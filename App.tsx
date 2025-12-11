import React, { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { HUD } from './components/HUD';
import { AppMode } from './types';
import { LiveClient } from './services/liveClient';
import { stopSpeaking as stopBrowserTTS, speak } from './services/speechService';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { analyzeSmartAssistant, selectBestModelForQuery } from './services/geminiService';

const VIDEO_FPS = 2; // Reduced to 2FPS to reduce bandwidth load/errors

const videoConstraints = {
  width: { ideal: 640 }, 
  height: { ideal: 480 },
  facingMode: "environment"
};

const App: React.FC = () => {
  const [mounted, setMounted] = useState(false);
  const webcamRef = useRef<Webcam>(null);
  
  // State
  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [statusText, setStatusText] = useState<string>("Ready");
  const [cameraError, setCameraError] = useState<boolean>(false);
  const [isProMode, setIsProMode] = useState(false);
  
  // Refs
  const liveClientRef = useRef<LiveClient | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
        if (liveClientRef.current) liveClientRef.current.disconnect();
    }; 
  }, []);

  const handleCameraError = useCallback((error: string | DOMException) => {
    console.error("Camera access error:", error);
    setCameraError(true);
    setStatusText("Camera Error");
  }, []);

  // --- Session Management (Live Navigation) ---

  const stopSession = useCallback(() => {
    // 1. Clear Interval FIRST to stop sending data
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    
    // 2. Disconnect Client
    if (liveClientRef.current) {
      liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }
    
    if (mode === AppMode.NAVIGATING) {
        setMode(AppMode.IDLE);
        setStatusText("Ready");
    }
  }, [mode]);

  const startLiveNavigation = useCallback(async () => {
    if (cameraError) return;
    
    stopSession();
    stopBrowserTTS();
    stopListening(); 

    setMode(AppMode.NAVIGATING);
    setStatusText("Connecting...");

    liveClientRef.current = new LiveClient({
      onAudioData: () => {}, 
      onStatusChange: (status) => {
        if (status === 'disconnected') {
           // handled
        } else if (status === 'error') {
           setStatusText("Connection Error");
           // Do not auto-call stopSession here to avoid recursion, just clear refs
           if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
        } else if (status === 'connected') {
           setStatusText("Live Active");
        }
      }
    });

    await liveClientRef.current.connect();

    // Start sending video frames
    frameIntervalRef.current = setInterval(() => {
      if (webcamRef.current && liveClientRef.current) {
        const imageSrc = webcamRef.current.getScreenshot();
        if (imageSrc) {
          liveClientRef.current.sendVideoFrame(imageSrc);
        }
      }
    }, 1000 / VIDEO_FPS);

  }, [cameraError, stopSession]);

  const toggleNavigation = () => {
    if (mode === AppMode.NAVIGATING) {
      stopSession();
    } else {
      startLiveNavigation();
    }
  };

  // --- Smart Assistant (Voice Command) ---

  const handleVoiceCommand = async (command: string) => {
    if (!command || !webcamRef.current) return;

    try {
        setMode(AppMode.READING);
        setStatusText("Thinking...");
        
        const imageSrc = webcamRef.current.getScreenshot();
        if (!imageSrc) throw new Error("Could not capture image");

        const selectedModel = await selectBestModelForQuery(command);
        setIsProMode(selectedModel.includes("pro"));
        setStatusText(selectedModel.includes("pro") ? "Pro Model..." : "Flash Model...");

        const result = await analyzeSmartAssistant(imageSrc, command, selectedModel, { latitude: 0, longitude: 0 });

        setStatusText(result);
        speak(result);

        setTimeout(() => {
            setMode(AppMode.IDLE);
            setStatusText("Ready");
        }, 3000 + (result.length * 70)); 

    } catch (error) {
        console.error("Assistant Error", error);
        setStatusText("Analysis Failed");
        setMode(AppMode.IDLE);
    }
  };

  const { isListening, startListening, stopListening } = useSpeechRecognition(handleVoiceCommand);

  const startAssistant = () => {
    stopSession();
    stopBrowserTTS();
    
    setStatusText("Wait...");
    setTimeout(() => {
        startListening();
        setStatusText("Listening...");
    }, 500); // Increased delay to 500ms to ensure mic is free
  };

  if (!mounted) return null;

  return (
    <div className="relative w-full h-[100dvh] bg-black overflow-hidden select-none touch-none">
      {!cameraError && (
          <Webcam
            ref={webcamRef}
            audio={false}
            className="absolute top-0 left-0 w-full h-full object-cover opacity-80"
            screenshotFormat="image/jpeg"
            videoConstraints={videoConstraints}
            onUserMediaError={handleCameraError}
          />
      )}
      
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-black/40 via-transparent to-black/90 pointer-events-none" />

      {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center z-0 bg-gray-900">
              <div className="text-center p-6">
                  <p className="text-red-500 font-bold text-xl mb-2">Camera Disabled</p>
                  <p className="text-gray-400">Please allow camera access.</p>
              </div>
          </div>
      )}

      <HUD 
        mode={mode} 
        lastMessage={statusText} 
        isListening={isListening} 
        onMicClick={startAssistant}
        onToggleNav={toggleNavigation}
        onStop={() => { stopSession(); stopListening(); }}
        isProMode={isProMode}
      />
    </div>
  );
};

export default App;