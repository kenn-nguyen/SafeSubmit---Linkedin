
import { Job, Agent } from "../types";
// No longer need AI_CONFIG from constants as models are handled by Python backend
// The prompts are now also handled by the Python backend.

// Define the base URL for your Python Flask backend
export const API_BASE_URL = "http://localhost:5002";

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
  } catch (error: unknown) {
    console.error("Agent Panel Creation Failed:", error);
    const message = error instanceof Error ? error.message : 'Unknown error creating agent panel';
    throw new Error(message);
  }
};

export const createResumePanel = async (resumeText: string, userIntent: string, jobDescription?: string): Promise<Agent[]> => {
  const resp = await fetch(`${API_BASE_URL}/agents/create_resume_panel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeText, userIntent, jobDescription }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || 'Failed to create resume panel');
  }
  const data = await resp.json();
  return data.agents || [];
};

export const createEvaluationInstructions = async (resumeText: string, userIntent: string): Promise<string> => {
  const resp = await fetch(`${API_BASE_URL}/instructions/evaluation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeText, userIntent }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || 'Failed to generate evaluation instructions');
  }
  const data = await resp.json();
  return data.instructions || '';
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

  const allResults: JobAnalysisResult[] = [];

  for (const job of jobs) {
    try {
      if (onLog) onLog(`Analyzing job "${job.title}" (${job.id})...`, 'info');

      const response = await fetch(`${API_BASE_URL}/jobs/analyze_batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resumeText, userIntent, jobs: [job], agents }), // Send one job at a time for immediate updates
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data: BatchAnalysisResponse = await response.json();
      const result = data.results?.[0];

      if (result) {
        allResults.push(result);
        if (onJobComplete) onJobComplete(result);
        if (onLog) onLog(`Job ${result.id} analysis complete.`, 'success');
      }
    } catch (error: unknown) {
      console.error("Job Analysis Error from backend:", error);
      if (onLog) onLog(`Job analysis failed: ${error instanceof Error ? error.message : String(error)}`, 'warning');
    }
  }

  return { results: allResults };
};

export const analyzeJobsInBatchV2 = async (
  resumeText: string,
  userIntent: string,
  jobs: Job[],
  instructions: string,
  onLog?: (message: string, type: any, agentName?: string) => void,
  onJobComplete?: (result: JobAnalysisResult) => void
): Promise<BatchAnalysisResponse> => {
  if (!jobs.length) return { results: [] };
  try {
    const resp = await fetch(`${API_BASE_URL}/jobs/evaluate_batch_v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeText, userIntent, jobs, instructions }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || `HTTP error ${resp.status}`);
    }
    const data: BatchAnalysisResponse = await resp.json();
    if (data.results && Array.isArray(data.results)) {
      data.results.forEach(r => {
        onJobComplete?.(r);
        onLog?.(`Job ${r.id} analysis complete.`, 'info');
      });
    }
    return { results: data.results || [] };
  } catch (e) {
    console.error("Batch V2 analysis error:", e);
    onLog?.(`Batch analysis failed: ${e instanceof Error ? e.message : String(e)}`, 'warning');
    return { results: [] };
  }
};

export const generateTailoredResume = async (
  resumeText: string, 
  userIntent: string, // User's career goal/intent
  job: Job,
  onLog?: (msg: string, type: 'info' | 'success' | 'agent' | 'warning', agentName?: string) => void,
  onProgress?: (evt: { phase?: string; percent?: number; message?: string }) => void
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

    // Attempt to stream progress events if backend supports it
    const contentType = response.headers.get('Content-Type') || '';
    if (response.body && (contentType.includes('text/event-stream') || contentType.includes('ndjson') || contentType.includes('stream'))) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResume = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            if (evt.generatedResume) {
              finalResume = evt.generatedResume;
            }
            if (evt.phase || evt.percent || evt.message) {
              const mappedPercent = mapPhaseToPercent(evt.phase, evt.percent);
              onProgress?.({ phase: evt.phase, percent: mappedPercent, message: evt.message });
              if (evt.message && onLog) {
                onLog(evt.message, 'agent', evt.phase || 'ResumeCrew');
              }
            }
          } catch (e) {
            console.warn('Failed to parse stream event', e);
          }
        }
      }

      if (finalResume) {
        onLog?.("Resume generation complete!", "success");
        return finalResume;
      }
      // Fall through to try parsing any remaining buffer
      if (buffer.trim()) {
        try {
          const maybe = JSON.parse(buffer.trim());
          if (maybe.generatedResume) {
            onLog?.("Resume generation complete!", "success");
            return maybe.generatedResume as string;
          }
          if (maybe.phase || maybe.percent || maybe.message) {
            const mappedPercent = mapPhaseToPercent(maybe.phase, maybe.percent);
            onProgress?.({ phase: maybe.phase, percent: mappedPercent, message: maybe.message });
          }
        } catch {
          // ignore
        }
      }
    }

    const data = await response.json();
    const mappedPercent = mapPhaseToPercent(data.phase, data.percent);
    if (mappedPercent !== undefined || data.phase || data.message) {
      onProgress?.({ phase: data.phase, percent: mappedPercent, message: data.message });
      if (data.message && onLog) {
        onLog(data.message, 'agent', data.phase || 'ResumeCrew');
      }
    }
    const generatedResume: string = data.generatedResume;
    if (onLog) onLog("Resume generation complete!", "success");
    return generatedResume;
  } catch (error: unknown) {
    console.error("Resume Generation Crew Failed from backend:", error);
    const message = error instanceof Error ? error.message : String(error);
    if (onLog) onLog(`Resume generation failed: ${message}`, 'warning');
    throw new Error(message);
  }
};

// Map CrewAI phases to a friendly percent if none provided
const mapPhaseToPercent = (phase?: string, percent?: number) => {
  if (typeof percent === 'number') return percent;
  if (!phase) return undefined;
  const normalized = phase.toLowerCase();
  if (normalized.includes('architect')) return 30;
  if (normalized.includes('plan')) return 30;
  if (normalized.includes('writer') || normalized.includes('draft')) return 60;
  if (normalized.includes('editor') || normalized.includes('edit')) return 85;
  return undefined;
};
