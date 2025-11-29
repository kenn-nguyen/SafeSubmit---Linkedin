
import React, { useState, useMemo } from 'react';
import { Job } from '../types';
import { ShieldAlert, ShieldCheck, ShieldQuestion, Loader2, FileText, Users, Clock, CalendarDays, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Zap } from 'lucide-react';

interface JobTableProps {
  jobs: Job[];
  onGenerate: (jobId: string) => void;
  isProcessing: Record<string, boolean>;
  isGlobalBusy?: boolean; // New prop
}

type SortField = 'publishedAt' | 'matchScore';
type SortDirection = 'asc' | 'desc';

const VisaBadge: React.FC<{ risk?: string }> = ({ risk }) => {
  if (!risk) {
    return <span className="text-gray-300 text-xs font-medium">—</span>;
  }

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

const MatchBar: React.FC<{ score?: number }> = ({ score }) => {
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

export const JobTable: React.FC<JobTableProps> = ({ jobs, onGenerate, isProcessing, isGlobalBusy }) => {
  const [sortField, setSortField] = useState<SortField>('matchScore');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1); 
  };

  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
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
  }, [jobs, sortField, sortDirection]);

  const paginatedJobs = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedJobs.slice(startIndex, startIndex + pageSize);
  }, [sortedJobs, currentPage, pageSize]);

  const totalPages = Math.ceil(jobs.length / pageSize);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <div className="w-4 h-4 opacity-0" />;
    return sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  if (jobs.length === 0) {
    return (
      <div className="text-center py-24 bg-white rounded-xl border border-dashed border-gray-300">
        <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
           <FileText className="text-gray-400" size={24} />
        </div>
        <p className="text-gray-900 font-medium">No jobs found</p>
        <p className="text-gray-500 text-sm mt-1">Upload a CSV to populate this list.</p>
      </div>
    );
  }

  return (
    <div className="w-full bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[250px]">Role & Company</th>
              <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Details</th>
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
              <tr key={job.id} className="hover:bg-gray-50 transition-colors group">
                
                {/* Role & Company */}
                <td className="px-6 py-4 align-top">
                  <div className="flex flex-col max-w-xs">
                    <a href={job.applyUrl || '#'} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-semibold hover:underline text-base truncate block" title={job.title}>
                      {job.title}
                    </a>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-gray-900 font-medium truncate max-w-[150px]" title={job.company}>{job.company}</span>
                      {job.applyType === 'EASY_APPLY' && (
                        <a 
                          href={job.applyUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100 hover:bg-blue-100 transition-colors"
                          title="Easy Apply on LinkedIn"
                        >
                          <Zap size={10} className="fill-blue-700" />
                          Easy Apply
                        </a>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mt-2">
                      {job.location && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          {job.location.toLowerCase().includes('remote') ? '🌐' : '📍'} {job.location}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Details */}
                <td className="px-6 py-4 text-gray-500 align-top">
                  <div className="flex flex-col gap-1.5">
                     <div className="flex items-center gap-2 text-xs" title="Applicants">
                        <Users size={14} className="text-gray-400" />
                        <span className="font-medium">{job.applicants ? `${job.applicants}` : 'N/A'}</span>
                     </div>
                     {job.salary && (
                       <div className="flex items-center gap-2 text-xs" title="Salary">
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 w-fit max-w-[140px] truncate">
                            {job.salary}
                          </span>
                       </div>
                     )}
                     <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        <Clock size={12} />
                        <span>{job.postedAt || 'Recently'}</span>
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
                  <VisaBadge risk={job.visaRisk} />
                </td>

                {/* Match */}
                <td className="px-6 py-4 align-top">
                  <MatchBar score={job.matchScore} />
                </td>

                {/* Action */}
                <td className="px-6 py-4 text-right align-top">
                  <button
                    onClick={() => onGenerate(job.id)}
                    disabled={isProcessing[job.id] || job.matchScore === undefined || isGlobalBusy}
                    className={`
                      inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all min-w-[110px]
                      ${job.status === 'DONE' 
                        ? 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50' 
                        : 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                      }
                      disabled:opacity-40 disabled:cursor-not-allowed
                    `}
                  >
                    {isProcessing[job.id] ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : job.status === 'DONE' ? (
                      'Download'
                    ) : (
                      'Generate'
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {jobs.length > 0 && (
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
                aria-label="Previous Page"
              >
                <ChevronLeft size={20} />
              </button>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-md hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-600"
                aria-label="Next Page"
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
