
import React, { useMemo } from 'react';
import { X, ArrowLeftRight, FileText, Sparkles } from 'lucide-react';
import * as Diff from 'diff';

interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalText: string;
  tailoredText: string;
  jobTitle: string;
}

export const DiffModal: React.FC<DiffModalProps> = ({ isOpen, onClose, originalText, tailoredText, jobTitle }) => {
  if (!isOpen) return null;

  // Compute Diff using the 'diff' library
  // diffTrimmedLines ignores leading/trailing whitespace, making it better for structured text/markdown
  const diffs = useMemo(() => {
      if (!originalText || !tailoredText) return [];
      return Diff.diffTrimmedLines(originalText, tailoredText);
  }, [originalText, tailoredText]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative w-full max-w-7xl h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
             <div className="bg-primary-100 p-2 rounded-lg">
                <ArrowLeftRight className="text-primary-600 w-5 h-5" />
             </div>
             <div>
                <h3 className="font-bold text-gray-900">Resume Comparison</h3>
                <p className="text-xs text-gray-500">Tailored for: {jobTitle}</p>
             </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Comparison */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden text-sm">
          
          {/* Left: Original (Shows Removed + Common) */}
          <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r border-gray-200 h-1/2 md:h-full">
            <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 flex items-center gap-2">
               <FileText size={14} className="text-gray-500" />
               <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">Original Resume</span>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-white font-mono text-gray-600 leading-relaxed whitespace-pre-wrap">
               {diffs.map((part, idx) => {
                   // In Original View: Skip things that were ADDED in the new version
                   if (part.added) return null;

                   return (
                       <span 
                        key={idx} 
                        className={part.removed ? 'bg-red-100 text-red-900 decoration-red-300 line-through decoration-2' : ''}
                       >
                           {part.value}
                       </span>
                   );
               })}
            </div>
          </div>

          {/* Right: Tailored (Shows Added + Common) */}
          <div className="flex-1 flex flex-col h-1/2 md:h-full">
            <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
               <Sparkles size={14} className="text-blue-500" />
               <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">Tailored Content</span>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-white font-mono text-gray-800 leading-relaxed whitespace-pre-wrap">
               {diffs.map((part, idx) => {
                   // In Tailored View: Skip things that were REMOVED from the old version
                   if (part.removed) return null;

                   return (
                       <span 
                        key={idx} 
                        className={part.added ? 'bg-green-100 text-green-900 font-semibold' : ''}
                       >
                           {part.value}
                       </span>
                   );
               })}
            </div>
          </div>

        </div>
        
        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-center gap-6 text-xs text-gray-500">
          <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-100 border border-red-300 rounded-sm"></span>
              <span className="line-through decoration-red-300">Removed content</span>
          </div>
          <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-green-100 border border-green-300 rounded-sm"></span>
              <span className="font-semibold text-green-900">Added/Tailored content</span>
          </div>
        </div>
      </div>
    </div>
  );
};
