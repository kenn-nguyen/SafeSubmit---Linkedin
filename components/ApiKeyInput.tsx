
import React, { useState, useEffect, useRef } from 'react';
import { Key, Eye, EyeOff, Save, Lock, X } from 'lucide-react';
import { StorageService } from '../services/storageService';

interface ApiKeyInputProps {
  onKeySaved?: () => void;
  onChange?: (value: string) => void;
  compact?: boolean;
}

export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({ onKeySaved, onChange, compact = false }) => {
  const [key, setKey] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isOpen, setIsOpen] = useState(false); // Only for compact mode
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const existing = StorageService.getApiKey();
    if (existing) {
        setKey(existing);
        setIsSaved(true);
        if (onChange) onChange(existing);
    }

    // Click outside handler for compact dropdown
    const handleClickOutside = (event: MouseEvent) => {
        if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
            setIsOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);

  }, []);

  const handleInputChange = (val: string) => {
      setKey(val);
      setIsSaved(false);
      if (onChange) onChange(val);
  };

  const handleSave = () => {
    if (!key.trim()) return;
    StorageService.saveApiKey(key.trim());
    setIsSaved(true);
    if (compact) setIsOpen(false);
    if (onKeySaved) onKeySaved();
  };

  const handleClear = () => {
      StorageService.clearApiKey();
      setKey('');
      setIsSaved(false);
      if (onChange) onChange('');
  };

  if (compact) {
      return (
          <div className="relative" ref={wrapperRef}>
              <div 
                  className={`p-2 rounded-full cursor-pointer transition-colors ${isSaved ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  onClick={() => setIsOpen(!isOpen)}
                  title={isSaved ? "API Key Saved" : "Set API Key"}
              >
                  {isSaved ? <Lock size={16} /> : <Key size={16} />}
              </div>

              {isOpen && (
                  <div className="absolute top-full right-0 mt-3 w-72 bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-[60] animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Gemini API Key</h4>
                          <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                              <X size={14} />
                          </button>
                      </div>
                      
                      <div className="relative flex items-center mb-3">
                        <input
                            type={isVisible ? "text" : "password"}
                            value={key}
                            onChange={(e) => handleInputChange(e.target.value)}
                            placeholder="AIzaSy..."
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 pr-8 focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none bg-white text-gray-900"
                        />
                        <button 
                            type="button"
                            onClick={() => setIsVisible(!isVisible)}
                            className="absolute right-2 text-gray-400 hover:text-gray-600"
                        >
                            {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>

                      <div className="flex gap-2">
                          <button 
                            onClick={handleSave} 
                            disabled={!key.trim()}
                            className="flex-1 bg-primary-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                          >
                              Save Key
                          </button>
                          {isSaved && (
                              <button 
                                onClick={handleClear}
                                className="px-3 bg-gray-100 text-gray-600 text-xs font-bold py-2 rounded-lg hover:bg-red-50 hover:text-red-600"
                              >
                                  Clear
                              </button>
                          )}
                      </div>
                  </div>
              )}
          </div>
      );
  }

  // Full/Onboarding Mode
  return (
    <div className="w-full max-w-sm mx-auto mt-4">
        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
            Google Gemini API Key
        </label>
        <div className="relative flex items-center">
            <div className="absolute left-3 text-gray-400">
                <Key size={16} />
            </div>
            <input
                type={isVisible ? "text" : "password"}
                value={key}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="AIzaSy..."
                className={`w-full pl-9 pr-20 py-2.5 text-sm border rounded-lg outline-none transition-all ${isSaved ? 'border-green-300 bg-green-50 text-green-800' : 'bg-white border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 text-gray-900'}`}
            />
            <button 
                type="button"
                onClick={() => setIsVisible(!isVisible)}
                className="absolute right-10 text-gray-400 hover:text-gray-600 p-1"
                tabIndex={-1}
            >
                {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
                onClick={handleSave}
                disabled={!key.trim() || isSaved}
                className={`absolute right-1 p-1.5 rounded-md transition-colors ${isSaved ? 'text-green-600' : 'text-primary-600 hover:bg-primary-50'} disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Save Key"
            >
                {isSaved ? <Lock size={18} /> : <Save size={18} />}
            </button>
        </div>
        <p className="text-[10px] text-gray-500 mt-1.5 flex items-center gap-1">
            <Lock size={10} />
            Key is encrypted & stored locally. We never see it.
        </p>
    </div>
  );
};
