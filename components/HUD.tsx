import React from 'react';
import { Mic, Play, Square } from 'lucide-react';
import { AppMode } from '../types';

interface HUDProps {
  mode: AppMode;
  lastMessage: string;
  isListening: boolean;
  onMicClick: () => void; // Triggers Voice/Analysis
  onToggleNav: () => void; // Triggers Live Navigation
  onStop: () => void;     // Generic Stop
  isProMode?: boolean; 
}

export const HUD: React.FC<HUDProps> = ({ mode, lastMessage, isListening, onMicClick, onToggleNav, onStop, isProMode }) => {
  const isNavigating = mode === AppMode.NAVIGATING;
  const isReading = mode === AppMode.READING; // Interaction Mode (Analysis)
  
  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end pointer-events-none p-6">
      {/* Center: Reticle */}
      <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-72 h-72 transition-all duration-500 ${isListening || isNavigating ? 'scale-100 opacity-80' : 'scale-90 opacity-30'}`}>
        <div className={`w-full h-full border border-white/20 rounded-lg relative ${isNavigating ? 'border-green-500/30' : ''}`}>
            <div className={`absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 ${isNavigating ? 'border-green-400' : 'border-cyan-400'}`}></div>
            <div className={`absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 ${isNavigating ? 'border-green-400' : 'border-cyan-400'}`}></div>
            <div className={`absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 ${isNavigating ? 'border-green-400' : 'border-cyan-400'}`}></div>
            <div className={`absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 ${isNavigating ? 'border-green-400' : 'border-cyan-400'}`}></div>
            
            {/* Listening Visualizer */}
            {isListening && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 bg-purple-500/20 rounded-full animate-ping"></div>
                </div>
            )}
        </div>
      </div>

      {/* Bottom: Output & Controls */}
      <div className="flex flex-col gap-6 pointer-events-auto items-center mb-8 w-full max-w-lg mx-auto">
        
        {/* Thought Bubble / Status Text */}
        <div className="w-full min-h-[80px] backdrop-blur-xl bg-black/70 border border-slate-700 rounded-2xl p-4 shadow-2xl transition-all text-center flex items-center justify-center">
          <p className="text-lg font-medium text-slate-100 leading-relaxed">
            {lastMessage}
          </p>
        </div>

        {/* Control Bar */}
        <div className="flex items-center gap-6">
            
            {/* 1. Live Navigation Button (Toggle) */}
            <button 
                onClick={onToggleNav}
                className={`flex flex-col items-center gap-2 group transition-all ${isReading ? 'opacity-50 grayscale' : 'opacity-100'}`}
                disabled={isReading}
            >
                <div className={`w-20 h-20 rounded-full flex items-center justify-center border-4 shadow-[0_0_30px_rgba(0,0,0,0.5)] transition-all transform group-active:scale-95 ${
                    isNavigating 
                    ? 'bg-red-500/20 border-red-500 text-red-500 hover:bg-red-500/30' 
                    : 'bg-green-500/20 border-green-500 text-green-500 hover:bg-green-500/30'
                }`}>
                    {isNavigating ? <Square fill="currentColor" size={32} /> : <Play fill="currentColor" size={32} className="ml-1" />}
                </div>
                <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                    {isNavigating ? "STOP LIVE" : "START LIVE"}
                </span>
            </button>

            {/* 2. Voice Assistant Button (One-shot) */}
            <button 
                onClick={onMicClick}
                className={`flex flex-col items-center gap-2 group transition-all ${isNavigating ? 'opacity-80' : 'opacity-100'}`}
            >
                <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 shadow-lg transition-all transform group-active:scale-95 ${
                    isListening 
                    ? 'bg-purple-600 border-purple-400 text-white animate-pulse' 
                    : 'bg-slate-800 border-slate-600 text-cyan-400 hover:border-cyan-400 hover:text-white'
                }`}>
                    <Mic size={28} />
                </div>
                <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                    ASK AI
                </span>
            </button>

        </div>
      </div>
    </div>
  );
};
