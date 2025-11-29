import os
import json
from crewai import Agent, Task, Crew, Process

__all__ = [
    "build_evaluation_panel",
    "run_evaluation_crew",
    "run_resume_crew",
    "run_resume_crew_streaming",
    "build_resume_panel",
    "generate_evaluation_instructions",
    "run_evaluation_batch_llm",
]
from langchain_community.chat_models import ChatLiteLLM
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# --- Model Configuration ---
# Models are configurable via environment variables:
# - GEMINI_EVALUATION_MODEL_NAME: Model for job evaluation crew (default: gemini-2.5-flash)
#   Uses a faster, cost-effective model for efficient batch processing
#   Used for: job evaluation agents
# - GEMINI_PANEL_CREATION_MODEL_NAME: Model for agent panel/crew creation (default: gemini-2.5-flash)
#   Uses a faster model to reduce rate-limit pressure during panel builds
#   Used for: creating agent panels for both evaluation and resume crews
# - GEMINI_RESUME_MODEL_NAME: Model for resume generation crew content creation (default: gemini-2.5-flash)
#   Uses the lighter model by default to avoid quota/rate limits; override via env for higher quality
#   Used for: resume writing, editing, and finalization
# 
# Default model names (override via .env if set)
EVALUATION_MODEL_NAME = os.getenv("GEMINI_EVALUATION_MODEL_NAME", "gemini-2.5-flash")
PANEL_CREATION_MODEL_NAME = os.getenv("GEMINI_PANEL_CREATION_MODEL_NAME", "gemini-2.5-flash")
RESUME_MODEL_NAME = os.getenv("GEMINI_RESUME_MODEL_NAME", "gemini-2.5-flash")

# --- Utilities ---
def clean_json(text: str) -> str:
    # Handles common LLM JSON output issues (markdown, etc.)
    if "```json" in text:
        text = text.split("```json")[1].strip()
    if "```" in text:
        text = text.split("```")[0].strip()
    return text

def extract_output(result):
    """
    CrewAI 0.30+ returns a CrewOutput object instead of a raw string.
    This helper normalizes the return value to a primitive we can parse.
    """
    if isinstance(result, (str, list, dict)):
        return result
    for attr in ("raw_output", "raw", "output", "final_output"):
        if hasattr(result, attr):
            candidate = getattr(result, attr)
            if candidate:
                return candidate
    return str(result) if result is not None else ""


def ensure_valid_api_response(error: Exception):
    """
    Re-raises a clearer error when the Gemini API rejects a request because
    the API key is invalid/expired or when we hit rate limits. This helps the
    Flask layer respond with a user-friendly 400 instead of a generic 500.
    """
    message = str(error)
    key_error_indicators = [
        "api key expired",
        "api_key_invalid",
        "invalid api key",
        "keyinvalid",
        "permission_denied",
    ]
    rate_limit_indicators = [
        "rate limit",
        "quota exceeded",
        "quota_exceeded",
        "resource_exhausted",
        "429",
    ]

    if any(indicator in message.lower() for indicator in key_error_indicators):
        print(f"[CrewAI] API key validation error detected: {message}")
        raise ValueError(
            "Gemini API key is invalid or expired. Please renew the backend API key."
        ) from error
    if any(indicator in message.lower() for indicator in rate_limit_indicators):
        print(f"[CrewAI] Rate limit or quota error detected: {message}")
        raise ValueError(
            "Gemini API rate limit reached. Please wait a moment or reduce your batch size."
        ) from error

# --- LLM Instances ---
# We use ChatLiteLLM for more control, as requested by the user.
# Ensure GOOGLE_API_KEY, GEMINI_API_KEY, or API_KEY is set in your .env file.
# ChatLiteLLM will automatically pick up API keys from environment variables.
api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("API_KEY")
if not api_key:
    raise ValueError("GOOGLE_API_KEY, GEMINI_API_KEY, or API_KEY must be set in environment variables")

# Ensure API key is set in environment for LiteLLM (expects GOOGLE_API_KEY for Gemini)
os.environ["GOOGLE_API_KEY"] = api_key 

llm_evaluation = ChatLiteLLM(model=f"gemini/{EVALUATION_MODEL_NAME}", temperature=0.7)
llm_panel_creation = ChatLiteLLM(model=f"gemini/{PANEL_CREATION_MODEL_NAME}", temperature=0.7)
llm_resume = ChatLiteLLM(model=f"gemini/{RESUME_MODEL_NAME}", temperature=0.5)


# --- PROMPT TEMPLATES ---

BUILD_EVALUATION_PANEL_PROMPT = lambda resume_text, user_intent, job_description: f"""
You are a Master AI Team Architect assembling a rigorous hiring panel to judge this candidate across many jobs.
Recruit a panel of 4 specialist AI Agents that together produce a consistent, critical verdict.

**CANDIDATE GOAL:** "{user_intent}"

**CANDIDATE RESUME:**
```
{resume_text}
```

**TARGET JOB DESCRIPTION (representative of batch):**
```
{job_description}
```

**CRITERIA & DEFINITIONS (use for consistency across all jobs)**
- Match Score (0-100): Ability to do THIS role now, at the required level. 95-100 exceptional; 80-94 strong; 65-79 partial/adjacent; 45-64 weak; <45 poor. Base on evidence (skills, domain, scope/impact, leadership where relevant).
- Visa Risk (candidate perspective): LOW = authorized in-country or employer commonly/explicitly sponsors; MEDIUM = unclear; HIGH = needs sponsorship with no indication of support.

**GUIDELINES FOR PANEL DESIGN**
- Align expertise to the target role AND the candidate’s resume (tech/domain/industry/seniority/location).
- Avoid overlap; each agent owns a distinct lens that materially affects hire/no-hire.
- Include one agent owning visa/sponsorship feasibility from the candidate perspective.
- Include domain-specific Hiring Manager as final synthesizer of all inputs.
- Be critical and enforce consistent output formats from the panel.

**OUTPUT (JSON array of exactly 4 objects)**
Each: `name` (creative), `role` (realistic title), `focus` (single precise question they must answer), `emoji`.

*Example pattern:*
[
  {{"name": "Tech_DueDiligence", "role": "Staff/Principal {user_intent}", "focus": "Does tech/domain depth match the role’s must-haves?", "emoji": "💻"}},
  {{"name": "Scope_Assessor", "role": "Senior Leader", "focus": "Has the candidate operated at comparable scope (team/IC level, systems complexity, markets)?", "emoji": "📈"}},
  {{"name": "Visa_Compliance", "role": "HR/Legal Partner", "focus": "Are there sponsorship blockers? Rate visa risk per definition.", "emoji": "🛂"}},
  {{"name": "Hiring_Manager_AI", "role": "Director/Lead for this domain", "focus": "Final verdict with match score, visa risk, and concise reasoning. Enforce consistent JSON output.", "emoji": "🚀"}}
]
"""

BUILD_RESUME_PANEL_PROMPT = lambda resume_text, user_intent, job_description: f"""
You are an Editorial Director at a top-tier career branding agency.
Assemble a 4-agent resume ghostwriting team to tailor this candidate to the target job.

**CANDIDATE GOAL:** '{user_intent}'

**CANDIDATE RESUME:**
```
{resume_text}
```

**TARGET JOB DESCRIPTION:**
```
{job_description}
```

**GUIDELINES FOR PANEL DESIGN**
- Build a sequential workflow: Strategy -> Drafting -> Metrics -> Final ATS polish.
- Align to the job's domain, level, and key skills; ensure each role has a unique, non-overlapping focus.
- Drive quantifiable impact (numbers, scope, velocity, quality) and clear alignment to the role's top requirements.
- Enforce a single-column, ATS-friendly Markdown output and remove fluff.

**OUTPUT (JSON array of exactly 4 objects)**
Each object: `name`, `role`, `focus` (one crisp instruction for their stage), `emoji`.

*Example:*
[
  {{"name": "ATS_Strategist", "role": "Resume Analyst", "focus": "Extract top 10 skills/keywords from the job. Produce a bullet tailoring plan: what to emphasize, de-emphasize, or add to mirror the role.", "emoji": "🗺️"}},
  {{"name": "Content_Crafter", "role": "Lead Ghostwriter", "focus": "Rewrite summary and experiences using the strategy; keep language crisp, role-aligned, and impact-focused.", "emoji": "✍️"}},
  {{"name": "Metrics_Booster", "role": "Impact Consultant", "focus": "Add/strengthen 3-5 quantified wins (team size, revenue, latency, adoption, cost). Convert duties into measurable outcomes.", "emoji": "📊"}},
  {{"name": "Final_Editor", "role": "ATS Compliance Editor", "focus": "Polish into a clean, single-column, ATS-friendly Markdown resume; fix grammar, consistency, and ensure keywords remain.", "emoji": "🧐"}}
]
"""

AGENT_TASK_PROMPT = lambda resume_text, job_title, job_company, job_description, agent_name, agent_focus, previous_analyses: f"""
**CANDIDATE'S FULL RESUME:**
```
{resume_text}
```

**JOB DETAILS:**
- Title: {job_title}
- Company: {job_company}
- Description: {job_description}

**PRIOR ANALYSES FROM YOUR TEAM:**
{''.join(f'- {analysis} \\n' for analysis in previous_analyses) if previous_analyses else "You are the first agent. No prior analysis."}
---

**YOUR ASSIGNMENT:**
- Your Name: {agent_name}
- Your Specific Focus: {agent_focus}

Provide your analysis based *only* on your focus.

**DEFINITIONS AND SCORING**
- Match Score (0-100): Evidence the candidate can do THIS job now, at the stated level. 95-100 = exceptional, near-perfect alignment (skills/domain/scope/impact match role level); 80-94 = strong, clear evidence across most required skills and scope; 65-79 = partial/adjacent, some gaps in level, domain, or scope; 45-64 = weak, multiple gaps or step-up without proof; <45 = poor fit.
- Visa Risk (candidate perspective): Likelihood hiring would be blocked by sponsorship/authorization. LOW = work authorized in the role’s country OR explicit employer/role sponsorship is common/indicated; MEDIUM = unclear signals about authorization or sponsorship; HIGH = likely needs sponsorship with no indication the employer will sponsor.
- Be critical: map experience to the role’s seniority (team size, budget, systems complexity, leadership scope) and domain requirements. Use only facts from the resume and job description; if info is missing, state the gap in reasoning.

**REQUIRED OUTPUT (return ONLY valid JSON):**
{{
  "matchScore": <0-100 integer confidence>,
  "visaRisk": "LOW" | "MEDIUM" | "HIGH",
  "reasoning": "1-3 sentence justification based strictly on your focus.",
  "evaluatedBy": "{agent_name}"
}}
"""

# --- CREW 1, Phase 1: Build Evaluation Panel ---
def build_evaluation_panel(resume_text: str, user_intent: str, on_log):
    """
    Builds a hiring committee panel of 4 AI agents.
    Note: A dummy job description is used as the panel should be generic based on user intent, not a specific job.
    """
    on_log("Building agent evaluation panel...", 'info', 'Architect')
    
    # Using a generic job description to build a reusable panel
    dummy_job_description = f"A role focused on {user_intent}."

    panel_architect = Agent(
        role='AI Team Architect',
        goal='Recruit an optimal, 4-person hiring committee to evaluate job opportunities for a candidate.',
        backstory='An expert in designing multi-agent systems for critical business analysis.',
        llm=llm_panel_creation,
        verbose=True,
    )

    panel_creation_task = Task(
        description=BUILD_EVALUATION_PANEL_PROMPT(resume_text, user_intent, dummy_job_description),
        expected_output='A JSON array of 4 agent objects.',
        agent=panel_architect
    )

    panel_crew = Crew(agents=[panel_architect], tasks=[panel_creation_task], verbose=True)
    try:
        panel_json_str = extract_output(panel_crew.kickoff())
    except Exception as e:
        ensure_valid_api_response(e)
        raise
    
    try:
        if isinstance(panel_json_str, (list, dict)):
            agent_configs = panel_json_str
        else:
            agent_configs = json.loads(clean_json(panel_json_str))
        # Convert to frontend format
        agents_info = []
        for idx, config in enumerate(agent_configs):
            agents_info.append({
                "id": str(idx + 1),
                "name": config.get('name', f"Agent_{idx+1}"),
                "role": config.get('role', 'Expert'),
                "focus": config.get('focus', 'Analysis'),
                "emoji": config.get('emoji', '🤖')
            })
        on_log(f"Successfully built a panel of {len(agents_info)} agents.", 'info', 'Architect')
        return agents_info
    except json.JSONDecodeError as e:
        on_log(f"Failed to parse agent panel JSON: {e}. Raw output: {panel_json_str}", 'error', 'Architect')
        return []

def build_resume_panel(resume_text: str, user_intent: str, job_description: str, on_log):
    on_log("Building resume editing team...", 'info', 'Director')

    panel_creation_task = Task(
        description=BUILD_RESUME_PANEL_PROMPT(resume_text, user_intent, job_description),
        expected_output='A JSON array of 4 agent objects.',
        agent=Agent(
            role='Editorial Director',
            goal='Recruit a high-impact resume writing crew.',
            backstory='Expert in constructing resume ghostwriting teams.',
            llm=llm_panel_creation,
            verbose=True,
        )
    )

    panel_crew = Crew(agents=[panel_creation_task.agent], tasks=[panel_creation_task], verbose=True)
    try:
        panel_json_str = extract_output(panel_crew.kickoff())
    except Exception as e:
        ensure_valid_api_response(e)
        raise

    try:
        agent_configs = json.loads(clean_json(panel_json_str)) if isinstance(panel_json_str, str) else panel_json_str
        on_log(f"Resume team ready: {len(agent_configs)} agents.", 'info', 'Director')
        agents_info = []
        for idx, config in enumerate(agent_configs):
            agents_info.append({
                "id": str(idx + 1),
                "name": config.get('name', f"Agent_{idx+1}"),
                "role": config.get('role', 'Expert'),
                "focus": config.get('focus', 'Editing'),
                "emoji": config.get('emoji', '📝')
            })
        return agents_info
    except Exception as e:
        on_log(f"Failed to parse resume panel: {e}", 'error', 'Director')
        return []

def generate_evaluation_instructions(resume_text: str, user_intent: str) -> str:
    prompt = f"""
Act as a hiring committee coordinator. You will evaluate batches of jobs (up to 20 at once) for this candidate.

Candidate goal: {user_intent}
Candidate resume:
```
{resume_text}
```

Define clear, consistent instructions for evaluating jobs with two outputs per job: matchScore (0-100) and visaRisk (LOW, MEDIUM, HIGH).

Match Score definitions:
- 95-100 Exceptional: direct, level-appropriate evidence across skills/domain/scope/impact.
- 80-94 Strong: clear evidence on most must-haves; minor gaps only.
- 65-79 Partial/Adjacent: some alignment but notable gaps in level/domain/scope.
- 45-64 Weak: multiple gaps or step-up without proof.
- <45 Poor: little evidence for this role.

Visa Risk (candidate perspective):
- LOW: work authorized in-country OR employer commonly/explicitly sponsors.
- MEDIUM: signals unclear.
- HIGH: likely needs sponsorship with no indication of support.

Instructions:
- Be critical, concise, and consistent. Use only provided resume and job data.
- For each job, return JSON with fields: id, matchScore (int), visaRisk (LOW|MEDIUM|HIGH), reasoning (1-3 sentences), evaluatedBy ("Evaluator_Panel").
- Output a JSON array of job results, matching the input order of job IDs.
"""
    return prompt

def run_evaluation_batch_llm(resume_text: str, user_intent: str, jobs: list, instructions: str):
    job_snippets = "\n".join([f"- ID: {j.get('id')} | Title: {j.get('title')} | Company: {j.get('company')} | Desc: {j.get('description')}" for j in jobs])
    prompt = f"""{instructions}

Jobs to evaluate:
{job_snippets}

Return ONLY a JSON array of results.
"""
    try:
        raw_response = llm_evaluation.invoke(prompt)
    except Exception as e:
        ensure_valid_api_response(e)
        raise
    try:
        # ChatLiteLLM may return an AIMessage; always coerce to string then parse
        text = raw_response.content if hasattr(raw_response, "content") else raw_response
        data = text if isinstance(text, list) else json.loads(clean_json(text))
        # Normalize fields
        normalized = []
        for item in data:
            normalized.append({
                "id": str(item.get("id")),
                "matchScore": int(item.get("matchScore", 0)),
                "visaRisk": str(item.get("visaRisk", "HIGH")).upper(),
                "reasoning": item.get("reasoning", ""),
                "evaluatedBy": item.get("evaluatedBy", "Evaluator_Panel")
            })
        return normalized
    except Exception as e:
        raw_text = raw_response.content if hasattr(raw_response, "content") else raw_response
        print(f"Failed to parse batch eval: {e}, raw: {raw_text}")
        return []

# --- CREW 1, Phase 2: Run Evaluation ---
def run_evaluation_crew(resume_text: str, user_intent: str, job: dict, agent_panel: list, on_log):
    """
    Runs the job evaluation using a pre-built hiring committee.
    """
    on_log(f"Starting evaluation for job '{job['title']}'...", 'info', 'Dispatcher')

    agents = []
    tasks = []

    for idx, config in enumerate(agent_panel):
        agent = Agent(
            role=config['role'],
            goal=f"Evaluate job '{job['title']}' based on your focus: {config['focus']}.",
            backstory=f"You are {config['name']}, an expert in your domain.",
            llm=llm_evaluation,
            verbose=True,
        )
        agents.append(agent)
        
        task = Task(
            description=AGENT_TASK_PROMPT(
                resume_text, job['title'], job['company'], job['description'],
                config['name'], config['focus'], []
            ),
            expected_output='A concise paragraph of analysis if you are an expert, or a final JSON object if you are the Hiring Manager.',
            agent=agent
        )
        tasks.append(task)

    evaluation_crew = Crew(agents=agents, tasks=tasks, process=Process.sequential, verbose=True)

    try:
        final_result = extract_output(evaluation_crew.kickoff())
        on_log("Evaluation crew finished successfully.", 'info', 'Dispatcher')
        
        result_dict = {}
        if isinstance(final_result, dict):
            result_dict = final_result
        elif isinstance(final_result, str):
            result_dict = json.loads(clean_json(final_result))
        else:
            result_dict = {"matchScore": 0, "visaRisk": "HIGH", "reasoning": "Invalid crew output format.", "evaluatedBy": "System"}

        # Normalize required fields so the frontend always gets usable values
        result_dict['matchScore'] = int(result_dict.get('matchScore', 0)) if str(result_dict.get('matchScore', '')).isdigit() else 0
        visa = str(result_dict.get('visaRisk', 'HIGH')).upper()
        result_dict['visaRisk'] = visa if visa in ["LOW", "MEDIUM", "HIGH"] else "HIGH"
        result_dict['reasoning'] = result_dict.get('reasoning', 'No reasoning provided.')
        result_dict['evaluatedBy'] = result_dict.get('evaluatedBy', 'Hiring_Manager_AI')
            
        # The agent panel is now passed in, so it's no longer added here.
            # It will be handled at the batch level.
        result_dict['id'] = job['id'] # Add the job ID to the result
        return result_dict
    except Exception as e:
        ensure_valid_api_response(e)
        on_log(f"Evaluation crew failed for job '{job['title']}': {e}", 'error', 'Dispatcher')
        return {"id": job['id'], "matchScore": 0, "visaRisk": "HIGH", "reasoning": "Crew failed during evaluation.", "evaluatedBy": "System"}


# --- AUTONOMOUS CREW 2: RESUME GENERATION ---
def run_resume_crew(resume_text: str, user_intent: str, job: dict, on_log):
    """
    An autonomous crew that first builds an editorial team and then generates a tailored resume.
    """
    on_log("Resume generation crew starting...", 'info', 'Dispatcher')

    # --- Phase 1: Build the Editorial Team ---
    # Panel creation uses dedicated panel creation model (configurable via environment variable)
    editorial_director = Agent(
        role='Editorial Director',
        goal='Recruit an elite, 4-person ghostwriting team to tailor a resume.',
        backstory='An expert in building creative teams for high-impact content creation.',
        llm=llm_panel_creation,  # Use dedicated panel creation model
        verbose=True,
    )

    panel_creation_task = Task(
        description=BUILD_RESUME_PANEL_PROMPT(resume_text, user_intent, job['description']),
        expected_output='A JSON array of 4 agent objects.',
        agent=editorial_director
    )
    
    panel_crew = Crew(agents=[editorial_director], tasks=[panel_creation_task], verbose=True)
    try:
        panel_json_str = extract_output(panel_crew.kickoff())
    except Exception as e:
        ensure_valid_api_response(e)
        raise

    try:
        if isinstance(panel_json_str, (list, dict)):
            agent_configs = panel_json_str
        else:
            agent_configs = json.loads(clean_json(panel_json_str))
        on_log(f"Successfully built an editorial team of {len(agent_configs)} agents.", 'info', 'Director')
    except json.JSONDecodeError as e:
        on_log(f"Failed to parse editorial panel JSON: {e}. Raw output: {panel_json_str}", 'error', 'Director')
        return "Error: Failed to build the resume writing team."

    # --- Phase 2: Run the Resume Generation Workflow ---
    agents = []
    tasks = []

    for config in agent_configs:
        agent = Agent(
            role=config['role'],
            goal=f"Contribute to tailoring a resume based on your focus: {config['focus']}.",
            backstory=f"You are {config['name']}, a key member of a resume ghostwriting team.",
            llm=llm_resume,
            verbose=True,
        )
        agents.append(agent)

        task = Task(
            description=(
                f"**Your Assignment:**\n"
                f"- Your Name: {config['name']}\n"
                f"- Your Focus: {config['focus']}\n\n"
                f"**CONTEXT:**\n"
                f"- Candidate's Goal: {user_intent}\n"
                f"- Original Resume: {resume_text}\n"
                f"- Target Job: {job['description']}\n\n"
                f"**GUARDRAILS:**\n"
                f"- Be factual: never invent employers, dates, or numbers not implied by the resume.\n"
                f"- Keep single-column, ATS-friendly Markdown; use concise bullet points with strong verbs.\n"
                f"- Preserve/boost keywords from the job description; do not delete role-critical skills.\n"
                f"- Quantify impact where possible (team size, revenue, latency, adoption, cost, uptime).\n"
                f"- Use prior agent output as primary input and keep a consistent narrative/tense.\n"
            ),
            expected_output='Your contribution for this stage (strategy, rewrite, metrics, or final polished Markdown). Do NOT return JSON.',
            agent=agent
        )
        tasks.append(task)
        
    resume_crew = Crew(agents=agents, tasks=tasks, process=Process.sequential, verbose=True)

    try:
        final_resume = extract_output(resume_crew.kickoff())
        on_log("Resume generation finished successfully.", 'info', 'Dispatcher')
        return final_resume
    except Exception as e:
        ensure_valid_api_response(e)
        on_log(f"Resume crew failed during execution: {e}", 'error', 'Dispatcher')
        return f"Error: The resume generation process failed. Details: {e}"


def run_resume_crew_streaming(resume_text: str, user_intent: str, job: dict, on_log):
    """
    Streaming wrapper around run_resume_crew that yields phase updates and the final resume.
    Emits JSON-serializable dicts intended for JSONL/SSE streaming.
    """
    # Phase: panel build
    on_log("Resume generation crew starting...", 'info', 'Dispatcher')
    yield {"phase": "architect", "message": "Building editorial team", "percent": 15}

    # Build panel
    editorial_director = Agent(
        role='Editorial Director',
        goal='Recruit an elite, 4-person ghostwriting team to tailor a resume.',
        backstory='An expert in building creative teams for high-impact content creation.',
        llm=llm_panel_creation,
        verbose=True,
    )

    panel_creation_task = Task(
        description=BUILD_RESUME_PANEL_PROMPT(resume_text, user_intent, job['description']),
        expected_output='A JSON array of 4 agent objects.',
        agent=editorial_director
    )

    panel_crew = Crew(agents=[editorial_director], tasks=[panel_creation_task], verbose=True)
    try:
        panel_json_str = extract_output(panel_crew.kickoff())
    except Exception as e:
        ensure_valid_api_response(e)
        msg = f"Failed to build editorial team: {e}"
        on_log(msg, 'error', 'Director')
        yield {"phase": "error", "message": msg, "percent": 100}
        return

    try:
        if isinstance(panel_json_str, (list, dict)):
            agent_configs = panel_json_str
        else:
            agent_configs = json.loads(clean_json(panel_json_str))
        on_log(f"Successfully built an editorial team of {len(agent_configs)} agents.", 'info', 'Director')
        yield {"phase": "architect", "message": "Editorial team ready", "percent": 30}
    except json.JSONDecodeError as e:
        msg = f"Failed to parse editorial panel JSON: {e}"
        on_log(f"{msg}. Raw output: {panel_json_str}", 'error', 'Director')
        yield {"phase": "error", "message": msg, "percent": 100}
        return

    agents = []
    tasks = []
    for idx, config in enumerate(agent_configs):
        agent = Agent(
            role=config['role'],
            goal=f"Contribute to tailoring a resume based on your focus: {config['focus']}.",
            backstory=f"You are {config['name']}, a key member of a resume ghostwriting team.",
            llm=llm_resume,
            verbose=True,
        )
        agents.append(agent)

        task = Task(
            description=(
                f"**Your Assignment:**\n"
                f"- Your Name: {config['name']}\n"
                f"- Your Focus: {config['focus']}\n\n"
                f"**CONTEXT:**\n"
                f"- Candidate's Goal: {user_intent}\n"
                f"- Original Resume: {resume_text}\n"
                f"- Target Job: {job['description']}\n\n"
                f"**GUARDRAILS:**\n"
                f"- Be factual: never invent employers, dates, or numbers not implied by the resume.\n"
                f"- Keep single-column, ATS-friendly Markdown; use concise bullet points with strong verbs.\n"
                f"- Preserve/boost keywords from the job description; do not delete role-critical skills.\n"
                f"- Quantify impact where possible (team size, revenue, latency, adoption, cost, uptime).\n"
                f"- Use prior agent output as primary input and keep a consistent narrative/tense.\n"
            ),
            expected_output='Your contribution for this stage (strategy, rewrite, metrics, or final polished Markdown). Do NOT return JSON.',
            agent=agent
        )
        tasks.append(task)

    resume_crew = Crew(agents=agents, tasks=tasks, process=Process.sequential, verbose=True)

    try:
        # Emit a phase before running the crew and update per agent index
        yield {"phase": "writer", "message": "Running ghostwriting crew", "percent": 45}
        final_resume = extract_output(resume_crew.kickoff())
        yield {"phase": "editor", "message": "Polishing and finalizing", "percent": 85}
        on_log("Resume generation finished successfully.", 'info', 'Dispatcher')
        yield {"generatedResume": final_resume, "phase": "done", "percent": 100}
    except Exception as e:
        ensure_valid_api_response(e)
        msg = f"Resume crew failed during execution: {e}"
        on_log(msg, 'error', 'Dispatcher')
        yield {"phase": "error", "message": msg, "percent": 100}
