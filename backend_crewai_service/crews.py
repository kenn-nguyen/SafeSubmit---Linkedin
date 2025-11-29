import os
import json
from crewai import Agent, Task, Crew, Process
from langchain_community.chat_models import ChatLiteLLM
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# --- Model Configuration ---
# Models are configurable via environment variables:
# - GEMINI_EVALUATION_MODEL_NAME: Model for job evaluation crew (default: gemini-2.5-flash)
#   Uses a faster, cost-effective model for efficient batch processing
#   Used for: job evaluation agents
# - GEMINI_PANEL_CREATION_MODEL_NAME: Model for agent panel/crew creation (default: gemini-2.5-pro)
#   Uses a more powerful model for intelligent crew assembly
#   Used for: creating agent panels for both evaluation and resume crews
# - GEMINI_RESUME_MODEL_NAME: Model for resume generation crew content creation (default: gemini-2.5-pro)
#   Uses a more powerful model for high-quality content creation
#   Used for: resume writing, editing, and finalization
# 
# Default model names (not loaded from .env)
EVALUATION_MODEL_NAME = "gemini-2.5-flash"
PANEL_CREATION_MODEL_NAME = "gemini-2.5-pro"
RESUME_MODEL_NAME = "gemini-2.5-pro"

# --- Utilities ---
def clean_json(text: str) -> str:
    # Handles common LLM JSON output issues (markdown, etc.)
    if "```json" in text:
        text = text.split("```json")[1].strip()
    if "```" in text:
        text = text.split("```")[0].strip()
    return text

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
You are a Master AI Team Architect who builds elite corporate hiring committees.
Your task is to recruit a panel of 4 specialist AI Agents to evaluate a job opportunity for a candidate.

**CANDIDATE'S STATED GOAL:**
"{user_intent}"

**CANDIDATE'S FULL RESUME:**
```
{resume_text}
```

**TARGET JOB DESCRIPTION:**
```
{job_description}
```

**INSTRUCTIONS:**
1.  **Analyze the Candidate's Goal:** The candidate wants to be a '{user_intent}'.
2.  **Appoint a Leader:** The final agent MUST be a domain-specific senior leader who acts as the Hiring Manager. Their role should be a realistic senior title for a '{user_intent}' (e.g., if the goal is 'Product Manager', the leader could be 'Principal Product Manager' or 'Director of Product'). This agent synthesizes all prior analysis into a final decision.
3.  **Recruit Supporting Experts:** Recruit 3 other agents with diverse, critical perspectives relevant to the role. Examples include a technical specialist, a cultural fit analyst, a business strategist, or an HR compliance officer.
4.  **Output:** Return a JSON Array of exactly 4 Agent objects.
    Each object must have: `name` (Creative, e.g., "TechLead_Dave"), `role` (Specific job title), `focus` (A concise question they must answer), and `emoji`.

*Example for a 'Senior Software Engineer' goal:*
[
  {{"name": "Code_Validator", "role": "Staff Engineer", "focus": "Does the candidate's tech stack and project experience (e.g., Python, AWS, microservices) meet the core technical requirements of this job?", "emoji": "💻"}},
  {{"name": "Growth_Assessor", "role": "Engineering Manager", "focus": "Does the candidate show evidence of mentorship, leadership, and the ability to handle complex, cross-team projects? Are they a good long-term investment?", "emoji": "📈"}},
  {{"name": "HR_Screener", "role": "HR Business Partner", "focus": "Are there any red flags? Assess communication skills from the resume's language and check for job stability or potential sponsorship needs.", "emoji": "📋"}},
  {{"name": "Hiring_Manager_AI", "role": "Director of Engineering", "focus": "Synthesizing all analyses, what is the final verdict? Provide a match score (0-100), visa risk (LOW, MEDIUM, HIGH), and a concise reasoning for a hire/no-hire decision.", "emoji": "🚀"}}
]
"""

BUILD_RESUME_PANEL_PROMPT = lambda resume_text, user_intent, job_description: f"""
You are an Editorial Director at a top-tier career branding agency.
Your task is to assemble a "resume ghostwriting" team of 4 AI specialists to tailor a candidate's resume for a specific job.

**CANDIDATE'S GOAL:** '{user_intent}'

**CANDIDATE'S FULL RESUME:**
```
{resume_text}
```

**TARGET JOB DESCRIPTION:**
```
{job_description}
```

**INSTRUCTIONS:**
1.  **Form a Workflow-Based Team:** Recruit a team of 4 agents that represents a logical, sequential workflow for resume creation.
2.  **Define Roles:** The team should consist of a strategist, a writer, a quantifier, and a finalizer.
3.  **Output:** Return a JSON Array of exactly 4 Agent objects.
    Each object must have: `name`, `role`, `focus` (Their specific instruction in the workflow), and `emoji`.

*Example:*
[
  {{"name": "ATS_Strategist", "role": "Resume Analyst", "focus": "Analyze the job description to extract the top 10 keywords and skills. Create a bullet-point 'tailoring strategy' outlining what to emphasize, de-emphasize, or add.", "emoji": "🗺️"}},
  {{"name": "Content_Crafter", "role": "Lead Ghostwriter", "focus": "Using the strategist's plan, rewrite the resume's summary and experience sections. Focus on compelling language and strong action verbs.", "emoji": "✍️"}},
  {{"name": "Metrics_Booster", "role": "Impact Consultant", "focus": "Review the rewritten draft and suggest 3-5 places where duties can be turned into quantifiable results (e.g., 'Managed a team' -> 'Led a team of 5, increasing output by 15%').", "emoji": "📊"}},
  {{"name": "Final_Editor", "role": "ATS Compliance Editor", "focus": "Incorporate the metrics and perform a final polish. Format the entire document into a pristine, single-column, ATS-friendly Markdown resume. Ensure zero grammatical errors.", "emoji": "🧐"}}
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
"""

# --- CREW 1, Phase 1: Build Evaluation Panel ---
def build_evaluation_panel(resume_text: str, user_intent: str, on_log):
    """
    Builds a hiring committee panel of 4 AI agents.
    Note: A dummy job description is used as the panel should be generic based on user intent, not a specific job.
    """
    on_log("Building agent evaluation panel...", 'info', 'Architect')
    
    # Using a generic job description to build a reusable panel
    dummy_job_description = f"A senior role focused on {user_intent}."

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

    panel_crew = Crew(agents=[panel_architect], tasks=[panel_creation_task], verbose=1)
    panel_json_str = panel_crew.kickoff()
    
    try:
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
        
    evaluation_crew = Crew(agents=agents, tasks=tasks, process=Process.sequential, verbose=2)
    
    try:
        final_result = evaluation_crew.kickoff()
        on_log("Evaluation crew finished successfully.", 'info', 'Dispatcher')
        
        result_dict = {}
        if isinstance(final_result, str):
            result_dict = json.loads(clean_json(final_result))
        else:
            result_dict = final_result
            
        # The agent panel is now passed in, so it's no longer added here.
            # It will be handled at the batch level.
        result_dict['id'] = job['id'] # Add the job ID to the result
        return result_dict
    except Exception as e:
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
    
    panel_crew = Crew(agents=[editorial_director], tasks=[panel_creation_task], verbose=1)
    panel_json_str = panel_crew.kickoff()

    try:
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
            description=f"**Your Assignment:**\n- Your Name: {config['name']}\n- Your Focus: {config['focus']}\n\n**CONTEXT:**\n- Candidate's Goal: {user_intent}\n- Original Resume: {resume_text}\n- Target Job: {job['description']}\n\nUse the output from the previous agent as your primary input.",
            expected_output='Your specific contribution to the resume, whether it is a strategy, rewritten content, metric suggestions, or the final Markdown.',
            agent=agent
        )
        tasks.append(task)
        
    resume_crew = Crew(agents=agents, tasks=tasks, process=Process.sequential, verbose=2)
    
    try:
        final_resume = resume_crew.kickoff()
        on_log("Resume generation finished successfully.", 'info', 'Dispatcher')
        return final_resume
    except Exception as e:
        on_log(f"Resume crew failed during execution: {e}", 'error', 'Dispatcher')
        return f"Error: The resume generation process failed. Details: {e}"
