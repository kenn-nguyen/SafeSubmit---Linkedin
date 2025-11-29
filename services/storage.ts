// Lightweight local storage helpers for caching per-job artifacts.

export interface ArtifactRecord {
  generatedResume?: string;
  reasoning?: string;
  matchScore?: number;
  visaRisk?: 'LOW' | 'MEDIUM' | 'HIGH';
  evaluatedBy?: string;
  updatedAt: number;
}

const CACHE_KEY = 'safesubmit_artifact_cache_v1';
const JOBS_KEY = 'safesubmit_jobs_v1';
const INTENT_KEY = 'safesubmit_intent_v1';

export const fastHash = (input: string): string => {
  // Simple non-crypto hash for stable keys; avoids async subtle.digest.
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return `h${Math.abs(hash)}`;
};

export const loadArtifactCache = (): Record<string, ArtifactRecord> => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('Failed to read artifact cache', e);
    return {};
  }
};

export const persistArtifactCache = (cache: Record<string, ArtifactRecord>) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Failed to persist artifact cache', e);
  }
};

export const makeArtifactKey = (resumeHash: string | null, jobId: string) => {
  return `${resumeHash || 'no-resume'}::${jobId}`;
};

// Persist jobs per resume hash so refreshes restore the table
export const loadJobsForResume = <T extends { status: string }>(resumeHash: string | null): T[] => {
  if (!resumeHash) return [];
  try {
    const raw = localStorage.getItem(JOBS_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, T[]>;
    return map[resumeHash] || [];
  } catch (e) {
    console.warn('Failed to read jobs cache', e);
    return [];
  }
};

export const persistJobsForResume = <T extends { status: string }>(resumeHash: string | null, jobs: T[]) => {
  if (!resumeHash) return;
  try {
    const raw = localStorage.getItem(JOBS_KEY);
    const map = raw ? JSON.parse(raw) as Record<string, T[]> : {};
    map[resumeHash] = jobs;
    localStorage.setItem(JOBS_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('Failed to persist jobs cache', e);
  }
};

export const clearJobsForResume = (resumeHash: string | null) => {
  if (!resumeHash) return;
  try {
    const raw = localStorage.getItem(JOBS_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, unknown>;
    delete map[resumeHash];
    localStorage.setItem(JOBS_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('Failed to clear jobs cache', e);
  }
};

// Persist user intent per resume so refreshes skip the intent prompt
export const loadIntentForResume = (resumeHash: string | null): string => {
  if (!resumeHash) return '';
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    if (!raw) return '';
    const map = JSON.parse(raw) as Record<string, string>;
    return map[resumeHash] || '';
  } catch (e) {
    console.warn('Failed to read intent cache', e);
    return '';
  }
};

export const persistIntentForResume = (resumeHash: string | null, intent: string) => {
  if (!resumeHash) return;
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    const map = raw ? JSON.parse(raw) as Record<string, string> : {};
    map[resumeHash] = intent;
    localStorage.setItem(INTENT_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('Failed to persist intent cache', e);
  }
};

export const clearIntentForResume = (resumeHash: string | null) => {
  if (!resumeHash) return;
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, unknown>;
    delete map[resumeHash];
    localStorage.setItem(INTENT_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('Failed to clear intent cache', e);
  }
};
