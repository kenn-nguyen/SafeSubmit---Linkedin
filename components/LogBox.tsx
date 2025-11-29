
import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Terminal, CheckCircle, Info, AlertTriangle, UserCog } from 'lucide-react';

interface LogBoxProps {
  logs: LogEntry[];
}

export const LogBox: React.FC<LogBoxProps> = ({ logs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return <CheckCircle size={14} className="text-green-500" />;
      case 'warning': return <AlertTriangle size={14} className="text-yellow-500" />;
      case 'agent': return <UserCog size={14} className="text-purple-500" />;
      default: return <Info size={14} className="text-blue-500" />;
    }
  };

  if (logs.length === 0) return null;

  return (
    <div className="w-full bg-gray-900 rounded-xl border border-gray-800 shadow-lg overflow-hidden flex flex-col h-48">
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-950 border-b border-gray-800">
        <Terminal size={14} className="text-gray-400" />
        <span className="text-xs font-mono font-semibold text-gray-400 uppercase tracking-wider">System Logs & Agent Activity</span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
            <span className="text-gray-600 text-[10px] pt-1 min-w-[50px]">{log.timestamp}</span>
            <div className="mt-1">{getIcon(log.type)}</div>
            <div className="flex-1">
              {log.agentName && (
                <span className="text-purple-400 font-bold mr-2 text-xs uppercase tracking-wide">
                  [{log.agentName}]
                </span>
              )}
              <span className={`
                ${log.type === 'success' ? 'text-green-400' : ''}
                ${log.type === 'warning' ? 'text-yellow-400' : ''}
                ${log.type === 'agent' ? 'text-gray-200' : 'text-gray-400'}
              `}>
                {log.message}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
