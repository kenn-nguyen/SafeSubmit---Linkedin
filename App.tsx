import React, { useState, useEffect, useMemo } from 'react';
import { FileText, Database, Briefcase, PlayCircle, Loader2, Zap } from 'lucide-react';
import { FileUpload } from './components/FileUpload';
import { JobTable } from './components/JobTable';
import { ResumeWidget } from './components/ResumeWidget';
import { LogBox } from './components/LogBox';
import { AgentPanel } from './components/AgentPanel';
import { parseCSV } from './services/csvParser';
import { analyzeJobsInBatchV2, generateTailoredResume, createResumePanel, createEvaluationInstructions, JobAnalysisResult, API_BASE_URL } from './services/geminiService'; // Import API_BASE_URL
import { Job, Agent, LogEntry } from './types';
import { ResumeDiffModal } from './components/ResumeDiffModal';
import { FilterBar, FilterState } from './components/FilterBar';
import { ArtifactRecord, fastHash, loadArtifactCache, makeArtifactKey, persistArtifactCache, loadJobsForResume, persistJobsForResume, clearJobsForResume, loadIntentForResume, persistIntentForResume, clearIntentForResume } from './services/storage';

const App: React.FC = () => {
  const [uuid, setUuid] = useState<string>('');
  
  // Persistent State
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [resumeHash, setResumeHash] = useState<string | null>(null);
  const [userIntent, setUserIntent] = useState<string>('Senior Manager'); // User's career goal/intent

  // Core Data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [artifactCache, setArtifactCache] = useState<Record<string, ArtifactRecord>>(() => loadArtifactCache());
  const [intentConfirmed, setIntentConfirmed] = useState<boolean>(false);
  
  // UI Flags for Async Operations
  const [isProcessingResume, setIsProcessingResume] = useState(false);
  const [isBuildingAgents, setIsBuildingAgents] = useState(false);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [isGeneratingResume, setIsGeneratingResume] = useState(false); 
  
  const [generationStatus, setGenerationStatus] = useState<Record<string, boolean>>({});
  const [generationProgress, setGenerationProgress] = useState<Record<string, { phase?: string; percent?: number; message?: string }>>({});
  const [isJobImported, setIsJobImported] = useState(false);
  const [diffJobId, setDiffJobId] = useState<string | null>(null);
  const [analyzeCount, setAnalyzeCount] = useState<number>(10);
  const [evaluationInstructions, setEvaluationInstructions] = useState<string>('');
  const [filters, setFilters] = useState<FilterState>({ visa: 'ALL', matchBand: 'ALL', easyApply: false, recency: 'ANY' });
  const [resumeDownloadCount, setResumeDownloadCount] = useState<number>(0);

  // Lane flags
  const isAnyGenerating = Object.values(generationStatus).some(Boolean);

  // --- Logging Helper ---
  const addLog = (message: string, type: LogEntry['type'] = 'info', agentName?: string) => {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      message,
      type,
      agentName
    };
    setLogs(prev => [...prev, entry]);
  };

  useEffect(() => {
    const storedUuid = localStorage.getItem('safesubmit_uuid');
    if (storedUuid) {
      setUuid(storedUuid);
    } else {
      const newUuid = crypto.randomUUID();
      setUuid(newUuid);
      localStorage.setItem('safesubmit_uuid', newUuid);
    }

    const storedResume = localStorage.getItem('safesubmit_resume');
    const storedResumeName = localStorage.getItem('safesubmit_resume_name');
    if (storedResume && storedResumeName) {
      const hash = fastHash(storedResume);
      setResumeText(storedResume);
      setResumeName(storedResumeName);
      setResumeHash(hash);
      const cachedIntent = loadIntentForResume(hash);
      if (cachedIntent) {
        setUserIntent(cachedIntent);
        setIntentConfirmed(true);
      }
      const cachedJobs = loadJobsForResume<Job>(hash);
      if (cachedJobs.length > 0) {
        setJobs(cachedJobs);
        setIsJobImported(true);
        addLog(`Welcome back. Restored ${cachedJobs.length} jobs.`, 'success');
      } else {
        addLog('Welcome back. Resume loaded from secure storage.', 'success');
      }
    }
  }, []);

  useEffect(() => {
    persistArtifactCache(artifactCache);
  }, [artifactCache]);

  useEffect(() => {
    if (!resumeHash) return;
    setJobs(prev => prev.map(job => {
      const key = makeArtifactKey(resumeHash, job.id);
      const cached = artifactCache[key];
      if (!cached) return job;
      return {
        ...job,
        matchScore: cached.matchScore ?? job.matchScore,
        visaRisk: cached.visaRisk ?? job.visaRisk,
        reasoning: cached.reasoning ?? job.reasoning,
        evaluatedBy: cached.evaluatedBy ?? job.evaluatedBy,
        generatedResume: cached.generatedResume ?? job.generatedResume,
        status: job.status === 'NEW' ? (cached.matchScore ? 'DONE' : job.status) : job.status,
      };
    }));
  }, [resumeHash, artifactCache]);

  useEffect(() => {
    if (!resumeHash) return;
    persistJobsForResume(resumeHash, jobs);
  }, [jobs, resumeHash]);

  useEffect(() => {
    if (!resumeHash) return;
    if (userIntent && intentConfirmed) {
      persistIntentForResume(resumeHash, userIntent);
    } else if (!userIntent) {
      clearIntentForResume(resumeHash);
    }
  }, [userIntent, resumeHash, intentConfirmed]);

  // --- Handlers ---

  const handleResumeUpload = (file: File) => {
    setIsProcessingResume(true);
    
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    const processTextResume = (text: string) => {
      const hadJobs = jobs.length > 0;
      const nextHash = fastHash(text);
      setResumeText(text);
      setResumeName(file.name);
      setResumeHash(nextHash);
      setUserIntent('Senior Manager');
      setIntentConfirmed(false);
      clearIntentForResume(nextHash);
      clearJobsForResume(nextHash);
      setArtifactCache({});
      setEvaluationInstructions('');
      localStorage.setItem('safesubmit_resume', text);
      localStorage.setItem('safesubmit_resume_name', file.name);
      
      // Reset analyses but keep job data
      if (jobs.length > 0) {
        setJobs(prevJobs => prevJobs.map(job => ({
          ...job,
          matchScore: undefined,
          visaRisk: undefined,
          reasoning: undefined,
          evaluatedBy: undefined,
          generatedResume: undefined,
          status: 'NEW'
        })));
        setIsJobImported(true);
      }
      
      // --- RESET LOGIC ---
      setAgents([]);
      if (hadJobs) {
        addLog(`Resume updated. Previous job analysis reset to ensure accuracy.`, 'warning');
        addLog('Set your career goal and analyze jobs to recruit a new agent crew.', 'info');
      } else {
        addLog(`Resume uploaded: ${file.name}`, 'success');
        addLog('Waiting for user to define target role for Agent Recruitment...', 'info');
      }
      setIsProcessingResume(false);
    };

    if (fileExtension === 'pdf') {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const base64Pdf = btoa(
            new Uint8Array(arrayBuffer)
              .reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          
          addLog(`Uploading PDF: ${file.name}...`, 'info');
          const response = await fetch(`${API_BASE_URL}/resume/upload_pdf`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pdf_base64: base64Pdf }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to process PDF on backend.');
          }

          const data = await response.json();
          const extractedText = data.resumeText;

          processTextResume(extractedText); // Use the common logic for setting state and soft reset

        } catch (error) {
          addLog(`Error processing PDF: ${error instanceof Error ? error.message : String(error)}`, 'error');
          console.error("Error handling PDF upload:", error);
          setResumeText(null); // Clear resume on error
          setResumeName(null);
          localStorage.removeItem('safesubmit_resume');
          localStorage.removeItem('safesubmit_resume_name');
        } finally {
          setIsProcessingResume(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (fileExtension === 'txt' || fileExtension === 'md') { // Handle .txt and .md files
      addLog(`Attempting to read text/markdown file: ${file.name}`, 'info');
      const reader = new FileReader();
      reader.onload = (e) => {
        addLog(`FileReader onload for ${file.name} triggered.`, 'info');
        try {
          const text = typeof e.target?.result === 'string' ? e.target.result : '';
          addLog(`Processing text content for ${file.name}.`, 'info');
          processTextResume(text); // Use the common logic for setting state and soft reset
        } catch (error) {
          addLog(`Error processing text file: ${error instanceof Error ? error.message : String(error)}`, 'error');
          console.error("Error handling text file upload:", error);
          setResumeText(null); // Clear resume on error
          setResumeName(null);
          localStorage.removeItem('safesubmit_resume');
          localStorage.removeItem('safesubmit_resume_name');
        } finally {
          setIsProcessingResume(false);
        }
      };
      reader.onerror = (e) => {
        addLog(`Failed to read file: ${file.name}. Error: ${e.target?.error}`, 'error');
        console.error("FileReader error:", e.target?.error);
        setIsProcessingResume(false);
      };
      reader.readAsText(file);
    } else {
      addLog(`Unsupported file type: ${fileExtension}. Please upload a PDF, TXT, or MD file.`, 'error');
      setIsProcessingResume(false);
    }
  };

  const handleResetResume = () => {
    if (resumeHash) {
      clearJobsForResume(resumeHash);
      clearIntentForResume(resumeHash);
    }
    setResumeText(null);
    setResumeName(null);
    setResumeHash(null);
    setArtifactCache({});
    setJobs([]);
    setAgents([]);
    setUserIntent('Senior Manager');
    setIntentConfirmed(false);
    setIsJobImported(false);
    setGenerationStatus({});
    localStorage.removeItem('safesubmit_resume');
    localStorage.removeItem('safesubmit_resume_name');
    addLog('Resume cleared. Please upload a new resume to continue.', 'warning', 'Dispatcher');
  };

  const handleBuildAgents = async (intent: string) => {
    addLog(`Start clicked for target role: "${intent}".`, 'info', 'Dispatcher');

    if (!resumeText) {
      addLog('Upload a resume before building your crew.', 'warning', 'Dispatcher');
      return;
    }
    setIsBuildingAgents(true);
    addLog(`Career goal set: "${intent}". Recruiting resume editing crew...`, 'info', 'Dispatcher');
    addLog('Director: drafting resume team...', 'agent', 'Director');

    try {
      const newAgents = await createResumePanel(resumeText, intent);
      if (newAgents.length > 0) {
        setAgents(newAgents);
        setUserIntent(intent); // Set intent only upon successful agent creation
        setIntentConfirmed(true);
        newAgents.forEach(agent => {
          addLog(`Agent ${agent.name} (${agent.role}) recruited`, 'agent', agent.name);
        });
        addLog('Resume editing crew assembled and ready!', 'success', 'Dispatcher');
      } else {
        addLog('Failed to build resume panel.', 'warning');
      }

      addLog('Generating evaluation system instructions...', 'info', 'Dispatcher');
      const instructions = await createEvaluationInstructions(resumeText, intent);
      setEvaluationInstructions(instructions);
      addLog('Evaluation instructions ready.', 'success', 'Dispatcher');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Failed to set up crews: ${message}`, 'error');
      console.error(e);
    } finally {
      setIsBuildingAgents(false);
    }
  };

  const handleCsvUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsedJobs = parseCSV(text);
      
      if (parsedJobs.length === 0) {
         addLog("Uploaded CSV contains no valid jobs. Please check format.", 'warning');
         return;
      }

      setJobs(prev => {
        const existingIds = new Set(prev.map(j => j.id));
        const newJobs = parsedJobs.filter(j => !existingIds.has(j.id)).map(job => {
          if (!resumeHash) return job;
          const key = makeArtifactKey(resumeHash, job.id);
          const cached = artifactCache[key];
          if (!cached) return job;
          return {
            ...job,
            matchScore: cached.matchScore ?? job.matchScore,
            visaRisk: cached.visaRisk ?? job.visaRisk,
            reasoning: cached.reasoning ?? job.reasoning,
            evaluatedBy: cached.evaluatedBy ?? job.evaluatedBy,
            generatedResume: cached.generatedResume ?? job.generatedResume,
            status: cached.matchScore ? 'DONE' : job.status,
          };
        });
        return [...prev, ...newJobs];
      });
      setIsJobImported(true);
    };
    reader.readAsText(file);
  };

  const handleAnalyzeNextBatch = async () => {
    if (!resumeText || agents.length === 0) return;

    if (!userIntent || !intentConfirmed) {
      addLog("Please input your target role and click Start to recruit a new crew before analyzing.", 'warning');
      return;
    }

    const unanalyzedJobs = jobs.filter(j => j.status === 'NEW' || j.matchScore === undefined);
    if (unanalyzedJobs.length === 0) {
      addLog("No unanalyzed jobs found.", 'warning');
      return;
    }

    if (!evaluationInstructions) {
      addLog('Evaluation instructions not ready yet.', 'warning');
      return;
    }

    const batch = unanalyzedJobs.slice(0, analyzeCount);
    setIsBatchAnalyzing(true);
    addLog(`Evaluating batch of ${batch.length} jobs with the scoring API...`, 'info');

    // Optimistically mark the batch as processing so the UI reflects progress immediately
      setJobs(prev => prev.map(j => batch.find(b => b.id === j.id) ? { ...j, status: 'PROCESSING' } : j));

    try {
      const response = await analyzeJobsInBatchV2(
        resumeText,
        userIntent,
        batch,
        evaluationInstructions, // system instructions
        addLog,
        (result: JobAnalysisResult) => {
          setJobs(prev => prev.map(j => j.id === result.id ? {
            ...j,
            matchScore: result.matchScore,
            visaRisk: result.visaRisk,
            reasoning: result.reasoning,
            evaluatedBy: result.evaluatedBy,
            status: 'DONE'
          } : j));
          setArtifactCache(prev => {
            const key = makeArtifactKey(resumeHash, result.id);
            return {
              ...prev,
              [key]: {
                ...prev[key],
                matchScore: result.matchScore,
                visaRisk: result.visaRisk,
                reasoning: result.reasoning,
                evaluatedBy: result.evaluatedBy,
                updatedAt: Date.now(),
              }
            };
          });
          addLog(
            `Job ${result.id} analyzed: match ${result.matchScore}% | visa risk ${result.visaRisk}`,
            'success'
          );
        }
      );

      if (response.results.length === 0) {
        addLog('Analysis yielded no results or was aborted.', 'warning');
      } else {
        addLog(`Batch analysis complete. Evaluated ${response.results.length} jobs.`, 'success');
      }
    } catch (e) {
      addLog('Batch analysis failed unexpectedly.', 'warning');
    } finally {
      setIsBatchAnalyzing(false);
    }
  };

  const downloadFile = (content: string, filename: string) => {
    const element = document.createElement("a");
    const file = new Blob([content], {type: 'text/markdown'});
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element); 
    element.click();
    document.body.removeChild(element);
  };

  const handleGenerateResume = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || !resumeText) return;

    if (!intentConfirmed) {
      addLog('Please input your target role and click Start to recruit a new crew before generating resumes.', 'warning');
      return;
    }

    // 1. CHECK FOR EXISTING RESUME
    if (job.status === 'DONE' && job.generatedResume) {
      const safeCompanyName = job.company.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      downloadFile(job.generatedResume, `Resume_${safeCompanyName}.md`);
      setResumeDownloadCount(count => count + 1);
      return;
    }

    // 2. START GENERATION
    setIsGeneratingResume(true);
    setGenerationStatus(prev => ({ ...prev, [jobId]: true }));
    setGenerationProgress(prev => ({ ...prev, [jobId]: { percent: 15, phase: 'starting' } }));
    addLog(`Starting Resume Generation Crew for ${job.company}...`, 'info');
    const timer = window.setInterval(() => {
      setGenerationProgress(prev => {
        const current = prev[jobId]?.percent ?? 15;
        if (current >= 90) return prev;
        const next = Math.min(90, current + 7);
        return { ...prev, [jobId]: { ...prev[jobId], percent: next } };
      });
    }, 1800);
    
    let hadError = false;
    try {
      if (!userIntent) {
        addLog('Please set your career goal before generating resumes.', 'warning');
        return;
      }
      // Pass addLog to visualize the Architect -> Writer -> Editor process
      const generatedContent = await generateTailoredResume(
        resumeText,
        userIntent,
        job,
        addLog,
        (evt) => {
          setGenerationProgress(prev => {
            const existing = prev[jobId] || {};
            if (evt.phase && evt.phase !== existing.phase) {
              addLog(`Resume crew step: ${evt.phase}`, 'agent', 'ResumeCrew');
            }
            const stepPercents = [15, 35, 55, 75, 90];
            const mapped = evt.percent !== undefined
              ? evt.percent
              : (() => {
                  if (!evt.phase) return existing.percent ?? 20;
                  const phaseOrder = ['architect', 'planner', 'writer', 'editor', 'qa'];
                  const idx = phaseOrder.findIndex(p => evt.phase.toLowerCase().includes(p));
                  if (idx >= 0) return stepPercents[Math.min(idx, stepPercents.length - 1)];
                  return existing.percent ?? 20;
                })();
            return { ...prev, [jobId]: { ...existing, ...evt, percent: mapped } };
          });
        }
      );
      
      setJobs(prev => prev.map(j => j.id === jobId ? { 
        ...j, 
        status: 'DONE',
        generatedResume: generatedContent // Store content so we don't regenerate
      } : j));
      setArtifactCache(prev => {
        const key = makeArtifactKey(resumeHash, jobId);
        return {
          ...prev,
          [key]: {
            ...prev[key],
            generatedResume: generatedContent,
            updatedAt: Date.now(),
          }
        };
      });
      
      addLog(`Resume generated for ${job.company}. Click 'Download' to save.`, 'success');
      
      // Optional: Auto-download on finish
      // const safeCompanyName = job.company.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      // downloadFile(generatedContent, `Resume_${safeCompanyName}.md`);

    } catch (e) {
      hadError = true;
      const message = e instanceof Error ? e.message : String(e);
      errorMessage = message;
      const isRateLimited = message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('quota');
      const userMessage = isRateLimited
        ? `Rate limit hit while generating resume for ${job.company}. Please wait a moment and try again.`
        : `Failed to generate resume for ${job.company}`;
      addLog(userMessage, 'warning');
      setGenerationProgress(prev => ({
        ...prev,
        [jobId]: { ...prev[jobId], percent: prev[jobId]?.percent ?? 0, phase: 'error', message: userMessage }
      }));
    } finally {
      setGenerationStatus(prev => ({ ...prev, [jobId]: false }));
      setIsGeneratingResume(false);
      if (!hadError) {
        setGenerationProgress(prev => ({ ...prev, [jobId]: { ...prev[jobId], percent: 100, phase: 'done', message: 'Complete' } }));
      }
      window.clearInterval(timer);
    }
  };

  const filteredJobs = useMemo(() => {
    const bandCheck = (score?: number) => {
      if (filters.matchBand === 'ALL') return true;
      if (score === undefined) return false;
      if (filters.matchBand === 'TOP' && score >= 80) return true;
      if (filters.matchBand === 'MID' && score >= 60 && score < 80) return true;
      if (filters.matchBand === 'LOW' && score < 60) return true;
      return false;
    };

    return jobs.filter(job => {
      if (filters.visa !== 'ALL' && job.visaRisk !== filters.visa) return false;
      if (filters.easyApply && job.applyType !== 'EASY_APPLY') return false;
      if (!bandCheck(job.matchScore)) return false;
      if (filters.recency === 'RECENT') {
        const published = job.publishedAt ? new Date(job.publishedAt).getTime() : 0;
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (published < sevenDaysAgo) return false;
      }
      return true;
    });
  }, [jobs, filters]);

  // --- Render Views ---

  if (!resumeText) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <div className="mx-auto h-16 w-16 bg-primary-100 rounded-full flex items-center justify-center mb-6">
              <Briefcase className="h-8 w-8 text-primary-600" />
            </div>
            <h2 className="text-3xl font-extrabold text-gray-900">SafeSubmit</h2>
            <p className="mt-2 text-gray-600">
              Upload your resume. Recruit AI Agents. Automate your job search.
            </p>
          </div>
          
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
            {isProcessingResume ? (
              <div className="py-12 flex flex-col items-center">
                <Loader2 className="h-10 w-10 text-primary-600 animate-spin mb-4" />
                <p className="text-sm text-gray-500 font-medium">Parsing resume & initializing profile...</p>
              </div>
            ) : (
              <FileUpload
                label="Upload Resume"
                subLabel="We support PDF, TXT, and Markdown formats"
                accept="application/pdf, text/plain, text/markdown, .pdf, .txt, .md"
                onFileSelect={handleResumeUpload}
                icon={<FileText size={32} />}
                isActive={!isProcessingResume}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  const unanalyzedCount = jobs.filter(j => j.status === 'NEW' || j.matchScore === undefined).length;
  const generatedResumeCount = jobs.filter(j => j.generatedResume).length;
  const nextBatchSize = Math.min(unanalyzedCount, analyzeCount);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shadow-md shadow-primary-600/20">
              <Briefcase size={18} className="text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-gray-900 hidden sm:block">SafeSubmit</span>
          </div>

          <div className="flex items-center gap-4">
            <ResumeWidget 
               resumeName={resumeName} 
               onReupload={handleResumeUpload} 
               onReset={handleResetResume}
               isDisabled={false}
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* 1. Agent Panel (Intent Config) */}
      <AgentPanel 
        agents={agents} // Display agents once they're created by the backend crew
        onBuildPanel={handleBuildAgents} 
        isBuilding={isBuildingAgents}
        isDisabled={false}
        intentLocked={intentConfirmed && !!resumeText}
        intentValue={userIntent}
        onIntentChange={handleIntentChange}
      />

        {/* Logs visible even before jobs are imported */}
        {logs.length > 0 && <LogBox logs={logs} />}

        {/* 2. Job Import (Only if no jobs yet) */}
        {!isJobImported && jobs.length === 0 && userIntent && agents.length > 0 && (
          <div className={`max-w-2xl mx-auto mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500`}>
            <div className="bg-white rounded-2xl p-10 shadow-sm border border-gray-200 text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Data Ingestion</h2>
              <p className="text-gray-500 mb-8">Your crew is ready. Upload your CSV to start the pipeline.</p>
              <FileUpload
                label="Import Job CSV"
                subLabel="Drag and drop your job list here"
                accept=".csv"
                onFileSelect={handleCsvUpload}
                icon={<Database size={32} />}
                isActive={true}
              />
            </div>
          </div>
        )}

        {/* 3. Dashboard & Logs */}
        {jobs.length > 0 && (
          <>
            {/* Control Bar */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="flex gap-8 flex-wrap">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Total Jobs</p>
                  <p className="text-2xl font-bold text-gray-900">{jobs.length}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Analyzed</p>
                  <p className="text-2xl font-bold text-blue-600">{jobs.length - unanalyzedCount}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Resumes Generated</p>
                  <p className="text-2xl font-bold text-emerald-600">{generatedResumeCount}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Resumes Downloaded</p>
                  <p className="text-2xl font-bold text-purple-600">{resumeDownloadCount}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto">
                 <div className="flex items-center gap-2 text-sm text-gray-600">
                   <span>Batch size:</span>
                   <select
                     value={analyzeCount}
                     onChange={(e) => setAnalyzeCount(Number(e.target.value))}
                     className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
                   >
                     {[1,5,10,20,50].map(n => (
                       <option key={n} value={n}>{n}</option>
                     ))}
                   </select>
                 </div>
                 <div className={`relative`}>
                    <input 
                      type="file" 
                      id="csv-append" 
                      className="hidden" 
                      accept=".csv" 
                      onChange={(e) => e.target.files?.[0] && handleCsvUpload(e.target.files[0])} 
                    />
                    <button 
                      onClick={() => document.getElementById('csv-append')?.click()}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:cursor-not-allowed"
                      disabled={false}
                    >
                      Append CSV
                    </button>
                 </div>

                 {unanalyzedCount > 0 && (
                   <button 
                     onClick={handleAnalyzeNextBatch}
                     disabled={!userIntent}
                     className="flex items-center justify-center gap-2 px-5 py-2 text-sm font-bold text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                   >
                     {isBatchAnalyzing ? (
                       <>
                         <Loader2 size={16} className="animate-spin" />
                         Evaluating...
                       </>
                      ) : (
                       <>
                         <PlayCircle size={16} />
                         Analyze Next {nextBatchSize}
                       </>
                     )}
                   </button>
                 )}
              </div>
            </div>

            <FilterBar filters={filters} onChange={setFilters} />
          {/* Main Table */}
            <JobTable 
              jobs={filteredJobs} 
              onGenerate={handleGenerateResume} 
              isProcessing={generationStatus} 
              isGenerating={isAnyGenerating}
              onViewDiff={(jobId) => setDiffJobId(jobId)}
              showReasoning
              generationProgress={generationProgress}
            />

          {/* Diff Modal */}
          {diffJobId && (
            <ResumeDiffModal
              job={jobs.find(j => j.id === diffJobId) || null}
              original={resumeText || ''}
              onClose={() => setDiffJobId(null)}
            />
          )}
        </>
      )}
    </main>
  </div>
);
};

export default App;
  const handleIntentChange = (intent: string) => {
    setUserIntent(intent);
    setIntentConfirmed(false);
  };
