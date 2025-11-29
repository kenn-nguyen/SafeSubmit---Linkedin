import React, { useCallback, useState } from 'react';
import { UploadCloud, CheckCircle2, AlertCircle } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  accept: string;
  label: string;
  subLabel: string;
  icon?: React.ReactNode;
  isActive?: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ 
  onFileSelect, 
  accept, 
  label, 
  subLabel,
  icon,
  isActive = true
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  }, [isActive]);

  const validateAndSetFile = (file: File) => {
    if (!file.type.match(accept.replace('*', '.*')) && accept !== '*') {
       // Relaxed checking for CSV as MIME types vary
       if (accept.includes('.csv') && !file.name.endsWith('.csv')) {
         setError('Invalid file type.');
         return;
       }
    }
    setError(null);
    setSelectedFileName(file.name);
    onFileSelect(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  }, [onFileSelect, isActive]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  if (!isActive) return null;

  return (
    <div
      className={`relative group border-2 border-dashed rounded-xl p-8 transition-all duration-200 ease-in-out text-center cursor-pointer
        ${isDragging 
          ? 'border-primary-500 bg-primary-50' 
          : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
        }
        ${selectedFileName ? 'bg-green-50 border-green-400' : 'bg-white'}
      `}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={() => document.getElementById(`file-input-${label}`)?.click()}
    >
      <input
        type="file"
        id={`file-input-${label}`}
        className="hidden"
        accept={accept}
        onChange={handleChange}
      />
      
      <div className="flex flex-col items-center justify-center gap-3">
        {selectedFileName ? (
          <>
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center text-green-600">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{selectedFileName}</p>
              <p className="text-xs text-green-600 mt-1 font-medium">Successfully uploaded</p>
            </div>
          </>
        ) : (
          <>
            <div className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors shadow-sm
              ${isDragging ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500 group-hover:text-primary-600 group-hover:bg-white'}
            `}>
              {icon || <UploadCloud size={24} />}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{label}</p>
              <p className="text-xs text-gray-500 mt-1">{subLabel}</p>
            </div>
          </>
        )}
        {error && (
          <div className="flex items-center gap-2 text-red-600 text-xs mt-2 font-medium">
            <AlertCircle size={12} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};