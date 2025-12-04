
import React, { useState, useMemo, useRef } from 'react';
import { Job, JobFilters } from '../types';
import { ShieldAlert, ShieldCheck, ShieldQuestion, Loader2, FileText, Users, Clock, CalendarDays, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Zap, RefreshCw, Eye, Check, Filter, MapPin, DollarSign, Briefcase, HelpCircle, Bot, PlayCircle } from 'lucide-react';
import { generateAudioSummary } from '../services/geminiService';

interface JobTableProps {
  jobs: Job[];
  onGenerate: (jobId: string) => void;
  onRetryGeneration: (jobId: string) => void;
  onRetryAnalysis: (job: Job) => void;
  onViewDiff: (jobId: string) => void;
  isProcessing: Record<string, boolean>;
  isGlobalBusy?: boolean;
}

type SortField = 'publishedAt' | 'matchScore';
type SortDirection = 'asc' | 'desc';

const StatusChip: React.FC<{ status: Job['status']; matchScore?: number }> = ({ status, matchScore }) => {
  switch (status) {
    case 'NEW':
      if (matchScore !== undefined) {
         return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 uppercase tracking-wide border border-blue-200">Analyzed</span>;
      }
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 uppercase tracking-wide border border-gray-200">New</span>;
    case 'PROCESSING':
      return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 uppercase tracking-wide border border-blue-100"><Loader2 size={8} className="animate-spin" /> Processing</span>;
    case 'DONE':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600 uppercase tracking-wide border border-green-100">Done</span>;
    case 'FAILED':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 uppercase tracking-wide border border-red-100">Failed</span>;
    default:
      return null;
  }
};

const VisaBadge: React.FC<{ risk?: string }> = ({ risk }) => {
  if (!risk) return <span className="text-gray-300 text-xs font-medium">—</span>;
  const config = {
    LOW: { color: 'bg-green-100 text-green-700 border-green-200', icon: ShieldCheck, label: 'Visa Safe' },
    MEDIUM: { color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: ShieldQuestion, label: 'Unclear' },
    HIGH: { color: 'bg-red-100 text-red-700 border-red-200', icon: ShieldAlert, label: 'High Risk' },
  };
  const { color, label } = config[risk as keyof typeof config] || config.MEDIUM;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${color}`}>
      {label}
    </span>
  );
};

const MatchBar: React.FC<{ score?: number, reasoning?: string, onClick?: () => void }> = ({ score, reasoning, onClick }) => {
  if (score === undefined) {
    return (
      <div className="flex items-center gap-3 opacity-50">
        <span className="text-sm font-bold w-8 text-gray-300">--</span>
        <div className="w-24 h-2 bg-gray-100 rounded-full" />
      </div>
    );
  }
  let colorClass = 'bg-gray-300';
  if (score >= 80) colorClass = 'bg-green-500';
  else if (score >= 60) colorClass = 'bg-yellow-500';
  else if (score > 0) colorClass = 'bg-orange-500';

  return (
    <div className="relative group cursor-pointer" onClick={onClick}>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-bold w-8 ${score >= 80 ? 'text-gray-900' : 'text-gray-600'}`}>
          {score}%
        </span>
        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-1000 ease-out ${colorClass}`}
            style={{ width: `${score}%` }}
          />
        </div>
        {reasoning && <HelpCircle size={14} className="text-gray-400 group-hover:text-primary-500 transition-colors" />}
      </div>
    </div>
  );
};

// Granular Progress Bar for Generation
const GenerationProgress: React.FC<{ phase?: Job['generationPhase'] }> = ({ phase }) => {
  const phases = {
    'ARCHITECT': { pct: 25, label: 'Architect' },
    'WRITER': { pct: 50, label: 'Writer' },
    'EDITOR': { pct: 75, label: 'Editor' },
    'QA': { pct: 90, label: 'QA' },
    'DONE': { pct: 100, label: 'Done' }
  };
  
  const current = phases[phase || 'ARCHITECT'];

  return (
    <div className="flex flex-col gap-1.5 w-full max-w-[120px]">
      <div className="flex items-center justify-between text-[10px] text-white font-bold uppercase tracking-wide">
        <span className="animate-pulse">{current.label}</span>
        <span>{current.pct}%</span>
      </div>
      <div className="h-1.5 w-full bg-black/20 rounded-full overflow-hidden">
        <div 
          className="h-full bg-white transition-all duration-500" 
          style={{ width: `${current.pct}%` }} 
        />
      </div>
    </div>
  );
};

const formatDate = (dateString?: string) => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  } catch {
    return dateString;
  }
};

export const JobTable: React.FC<JobTableProps> = ({ jobs, onGenerate, onRetryGeneration, onRetryAnalysis, onViewDiff, isProcessing, isGlobalBusy }) => {
  const [sortField, setSortField] = useState<SortField>('matchScore');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openReasoningId, setOpenReasoningId] = useState<string | null>(null);
  
  // Audio State with Ref for cleanup
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const activeAudioRef = useRef<{ stop: () => void } | null>(null);
  
  // Filters State
  const [filters, setFilters] = useState<JobFilters>({
    minScore: 0,
    visaRisk: 'ALL',
    easyApplyOnly: false,
    recentOnly: false,
    status: 'ALL'
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1); 
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      if (filters.easyApplyOnly && job.applyType !== 'EASY_APPLY') return false;
      if (filters.visaRisk !== 'ALL' && job.visaRisk !== filters.visaRisk) return false;
      if (job.matchScore !== undefined && job.matchScore < filters.minScore) return false;
      if (filters.status === 'TODO' && job.status === 'DONE') return false;
      if (filters.status === 'DONE' && job.status !== 'DONE') return false;
      
      if (filters.recentOnly && job.publishedAt) {
          const pubDate = new Date(job.publishedAt);
          // Safety check for invalid dates
          if (isNaN(pubDate.getTime())) return false; 
          
          const diffTime = Math.abs(Date.now() - pubDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
          if (diffDays > 7) return false;
      }
      return true;
    });
  }, [jobs, filters]);

  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (valA === undefined || valA === null) valA = -Infinity;
      if (valB === undefined || valB === null) valB = -Infinity;

      if (sortField === 'publishedAt') {
        valA = new Date(a.publishedAt || 0).getTime();
        valB = new Date(b.publishedAt || 0).getTime();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredJobs, sortField, sortDirection]);

  const paginatedJobs = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedJobs.slice(startIndex, startIndex + pageSize);
  }, [sortedJobs, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredJobs.length / pageSize);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <div className="w-4 h-4 opacity-0" />;
    return sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const toggleReasoning = (id: string) => {
    setOpenReasoningId(prev => prev === id ? null : id);
  };

  const handlePlayAudio = async (e: React.MouseEvent, job: Job) => {
      e.stopPropagation();
      
      // Stop current if playing
      if (activeAudioRef.current) {
          activeAudioRef.current.stop();
          activeAudioRef.current = null;
          setPlayingAudioId(null);
      }
      
      // If clicking same job, just stop (toggle off behavior)
      if (playingAudioId === job.id) {
          return;
      }

      // Start loading
      setLoadingAudioId(job.id);
      
      try {
        const audioBase64 = await generateAudioSummary(job);
        
        if (audioBase64) {
            // Web Audio API Context
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContext({ sampleRate: 24000 }); // Gemini TTS Default

            // Decode Base64 to ArrayBuffer
            const binaryString = atob(audioBase64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Convert raw PCM (Int16 Little Endian) to AudioBuffer (Float32)
            const int16Data = new Int16Array(bytes.buffer);
            const float32Data = new Float32Array(int16Data.length);
            for(let i=0; i<int16Data.length; i++) {
                float32Data[i] = int16Data[i] / 32768.0;
            }

            const buffer = audioCtx.createBuffer(1, float32Data.length, 24000);
            buffer.getChannelData(0).set(float32Data);

            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(audioCtx.destination);
            
            source.onended = () => {
                setPlayingAudioId(null);
                activeAudioRef.current = null;
                audioCtx.close();
            };

            source.start(0);

            // Now it's playing
            setPlayingAudioId(job.id);

            activeAudioRef.current = {
                stop: () => {
                    try {
                        source.stop();
                        audioCtx.close();
                    } catch(e) {}
                }
            };
        }
      } catch(e) {
          console.error("Audio playback failed", e);
          setPlayingAudioId(null);
      } finally {
          setLoadingAudioId(null);
      }
  };

  if (jobs.length === 0) return null;

  return (
    <div className="w-full bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
      
      {/* Filters Bar */}
      <div className="p-4 border-b border-gray-200 bg-white flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Filter size={16} className="text-gray-500" />
          <span>Filters:</span>
        </div>
        
        <select 
          className="text-xs bg-white text-gray-700 border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          value={filters.visaRisk}
          onChange={e => setFilters(prev => ({ ...prev, visaRisk: e.target.value as any }))}
        >
          <option value="ALL">Visa: All</option>
          <option value="LOW">Visa: Low Risk</option>
          <option value="MEDIUM">Visa: Medium</option>
          <option value="HIGH">Visa: High Risk</option>
        </select>

        <select 
          className="text-xs bg-white text-gray-700 border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          value={filters.minScore}
          onChange={e => setFilters(prev => ({ ...prev, minScore: Number(e.target.value) }))}
        >
          <option value={0}>Score: All</option>
          <option value={50}>Score: 50%+</option>
          <option value={75}>Score: 75%+</option>
          <option value={90}>Score: 90%+</option>
        </select>

        <select 
           className="text-xs bg-white text-gray-700 border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
           value={filters.status}
           onChange={e => setFilters(prev => ({ ...prev, status: e.target.value as any }))}
        >
          <option value="ALL">Status: All</option>
          <option value="TODO">To Do</option>
          <option value="DONE">Done</option>
        </select>

        <div className="flex items-center gap-4 border-l border-gray-300 pl-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none text-gray-700 hover:text-gray-900">
            <input 
                type="checkbox" 
                checked={filters.recentOnly}
                onChange={e => setFilters(prev => ({ ...prev, recentOnly: e.target.checked }))}
                className="rounded border-gray-300 bg-white text-primary-600 focus:ring-primary-500" 
            />
            Last 7 Days
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none text-gray-700 hover:text-gray-900">
            <input 
                type="checkbox" 
                checked={filters.easyApplyOnly}
                onChange={e => setFilters(prev => ({ ...prev, easyApplyOnly: e.target.checked }))}
                className="rounded border-gray-300 bg-white text-primary-600 focus:ring-primary-500" 
            />
            Easy Apply
            </label>
        </div>
        
        <div className="ml-auto text-xs text-gray-400">
          Showing {filteredJobs.length} of {jobs.length}
        </div>
      </div>

      <div className="overflow-x-auto min-h-[400px]">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[300px]">Role & Company</th>
              <th 
                className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                onClick={() => handleSort('publishedAt')}
              >
                <div className="flex items-center gap-1">
                  Published
                  <SortIcon field="publishedAt" />
                </div>
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Visa Risk</th>
              <th 
                className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                onClick={() => handleSort('matchScore')}
              >
                <div className="flex items-center gap-1">
                  Match
                  <SortIcon field="matchScore" />
                </div>
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedJobs.map((job) => (
              <React.Fragment key={job.id}>
              <tr className={`hover:bg-gray-50 transition-colors group ${openReasoningId === job.id ? 'bg-primary-50' : ''}`}>
                
                {/* Role & Company */}
                <td className="px-6 py-4 align-top">
                  <div className="flex flex-col max-w-sm">
                    <div className="flex items-center gap-2">
                       <a href={job.applyUrl || '#'} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-semibold hover:underline text-base truncate block mb-1" title={job.title}>
                         {job.title}
                       </a>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-gray-900 font-medium truncate max-w-[150px]" title={job.company}>{job.company}</span>
                      <StatusChip status={job.status} matchScore={job.matchScore} />
                      {job.applyType === 'EASY_APPLY' && (
                        <div className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                          <Zap size={10} className="fill-blue-700" />
                          Easy Apply
                        </div>
                      )}
                    </div>
                    {/* Enhanced Details */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                         {job.location && (
                             <div className="flex items-center gap-1">
                                <MapPin size={12} /> {job.location}
                             </div>
                         )}
                         {job.salary && (
                             <div className="flex items-center gap-1 text-gray-700 font-medium">
                                <DollarSign size={12} /> {job.salary}
                             </div>
                         )}
                         {job.applicants && (
                             <div className="flex items-center gap-1">
                                <Users size={12} /> {job.applicants}
                             </div>
                         )}
                    </div>
                  </div>
                </td>

                {/* Published */}
                <td className="px-6 py-4 text-gray-500 align-top">
                   <div className="flex items-center gap-2 text-xs">
                      <CalendarDays size={14} className="text-gray-400" />
                      <span>{formatDate(job.publishedAt)}</span>
                   </div>
                </td>

                {/* Visa */}
                <td className="px-6 py-4 align-top">
                  {job.status === 'PROCESSING' ? (
                     <Loader2 size={16} className="text-blue-500 animate-spin" />
                  ) : job.status === 'FAILED' ? (
                     <span className="text-red-500 text-xs font-bold">Error</span>
                  ) : (
                     <VisaBadge risk={job.visaRisk} />
                  )}
                </td>

                {/* Match */}
                <td className="px-6 py-4 align-top relative">
                  {job.status === 'PROCESSING' ? (
                     <span className="text-xs text-blue-500 font-medium">Evaluating...</span>
                  ) : job.status === 'FAILED' ? (
                    <button 
                      onClick={() => onRetryAnalysis(job)}
                      className="text-xs text-red-600 hover:text-red-800 underline flex items-center gap-1"
                    >
                      <RefreshCw size={12} /> Retry
                    </button>
                  ) : (
                    <MatchBar score={job.matchScore} reasoning={job.reasoning} onClick={() => job.reasoning && toggleReasoning(job.id)} />
                  )}
                </td>

                {/* Action */}
                <td className="px-6 py-4 text-right align-top">
                  <div className="flex items-center justify-end gap-2">
                    {/* Audio Play Button */}
                    {job.reasoning && (
                       <button
                         onClick={(e) => handlePlayAudio(e, job)}
                         className={`p-2 rounded-lg transition-colors ${playingAudioId === job.id ? 'text-green-600 bg-green-50 animate-pulse' : 'text-gray-400 hover:text-primary-600 hover:bg-primary-50'}`}
                         title="Play Audio Summary"
                         disabled={(!!playingAudioId && playingAudioId !== job.id) || loadingAudioId !== null}
                       >
                         {loadingAudioId === job.id ? (
                             <Loader2 size={18} className="animate-spin text-primary-600" />
                         ) : (
                             <PlayCircle size={18} />
                         )}
                       </button>
                    )}

                    {/* View Diff Button (Only if done) */}
                    {job.status === 'DONE' && job.generatedResume && (
                       <button
                         onClick={() => onViewDiff(job.id)}
                         className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                         title="View Resume Difference"
                       >
                         <Eye size={18} />
                       </button>
                    )}

                    {/* Main Action Button */}
                    <button
                      onClick={() => {
                        if (job.status === 'DONE') onGenerate(job.id); // Download
                        else if (job.status === 'FAILED') onRetryGeneration(job.id); // Retry Gen
                        else onGenerate(job.id); // Generate
                      }}
                      disabled={isProcessing[job.id] || (job.matchScore === undefined && job.status !== 'FAILED') || isGlobalBusy}
                      className={`
                        inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all min-w-[110px]
                        ${job.status === 'DONE' 
                          ? 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50' 
                          : 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                        }
                        disabled:opacity-70 disabled:cursor-not-allowed
                      `}
                    >
                      {isProcessing[job.id] ? (
                        <GenerationProgress phase={job.generationPhase} />
                      ) : job.status === 'DONE' ? (
                        <>Download</>
                      ) : (
                        'Generate'
                      )}
                    </button>
                  </div>
                </td>
              </tr>
              {/* Reasoning Popover Row */}
              {openReasoningId === job.id && job.reasoning && (
                  <tr className="bg-primary-50 animate-in fade-in slide-in-from-top-2 duration-200">
                      <td colSpan={5} className="px-6 py-4">
                          <div className="bg-white border border-primary-100 rounded-lg p-4 shadow-sm relative">
                              <div className="absolute top-[-6px] left-[65%] w-3 h-3 bg-white border-t border-l border-primary-100 transform rotate-45"></div>
                              <div className="flex items-start gap-3">
                                  <Bot className="text-primary-600 mt-1" size={18} />
                                  <div>
                                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">AI Reasoning</h4>
                                      <p className="text-sm text-gray-800 leading-relaxed">{job.reasoning}</p>
                                  </div>
                              </div>
                          </div>
                      </td>
                  </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filteredJobs.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>Rows per page:</span>
            <select 
              value={pageSize} 
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-white border border-gray-300 text-gray-900 text-sm rounded-md focus:ring-primary-500 focus:border-primary-500 block p-1.5 outline-none"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1">
               <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-md hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-600"
              >
                <ChevronLeft size={20} />
              </button>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-md hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-600"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
