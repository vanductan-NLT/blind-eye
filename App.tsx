import React, { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { HUD } from './components/HUD';
import { AppMode, GeoLocation } from './types';
import { analyzeNavigationFrame, analyzeSmartAssistant, classifyUserIntent } from './services/geminiService';
import { speak, stopSpeaking } from './services/speechService';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';

// Navigation loop interval (ms) - REDUCED for Real-time feel
// 2500ms is a good balance between "Real-time" and Rate Limiting
const NAV_INTERVAL_MS = 2500;

// Webcam configuration
const videoConstraints = {
  width: { ideal: 640 }, // Lower resolution for faster upload/processing
  height: { ideal: 480 },
  facingMode: "environment"
};

const App: React.FC = () => {
  const [mounted, setMounted] = useState(false);
  const webcamRef = useRef<Webcam>(null);
  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [lastMessage, setLastMessage] = useState<string>("");
  const [location, setLocation] = useState<GeoLocation | undefined>(undefined);
  const [isProMode, setIsProMode] = useState(false);
  const [cameraError, setCameraError] = useState<boolean>(false);
  
  const modeRef = useRef<AppMode>(AppMode.IDLE);
  const navLoopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
        }),
        null,
        { enableHighAccuracy: true }
      );
    }
  }, []);

  const handleCameraError = useCallback((error: string | DOMException) => {
    console.error("Camera access error:", error);
    setCameraError(true);
    setLastMessage("Camera Error: Check Permissions");
    speak("I cannot access the camera. Please check your browser permissions.");
  }, []);

  // --- Core Handlers (Defined before usage) ---

  const handleStop = useCallback(() => {
    if (navLoopTimer.current) {
      clearTimeout(navLoopTimer.current);
      navLoopTimer.current = null;
    }
    setMode(AppMode.IDLE);
    setIsProMode(false);
    stopSpeaking();
    setLastMessage("Paused.");
  }, []);

  const handleStartNav = useCallback(() => {
    if (cameraError) {
        speak("Camera is unavailable.");
        return;
    }
    setMode(AppMode.NAVIGATING);
    setIsProMode(false);
    setLastMessage("Navigation Active");
    speak("Navigation started.");
  }, [cameraError]);

  const handleSmartQuery = useCallback(async (query: string, usePro: boolean) => {
    if (cameraError) {
        speak("Camera is unavailable.");
        return;
    }
    setMode(AppMode.READING);
    setIsProMode(usePro);
    setLastMessage(usePro ? "Deep analyzing..." : "Looking...");
    
    // Immediate feedback
    if (usePro) speak("Analyzing.");

    // Small delay to allow UI to update
    setTimeout(async () => {
      if (modeRef.current === AppMode.IDLE || !webcamRef.current) return;

      const imageSrc = webcamRef.current.getScreenshot();
      
      if (imageSrc) {
        const response = await analyzeSmartAssistant(imageSrc, query, location, usePro);
        
        if (modeRef.current === AppMode.IDLE) return;

        if (response === "QUOTA_EXCEEDED") {
           setLastMessage("Quota exceeded.");
           speak("Quota exceeded.");
           setMode(AppMode.IDLE);
           return;
        }

        setLastMessage(response);
        speak(response);
        setMode(AppMode.IDLE); 
      } else {
        setLastMessage("Camera failed.");
        setMode(AppMode.IDLE);
      }
    }, 100);
  }, [cameraError, location]);

  const handleTranscribedCommand = useCallback(async (transcript: string) => {
    if (!transcript) return;
    
    const lower = transcript.toLowerCase();

    // --- 1. LOCAL INTENT CHECK (Instant Latency Fix) ---
    // Bypass AI for common keywords to make it feel instant
    if (lower.includes("stop") || lower.includes("pause") || lower.includes("quit")) {
        handleStop();
        return;
    }

    // Stop current speech to listen/process new command
    handleStop(); 
    setLastMessage("Processing...");

    // Fast-path for Navigation
    if (lower.includes("nav") || lower.includes("walk") || lower.includes("go") || lower.includes("start")) {
        handleStartNav();
        return;
    }

    // Fast-path for Basic Chat (Hello/Describe)
    if (lower.includes("hello") || lower.includes("hi") || lower.includes("what") || lower.includes("describe")) {
        handleSmartQuery(transcript, false); // False = Use Flash (Fast)
        return;
    }

    // --- 2. AI INTENT CHECK (Fallback for complex queries) ---
    const intent = await classifyUserIntent(transcript);
    console.log("Intent detected:", intent);

    if (modeRef.current === AppMode.IDLE && mode !== AppMode.IDLE) return;

    if (intent === 'NAVIGATION') {
      handleStartNav();
    } else {
      const usePro = intent === 'ADVANCED';
      handleSmartQuery(transcript, usePro);
    }

  }, [handleStop, handleStartNav, handleSmartQuery, mode]);

  // Initialize Speech Hook
  const { isListening, startListening, stopListening } = useSpeechRecognition(handleTranscribedCommand);

  // --- Navigation Loop ---

  const runNavLoop = useCallback(async () => {
    if (modeRef.current !== AppMode.NAVIGATING || !webcamRef.current) return;

    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
      const safetyInfo = await analyzeNavigationFrame(imageSrc);
      
      if (modeRef.current !== AppMode.NAVIGATING) return;

      if (safetyInfo === "QUOTA_EXCEEDED") {
        handleStop();
        speak("Quota limit reached.");
        return;
      }

      setLastMessage(safetyInfo);
      speak(safetyInfo);
    }

    // Re-schedule
    if (modeRef.current === AppMode.NAVIGATING) {
      navLoopTimer.current = setTimeout(runNavLoop, NAV_INTERVAL_MS);
    }
  }, [handleStop]); 

  useEffect(() => {
    if (mode === AppMode.NAVIGATING) {
      runNavLoop();
    }
    return () => {
      if (navLoopTimer.current) clearTimeout(navLoopTimer.current);
    };
  }, [mode, runNavLoop]);

  const handleMicClick = () => {
    if (isListening) {
      stopListening();
    } else {
      stopSpeaking();
      startListening();
    }
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
                  <p className="text-gray-400">Please allow camera access in your browser settings to use Vision Companion.</p>
              </div>
          </div>
      )}

      <HUD 
        mode={mode} 
        lastMessage={lastMessage} 
        isListening={isListening}
        onMicClick={handleMicClick}
        onStop={handleStop}
        isProMode={isProMode}
      />
    </div>
  );
};

export default App;