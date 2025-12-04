
import { Artifact, Job, ResumeData } from '../types';

// Simple SHA-256 hash wrapper for strings
export const hashString = async (content: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const ARTIFACT_KEY_PREFIX = 'safesubmit_artifact_';
const API_KEY_STORAGE_KEY = 'safesubmit_user_api_key';

// Basic XOR encryption for local storage obfuscation (Client-side only)
// Note: In a browser, "true" encryption requires user to remember a separate password.
// This obfuscation prevents casual shoulder-surfing or plain-text reading in dev tools.
const encrypt = (text: string): string => {
    try {
        const key = 'SafeSubmit_Secret_Salt';
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return btoa(result);
    } catch(e) { return ''; }
};

const decrypt = (encoded: string): string => {
    try {
        const text = atob(encoded);
        const key = 'SafeSubmit_Secret_Salt';
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    } catch(e) { return ''; }
};

// Safety wrapper to handle QuotaExceededError
const safeSetItem = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch (e: any) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            console.warn(`LocalStorage Quota Exceeded. Failed to save key: ${key}`);
            // Optional: Implement a cleanup strategy here (remove old artifacts)
        } else {
            console.error('LocalStorage Error:', e);
        }
    }
};

export const StorageService = {
  // --- API Key Management ---
  saveApiKey: (apiKey: string) => {
      if (!apiKey) return;
      safeSetItem(API_KEY_STORAGE_KEY, encrypt(apiKey));
  },

  getApiKey: (): string | null => {
      const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
      if (!stored) return null;
      return decrypt(stored);
  },

  clearApiKey: () => {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
  },

  // --- Resume & Session ---
  saveResume: (data: ResumeData) => {
    safeSetItem('safesubmit_resume', JSON.stringify(data));
  },

  getResume: (): ResumeData | null => {
    const raw = localStorage.getItem('safesubmit_resume');
    return raw ? JSON.parse(raw) : null;
  },

  clearResume: () => {
    localStorage.removeItem('safesubmit_resume');
  },

  saveIntent: (resumeHash: string, intent: string) => {
    safeSetItem(`safesubmit_intent_${resumeHash}`, intent);
  },

  getIntent: (resumeHash: string): string | null => {
    return localStorage.getItem(`safesubmit_intent_${resumeHash}`);
  },

  // --- Artifacts (Caching Analysis Results) ---
  
  getArtifactKey: (resumeHash: string, jobId: string) => {
    return `${ARTIFACT_KEY_PREFIX}${resumeHash}_${jobId}`;
  },

  saveArtifact: (artifact: Artifact) => {
    const key = StorageService.getArtifactKey(artifact.resumeHash, artifact.jobId);
    safeSetItem(key, JSON.stringify(artifact));
  },

  getArtifact: (resumeHash: string, jobId: string): Artifact | null => {
    const key = StorageService.getArtifactKey(resumeHash, jobId);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  },

  // Hydrates a job with cached data if it exists for the current resume
  hydrateJob: (job: Job, resumeHash: string): Job => {
    const artifact = StorageService.getArtifact(resumeHash, job.id);
    if (artifact) {
      return {
        ...job,
        matchScore: artifact.matchScore,
        visaRisk: artifact.visaRisk,
        reasoning: artifact.reasoning,
        evaluatedBy: artifact.evaluatedBy,
        generatedResume: artifact.generatedResume,
        // Fix: Analyzed jobs (without resume) should be 'NEW' so they don't spin forever.
        // The presence of matchScore tells the UI it's analyzed.
        status: artifact.generatedResume ? 'DONE' : 'NEW'
      };
    }
    return job;
  }
};
