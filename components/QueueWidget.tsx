
import React from 'react';
import { Loader2 } from 'lucide-react';
import { Job } from '../types';

interface QueueWidgetProps {
  jobs: Job[];
  generationStatus: Record<string, boolean>;
}

export const QueueWidget: React.FC<QueueWidgetProps> = ({ jobs, generationStatus }) => {
  const analyzingJobs = jobs.filter(j => j.status === 'PROCESSING');
  const generatingCount = Object.values(generationStatus).filter(Boolean).length;

  if (analyzingJobs.length === 0 && generatingCount === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white/95 backdrop-blur-md text-gray-900 p-3 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-200 flex items-center gap-4 text-xs font-medium">
        
        {/* Analysis Queue */}
        {analyzingJobs.length > 0 && (
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-blue-600" />
            <div className="flex flex-col">
              <span className="text-gray-700">Analyzing {analyzingJobs.length} jobs</span>
              <div className="flex gap-1 mt-0.5">
                {analyzingJobs.slice(0, 3).map(j => (
                  <span key={j.id} className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] text-gray-600 truncate max-w-[60px] border border-gray-200">
                    {j.company}
                  </span>
                ))}
                {analyzingJobs.length > 3 && <span className="text-gray-500 text-[10px]">+{analyzingJobs.length - 3}</span>}
              </div>
            </div>
          </div>
        )}

        {analyzingJobs.length > 0 && generatingCount > 0 && (
          <div className="h-8 w-px bg-gray-200"></div>
        )}

        {/* Generation Queue */}
        {generatingCount > 0 && (
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-green-600" />
            <div className="flex flex-col">
              <span className="text-gray-700">Tailoring {generatingCount} resumes</span>
              <span className="text-green-600 font-bold text-[10px]">Writing...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
