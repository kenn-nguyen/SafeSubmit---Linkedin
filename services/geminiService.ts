
import { Job, Agent } from "../types";
// No longer need AI_CONFIG from constants as models are handled by Python backend
// The prompts are now also handled by the Python backend.

// Define the base URL for your Python Flask backend
const API_BASE_URL = "http://localhost:5002";

export interface JobAnalysisResult {
  id: string;
  matchScore: number;
  visaRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning?: string;
  evaluatedBy?: string;
}

// ============================================================================
//  PUBLIC SERVICES (Now calling Python Backend)
// ============================================================================

export const createAgentPanel = async (resumeText: string, userIntent: string): Promise<Agent[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/agents/create_panel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resumeText, userIntent }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.agents || [];
  } catch (error) {
    console.error("Agent Panel Creation Failed:", error);
    // Optionally, log this error to the UI
    return [];
  }
};

export interface BatchAnalysisResponse {
  results: JobAnalysisResult[];
  // Agents are no longer returned from the batch analysis endpoint
}

export const analyzeJobsInBatch = async (
  resumeText: string, 
  userIntent: string,
  jobs: Job[], 
  agents: Agent[], // Pass the pre-built agent panel
  onLog?: (message: string, type: any, agentName?: string) => void,
  onJobComplete?: (result: JobAnalysisResult) => void
): Promise<BatchAnalysisResponse> => {
  if (!jobs.length) return { results: [] };

  try {
    const response = await fetch(`${API_BASE_URL}/jobs/analyze_batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resumeText, userIntent, jobs, agents }), // Pass agents to backend
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data: BatchAnalysisResponse = await response.json();
    
    if (data.results && Array.isArray(data.results)) {
      data.results.forEach(result => {
        if (onJobComplete) onJobComplete(result);
        if (onLog) onLog(`Job ${result.id} analysis complete.`, 'info');
      });
    }

    return {
      results: data.results || []
    };

  } catch (error) {
    console.error("Batch Analysis Fatal Error from backend:", error);
    if (onLog) onLog(`Batch analysis failed: ${error.message}`, 'warning');
    return { results: [] };
  }
};

export const generateTailoredResume = async (
  resumeText: string, 
  userIntent: string, // User's career goal/intent
  job: Job,
  onLog?: (msg: string, type: 'info' | 'success' | 'agent' | 'warning', agentName?: string) => void
): Promise<string> => {
  try {
    if (onLog) onLog("Initiating Resume Generation Crew via backend...", "info");
    const response = await fetch(`${API_BASE_URL}/resume/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resumeText, userIntent, job }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const generatedResume: string = data.generatedResume;
    if (onLog) onLog("Resume generation complete!", "success");
    return generatedResume;
  } catch (error) {
    console.error("Resume Generation Crew Failed from backend:", error);
    if (onLog) onLog(`Resume generation failed: ${error.message}`, 'warning');
    return "Failed to generate resume.";
  }
};
