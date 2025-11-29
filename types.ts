
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
  
  status: 'NEW' | 'PROCESSING' | 'DONE';
  generatedResume?: string; // Markdown content
}

export interface ResumeData {
  fileName: string;
  text: string;
  uploadedAt: number;
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
  type: 'info' | 'success' | 'warning' | 'agent';
  agentName?: string;
}

export interface UserState {
  uuid: string;
  resume: ResumeData | null;
  jobs: Job[];
  targetRole: string; // User's context
}

export enum ViewState {
  ONBOARDING = 'ONBOARDING',
  DASHBOARD = 'DASHBOARD',
}