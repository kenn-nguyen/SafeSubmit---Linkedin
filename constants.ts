
export const AI_CONFIG = {
  // Using user-specified model for batch processing and resume tailoring.
  BATCH_MODEL_NAME: 'gemini-2.0-flash-lite', 
  TAILOR_MODEL_NAME: 'gemini-2.0-flash-lite',
  // Reduced from 12 to 4. 
  // Each job triggers ~3 agent calls (sequential). 4 jobs * 3 agents = 12 calls per batch.
  // This keeps the loop responsive and within rate limit buffers.
  BATCH_SIZE: 4,
};

// --- 1. Agent Builder Prompt ---
export const BUILD_PANEL_PROMPT = (resumeText: string, userIntent: string) => `
You are an Expert AI Team Architect.
Based on the Candidate's Resume and their Target Role, recruit a panel of 3 AI Agents to evaluate job opportunities. The final agent should always be a "Manager" or "Synthesizer" type role.

CANDIDATE CONTEXT:
"${userIntent}"

RESUME SUMMARY:
"${resumeText.slice(0, 1500)}..."

OUTPUT: Return a JSON Array of exactly 3 Agent objects.
Each agent must have:
- name: Creative name (e.g., "TechLead_Dave")
- role: Their specific job title
- focus: What specific criteria they judge (e.g., "Visa Compliance", "React Proficiency", "Culture Fit")
- emoji: A representative single emoji

Example:
[
  { "name": "Code_Guru", "role": "Senior Engineering Manager", "focus": "Technical Skills Match", "emoji": "👨‍💻" },
  { "name": "Visa_Guard", "role": "Immigration Specialist", "focus": "H1B/Sponsorship Safety", "emoji": "🛂" },
  { "name": "Hiring_Manager_AI", "role": "Synthesizing Manager", "focus": "Final Decision and Score", "emoji": "🚀" }
]
`;

// --- 2. CrewAI-Style Sequential Agent Prompts (Analysis Phase) ---

// This is the instruction given to EVERY agent in the crew.
export const AGENT_SYSTEM_INSTRUCTION = `
You are an expert AI agent, part of a multi-agent crew evaluating job opportunities for a candidate.
Your goal is to perform a specific task based on your assigned 'focus'.
You will receive the candidate's resume, the job details, and the analytical notes from previous agents in your crew.

RULES:
1.  Adhere STRICTLY to your assigned 'focus'. Do not evaluate criteria outside your scope.
2.  Your output must be a single, concise paragraph of analysis.
3.  Begin your output with your name, e.g., "Code_Guru Analysis: ..."
`;

// This prompt is used for the final agent in the chain to synthesize the results.
export const FINAL_AGENT_SYSTEM_INSTRUCTION = `
You are the final agent in a multi-agent crew, acting as the 'Hiring Manager'.
Your task is to synthesize the analyses from your team members into a final, structured JSON output.

RULES:
1.  Read the candidate's resume, the job details, and all previous agent analyses.
2.  Produce a final 'matchScore' (0-100), 'visaRisk' ('LOW', 'MEDIUM', 'HIGH'), and a 'reasoning' summary (max 15 words).
3.  Your output MUST be a valid JSON object, and nothing else. Do not use markdown.
`;

// This function builds the prompt for each agent in the sequence.
export const getAgentTaskPrompt = (
  resumeText: string,
  job: { title: string; company: string; description: string; },
  agent: { name: string; focus: string; },
  previousAnalyses: string[]
): string => `
CANDIDATE RESUME:
"""
${resumeText.slice(0, 3000)}
"""

JOB DETAILS:
- Title: ${job.title}
- Company: ${job.company}
- Description: ${job.description.slice(0, 2000)}

PREVIOUS AGENT ANALYSES:
${previousAnalyses.length > 0 ? previousAnalyses.join('\n\n') : "You are the first agent. No prior analysis."}
---

YOUR TASK:
- Your Name: ${agent.name}
- Your Focus: ${agent.focus}

Please provide your analysis based ONLY on your focus.
`;

// --- 3. Resume Generation Crew Prompts ---

export const RESUME_CREW_PROMPTS = {
  ARCHITECT: (resume: string, jobTitle: string, jobCompany: string, jobDesc: string) => `
    ROLE: You are the 'Resume Architect'.
    TASK: Perform a gap analysis and indexing of the candidate's resume against the target job.
    
    1.  **Analyze Job**: Identify the top 5 critical hard skills and 2 soft skills required for the '${jobTitle}' role at '${jobCompany}'.
    2.  **RAG Indexing**: Scan the RESUME and extract/index the specific experience blocks that prove these skills.
    3.  **Strategy**: Outline a bullet-point strategy on how to tailor the resume. What to emphasize? What to remove?
    
    TARGET JOB:
    ${jobDesc.slice(0, 3000)}
    
    CANDIDATE RESUME:
    ${resume.slice(0, 4000)}
  `,

  WRITER: (strategy: string, resume: string) => `
    ROLE: You are the 'Lead Ghostwriter'.
    TASK: Rewrite the candidate's Professional Experience and Summary based on the provided STRATEGY.
    
    GUIDELINES:
    - Use strong action verbs (Architected, Deployed, Spearheaded).
    - Quantify results (e.g., "Improved latency by 20%").
    - Do not worry about final formatting. Focus on the CONTENT density and keyword matching.
    
    ARCHITECT'S STRATEGY:
    ${strategy}
    
    ORIGINAL CONTEXT:
    ${resume.slice(0, 4000)}
  `,

  EDITOR: (draft: string) => `
    ROLE: You are the 'Chief Editor'.
    TASK: Take the raw draft content and format it into a pristine, ATS-friendly MARKDOWN resume.
    
    GUIDELINES:
    - Add a clear header (Name, Role).
    - Use standard Markdown headers (#, ##).
    - Ensure bullet points are clean.
    - Fix any grammar or flow issues.
    - Return ONLY the Markdown content.
    
    RAW DRAFT:
    ${draft}
  `
};
