import React, { useMemo } from 'react';
import { diffLines, Change } from 'diff';
import { X, FileText, Sparkles } from 'lucide-react';
import { Job } from '../types';

interface ResumeDiffModalProps {
  job: Job | null;
  original: string;
  onClose: () => void;
}

const renderChunk = (chunk: Change, type: 'old' | 'new', key: string) => {
  const isRemoval = chunk.removed && type === 'old';
  const isAddition = chunk.added && type === 'new';
  const bg = isRemoval ? 'bg-red-50 text-red-700 border-red-100' : isAddition ? 'bg-green-50 text-green-700 border-green-100' : '';
  return (
    <pre
      key={key}
      className={`whitespace-pre-wrap text-sm p-2 rounded border ${bg || 'border-transparent text-gray-800'} font-mono`}
    >
      {chunk.value}
    </pre>
  );
};

export const ResumeDiffModal: React.FC<ResumeDiffModalProps> = ({ job, original, onClose }) => {
  const generated = job?.generatedResume || '';
  const { leftChunks, rightChunks } = useMemo(() => {
    const chunks = diffLines(original || '', generated || '');
    return {
      leftChunks: chunks.filter(c => !c.added).map(c => ({ ...c, removed: c.removed || false, added: false })),
      rightChunks: chunks.filter(c => !c.removed).map(c => ({ ...c, added: c.added || false, removed: false }))
    };
  }, [original, generated]);

  if (!job || !generated) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Sparkles size={18} className="text-primary-600" />
              Resume Diff
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded hover:bg-gray-100 text-gray-500"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-sm text-gray-600">
            No generated resume available to compare yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary-600" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-gray-900">Resume Diff</span>
              <span className="text-xs text-gray-500 truncate max-w-[300px]">{job?.title || 'Generated Resume'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 p-4 overflow-y-auto">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1">
              <FileText size={16} className="text-gray-500" />
              Original Resume
            </div>
            {leftChunks.map((chunk, index) => renderChunk(chunk, 'old', `old-${index}-${chunk.count ?? 0}-${chunk.value.length}`))}
          </div>

          <div className="bg-green-50/40 border border-green-100 rounded-lg p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1">
              <Sparkles size={16} className="text-green-600" />
              Tailored Resume
            </div>
            {rightChunks.map((chunk, index) => renderChunk(chunk, 'new', `new-${index}-${chunk.count ?? 0}-${chunk.value.length}`))}
          </div>
        </div>
      </div>
    </div>
  );
};
