import React, { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { HUD } from './components/HUD';
import { AppMode, GeoLocation } from './types';
import { analyzeNavigationFrame, analyzeSmartAssistant, classifyUserIntent } from './services/geminiService';
import { speak, stopSpeaking } from './services/speechService';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';

// Navigation loop interval (ms)
const NAV_INTERVAL_MS = 8000;

// Webcam configuration
const videoConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
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
    setLastMessage("Starting Navigation...");
    speak("Starting navigation mode.");
  }, [cameraError]);

  const handleSmartQuery = useCallback(async (query: string, usePro: boolean) => {
    if (cameraError) {
        speak("Camera is unavailable.");
        return;
    }
    setMode(AppMode.READING);
    setIsProMode(usePro);
    setLastMessage(usePro ? "Deep analyzing..." : "Thinking...");
    
    if (usePro) speak("Analyzing."); 

    // Small delay to allow UI to update
    setTimeout(async () => {
      // Check if user cancelled while waiting
      if (modeRef.current === AppMode.IDLE || !webcamRef.current) return;

      const imageSrc = webcamRef.current.getScreenshot();
      
      if (imageSrc) {
        const response = await analyzeSmartAssistant(imageSrc, query, location, usePro);
        
        // Check if user cancelled during await
        if (modeRef.current === AppMode.IDLE) {
            console.log("Response discarded (User stopped app)");
            return; 
        }

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
        setLastMessage("Camera image failed.");
        setMode(AppMode.IDLE);
      }
    }, 200);
  }, [cameraError, location]);

  const handleTranscribedCommand = useCallback(async (transcript: string) => {
    if (!transcript) return;
    
    // Stop any current activity first
    handleStop();
    setLastMessage("Processing...");
    
    const intent = await classifyUserIntent(transcript);
    console.log("Intent detected:", intent);

    // If user stopped app while classifying, abort
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