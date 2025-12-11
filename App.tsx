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
  width: 1280,
  height: 720,
  facingMode: "environment"
};

const App: React.FC = () => {
  const webcamRef = useRef<Webcam>(null);
  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [lastMessage, setLastMessage] = useState<string>("");
  const [location, setLocation] = useState<GeoLocation | undefined>(undefined);
  const [isProMode, setIsProMode] = useState(false);
  
  // Ref to track mode synchronously for async callbacks (prevents speaking after stop)
  const modeRef = useRef<AppMode>(AppMode.IDLE);
  const navLoopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync ref with state
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // --- Geolocation ---
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

  // --- Voice Command Routing ---
  const handleTranscribedCommand = useCallback(async (transcript: string) => {
    if (!transcript) return;
    
    // Stop any existing output/loops first
    handleStop();
    setLastMessage("Processing...");
    
    // Use Gemini Flash to classify intent
    const intent = await classifyUserIntent(transcript);
    console.log("Intent detected:", intent);

    // If user stopped while processing intent, abort
    if (modeRef.current === AppMode.IDLE && mode !== AppMode.IDLE) return;

    if (intent === 'NAVIGATION') {
      handleStartNav();
    } else {
      const usePro = intent === 'ADVANCED';
      handleSmartQuery(transcript, usePro);
    }

  }, []);

  const { isListening, startListening, stopListening } = useSpeechRecognition(handleTranscribedCommand);

  // --- Actions ---

  const handleStartNav = () => {
    setMode(AppMode.NAVIGATING);
    setIsProMode(false);
    setLastMessage("Starting Navigation...");
    speak("Starting navigation mode.");
  };

  const handleStop = () => {
    if (navLoopTimer.current) {
      clearTimeout(navLoopTimer.current);
      navLoopTimer.current = null;
    }
    setMode(AppMode.IDLE);
    setIsProMode(false);
    stopSpeaking(); // Immediately silence TTS
    setLastMessage("Paused.");
  };

  const handleSmartQuery = async (query: string, usePro: boolean) => {
    setMode(AppMode.READING);
    setIsProMode(usePro);
    setLastMessage(usePro ? "Deep analyzing..." : "Thinking...");
    
    // Only speak "Checking" if not in Pro mode to save time, or keep it very short
    if (usePro) speak("Analyzing."); 

    // Small delay to ensure webcam frame is fresh
    setTimeout(async () => {
      // 1. Safety Check: If user stopped during the delay, abort
      if (modeRef.current === AppMode.IDLE || !webcamRef.current) return;

      const imageSrc = webcamRef.current.getScreenshot();
      
      if (imageSrc) {
        const response = await analyzeSmartAssistant(imageSrc, query, location, usePro);
        
        // 2. Safety Check: If user stopped during the API call, abort
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
      }
    }, 200);
  };

  // --- Navigation Loop ---
  const runNavLoop = useCallback(async () => {
    if (modeRef.current !== AppMode.NAVIGATING || !webcamRef.current) return;

    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
      const safetyInfo = await analyzeNavigationFrame(imageSrc);
      
      // Check if still navigating before speaking
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
  }, []); // Remove dependencies to avoid stale closures, rely on refs

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

  return (
    <div className="relative w-full h-[100dvh] bg-black overflow-hidden select-none touch-none">
      <Webcam
        ref={webcamRef}
        audio={false}
        className="absolute top-0 left-0 w-full h-full object-cover opacity-80"
        screenshotFormat="image/jpeg"
        videoConstraints={videoConstraints}
      />
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-black/40 via-transparent to-black/90 pointer-events-none" />

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