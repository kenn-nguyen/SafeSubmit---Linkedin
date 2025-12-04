
import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Bot, User } from 'lucide-react';
import { Job, ChatMessage } from '../types';
import { chatWithData } from '../services/geminiService';

interface ChatWidgetProps {
  jobs: Job[];
  resumeText: string;
  userIntent: string;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({ jobs, resumeText, userIntent }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'init', role: 'model', text: 'Hi! I can help you find the best job from your list. Ask me anything!', timestamp: Date.now() }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
       const responseText = await chatWithData(messages, input, jobs, resumeText, userIntent);
       const botMsg: ChatMessage = { id: crypto.randomUUID(), role: 'model', text: responseText, timestamp: Date.now() };
       setMessages(prev => [...prev, botMsg]);
    } catch (error) {
       const errorMsg: ChatMessage = { id: crypto.randomUUID(), role: 'model', text: "Sorry, I'm having trouble connecting right now.", timestamp: Date.now() };
       setMessages(prev => [...prev, errorMsg]);
    } finally {
       setIsTyping(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start gap-4">
      {isOpen && (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-80 sm:w-96 h-[500px] flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-300">
           {/* Header */}
           <div className="bg-gradient-to-r from-primary-600 to-primary-700 p-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                 <Bot size={20} />
                 <span className="font-bold">Recruiter AI</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1 rounded-full"><X size={18} /></button>
           </div>
           
           {/* Messages */}
           <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {messages.map(m => (
                 <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-primary-600'}`}>
                       {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                    </div>
                    <div className={`p-3 rounded-2xl text-sm max-w-[80%] ${m.role === 'user' ? 'bg-primary-600 text-white rounded-tr-none' : 'bg-white border border-gray-200 rounded-tl-none shadow-sm text-gray-800'}`}>
                       {m.text}
                    </div>
                 </div>
              ))}
              {isTyping && (
                  <div className="flex gap-2">
                      <div className="w-8 h-8 bg-white border border-gray-200 rounded-full flex items-center justify-center"><Bot size={14} className="text-primary-600"/></div>
                      <div className="bg-white border border-gray-200 p-3 rounded-2xl rounded-tl-none text-xs text-gray-400 flex items-center gap-1">
                          <span className="animate-bounce">●</span><span className="animate-bounce delay-100">●</span><span className="animate-bounce delay-200">●</span>
                      </div>
                  </div>
              )}
              <div ref={messagesEndRef} />
           </div>
           
           {/* Input */}
           <form onSubmit={handleSend} className="p-3 bg-white border-t border-gray-200 flex gap-2">
              <input 
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about your jobs..."
                className="flex-1 bg-gray-100 text-sm px-4 py-2 rounded-full outline-none focus:ring-2 focus:ring-primary-500 text-gray-800"
              />
              <button type="submit" disabled={!input.trim() || isTyping} className="p-2 bg-primary-600 text-white rounded-full hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
                 <Send size={18} />
              </button>
           </form>
        </div>
      )}

      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="h-14 w-14 bg-primary-600 hover:bg-primary-700 text-white rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
      >
        {isOpen ? <X size={24} /> : <MessageSquare size={24} />}
      </button>
    </div>
  );
};
