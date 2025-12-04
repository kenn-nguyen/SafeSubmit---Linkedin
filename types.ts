
export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salary?: string;
  applyUrl?: string;
  applyType?: string; // e.g. "EASY_APPLY"
  
  // Metadata
  applicants?: string;
  postedAt?: string;
  publishedAt?: string; // ISO Date string

  // Analysis (Optional until AI runs)
  matchScore?: number;
  visaRisk?: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning?: string;
  evaluatedBy?: string; // Name of the agent who evaluated this
  
  status: 'NEW' | 'PROCESSING' | 'DONE' | 'FAILED';
  
  // Generation Specifics
  generationPhase?: 'ARCHITECT' | 'WRITER' | 'EDITOR' | 'QA' | 'DONE';
  generatedResume?: string; // Markdown content
  audioSummary?: string; // Base64 Audio string
}

export interface ResumeData {
  fileName: string;
  text: string;
  uploadedAt: number;
  hash?: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  focus: string; // e.g., "Visa Safety", "Technical Depth"
  emoji: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'agent' | 'error';
  agentName?: string;
}

export interface UserState {
  uuid: string;
  resume: ResumeData | null;
  jobs: Job[];
  targetRole: string; // User's context
}

export interface JobFilters {
  minScore: number;
  visaRisk: 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';
  easyApplyOnly: boolean;
  recentOnly: boolean;
  status: 'ALL' | 'TODO' | 'DONE';
}

export interface ResumeCrewStep {
  role: string;
  label: string;
  desc: string;
}

export interface Artifact {
  jobId: string;
  resumeHash: string;
  matchScore: number;
  visaRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning: string;
  evaluatedBy: string;
  generatedResume?: string;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export enum ViewState {
  ONBOARDING = 'ONBOARDING',
  DASHBOARD = 'DASHBOARD',
}
