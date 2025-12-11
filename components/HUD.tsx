import React from 'react';
import { Activity, Eye, Mic, Navigation, MicOff, Sparkles } from 'lucide-react';
import { AppMode } from '../types';

interface HUDProps {
  mode: AppMode;
  lastMessage: string;
  isListening: boolean;
  onMicClick: () => void;
  onStop: () => void;
  isProMode?: boolean; // New prop to show if we are using the heavy model
}

export const HUD: React.FC<HUDProps> = ({ mode, lastMessage, isListening, onMicClick, onStop, isProMode }) => {
  const isNavigating = mode === AppMode.NAVIGATING;
  const isReading = mode === AppMode.READING;
  const isIdle = mode === AppMode.IDLE;

  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-between pointer-events-none p-6">
      {/* Top Bar: Status */}
      <div className="flex justify-between items-start">
        <div className={`px-4 py-2 rounded-full backdrop-blur-md border shadow-lg transition-colors ${
            isNavigating ? 'bg-green-500/20 border-green-400 text-green-400' : 
            isReading ? 'bg-purple-500/20 border-purple-400 text-purple-400' : 
            'bg-slate-900/60 border-slate-600 text-slate-400'
          }`}>
          <div className="flex items-center gap-2 font-mono font-bold uppercase text-sm tracking-wider">
            {isNavigating ? <Activity className="animate-pulse w-4 h-4" /> : 
             isReading ? (isProMode ? <Sparkles className="animate-pulse w-4 h-4" /> : <Eye className="animate-pulse w-4 h-4" />) : 
             <Navigation className="w-4 h-4" />}
            
            {/* Dynamic Label */}
            {isNavigating ? "NAVIGATING" : 
             isReading ? (isProMode ? "DEEP ANALYSIS (GEMINI 3)" : "ASSISTANT (FLASH)") : 
             "STANDBY"}
          </div>
        </div>
      </div>

      {/* Center: Reticle */}
      <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-72 h-72 transition-all duration-500 ${isListening ? 'scale-110 opacity-80' : 'opacity-40'}`}>
        <div className="w-full h-full border border-white/20 rounded-lg relative">
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400"></div>
            
            {/* Listening Visualizer */}
            {isListening && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 bg-red-500/20 rounded-full animate-ping"></div>
                </div>
            )}
        </div>
      </div>

      {/* Bottom: Output & Controls */}
      <div className="flex flex-col gap-6 pointer-events-auto items-center">
        
        {/* Thought Bubble */}
        <div className="w-full max-w-md backdrop-blur-xl bg-black/70 border border-slate-700 rounded-2xl p-6 shadow-2xl transition-all">
          <p className="text-cyan-300 font-mono text-xs mb-2 opacity-70 tracking-widest">
             {isProMode ? "GEMINI 3 PRO" : "GEMINI FLASH"}
          </p>
          <p className={`font-medium text-xl leading-relaxed ${
            isNavigating ? 'text-green-300' : isReading ? 'text-purple-300' : 'text-white'
          }`}>
            {isListening ? "Listening..." : lastMessage || "Press microphone to start."}
          </p>
        </div>

        {/* Main Control Button */}
        <div className="flex gap-4 items-center">
            {/* If active, show Stop button */}
            {!isIdle && (
                <button
                    onClick={onStop}
                    className="h-16 w-16 rounded-full flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white border-2 border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all active:scale-95"
                >
                    <div className="w-6 h-6 bg-white rounded-sm" />
                </button>
            )}

            {/* Mic Button */}
            <button
                onClick={onMicClick}
                className={`h-20 w-20 rounded-full flex items-center justify-center border-4 shadow-2xl transition-all active:scale-95 ${
                    isListening 
                    ? 'bg-red-600 border-red-400 animate-pulse shadow-[0_0_30px_rgba(220,38,38,0.6)]' 
                    : 'bg-cyan-600 border-cyan-400 hover:bg-cyan-500 shadow-[0_0_30px_rgba(8,145,178,0.4)]'
                }`}
            >
                {isListening ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
            </button>
        </div>
        
        <p className="text-white/30 text-xs font-mono">TAP MIC • SAY COMMAND</p>
      </div>
    </div>
  );
};