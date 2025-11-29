
import React, { useState } from 'react';
import { Agent } from '../types';
import { Sparkles, Users, ArrowRight, Bot, Lock } from 'lucide-react';

interface AgentPanelProps {
  agents: Agent[];
  onBuildPanel: (intent: string) => void;
  isBuilding: boolean;
  isDisabled?: boolean;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ agents, onBuildPanel, isBuilding, isDisabled }) => {
  const [intent, setIntent] = useState('Senior Product Manager in Fintech');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (intent.trim() && !isBuilding && !isDisabled) onBuildPanel(intent);
  };

  if (agents.length > 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6 animate-in fade-in duration-500">
        <div className="flex items-center gap-2 mb-4">
           <Users className="text-purple-600" size={20} />
           <h3 className="font-bold text-gray-900">Your Evaluation Crew</h3>
           <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Active</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {agents.map(agent => (
            <div key={agent.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-purple-200 transition-colors">
              <div className="text-2xl bg-white w-10 h-10 flex items-center justify-center rounded-full shadow-sm">
                {agent.emoji}
              </div>
              <div>
                <p className="font-bold text-sm text-gray-900">{agent.name}</p>
                <p className="text-xs text-gray-500 truncate max-w-[140px]" title={agent.role}>{agent.role}</p>
                <p className="text-[10px] text-purple-600 font-medium mt-0.5">{agent.focus}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-100 rounded-xl p-6 mb-6 transition-all duration-300 ${isDisabled ? 'opacity-60 grayscale-[0.5] pointer-events-none' : 'opacity-100'}`}>
      <div className="flex flex-col md:flex-row items-center gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="text-purple-600" size={20} />
            <h3 className="font-bold text-gray-900 text-lg">Build Your AI Crew</h3>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Describe your target role (e.g., "Senior Product Manager in Fintech"). 
            Our Dispatcher will recruit 3 expert agents to evaluate your job matches.
          </p>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="I'm looking for a..."
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none text-sm bg-white"
              disabled={isBuilding || isDisabled}
            />
            <button 
              type="submit" 
              disabled={!intent.trim() || isBuilding || isDisabled}
              className={`
                px-5 py-2.5 text-white text-sm font-semibold rounded-lg flex items-center gap-2 min-w-[120px] justify-center transition-all
                ${isDisabled 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-gray-900 hover:bg-gray-800'
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
