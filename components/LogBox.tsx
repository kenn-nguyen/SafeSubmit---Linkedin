
import React, { useEffect, useRef, useState } from 'react';
import { LogEntry } from '../types';
import { Terminal, CheckCircle, Info, AlertTriangle, UserCog, ChevronDown, ChevronUp } from 'lucide-react';

interface LogBoxProps {
  logs: LogEntry[];
}

export const LogBox: React.FC<LogBoxProps> = ({ logs }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (containerRef.current && bottomRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const getIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return <CheckCircle size={14} className="text-green-500" />;
      case 'warning': return <AlertTriangle size={14} className="text-yellow-500" />;
      case 'agent': return <UserCog size={14} className="text-primary-500" />;
      default: return <Info size={14} className="text-blue-500" />;
    }
  };

  if (logs.length === 0) return null;

  return (
    <div className={`w-full bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg overflow-hidden flex flex-col ${collapsed ? '' : 'h-48'}`}>
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-gray-100 border-b border-gray-200">
        <div className="flex items-center gap-2">
        <Terminal size={14} className="text-gray-500" />
        <span className="text-xs font-mono font-semibold text-gray-600 uppercase tracking-wider">System Logs & Agent Activity</span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="p-1.5 text-gray-500 hover:text-gray-700 rounded"
          aria-label={collapsed ? 'Expand logs' : 'Collapse logs'}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent bg-white/60">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
              <span className="text-gray-500 text-[10px] pt-1 min-w-[50px]">{log.timestamp}</span>
              <div className="mt-1">{getIcon(log.type)}</div>
              <div className="flex-1">
                {log.agentName && (
                  <span className="text-primary-500 font-bold mr-2 text-xs uppercase tracking-wide">
                    [{log.agentName}]
                  </span>
                )}
                <span className={`
                  ${log.type === 'success' ? 'text-green-600' : ''}
                  ${log.type === 'warning' ? 'text-yellow-600' : ''}
                  ${log.type === 'agent' ? 'text-gray-700' : 'text-gray-600'}
                `}>
                  {log.message}
                </span>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};
