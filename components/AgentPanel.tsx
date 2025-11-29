
import React from 'react';
import { Agent } from '../types';
import { Sparkles, Users, ArrowRight, Bot, Lock } from 'lucide-react';

interface AgentPanelProps {
  agents: Agent[];
  onBuildPanel: (intent: string) => void;
  isBuilding: boolean;
  isDisabled?: boolean;
  intentLocked?: boolean;
  intentValue: string;
  onIntentChange: (intent: string) => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ agents, onBuildPanel, isBuilding, isDisabled, intentLocked, intentValue, onIntentChange }) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (intentValue.trim() && !isBuilding && !isDisabled) onBuildPanel(intentValue);
  };

  if (agents.length > 0 || intentLocked) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6 animate-in fade-in duration-500">
        <div className="flex items-center gap-2 mb-4">
           <Users className="text-primary-600" size={20} />
           <h3 className="font-bold text-gray-900">Your Evaluation Crew</h3>
           <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full font-medium">Active</span>
        </div>
        <p className="text-sm text-gray-600 mb-3">
          Target role: <span className="font-semibold text-gray-900">{intentValue || 'Not set'}</span>
        </p>
        {agents.length === 0 && intentLocked && (
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => onBuildPanel(intentValue)}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 rounded-lg shadow-sm transition-colors"
              disabled={!intentValue.trim() || isBuilding || isDisabled}
            >
              {isBuilding ? 'Recruiting...' : 'Recruit Crew'}
            </button>
            <p className="text-xs text-gray-500">Upload a new resume to change your target role.</p>
          </div>
        )}
        {agents.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {agents.map(agent => (
                <div key={agent.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-primary-200 transition-colors">
                  <div className="text-2xl bg-white w-10 h-10 flex items-center justify-center rounded-full shadow-sm">
                    {agent.emoji}
                  </div>
                  <div>
                    <p className="font-bold text-sm text-gray-900">{agent.name}</p>
                    <p className="text-xs text-gray-500 truncate max-w-[140px]" title={agent.role}>{agent.role}</p>
                    <p className="text-[10px] text-primary-600 font-medium mt-0.5">{agent.focus}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-xs text-gray-600 bg-gray-50 border border-dashed border-gray-200 rounded-lg p-3">
              <div className="font-semibold text-gray-800 mb-1">Resume Crew Steps</div>
              <div className="flex flex-wrap gap-3">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border text-gray-700 text-[11px]">1. Architect → plan changes</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border text-gray-700 text-[11px]">2. Writer → draft tailored resume</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border text-gray-700 text-[11px]">3. Editor → tighten, check alignment</span>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-r from-primary-50 via-white to-accent-50 border border-primary-100 rounded-xl p-6 mb-6 transition-all duration-300 ${isDisabled ? 'opacity-60 grayscale-[0.5] pointer-events-none' : 'opacity-100'}`}>
      <div className="flex flex-col md:flex-row items-center gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="text-primary-600" size={20} />
            <h3 className="font-bold text-gray-900 text-lg">Build Your AI Crew</h3>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Describe your target role (e.g., "Senior Product Manager in Fintech"). 
            Our Dispatcher will recruit a specialized 4-agent crew to craft tailored resumes and generate the evaluation rubric for your job list.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <input
              type="text"
              value={intentValue}
              onChange={(e) => onIntentChange(e.target.value)}
              placeholder="I'm looking for a..."
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none text-sm bg-white shadow-sm"
              disabled={isBuilding || isDisabled || intentLocked}
            />
            <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
              <button 
                type="submit" 
                disabled={!intentValue.trim() || isBuilding || isDisabled}
                className={`
                  px-5 py-2.5 text-white text-sm font-semibold rounded-lg flex items-center gap-2 min-w-[120px] justify-center transition-all
                  ${isDisabled 
                    ? 'bg-gray-300 cursor-not-allowed' 
                    : 'bg-primary-500 hover:bg-primary-600 shadow-sm'
                  }
                `}
                >
                {isBuilding ? (
                  'Recruiting...'
                ) : isDisabled ? (
                  <><Lock size={14} /> Locked</>
                ) : (
                  <><span className="whitespace-nowrap">Start</span> <ArrowRight size={16} /></>
                )}
              </button>
              {intentLocked && (
                <p className="text-[11px] text-gray-500">
                  To change your target role, upload a new resume.
                </p>
              )}
            </div>
          </form>
        </div>
        <div className="hidden md:flex gap-3 opacity-60">
           <Bot size={40} className="text-gray-400" />
           <Bot size={40} className="text-gray-300" />
           <Bot size={40} className="text-gray-200" />
        </div>
      </div>
    </div>
  );
};
