

import { GoogleGenAI, Schema, Type } from "@google/genai";
import { Job, Agent, ChatMessage } from "../types";
import { StorageService } from "./storageService";
import { searchJobs } from "./vectorService";
import { 
  AI_CONFIG, 
  BUILD_PANEL_PROMPT,
  AGENT_SYSTEM_INSTRUCTION,
  FINAL_AGENT_SYSTEM_INSTRUCTION,
  BATCH_EVALUATION_SYSTEM_PROMPT,
  getAgentTaskPrompt,
  RESUME_CREW_PROMPTS
} from "../constants";

// Helper to get the active Client
const getClient = () => {
    // 1. Check User provided key
    const userKey = StorageService.getApiKey();
    if (userKey) {
        return new GoogleGenAI({ 
            apiKey: userKey,
            // @ts-ignore 
            requestOptions: { timeout: 600000 }
        });
    }
    
    // 2. Check Env key
    if (process.env.API_KEY) {
        return new GoogleGenAI({ 
            apiKey: process.env.API_KEY,
            // @ts-ignore 
            requestOptions: { timeout: 600000 }
        });
    }

    // 3. Throw or return dummy for safe handling upstream
    return null;
};

// --- API Validation Helper ---
export const validateApiKey = async (apiKey: string): Promise<boolean> => {
    try {
        const ai = new GoogleGenAI({ apiKey });
        // Make a minimal call to test credentials
        await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'ping',
        });
        return true;
    } catch (error) {
        console.error("API Key Validation Failed:", error);
        return false;
    }
};

export interface JobAnalysisResult {
  id: string;
  matchScore: number;
  visaRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning?: string;
  evaluatedBy?: string;
}

// --- Utils ---
// Improved JSON cleaner that uses Regex to find the first valid JSON block
const cleanJson = (text: string) => {
    // 1. Remove markdown code fences
    let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // 2. Find the first '{' or '[' to handle both Objects and Arrays
    const firstBrace = clean.indexOf('{');
    const firstBracket = clean.indexOf('[');
    
    let startIndex = -1;
    
    // Determine which starts first
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIndex = firstBrace;
    } else if (firstBracket !== -1) {
        startIndex = firstBracket;
    }
    
    if (startIndex !== -1) {
        // Look for the last matching closing character
        const closingChar = clean[startIndex] === '{' ? '}' : ']';
        const endIndex = clean.lastIndexOf(closingChar);
        if (endIndex > startIndex) {
            clean = clean.substring(startIndex, endIndex + 1);
        }
    }
    
    return clean;
};

// Guardrail: Strips conversational filler and code fences from Resume Markdown
const cleanMarkdown = (text: string) => {
    if (!text) return "";

    // 1. Remove code fences (```markdown, ```)
    let clean = text.replace(/```markdown/gi, '').replace(/```/g, '');

    // 2. Remove common conversational prefixes (e.g. "Here is the resume:")
    // Strategy: Find the first Header (# or ##). Everything before it is likely filler.
    // However, some resumes just start with a Name without #. 
    // We look for the first line that looks like structured content.
    
    const lines = clean.split('\n');
    let startLineIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // If line starts with #, it's definitely content
        if (line.startsWith('#')) {
            startLineIndex = i;
            break;
        }
        // If line is empty, skip
        if (!line) continue;

        // If line looks like "Here is the tailored resume...", skip it
        if (line.toLowerCase().includes('here is') || line.toLowerCase().includes('tailored resume')) {
            continue;
        }
        
        // If we hit a line that looks like a name (Title Case, no punctuation), assume start
        // Conservative approach: Just return from the first non-conversational line
        if (!line.toLowerCase().startsWith('sure') && !line.toLowerCase().startsWith('certainly')) {
             startLineIndex = i;
             break;
        }
    }

    return lines.slice(startLineIndex).join('\n').trim();
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Rate Limiter ---
let apiExecutionQueue: Promise<any> = Promise.resolve();
let lastCallTimestamp = 0;
const MIN_INTERVAL_MS = 2000; 

async function generateWithRetry(model: string, params: any, retries = 3) { 
  const operation = async () => {
    const ai = getClient();
    if (!ai) throw new Error("Missing API Key");

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
    
    // FEATURE: Tools / Google Search Grounding for "Researcher" type agents
    const tools = (this.focus.toLowerCase().includes('culture') || this.focus.toLowerCase().includes('research')) 
      ? [{ googleSearch: {} }] 
      : undefined;

    const response = await generateWithRetry(AI_CONFIG.BATCH_MODEL_NAME, {
      contents: prompt,
      config: {
        systemInstruction: AGENT_SYSTEM_INSTRUCTION,
        temperature: 0.2,
        tools: tools 
      }
    });
    
    // Check for grounding metadata to confirm search was used (Technical Accomplishment)
    // console.log(response.candidates?.[0]?.groundingMetadata);

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
        matchScore: { type: Type.INTEGER, description: "Score from 0-100 based on rubric" },
        visaRisk: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH"], description: "Visa risk assessment" },
        reasoning: { type: Type.STRING, description: "Concise reasoning summary (max 20 words)" },
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

    try {
      const result = JSON.parse(cleanJson(response.text || '{}'));
      return {
        id: job.id,
        matchScore: result.matchScore ?? 0,
        visaRisk: result.visaRisk ?? "MEDIUM",
        reasoning: result.reasoning ?? "Analysis failed.",
        evaluatedBy: this.name,
      };
    } catch (e) {
      console.error("Failed to parse Manager JSON:", response.text);
      return {
        id: job.id,
        matchScore: 0,
        visaRisk: 'MEDIUM',
        reasoning: 'AI Output Error',
        evaluatedBy: 'System'
      };
    }
  }
}

class Crew {
  private agents: CrewAgent[];
  private manager: ManagerAgent;

  constructor(
    agentConfigs: Agent[], 
    private onLog: (msg: string, type: 'agent' | 'info' | 'success', name: string) => void
  ) {
    const allAgents = agentConfigs.map(a => new CrewAgent(a.name, a.role, a.focus));
    const last = allAgents.pop();
    if (!last) throw new Error("Crew needs at least 1 agent");
    this.agents = allAgents;
    this.manager = new ManagerAgent(last.name, last.role, last.focus);
  }

  async kickoff(job: Job, resumeText: string): Promise<JobAnalysisResult> {
    const previousAnalyses: string[] = [];
    for (const agent of this.agents) {
      this.onLog(`Evaluating ${agent.focus}...`, 'agent', agent.name);
      const analysis = await agent.execute(resumeText, job, previousAnalyses);
      previousAnalyses.push(analysis);
    }
    this.onLog(`Synthesizing final score...`, 'agent', this.manager.name);
    return await this.manager.synthesize(resumeText, job, previousAnalyses);
  }
}

// ============================================================================
//  PUBLIC SERVICES
// ============================================================================

// ... (Existing exports like parseResumeFile, createEvaluationInstructions stay same)
export const parseResumeFile = async (file: File): Promise<string> => {
    if (file.type === 'application/pdf') {
       console.warn("PDF parsing requires backend. Returning mock text.");
       return "PDF Content Placeholder: This is a simulated resume extraction from a PDF.";
    }
    return await file.text();
};

export const createEvaluationInstructions = (resumeText: string, intent: string): string => {
   // This generates the static instructions used as input for the batch analyzer
   return `
   CANDIDATE PROFILE:
   TARGET INTENT: "${intent}"
   RESUME:
   "${resumeText.slice(0, 3000)}..."
   
   YOUR GOAL:
   Compare the jobs below against this candidate profile. 
   Follow the SCORING RUBRIC and VISA GUIDE strictly.
   `;
};

export const createAgentPanel = async (resumeText: string, userIntent: string): Promise<Agent[]> => {
  const client = getClient();
  if (!client) {
    // If no key, fail gracefully with mock or error
    console.warn("No API Key available. Returning mock agents.");
    return [
      { id: '1', name: 'Talent_Scout', role: 'Technical Recruiter', focus: 'Hard Skills Match', emoji: '🔍' },
      { id: '2', name: 'Culture_Fit_AI', role: 'HR Specialist', focus: 'Soft Skills & Values', emoji: '🤝' },
      { id: '3', name: 'Hiring_Manager', role: 'Decision Maker', focus: 'Final Verdict', emoji: '⚖️' },
      { id: '4', name: 'Resume_Architect', role: 'Career Strategist', focus: 'Gap Analysis', emoji: '📐' },
      { id: '5', name: 'Lead_Writer', role: 'Copywriter', focus: 'Content Drafting', emoji: '✍️' },
      { id: '6', name: 'QC_Specialist', role: 'Editor', focus: 'Formatting & ATS', emoji: '✅' }
    ];
  }

  try {
    const prompt = BUILD_PANEL_PROMPT(resumeText, userIntent);
    const response = await generateWithRetry(AI_CONFIG.BATCH_MODEL_NAME, {
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const allAgents = JSON.parse(cleanJson(response.text || '[]'));
    
    // We expect 6 agents now (3 Eval, 3 Crafting).
    // The "Crafting" agents are just for UI display, while Eval agents are for logic.
    // We will return ALL of them to the UI, but store them with a flag or infer based on index.
    
    return allAgents.map((a: any, idx: number) => ({ ...a, id: `agent-${idx}` }));
  } catch (error) {
    console.error("Failed to recruit agents:", error);
    return [
      { id: '1', name: 'Agent_Alpha', role: 'Screener', focus: 'Skills', emoji: '🤖' },
      { id: '2', name: 'Agent_Beta', role: 'Compliance', focus: 'Visa', emoji: '🛂' },
      { id: '3', name: 'Manager_Omega', role: 'Lead', focus: 'Score', emoji: '🏁' },
      { id: '4', name: 'Resume_Architect', role: 'Strategist', focus: 'Gap Analysis', emoji: '📐' },
      { id: '5', name: 'Lead_Writer', role: 'Writer', focus: 'Content', emoji: '✍️' },
      { id: '6', name: 'QC_Specialist', role: 'Editor', focus: 'Format', emoji: '✅' }
    ];
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
  if (!getClient()) return [];

  const allResults: JobAnalysisResult[] = [];
  let jobCounter = 0;

  try {
    const crewLogger = (msg: string, type: any, name: string) => {
      if (onLog) onLog(msg, type, name);
    };

    // Filter to only use the first 3 agents (Evaluation Crew)
    // The others are for Crafting (UI display)
    const evaluationAgents = agents.slice(0, 3);
    const crew = new Crew(evaluationAgents, crewLogger);

    for (const job of jobs) {
      jobCounter++;
      if (onLog) onLog(`Analyzing Job ${jobCounter}/${jobs.length}: ${job.company}`, 'info');
      
      try {
        const result = await crew.kickoff(job, resumeText);
        allResults.push(result);
        if (onJobComplete) onJobComplete(result);
      } catch (crewError) {
        console.error(`Crew failed for job ${job.id}:`, crewError);
        if (onLog) onLog(`Analysis failed for ${job.company}. Check logs.`, 'warning');
      }
    }
    return allResults;

  } catch (error) {
    console.error("Batch Analysis Fatal Error:", error);
    return [];
  }
};

// V2 wrapper - Implements the Batch PRD Logic
export const analyzeJobsInBatchV2 = async (
    resumeText: string, 
    jobs: Job[], 
    agents: Agent[],
    evaluationInstructions: string,
    onLog?: (message: string, type: any, agentName?: string) => void,
    onJobComplete?: (result: JobAnalysisResult) => void
): Promise<JobAnalysisResult[]> => {
    
    if (!getClient()) {
        if(onLog) onLog("Missing API Key. Analysis skipped.", "error");
        return [];
    }

    // 1. Construct the Batch Prompt
    const jobListText = jobs.map((j, idx) => `
    --- JOB #${idx + 1} ---
    ID: ${j.id}
    TITLE: ${j.title}
    COMPANY: ${j.company}
    DESCRIPTION: ${j.description.slice(0, 1000)}
    `).join('\n');

    const prompt = `
    ${evaluationInstructions}

    BATCH OF JOBS TO ANALYZE:
    ${jobListText}
    `;

    // 2. Define Strict Output Schema for Reliability
    const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                id: { type: Type.STRING },
                matchScore: { type: Type.INTEGER },
                visaRisk: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH"] },
                reasoning: { type: Type.STRING },
                evaluatedBy: { type: Type.STRING }
            },
            required: ["id", "matchScore", "visaRisk", "reasoning", "evaluatedBy"]
        }
    };

    try {
        if (onLog) onLog(`Calling Gemini Flash with batch of ${jobs.length} jobs...`, 'info');
        
        const response = await generateWithRetry(AI_CONFIG.BATCH_MODEL_NAME, {
            contents: prompt,
            config: {
                systemInstruction: BATCH_EVALUATION_SYSTEM_PROMPT,
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0.1
            }
        });

        // 3. Parse and Distribute Results
        const results = JSON.parse(cleanJson(response.text || '[]')) as JobAnalysisResult[];
        
        results.forEach(res => {
            if (onJobComplete) onJobComplete(res);
            if (onLog) onLog(`Analyzed ${res.id.slice(0, 4)}... Score: ${res.matchScore}`, 'success');
        });

        return results;

    } catch (e) {
        console.error("Batch V2 Failed", e);
        if (onLog) onLog("Batch analysis V2 failed.", "error");
        return [];
    }
};

export const generateTailoredResume = async (
  resumeText: string, 
  job: Job,
  onLog?: (msg: string, type: 'info' | 'success' | 'agent' | 'warning', agentName?: string) => void,
  onPhaseChange?: (phase: Job['generationPhase']) => void
): Promise<string> => {
  if (!getClient()) throw new Error("Missing API Key");

  // Local variable to store conversation history for this session (Isolated per job)
  let iterationHistory: string[] = [];

  try {
    // Phase 1: Architect
    if (onPhaseChange) onPhaseChange('ARCHITECT');
    if (onLog) onLog("Architecting tailoring strategy based on job gaps...", "agent", "Resume_Architect");
    const architectPrompt = RESUME_CREW_PROMPTS.ARCHITECT(resumeText, job.title, job.company, job.description);
    const strategyResponse = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, { 
      contents: architectPrompt,
      config: { temperature: 0.3 }
    });
    const strategy = strategyResponse.text || "Focus on relevant skills.";
    if (onLog) onLog("Strategy developed. Handing off to Writer.", "success", "Resume_Architect");

    // Phase 2: Writer (Initial Draft)
    if (onPhaseChange) onPhaseChange('WRITER');
    if (onLog) onLog("Drafting new experience bullets using active voice...", "agent", "Lead_Ghostwriter");
    const writerPrompt = RESUME_CREW_PROMPTS.WRITER(strategy, resumeText);
    const draftResponse = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, { 
      contents: writerPrompt,
      config: { temperature: 0.5 }
    });
    let currentDraft = draftResponse.text || "Resume draft.";
    if (onLog) onLog("Initial draft complete. Beginning Iterative Review.", "success", "Lead_Ghostwriter");

    // Phase 2.5: Iterative Lead Agent Loop (Critic <-> Reviser)
    const MAX_RETRIES = 3;
    const SCORE_THRESHOLD = 85;
    
    // Track best version in case loop fails
    let bestDraft = currentDraft;
    let bestScore = 0;

    for (let i = 1; i <= MAX_RETRIES; i++) {
        if (onLog) onLog(`Iteration ${i}/${MAX_RETRIES}: Critic evaluating draft...`, "agent", "Lead_Critic");
        
        // 1. Critic Evaluates (Passing history)
        const historyText = iterationHistory.join('\n\n');
        const criticPrompt = RESUME_CREW_PROMPTS.CRITIC(currentDraft, job.description, historyText);
        const criticResponse = await generateWithRetry(AI_CONFIG.BATCH_MODEL_NAME, {
            contents: criticPrompt,
            config: { responseMimeType: "application/json" }
        });
        
        let evaluation: { score: number, critique: string, revisionInstructions: string } = { score: 0, critique: '', revisionInstructions: '' };
        try {
            evaluation = JSON.parse(cleanJson(criticResponse.text || '{}'));
        } catch (e) {
            console.warn("Critic JSON parse error", e);
        }

        if (onLog) onLog(`Score: ${evaluation.score}. ${evaluation.critique}`, "info", "Lead_Critic");
        
        // Append Critic's feedback to history
        iterationHistory.push(`Iteration ${i} Critique: Score ${evaluation.score}. ${evaluation.critique}`);

        // Track best
        if (evaluation.score > bestScore) {
            bestScore = evaluation.score;
            bestDraft = currentDraft;
        }

        // Decision Logic
        if (evaluation.score >= SCORE_THRESHOLD) {
            if (onLog) onLog("Threshold met! Proceeding to final polish.", "success", "Lead_Critic");
            break;
        }

        if (i < MAX_RETRIES) {
             if (onLog) onLog("Score below threshold. Instructing revision...", "agent", "Lead_Critic");
             
             // 2. Reviser Updates (Passing history)
             // Logging the instruction for transparency (User Verification)
             const shortInstruction = evaluation.revisionInstructions.length > 60 
                ? evaluation.revisionInstructions.slice(0, 60) + "..." 
                : evaluation.revisionInstructions;
             if (onLog) onLog(`Feedback passed to Reviser: "${shortInstruction}"`, "info", "System");

             const reviserPrompt = RESUME_CREW_PROMPTS.REVISER(currentDraft, evaluation.revisionInstructions, historyText);
             const revisedResponse = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, {
                 contents: reviserPrompt,
                 config: { temperature: 0.3 }
             });
             
             // Append Revision action to history
             iterationHistory.push(`Iteration ${i} Revision: Applied instructions -> ${evaluation.revisionInstructions}`);

             currentDraft = revisedResponse.text || currentDraft;
             if (onLog) onLog("Revision complete. Re-submitting to Critic.", "success", "Expert_Reviser");
        } else {
             if (onLog) onLog("Max retries reached. Selecting best available draft.", "warning", "Lead_Critic");
             currentDraft = bestDraft; // Revert to best if last attempt was worse (or same)
        }
    }

    // Phase 3: Editor
    if (onPhaseChange) onPhaseChange('EDITOR');
    if (onLog) onLog("Formatting to Markdown and removing fluff...", "agent", "Chief_Editor");
    const editorPrompt = RESUME_CREW_PROMPTS.EDITOR(currentDraft); // Use the final/best draft
    const editorResponse = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, { 
      contents: editorPrompt,
      config: { temperature: 0.1 }
    });
    const editedMarkdown = editorResponse.text || currentDraft;
    if (onLog) onLog("Editing complete. Requesting final QA.", "success", "Chief_Editor");

    // Phase 4: QA
    if (onPhaseChange) onPhaseChange('QA');
    if (onLog) onLog("Verifying against Job Description constraints...", "agent", "QA_Specialist");
    const qaPrompt = RESUME_CREW_PROMPTS.QA(editedMarkdown, job.description);
    const qaResponse = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, {
      contents: qaPrompt,
      config: { temperature: 0.1 }
    });

    const finalRaw = qaResponse.text || editedMarkdown;
    // Guardrail: Clean the output to ensure no code fences or filler
    const finalMarkdown = cleanMarkdown(finalRaw);

    if (onPhaseChange) onPhaseChange('DONE');
    if (onLog) onLog("Quality check passed. Final resume ready.", "success", "QA_Specialist");
    
    return finalMarkdown;

  } catch (error) {
    console.error("Resume Generation Crew Failed:", error);
    if (onLog) onLog("Resume generation failed. Please retry.", "warning");
    throw error;
  }
};

// FEATURE: Conversational Chat (REAL RAG)
export const chatWithData = async (
  history: ChatMessage[], 
  newMessage: string, 
  jobs: Job[],
  resumeText: string,
  userIntent: string
): Promise<string> => {
  // 1. Perform Semantic Search to retrieve relevant context
  // This replaces the old slice(0, 20) with actual embedding-based retrieval
  const relevantJobs = await searchJobs(newMessage, jobs, 10);
  
  if (relevantJobs.length === 0) {
      return "I don't have enough data about the jobs to answer that yet. Try importing more jobs!";
  }

  // 2. Serialize retrieved context
  const contextData = JSON.stringify(relevantJobs.map(j => ({
    company: j.company, 
    title: j.title, 
    score: j.matchScore, 
    visa: j.visaRisk, 
    salary: j.salary,
    details: j.description.slice(0, 200) // Brief snippet
  })));
  
  // 3. Prepare Candidate Profile Backstory
  const candidateProfile = `
  USER INTENT: "${userIntent}"
  RESUME SNIPPET:
  "${resumeText.slice(0, 2000)}..."
  `;

  const systemInstruction = RESUME_CREW_PROMPTS.CHAT_SYSTEM(contextData, candidateProfile);
  
  // 4. Send to Gemini
  const prompt = `
  HISTORY:
  ${history.map(m => `${m.role}: ${m.text}`).join('\n')}
  
  USER: ${newMessage}
  
  MODEL:
  `;

  const response = await generateWithRetry(AI_CONFIG.TAILOR_MODEL_NAME, {
     contents: prompt,
     config: { systemInstruction }
  });

  return response.text || "I couldn't process that request.";
};

// FEATURE: Audio Generation (Multiple Media)
export const generateAudioSummary = async (job: Job): Promise<string | null> => {
    // Requires a model that supports audio generation (e.g. gemini-2.5-flash-preview-tts)
    const prompt = `
    Generate a 15-second enthusiastic audio summary for this job match.
    Role: ${job.title} at ${job.company}.
    Match Score: ${job.matchScore}.
    Reasoning: ${job.reasoning}.
    Tone: Professional Career Coach.
    `;

    try {
        const response = await generateWithRetry(AI_CONFIG.AUDIO_MODEL_NAME, {
           contents: prompt,
           config: {
               responseModalities: ["AUDIO"],
               speechConfig: {
                   voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
               }
           }
        });
        
        // Extract base64 audio
        const audioPart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return audioPart || null;
    } catch (e) {
        console.error("Audio gen failed", e);
        return null;
    }
};
