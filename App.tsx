
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Database, Briefcase, PlayCircle, Loader2, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { FileUpload } from './components/FileUpload';
import { JobTable } from './components/JobTable';
import { ResumeWidget } from './components/ResumeWidget';
import { LogBox } from './components/LogBox';
import { AgentPanel } from './components/AgentPanel';
import { ProgressTracker } from './components/ProgressTracker';
import { DiffModal } from './components/DiffModal';
import { QueueWidget } from './components/QueueWidget';
import { ChatWidget } from './components/ChatWidget';
import { ApiKeyInput } from './components/ApiKeyInput';
import { parseCSV } from './services/csvParser';
import { 
  analyzeJobsInBatchV2, 
  generateTailoredResume, 
  createAgentPanel, 
  JobAnalysisResult,
  parseResumeFile,
  createEvaluationInstructions,
  validateApiKey
} from './services/geminiService';
import { StorageService, hashString } from './services/storageService';
import { indexJobs, setVectorLogger } from './services/vectorService';
import { Job, Agent, LogEntry, ResumeData, Artifact } from './types';
import { AI_CONFIG } from './constants';

const App: React.FC = () => {
  const [uuid, setUuid] = useState<string>('');
  
  // Persistent State
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [evaluationInstructions, setEvaluationInstructions] = useState<string>('');
  const [userIntent, setUserIntent] = useState<string>(''); // NEW: Track intent for Chat Context

  // Core Data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Settings
  const [batchSize, setBatchSize] = useState(AI_CONFIG.BATCH_SIZE);
  
  // UI Flags
  const [isProcessingResume, setIsProcessingResume] = useState(false);
  const [isBuildingAgents, setIsBuildingAgents] = useState(false);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [isGeneratingResume, setIsGeneratingResume] = useState(false); 
  const [isIndexing, setIsIndexing] = useState(false); // NEW: Track Vector Indexing Status
  const [generationStatus, setGenerationStatus] = useState<Record<string, boolean>>({});

  // Session State
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [inputApiKey, setInputApiKey] = useState(''); // Temp state for onboarding input
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Diff Modal State
  const [diffJobId, setDiffJobId] = useState<string | null>(null);

  // Computed State - Now includes isIndexing
  const isGlobalBusy = isProcessingResume || isBuildingAgents || isBatchAnalyzing || isGeneratingResume || isIndexing;
  
  // Determine Step for ProgressTracker
  const currentStep = useMemo(() => {
    if (!isSessionActive) return 1;
    if (agents.length === 0) return 2;
    if (jobs.length === 0) return 3;
    const unanalyzed = jobs.filter(j => j.status === 'NEW' || j.matchScore === undefined);
    if (unanalyzed.length > 0 && jobs.length > 0) return 4;
    return 5;
  }, [isSessionActive, agents.length, jobs]);

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

    // Stuck State Recovery on Load
    // Forces any job stuck in 'PROCESSING' back to 'NEW' (or DONE if it has a resume)
    setJobs(prev => prev.map(j => {
        if (j.status === 'PROCESSING') {
           return { ...j, status: 'NEW' };
        }
        return j;
    }));

    // Restoration Flow
    const restoredResume = StorageService.getResume();
    const storedKey = StorageService.getApiKey();

    if (restoredResume) {
      setResumeData(restoredResume);
      // If we have resume AND key on load, we consider session active (restored)
      if (storedKey) {
          setIsSessionActive(true);
          setInputApiKey(storedKey); // Pre-fill
      }
      
      if (restoredResume.hash) {
          const savedIntent = StorageService.getIntent(restoredResume.hash);
          if (savedIntent) {
              setUserIntent(savedIntent);
          }
      }
      addLog('Session restored.', 'success');
    }

    // Wire up Vector Service Logging
    setVectorLogger((msg, type) => addLog(msg, type));

  }, []);

  // --- Handlers ---

  const handleResumeUpload = async (file: File) => {
    if (isGlobalBusy) return; 
    
    setIsProcessingResume(true);
    // don't log yet to keep onboarding clean, or log to hidden array
    
    try {
        const text = await parseResumeFile(file);
        const hash = await hashString(text);
        
        const newData: ResumeData = {
            fileName: file.name,
            text: text,
            uploadedAt: Date.now(),
            hash: hash
        };

        if (resumeData && resumeData.hash !== hash) {
            // Re-upload logic
            setAgents([]);
            setEvaluationInstructions('');
            setUserIntent(''); // Reset intent on new resume
            setJobs(prev => prev.map(j => ({ 
                ...j, 
                status: 'NEW', 
                matchScore: undefined, 
                visaRisk: undefined, 
                reasoning: undefined,
                evaluatedBy: undefined,
                generationPhase: undefined,
                generatedResume: undefined,
                audioSummary: undefined
            })));
        }

        setResumeData(newData);
        StorageService.saveResume(newData);
    } catch (e) {
        addLog("Failed to parse resume.", "error");
    } finally {
        setIsProcessingResume(false);
    }
  };

  const handleStartSession = async () => {
      setKeyError(null);
      setIsValidatingKey(true);

      // 1. Get Key (User Input or Storage)
      const keyToTest = inputApiKey || StorageService.getApiKey();

      if (!keyToTest) {
          setKeyError("Please enter your Gemini API Key.");
          setIsValidatingKey(false);
          return;
      }

      // 2. Validate Key
      const isValid = await validateApiKey(keyToTest);

      if (isValid) {
          StorageService.saveApiKey(keyToTest); // Ensure it's saved
          setIsSessionActive(true);
          addLog("Session started. Resume & API Key verified.", "success");
      } else {
          setKeyError("Invalid API Key. Please check and try again.");
          addLog("API Key validation failed.", "error");
      }
      setIsValidatingKey(false);
  };

  const handleResetSession = () => {
    setResumeData(null);
    setJobs([]);
    setAgents([]);
    setLogs([]);
    setEvaluationInstructions('');
    setUserIntent('');
    setIsSessionActive(false);
    StorageService.clearResume();
    addLog("Session reset complete.", "info");
  };

  const handleBuildAgents = async (intent: string) => {
    if (!resumeData || isGlobalBusy) return; 
    
    setIsBuildingAgents(true);
    setUserIntent(intent); // Update State
    addLog(`Recruiting agent panel for: "${intent}"...`, 'info', 'Dispatcher');
    
    try {
      const recruitedAgents = await createAgentPanel(resumeData.text, intent);
      setAgents(recruitedAgents);
      
      if (resumeData.hash) {
        StorageService.saveIntent(resumeData.hash, intent);
      }
      
      const instructions = createEvaluationInstructions(resumeData.text, intent);
      setEvaluationInstructions(instructions);

      addLog('Agent Panel is ready. Proceed to Job Import.', 'success', 'Dispatcher');
    } catch (e) {
      addLog('Failed to recruit agents. Please try again.', 'error');
    } finally {
      setIsBuildingAgents(false);
    }
  };

  const handleCsvUpload = (file: File) => {
    if (isGlobalBusy) return; 

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const parsedJobs = parseCSV(text);
      
      if (parsedJobs.length === 0) {
         addLog("Uploaded CSV contains no valid jobs. Check format.", 'error');
         return;
      }
      
      const MAX_JOBS = 500;
      let jobsToImport = parsedJobs;
      if (parsedJobs.length > MAX_JOBS) {
          jobsToImport = parsedJobs.slice(0, MAX_JOBS);
          addLog(`CSV too large. Limiting import to ${MAX_JOBS} rows.`, 'warning');
      }

      // START INDEXING STATE
      setIsIndexing(true);
      
      // Background Indexing for RAG (Batch Process) with UI Logging
      try {
        await indexJobs(jobsToImport, (msg) => addLog(msg, 'info'));
      } catch (err) {
        addLog("RAG Indexing error (Check console)", 'warning');
      } finally {
        setIsIndexing(false); // END INDEXING STATE
      }

      const hydratedJobs = jobsToImport.map(job => {
          if (resumeData?.hash) {
              const j = StorageService.hydrateJob(job, resumeData.hash);
              // Ensure we don't import jobs in 'PROCESSING' state from cache
              if (j.status === 'PROCESSING') {
                 return { ...j, status: 'NEW' as const }; 
              }
              return j;
          }
          return job;
      });

      setJobs(prev => {
        const existingIds = new Set(prev.map(j => j.id));
        const newJobs = hydratedJobs.filter(j => !existingIds.has(j.id));
        const count = newJobs.length;
        if (count > 0) addLog(`Imported ${count} jobs.`, 'success');
        else addLog('No new jobs found in CSV (duplicates ignored).', 'warning');
        return [...prev, ...newJobs];
      });
    };
    reader.readAsText(file);
  };

  const handleAnalyzeNextBatch = async () => {
    if (!resumeData || isGlobalBusy || agents.length === 0) return;
    
    // Strict Filter: Only analyze jobs that have NO match score yet
    const jobsToAnalyze = jobs.filter(j => j.matchScore === undefined || j.status === 'FAILED');
    if (jobsToAnalyze.length === 0) return;

    const batch = jobsToAnalyze.slice(0, batchSize);
    
    setIsBatchAnalyzing(true);
    addLog(`Dispatching analysis for ${batch.length} jobs...`, 'info');

    setJobs(prev => prev.map(j => batch.find(b => b.id === j.id) ? { ...j, status: 'PROCESSING' as const } : j));

    try {
      const results = await analyzeJobsInBatchV2(
        resumeData.text, 
        batch, 
        agents, 
        evaluationInstructions,
        addLog,
        (result: JobAnalysisResult) => {
          setJobs(prev => prev.map(j => j.id === result.id ? {
            ...j,
            matchScore: result.matchScore,
            visaRisk: result.visaRisk,
            reasoning: result.reasoning,
            evaluatedBy: result.evaluatedBy,
            status: 'PROCESSING' as const 
          } : j));
        }
      );
      
      setJobs(prev => prev.map(j => {
          const res = results.find(r => r.id === j.id);
          if (res) {
              if (resumeData.hash) {
                  const artifact: Artifact = {
                      jobId: j.id,
                      resumeHash: resumeData.hash,
                      matchScore: res.matchScore,
                      visaRisk: res.visaRisk,
                      reasoning: res.reasoning || '',
                      evaluatedBy: res.evaluatedBy || 'AI',
                      updatedAt: Date.now()
                  };
                  StorageService.saveArtifact(artifact);
              }
              // Set status to NEW (Analyzed) instead of PROCESSING so spinners stop
              return { ...j, status: 'NEW' as const }; 
          } else if (batch.find(b => b.id === j.id)) {
              return { ...j, status: 'FAILED' as const };
          }
          return j;
      }));

    } catch (e) {
      addLog('Batch analysis encountered a critical error. Rows marked as FAILED.', 'error');
      setJobs(prev => prev.map(j => batch.find(b => b.id === j.id) ? { ...j, status: 'FAILED' as const } : j));
    } finally {
      setIsBatchAnalyzing(false);
    }
  };

  const handleRetrySingleAnalysis = async (job: Job) => {
      if (isGlobalBusy || !resumeData) return;
      setIsBatchAnalyzing(true); 
      try {
         const results = await analyzeJobsInBatchV2(resumeData.text, [job], agents, evaluationInstructions, addLog);
         if (results.length > 0) {
            const res = results[0];
            if (resumeData.hash) {
                 StorageService.saveArtifact({
                     jobId: job.id,
                     resumeHash: resumeData.hash,
                     matchScore: res.matchScore,
                     visaRisk: res.visaRisk,
                     reasoning: res.reasoning || '',
                     evaluatedBy: res.evaluatedBy || 'AI',
                     updatedAt: Date.now()
                 });
            }

            setJobs(prev => prev.map(j => j.id === res.id ? {
                ...j,
                matchScore: res.matchScore,
                visaRisk: res.visaRisk,
                reasoning: res.reasoning,
                evaluatedBy: res.evaluatedBy,
                status: 'NEW' as const // Stop spinner
            } : j));
         } else {
             setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'FAILED' as const } : j));
         }
      } catch (e) {
         setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'FAILED' as const } : j));
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
    addLog(`Downloaded: ${filename}`, 'success');
  };

  const handleGenerateResume = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || !resumeData) return;

    if (job.status === 'DONE' && job.generatedResume) {
      const safeCompanyName = job.company.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      downloadFile(job.generatedResume, `Resume_${safeCompanyName}.md`);
      return;
    }

    if (isGlobalBusy) return;

    setIsGeneratingResume(true);
    setGenerationStatus(prev => ({ ...prev, [jobId]: true }));
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, generationPhase: 'ARCHITECT' } : j));

    try {
      const generatedContent = await generateTailoredResume(
          resumeData.text, 
          job, 
          addLog,
          (phase) => {
             setJobs(prev => prev.map(j => j.id === jobId ? { ...j, generationPhase: phase } : j));
          }
      );
      
      setJobs(prev => prev.map(j => j.id === jobId ? { 
        ...j, 
        status: 'DONE' as const,
        generationPhase: 'DONE',
        generatedResume: generatedContent 
      } : j));
      
      if (resumeData.hash) {
          const existing = StorageService.getArtifact(resumeData.hash, jobId);
          if (existing) {
              StorageService.saveArtifact({
                  ...existing,
                  generatedResume: generatedContent,
                  updatedAt: Date.now()
              });
          }
      }

      addLog(`Tailored resume ready for ${job.company}.`, 'success');

    } catch (e) {
      addLog(`Failed to generate resume for ${job.company}`, 'error');
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'FAILED' as const } : j));
    } finally {
      setGenerationStatus(prev => ({ ...prev, [jobId]: false }));
      setIsGeneratingResume(false);
    }
  };

  // --- Render ---

  const diffJob = diffJobId ? jobs.find(j => j.id === diffJobId) : null;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-20">
      
      {/* 1. Header & Stepper */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shadow-md shadow-primary-600/20">
              <Briefcase size={18} className="text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-gray-900 hidden sm:block">SafeSubmit</span>
          </div>
          <div className="flex items-center gap-4">
             {/* Only show Compact Key Input if session is active (to avoid double inputs) */}
             {isSessionActive && (
                <ApiKeyInput 
                   compact 
                   onKeySaved={() => addLog("API Key updated successfully.", "success")} 
                />
             )}
             
             {isSessionActive && resumeData && (
                <ResumeWidget 
                resumeName={resumeData.fileName} 
                onReupload={handleResumeUpload} 
                onReset={handleResetSession}
                isDisabled={isGlobalBusy}
                />
             )}
          </div>
        </div>
      </header>

      {isSessionActive && <ProgressTracker currentStep={currentStep} />}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Step 1: Strict Onboarding (Combined Upload + Key) */}
        {!isSessionActive && (
             <div className="max-w-md mx-auto mt-20 text-center space-y-8 animate-in fade-in duration-700">
                <div>
                  <h2 className="text-3xl font-extrabold text-gray-900">Let's get you hired.</h2>
                  <p className="mt-2 text-gray-600">Secure, AI-powered resume tailoring. Zero friction.</p>
                </div>
                
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-6 relative">
                    {/* Resume Upload Section */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">1. Upload Resume</label>
                        {isProcessingResume ? (
                             <div className="py-8 flex flex-col items-center justify-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                                <Loader2 className="h-8 w-8 text-primary-600 animate-spin mb-2" />
                                <span className="text-sm font-medium text-gray-500">Processing...</span>
                             </div>
                        ) : resumeData ? (
                            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                                <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center text-green-600 shrink-0">
                                    <ShieldCheck size={20} />
                                </div>
                                <div className="text-left overflow-hidden">
                                    <p className="text-sm font-bold text-gray-900 truncate">{resumeData.fileName}</p>
                                    <p className="text-xs text-green-700 font-medium">Ready</p>
                                </div>
                            </div>
                        ) : (
                            <FileUpload
                                label="Drop Resume"
                                subLabel="PDF, TXT, MD"
                                accept=".pdf,.txt,.md"
                                onFileSelect={handleResumeUpload}
                                isActive={true}
                            />
                        )}
                    </div>

                    {/* API Key Section */}
                    <div className="space-y-3 pt-4 border-t border-gray-100">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">2. Enter API Key</label>
                        <ApiKeyInput 
                            onKeySaved={() => {}} 
                            onChange={(val) => setInputApiKey(val)} 
                        />
                         {keyError && (
                            <div className="flex items-center gap-2 text-red-600 text-xs font-bold bg-red-50 p-2 rounded-lg justify-center animate-in fade-in slide-in-from-top-1">
                                <AlertCircle size={14} /> {keyError}
                            </div>
                         )}
                    </div>

                    {/* Start Button */}
                    <button
                        onClick={handleStartSession}
                        disabled={!resumeData || (!inputApiKey && !StorageService.getApiKey()) || isValidatingKey}
                        className={`
                            w-full py-3.5 rounded-xl font-bold text-white shadow-lg shadow-primary-500/30 transition-all transform active:scale-95
                            flex items-center justify-center gap-2
                            ${(!resumeData || (!inputApiKey && !StorageService.getApiKey())) 
                                ? 'bg-gray-300 cursor-not-allowed shadow-none' 
                                : 'bg-primary-600 hover:bg-primary-700 hover:shadow-primary-600/40'
                            }
                        `}
                    >
                        {isValidatingKey ? (
                            <>
                              <Loader2 size={18} className="animate-spin" /> 
                              Verifying...
                            </>
                        ) : (
                            <>
                              Let's Start <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </div>
             </div>
        )}

        {/* Step 2: Agent Panel (Only if Session Active) */}
        {isSessionActive && resumeData && (
            <AgentPanel 
            agents={agents} 
            onBuildPanel={handleBuildAgents} 
            isBuilding={isBuildingAgents}
            isDisabled={isGlobalBusy}
            />
        )}

        {/* Step 3: Job Import */}
        {isSessionActive && resumeData && agents.length > 0 && jobs.length === 0 && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl p-10 shadow-sm border border-gray-200 text-center animate-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Import Job Data</h2>
              <p className="text-gray-500 mb-8">Upload your CSV to populate the workspace.</p>
              <FileUpload
                label="Import Job CSV"
                subLabel="Drag and drop your job list"
                accept=".csv"
                onFileSelect={handleCsvUpload}
                icon={<Database size={32} />}
                isActive={!isGlobalBusy}
              />
          </div>
        )}

        {/* Dashboard */}
        {jobs.length > 0 && (
          <>
            {/* Control Bar */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="flex gap-8 w-full md:w-auto overflow-x-auto">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Jobs</p>
                  <p className="text-2xl font-bold text-gray-900">{jobs.length}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Analyzed</p>
                  <p className="text-2xl font-bold text-blue-600">
                      {jobs.filter(j => j.matchScore !== undefined).length}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Generated</p>
                  <p className="text-2xl font-bold text-green-600">
                      {jobs.filter(j => j.generatedResume).length}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto">
                 <div className={`relative ${isGlobalBusy ? 'opacity-50 pointer-events-none' : ''}`}>
                    <input 
                      type="file" 
                      id="csv-append" 
                      className="hidden" 
                      accept=".csv" 
                      onChange={(e) => e.target.files?.[0] && handleCsvUpload(e.target.files[0])} 
                      disabled={isGlobalBusy}
                    />
                    <button 
                      onClick={() => document.getElementById('csv-append')?.click()}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      Append CSV
                    </button>
                 </div>
                 
                 {/* Batch Selector */}
                 <div className="flex items-center gap-2 border-l border-gray-300 pl-4 bg-white rounded-md">
                     <span className="text-xs font-semibold text-gray-500 uppercase">Batch Size:</span>
                     <select 
                       value={batchSize}
                       onChange={(e) => setBatchSize(Number(e.target.value))}
                       disabled={isGlobalBusy || isBatchAnalyzing}
                       className="text-sm bg-white text-gray-900 border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
                     >
                       <option value={1}>1</option>
                       <option value={3}>3</option>
                       <option value={5}>5</option>
                       <option value={9}>9</option>
                       <option value={10}>10</option>
                     </select>
                 </div>

                 <button 
                     onClick={handleAnalyzeNextBatch}
                     disabled={isGlobalBusy || agents.length === 0 || jobs.filter(j => j.matchScore === undefined || j.status === 'FAILED').length === 0}
                     className="flex items-center justify-center gap-2 px-5 py-2 text-sm font-bold text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     {isBatchAnalyzing || isIndexing ? (
                       <>
                         <Loader2 size={16} className="animate-spin" />
                         {isIndexing ? 'Indexing...' : 'Analyzing...'}
                       </>
                     ) : (
                       <>
                         <PlayCircle size={16} />
                         Analyze Next {Math.min(batchSize, jobs.filter(j => j.matchScore === undefined || j.status === 'FAILED').length)}
                       </>
                     )}
                   </button>
              </div>
            </div>

            <LogBox logs={logs} />

            <JobTable 
              jobs={jobs} 
              onGenerate={handleGenerateResume} 
              onRetryGeneration={handleGenerateResume}
              onRetryAnalysis={handleRetrySingleAnalysis}
              onViewDiff={(id) => setDiffJobId(id)}
              isProcessing={generationStatus} 
              isGlobalBusy={isGlobalBusy}
            />
          </>
        )}
      </main>

      {/* Background Queue Monitor */}
      <QueueWidget jobs={jobs} generationStatus={generationStatus} />

      {/* Chat Widget */}
      {jobs.length > 0 && (
         <ChatWidget 
            jobs={jobs} 
            resumeText={resumeData?.text || ''} 
            userIntent={userIntent || ''}
         />
      )}

      {/* Diff Modal */}
      <DiffModal 
         isOpen={!!diffJob}
         onClose={() => setDiffJobId(null)}
         jobTitle={diffJob?.title || 'Job'}
         originalText={resumeData?.text || ''}
         tailoredText={diffJob?.generatedResume || ''}
      />
    </div>
  );
};

export default App;
