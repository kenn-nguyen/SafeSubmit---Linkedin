
import React from 'react';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';

interface ProgressTrackerProps {
  currentStep: number;
}

const STEPS = [
  { id: 1, label: "Upload" },
  { id: 2, label: "Recruit Crew" },
  { id: 3, label: "Import Jobs" },
  { id: 4, label: "Analyze" },
  { id: 5, label: "Generate" },
];

export const ProgressTracker: React.FC<ProgressTrackerProps> = ({ currentStep }) => {
  return (
    <div className="w-full bg-white border-b border-gray-200 py-3 px-4 sm:px-6 sticky top-16 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto flex items-center justify-between overflow-x-auto no-scrollbar gap-4">
        {STEPS.map((step, idx) => {
          const isCompleted = step.id < currentStep;
          const isCurrent = step.id === currentStep;
          
          return (
            <div key={step.id} className="flex items-center gap-2 sm:gap-4 min-w-fit">
              <div className={`flex items-center gap-2 ${isCurrent ? 'opacity-100' : 'opacity-60'}`}>
                {isCompleted ? (
                  <CheckCircle2 className="text-green-500 w-5 h-5" />
                ) : (
                  <div className={`
                    w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border-2
                    ${isCurrent 
                      ? 'border-primary-600 text-primary-600 bg-primary-50' 
                      : 'border-gray-300 text-gray-400 bg-white'
                    }
                  `}>
                    {step.id}
                  </div>
                )}
                <span className={`text-sm font-medium ${isCurrent ? 'text-primary-700' : 'text-gray-600'}`}>
                  {step.label}
                </span>
              </div>
              
              {idx < STEPS.length - 1 && (
                <ArrowRight className="w-4 h-4 text-gray-300 hidden sm:block" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
