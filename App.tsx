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
  
  const navLoopTimer = useRef<NodeJS.Timeout | null>(null);

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
    setLastMessage("Processing command...");
    
    // Use Gemini Flash to classify intent
    const intent = await classifyUserIntent(transcript);
    console.log("Intent detected:", intent);

    if (intent === 'NAVIGATION') {
      handleStartNav();
    } else {
      // Pass the original transcript as the query (e.g., "Read this text")
      handleSmartQuery(transcript);
    }

  }, []);

  const { isListening, startListening, stopListening } = useSpeechRecognition(handleTranscribedCommand);

  // --- Actions ---

  const handleStartNav = () => {
    setMode(AppMode.NAVIGATING);
    setLastMessage("Starting Navigation...");
    speak("Starting navigation mode.");
  };

  const handleStop = () => {
    if (navLoopTimer.current) {
      clearTimeout(navLoopTimer.current);
      navLoopTimer.current = null;
    }
    setMode(AppMode.IDLE);
    stopSpeaking();
    setLastMessage("Paused.");
  };

  const handleSmartQuery = async (query: string) => {
    setMode(AppMode.READING);
    setLastMessage("Thinking...");
    speak("Checking."); // Feedback that input was received

    // Small delay to ensure webcam frame is fresh after button press
    setTimeout(async () => {
      if (!webcamRef.current) return;
      const imageSrc = webcamRef.current.getScreenshot();
      
      if (imageSrc) {
        const response = await analyzeSmartAssistant(imageSrc, query, location);
        
        if (response === "QUOTA_EXCEEDED") {
           setLastMessage("Quota exceeded.");
           speak("Quota exceeded.");
           setMode(AppMode.IDLE);
           return;
        }

        setLastMessage(response);
        speak(response);
        setMode(AppMode.IDLE); // Return to idle after answering
      }
    }, 200);
  };

  // --- Navigation Loop ---
  const runNavLoop = useCallback(async () => {
    if (mode !== AppMode.NAVIGATING || !webcamRef.current) return;

    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
      const safetyInfo = await analyzeNavigationFrame(imageSrc);
      
      if (safetyInfo === "QUOTA_EXCEEDED") {
        handleStop();
        speak("Quota limit reached.");
        return;
      }

      setLastMessage(safetyInfo);
      speak(safetyInfo);
    }

    if (mode === AppMode.NAVIGATING) {
      navLoopTimer.current = setTimeout(runNavLoop, NAV_INTERVAL_MS);
    }
  }, [mode]);

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
      stopSpeaking(); // Quiet down when user wants to talk
      startListening();
    }
  };

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden select-none">
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
      />
    </div>
  );
};

export default App;