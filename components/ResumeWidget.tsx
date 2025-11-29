
import React, { useState } from 'react';
import { FileText, RefreshCw, Lock } from 'lucide-react';

interface ResumeWidgetProps {
  resumeName: string | null;
  onReupload: (file: File) => void;
  isDisabled?: boolean;
}

export const ResumeWidget: React.FC<ResumeWidgetProps> = ({ resumeName, onReupload, isDisabled }) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && !isDisabled) {
      onReupload(e.target.files[0]);
    }
  };

  const handleClick = () => {
    if (!isDisabled) {
      document.getElementById('resume-reupload')?.click();
    }
  };

  if (!resumeName) return null;

  return (
    <div 
      className={`
        relative flex items-center gap-3 px-4 py-2 bg-white border rounded-lg shadow-sm transition-all group
        ${isDisabled 
          ? 'border-gray-200 opacity-60 cursor-not-allowed' 
          : 'border-gray-200 hover:border-primary-200 hover:bg-primary-50 cursor-pointer'
        }
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      <input 
        type="file" 
        id="resume-reupload" 
        className="hidden" 
        accept=".pdf,.txt"
        onChange={handleFileChange}
        disabled={isDisabled}
      />

      <div className={`
        h-8 w-8 rounded-full flex items-center justify-center transition-colors
        ${isDisabled 
          ? 'bg-gray-100 text-gray-400' 
          : 'bg-blue-100 text-blue-600 group-hover:bg-white group-hover:text-blue-600'
        }
      `}>
        {isDisabled ? <Lock size={14} /> : (isHovered ? <RefreshCw size={14} /> : <FileText size={14} />)}
      </div>
      
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Active Resume</span>
        <span className="text-sm font-medium text-gray-900 max-w-[150px] truncate">{resumeName}</span>
      </div>

      <div className={`absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${isDisabled ? 'bg-gray-400' : 'bg-green-500'}`}></div>
    </div>
  );
};
