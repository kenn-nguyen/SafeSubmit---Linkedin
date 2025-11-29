import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Database, Briefcase, PlayCircle, Loader2, Zap } from 'lucide-react';
import { FileUpload } from './components/FileUpload';
import { JobTable } from './components/JobTable';
import { ResumeWidget } from './components/ResumeWidget';
import { LogBox } from './components/LogBox';
import { AgentPanel } from './components/AgentPanel';
import { parseCSV } from './services/csvParser';
import { analyzeJobsInBatch, generateTailoredResume, createAgentPanel, JobAnalysisResult } from './services/geminiService';
import { Job, Agent, LogEntry } from './types';
import { AI_CONFIG } from './constants';

const App: React.FC = () => {
  const [uuid, setUuid] = useState<string>('');
  
  // Persistent State
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [resumeName, setResumeName] = useState<string | null>(null);

  // Core Data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // UI Flags for Async Operations
  const [isProcessingResume, setIsProcessingResume] = useState(false);
  const [isBuildingAgents, setIsBuildingAgents] = useState(false);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [isGeneratingResume, setIsGeneratingResume] = useState(false); 
  
  const [generationStatus, setGenerationStatus] = useState<Record<string, boolean>>({});
  const [isJobImported, setIsJobImported] = useState(false);

  // GLOBAL LOCK: Strict "One at a time" enforcement
  const isGlobalBusy = isProcessingResume || isBuildingAgents || isBatchAnalyzing || isGeneratingResume;

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
      setResumeText(storedResume);
      setResumeName(storedResumeName);
      addLog('Welcome back. Resume loaded from secure storage.', 'success');
    }
  }, []);

  // --- Handlers ---

  const handleResumeUpload = (file: File) => {
    if (isGlobalBusy) return; 
    
    setIsProcessingResume(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = typeof e.target?.result === 'string' ? e.target.result : '';
      setTimeout(() => {
        setResumeText(text);
        setResumeName(file.name);
        localStorage.setItem('safesubmit_resume', text);
        localStorage.setItem('safesubmit_resume_name', file.name);
        
        // --- SOFT RESET LOGIC ---
        // 1. Clear Agents: Old agents are biased towards the old resume.
        setAgents([]);
        
        // 2. Reset Jobs: Old scores are invalid for the new resume.
        if (jobs.length > 0) {
          setJobs(prevJobs => prevJobs.map(job => ({
            ...job,
            matchScore: undefined,
            visaRisk: undefined,
            reasoning: undefined,
            evaluatedBy: undefined,
            status: 'NEW', // Ready for re-analysis
            generatedResume: undefined // Clear old generated resumes
          })));
          addLog(`Resume updated. Previous job analysis reset to ensure accuracy.`, 'warning');
          addLog('Please recruit a new Agent Panel for this resume.', 'info');
        } else {
          addLog(`Resume uploaded: ${file.name}`, 'success');
          addLog('Waiting for user to define target role for Agent Recruitment...', 'info');
        }

        setIsProcessingResume(false);
      }, 800); 
    };
    reader.readAsText(file);
  };

  const handleBuildAgents = async (intent: string) => {
    if (!resumeText || isGlobalBusy) return; 
    
    setIsBuildingAgents(true);
    addLog(`Recruiting agent panel for: "${intent}"...`, 'info', 'Dispatcher');
    
    try {
      const recruitedAgents = await createAgentPanel(resumeText, intent);
      setAgents(recruitedAgents);
      
      recruitedAgents.forEach(agent => {
        addLog(`Onboarded ${agent.role} with focus on ${agent.focus}`, 'agent', agent.name);
      });
      
      addLog('Agent Panel is ready. Start analysis.', 'success', 'Dispatcher');
    } catch (e) {
      addLog('Failed to recruit agents. Please try again.', 'warning');
      console.error(e);
    } finally {
      setIsBuildingAgents(false);
    }
  };

  const handleCsvUpload = (file: File) => {
    if (isGlobalBusy) return; 

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
        const newJobs = parsedJobs.filter(j => !existingIds.has(j.id));
        addLog(`Imported ${newJobs.length} new jobs from CSV. Ready for analysis.`, 'info');
        return [...prev, ...newJobs];
      });
      setIsJobImported(true);
    };
    reader.readAsText(file);
  };

  const handleAnalyzeNextBatch = async () => {
    if (!resumeText || isGlobalBusy) return; 
    
    if (agents.length === 0) {
      alert("Please recruit your Agent Panel first!");
      return;
    }
    
    const unanalyzedJobs = jobs.filter(j => j.status === 'NEW' || j.matchScore === undefined);
    if (unanalyzedJobs.length === 0) {
      addLog("No unanalyzed jobs found.", 'warning');
      return;
    }

    const batch = unanalyzedJobs.slice(0, AI_CONFIG.BATCH_SIZE);

    setIsBatchAnalyzing(true);
    addLog(`Dispatching batch of ${batch.length} jobs to the CrewAI pipeline...`, 'info');

    try {
      // We pass a callback to update state progressively as the crew finishes each job
      const results = await analyzeJobsInBatch(
        resumeText, 
        batch, 
        agents, 
        addLog,
        (result: JobAnalysisResult) => {
          setJobs(prev => prev.map(j => j.id === result.id ? {
            ...j,
            matchScore: result.matchScore,
            visaRisk: result.visaRisk,
            reasoning: result.reasoning,
            evaluatedBy: result.evaluatedBy,
            status: 'PROCESSING' // 'PROCESSING' indicates analyzed but resume not yet generated
          } : j));
        }
      );

      if (results.length === 0) {
         addLog('Analysis yielded no results or was aborted.', 'warning');
      } else {
        addLog(`Batch analysis complete. Evaluated ${results.length} jobs.`, 'success');
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

    // 1. CHECK FOR EXISTING RESUME
    if (job.status === 'DONE' && job.generatedResume) {
      const safeCompanyName = job.company.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      downloadFile(job.generatedResume, `Resume_${safeCompanyName}.md`);
      return;
    }

    if (isGlobalBusy) return;

    // 2. START GENERATION
    setIsGeneratingResume(true);
    setGenerationStatus(prev => ({ ...prev, [jobId]: true }));
    addLog(`Starting Resume Generation Crew for ${job.company}...`, 'info');
    
    try {
      // Pass addLog to visualize the Architect -> Writer -> Editor process
      const generatedContent = await generateTailoredResume(resumeText, job, addLog);
      
      setJobs(prev => prev.map(j => j.id === jobId ? { 
        ...j, 
        status: 'DONE',
        generatedResume: generatedContent // Store content so we don't regenerate
      } : j));
      
      addLog(`Resume generated for ${job.company}. Click 'Download' to save.`, 'success');
      
      // Optional: Auto-download on finish
      // const safeCompanyName = job.company.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      // downloadFile(generatedContent, `Resume_${safeCompanyName}.md`);

    } catch (e) {
      addLog(`Failed to generate resume for ${job.company}`, 'warning');
    } finally {
      setGenerationStatus(prev => ({ ...prev, [jobId]: false }));
      setIsGeneratingResume(false);
    }
  };

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
                label="Upload Resume PDF"
                subLabel="We support PDF and TXT formats"
                accept=".pdf,.txt"
                onFileSelect={handleResumeUpload}
                icon={<FileText size={32} />}
                isActive={!isGlobalBusy}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  const unanalyzedCount = jobs.filter(j => j.status === 'NEW' || j.matchScore === undefined).length;
  const nextBatchSize = Math.min(unanalyzedCount, AI_CONFIG.BATCH_SIZE);

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
               isDisabled={isGlobalBusy}
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* 1. Agent Panel (Intent Config) */}
        <AgentPanel 
          agents={agents} 
          onBuildPanel={handleBuildAgents} 
          isBuilding={isBuildingAgents}
          isDisabled={isGlobalBusy}
        />

        {/* 2. Job Import (Only if no jobs yet) */}
        {!isJobImported && jobs.length === 0 && agents.length > 0 && (
          <div className={`max-w-2xl mx-auto mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500 ${isGlobalBusy ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="bg-white rounded-2xl p-10 shadow-sm border border-gray-200 text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Data Ingestion</h2>
              <p className="text-gray-500 mb-8">Your crew is ready. Upload your CSV to start the pipeline.</p>
              <FileUpload
                label="Import Job CSV"
                subLabel="Drag and drop your job list here"
                accept=".csv"
                onFileSelect={handleCsvUpload}
                icon={<Database size={32} />}
                isActive={!isGlobalBusy}
              />
            </div>
          </div>
        )}

        {/* 3. Dashboard & Logs */}
        {jobs.length > 0 && (
          <>
            {/* Control Bar */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="flex gap-8">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Total Jobs</p>
                  <p className="text-2xl font-bold text-gray-900">{jobs.length}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Analyzed</p>
                  <p className="text-2xl font-bold text-blue-600">{jobs.length - unanalyzedCount}</p>
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
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:cursor-not-allowed"
                      disabled={isGlobalBusy}
                    >
                      Append CSV
                    </button>
                 </div>

                 {unanalyzedCount > 0 && (
                   <button 
                     onClick={handleAnalyzeNextBatch}
                     disabled={isGlobalBusy || agents.length === 0}
                     className="flex items-center justify-center gap-2 px-5 py-2 text-sm font-bold text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                   >
                     {isBatchAnalyzing ? (
                       <>
                         <Loader2 size={16} className="animate-spin" />
                         Dispatching Crew...
                       </>
                     ) : isGlobalBusy ? (
                        <>
                         <Loader2 size={16} className="animate-spin" />
                         Wait...
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

            {/* Log Box */}
            <LogBox logs={logs} />

            {/* Main Table */}
            <JobTable 
              jobs={jobs} 
              onGenerate={handleGenerateResume} 
              isProcessing={generationStatus} 
              isGlobalBusy={isGlobalBusy}
            />
          </>
        )}
      </main>
    </div>
  );
};

export default App;