
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { Job, Agent } from "../types";
import { 
  AI_CONFIG, 
  BUILD_PANEL_PROMPT,
  AGENT_SYSTEM_INSTRUCTION,
  FINAL_AGENT_SYSTEM_INSTRUCTION,
  getAgentTaskPrompt,
  RESUME_CREW_PROMPTS
} from "../constants";

// Initialize with a long timeout (10 minutes)
const ai = new GoogleGenAI({ 
  apiKey: process.env.API_KEY,
  // @ts-ignore 
  requestOptions: { timeout: 600000 } 
});

export interface JobAnalysisResult {
  id: string;
  matchScore: number;
  visaRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning?: string;
  evaluatedBy?: string;
}

// --- Utils ---
const cleanJson = (text: string) => text.replace(/```json/g, '').replace(/```/g, '').trim();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Rate Limiter ---
let apiExecutionQueue: Promise<any> = Promise.resolve();
let lastCallTimestamp = 0;
const MIN_INTERVAL_MS = 5000;

async function generateWithRetry(model: string, params: any, retries = 3) { 
  const operation = async () => {
    const now = Date.now();
    const timeSinceLast = now - lastCallTimestamp;
    if (timeSinceLast < MIN_INTERVAL_MS) {
      await delay(MIN_INTERVAL_MS - timeSinceLast);
    }

    for (let i = 0; i < retries; i++) {
      try {
        const result = await ai.models.generateContent({ model, ...params });
        lastCallTimestamp = Date.now();
        return result;
      } catch (error: any) {
        const isRateLimit = error?.status === 429 || error?.code === 429 || 
          (error?.message && (error.message.includes('429') || error.message.includes('quota')));
        
        if (isRateLimit) {
          if (i === retries - 1) throw error;
          const waitTime = Math.pow(2, i + 1) * 2000;
          console.warn(`Rate limit hit (Attempt ${i+1}). Retrying in ${waitTime}ms...`);
          await delay(waitTime);
          continue;
        }
        throw error;
      }
    }
    throw new Error("Max retries exceeded");
  };

  const resultPromise = apiExecutionQueue.then(operation);
  apiExecutionQueue = resultPromise.catch(() => {});
  return resultPromise;
}

// ============================================================================
//  CREW AI ENGINE (Custom TypeScript Implementation)
//  Mimics the structure of CrewAI / LangGraph Nodes
// ============================================================================

class CrewAgent {
  constructor(
    public name: string,
    public role: string,
    public focus: string
  ) {}

  async execute(
    context: string, 
    job: Job, 
    previousAnalyses: string[]
  ): Promise<string> {
    const prompt = getAgentTaskPrompt(context, job, { name: this.name, focus: this.focus }, previousAnalyses);
    
    const response = await generateWithRetry(AI_CONFIG.BATCH_MODEL_NAME, {
      contents: prompt,
      config: {
        systemInstruction: AGENT_SYSTEM_INSTRUCTION,
        temperature: 0.3,
      }
    });
    
    return response.text || `${this.name}: No analysis provided.`;
  }
}

class ManagerAgent extends CrewAgent {
  async synthesize(
    context: string, 
    job: Job, 
    previousAnalyses: string[]
  ): Promise<JobAnalysisResult> {
    const prompt = getAgentTaskPrompt(context, job, { name: this.name, focus: this.focus }, previousAnalyses);
    
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        matchScore: { type: Type.INTEGER },
        visaRisk: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH"] },
        reasoning: { type: Type.STRING },
      },
      required: ["matchScore", "visaRisk", "reasoning"]
    };

    const response = await generateWithRetry(AI_CONFIG.BATCH_MODEL_NAME, {
      contents: prompt,
      config: {
        systemInstruction: FINAL_AGENT_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1,
      }
    });

    const result = JSON.parse(cleanJson(response.text || '{}'));
    return {
      id: job.id,
      ...result,
      evaluatedBy: this.name,
    };
  }
}

class Crew {
  private agents: CrewAgent[];
  private manager: ManagerAgent;

  constructor(
    agentConfigs: Agent[], 
    private onLog: (msg: string, type: 'agent' | 'info' | 'success', name: string) => void
  ) {
    // Convert generic config objects into Class Instances
    const allAgents = agentConfigs.map(a => new CrewAgent(a.name, a.role, a.focus));
    
    // The last agent is promoted to Manager
    const last = allAgents.pop();
    if (!last) throw new Error("Crew needs at least 1 agent");
    
    this.agents = allAgents;
    this.manager = new ManagerAgent(last.name, last.role, last.focus);
  }

  async kickoff(job: Job, resumeText: string): Promise<JobAnalysisResult> {
    const previousAnalyses: string[] = [];

    // 1. Run Standard Agents sequentially (The "Crew")
    for (const agent of this.agents) {
      this.onLog(`Task delegated to ${agent.name} (${agent.role})`, 'agent', agent.name);
      const analysis = await agent.execute(resumeText, job, previousAnalyses);
      previousAnalyses.push(analysis);
      this.onLog(`Analysis complete. Handoff -> Next Agent`, 'agent', agent.name);
    }

    // 2. Run Manager to Synthesize
    this.onLog(`All reports submitted. ${this.manager.name} is finalizing decision...`, 'agent', this.manager.name);
    const finalResult = await this.manager.synthesize(resumeText, job, previousAnalyses);
    
    return finalResult;
  }
}

// ============================================================================
//  PUBLIC SERVICES
// ============================================================================

export const createAgentPanel = async (resumeText: string, userIntent: string): Promise<Agent[]> => {
  if (!process.env.API_KEY) {
    return [
      { id: '1', name: 'Default_Dave', role: 'Recruiter', focus: 'General Match', emoji: '🤖' },
      { id: '2', name: 'Visa_Vic', role: 'Legal', focus: 'Visa Risk', emoji: '🛂' },
      { id: '3', name: 'Tech_Tom', role: 'CTO', focus: 'Skills', emoji: '💻' }
    ];
  }

  try {
    const prompt = BUILD_PANEL_PROMPT(resumeText, userIntent);
    const response = await generateWithRetry(AI_CONFIG.BATCH_MODEL_NAME, {
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const agents = JSON.parse(cleanJson(response.text || '[]'));
    return agents.map((a: any, idx: number) => ({ ...a, id: `agent-${idx}` }));
  } catch (error) {
    console.error("Failed to recruit agents:", error);
    throw error; 
  }
};

export const analyzeJobsInBatch = async (
  resumeText: string, 
  jobs: Job[], 
  agents: Agent[],
  onLog?: (message: string, type: any, agentName?: string) => void,
  onJobComplete?: (result: JobAnalysisResult) => void
): Promise<JobAnalysisResult[]> => {
  
  if (!jobs.length) return [];
  if (!process.env.API_KEY) return []; // Handle no API key case if needed

  const allResults: JobAnalysisResult[] = [];
  let jobCounter = 0;

  try {
    // Instantiate the Crew Engine once
    // We pass a logger adapter to bridge the Class world with the UI world
    const crewLogger = (msg: string, type: any, name: string) => {
      if (onLog) onLog(msg, type, name);
    };

    const crew = new Crew(agents, crewLogger);

    for (const job of jobs) {
      jobCounter++;
      if (onLog) onLog(`Job ${jobCounter}/${jobs.length}: ${job.title}`, 'info');
      
      try {
        // Kickoff the crew for this specific job
        const result = await crew.kickoff(job, resumeText);
        
        allResults.push(result);
        if (onJobComplete) onJobComplete(result);
        
      } catch (crewError) {
        console.error(`Crew failed for job ${job.id}:`, crewError);
        if (onLog) onLog(`Crew failed for ${job.title}. Skipping.`, 'warning');
      }
    }
    return allResults;

  } catch (error) {
    console.error("Batch Analysis Fatal Error:", error);
    return [];
  }
};

export const generateTailoredResume = async (
  resumeText: string, 
  job: Job,
  onLog?: (msg: string, type: 'info' | 'success' | 'agent' | 'warning', agentName?: string) => void
): Promise<string> => {
  if (!process.env.API_KEY) return "Mock Resume PDF content...";

  try {
    // Step 1: The Architect (RAG & Strategy)
    if (onLog) onLog("Scanning resume for relevant assets & gaps...", "agent", "Resume_Architect");
    const architectPrompt = RESUME_CREW_PROMPTS.ARCHITECT(resumeText, job.title, job.company, job.description);
    const strategyResponse = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, { 
      contents: architectPrompt,
      config: { temperature: 0.3 }
    });
    const strategy = strategyResponse.text || "Focus on key skills.";

    // Step 2: The Ghostwriter (Content Drafting)
    if (onLog) onLog("Drafting new content based on strategy...", "agent", "Lead_Ghostwriter");
    const writerPrompt = RESUME_CREW_PROMPTS.WRITER(strategy, resumeText);
    const draftResponse = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, { 
      contents: writerPrompt,
      config: { temperature: 0.5 }
    });
    const draft = draftResponse.text || "Draft content.";

    // Step 3: The Editor (Polishing & Formatting)
    if (onLog) onLog("Polishing final document to Markdown...", "agent", "Chief_Editor");
    const editorPrompt = RESUME_CREW_PROMPTS.EDITOR(draft);
    const finalResponse = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, { 
      contents: editorPrompt,
      config: { temperature: 0.1 }
    });

    return finalResponse.text || "Error generating resume.";
  } catch (error) {
    console.error("Resume Generation Crew Failed:", error);
    if (onLog) onLog("Resume generation failed.", "warning");
    return "Failed to generate.";
  }
};
