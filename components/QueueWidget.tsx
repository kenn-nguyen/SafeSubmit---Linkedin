import React from 'react';

interface QueueWidgetProps {
  analysisQueue: string[];
  generationQueue: string[];
  isAnalyzing: boolean;
  isGenerating: boolean;
}

export const QueueWidget: React.FC<QueueWidgetProps> = ({ analysisQueue, generationQueue, isAnalyzing, isGenerating }) => {
  const total = analysisQueue.length + generationQueue.length;
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-2 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="text-xs font-semibold text-gray-600 uppercase">In Progress</div>
      <div className="flex flex-wrap gap-2 text-xs text-gray-700">
        {analysisQueue.map(id => (
          <span key={`a-${id}`} className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
            Analyzing #{id}
          </span>
        ))}
        {generationQueue.map(id => (
          <span key={`g-${id}`} className="px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-100">
            Generating #{id}
          </span>
        ))}
      </div>
      <div className="text-[11px] text-gray-500">Analysis {isAnalyzing ? 'running' : 'idle'} • Generation {isGenerating ? 'running' : 'idle'}</div>
    </div>
  );
};
