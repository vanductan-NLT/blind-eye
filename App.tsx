import React, { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { HUD } from './components/HUD';
import { AppMode, GeoLocation } from './types';
import { LiveClient } from './services/liveClient';
import { stopSpeaking as stopBrowserTTS, speak } from './services/speechService';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { analyzeSmartAssistant, selectBestModelForQuery } from './services/geminiService';

const VIDEO_FPS = 2;

const videoConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: "environment"
};

const App: React.FC = () => {
  const [mounted, setMounted] = useState(false);
  const webcamRef = useRef<Webcam>(null);

  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [statusText, setStatusText] = useState<string>("Ready");
  const [cameraError, setCameraError] = useState<boolean>(false);
  const [isProMode, setIsProMode] = useState(false);
  const [userLocation, setUserLocation] = useState<GeoLocation | null>(null);

  const liveClientRef = useRef<LiveClient | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Request geolocation permission and start tracking
  useEffect(() => {
    setMounted(true);

    // Request geolocation with quick timeout, then watch for updates
    if (navigator.geolocation) {
      console.log("📍 Requesting geolocation...");

      // First, try to get current position quickly
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          console.log("📍 Got initial location:", location);
          setUserLocation(location);
        },
        (error) => {
          console.warn("📍 Quick location failed, continuing without:", error.message);
          // Don't block - continue without location
        },
        {
          enableHighAccuracy: false, // Faster, less accurate
          timeout: 3000, // 3 second timeout
          maximumAge: 60000 // Accept 1 minute old cache
        }
      );

      // Then watch for updates in background
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          setUserLocation(location);
        },
        () => { }, // Ignore watch errors
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 30000
        }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
        if (liveClientRef.current) liveClientRef.current.disconnect();
      };
    }

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
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    if (liveClientRef.current) {
      liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }

    // Reset mode only if we were navigating
    if (mode === AppMode.NAVIGATING) {
      setMode(AppMode.IDLE);
      setStatusText("Ready");
    }
  }, [mode]);

  // --- CONTINUOUS NAVIGATION MODE (like blind-nav-android) ---
  const isNavigatingRef = useRef(false);

  const startLiveNavigation = useCallback(async () => {
    console.log("🚀 Starting Continuous Navigation...");
    if (cameraError) {
      console.warn("⚠️ Camera error, cannot start navigation");
      return;
    }

    // Import the navigation function
    const { analyzeForNavigation } = await import('./services/geminiService');

    stopSession();
    stopBrowserTTS();
    stopListening();

    setMode(AppMode.NAVIGATING);
    setStatusText("Navigation Active");
    isNavigatingRef.current = true;

    // Continuous navigation loop - analyze every 3 seconds
    const navigationLoop = async () => {
      while (isNavigatingRef.current) {
        try {
          if (!webcamRef.current) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          const imageSrc = webcamRef.current.getScreenshot();
          if (!imageSrc) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          console.log("👀 Analyzing frame for navigation...");
          const guidance = await analyzeForNavigation(imageSrc);
          console.log("🗣️ Guidance:", guidance);

          if (isNavigatingRef.current) {
            setStatusText(guidance);
            speak(guidance, 'high'); // High priority - interrupt previous speech
          }

          // Wait 2 seconds before next analysis (faster updates)
          // But check if we should stop during the wait
          for (let i = 0; i < 20 && isNavigatingRef.current; i++) {
            await new Promise(r => setTimeout(r, 100));
          }

        } catch (error) {
          console.error("Navigation error:", error);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    };

    // Start the navigation loop
    navigationLoop();
    speak("Navigation started. I will guide you continuously.", 'high');
    console.log("✅ Continuous navigation started");
  }, [cameraError, stopSession]);

  // Update stopSession to stop navigation
  const stopNavigationAndSession = useCallback(() => {
    console.log("🛑 Stopping navigation...");
    isNavigatingRef.current = false;
    stopSession();
    stopBrowserTTS();
    setMode(AppMode.IDLE);
    setStatusText("Ready");
  }, [stopSession]);

  const toggleNavigation = useCallback(() => {
    if (mode === AppMode.NAVIGATING) {
      isNavigatingRef.current = false;
      stopSession();
      stopBrowserTTS();
      setMode(AppMode.IDLE);
      setStatusText("Ready");
      speak("Navigation stopped.");
    } else {
      startLiveNavigation();
    }
  }, [mode, startLiveNavigation, stopSession]);

  // --- Smart Assistant (Voice Command) ---

  const handleVoiceCommand = async (command: string) => {
    console.log("🎤 Voice command received:", command);
    if (!command || !webcamRef.current) {
      console.warn("⚠️ No command or webcam not ready");
      return;
    }

    try {
      setMode(AppMode.READING);
      setStatusText("Thinking...");

      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) throw new Error("Could not capture image");
      console.log("📸 Image captured, length:", imageSrc.length);

      // 1. Router (Flash) - Quyết định model nào
      console.log("🔀 Selecting best model for query...");
      const selectedModel = await selectBestModelForQuery(command);
      console.log("✅ Selected model:", selectedModel);

      // Check if using Gemini 3 (complex model)
      const isGemini3 = selectedModel.includes("pro") || selectedModel.includes("3");
      setIsProMode(isGemini3);
      setStatusText(isGemini3 ? "Gemini 3 Pro..." : "Flash Speed...");

      // 2. Analysis (Flash/Gemini 3) with real location
      console.log("🧠 Analyzing with", selectedModel);
      console.log("📍 Using location:", userLocation || "Not available");
      const result = await analyzeSmartAssistant(
        imageSrc,
        command,
        selectedModel,
        userLocation || undefined
      );
      console.log("💬 Result:", result);

      // 3. Response
      setStatusText(result);
      speak(result);

      setTimeout(() => {
        setMode(AppMode.IDLE);
        setStatusText("Ready");
      }, 4000 + (result.length * 50));

    } catch (error) {
      console.error("❌ Assistant Error:", error);
      setStatusText("Failed. Try again.");
      speak("I couldn't understand that.");
      setMode(AppMode.IDLE);
    }
  };

  const { isListening, startListening, stopListening } = useSpeechRecognition(handleVoiceCommand);

  const startAssistant = () => {
    // Stop navigation first
    isNavigatingRef.current = false;
    stopSession();
    stopBrowserTTS();

    setMode(AppMode.IDLE);
    setStatusText("Wait...");

    // Increased delay to 1000ms to allow mic stream to fully release
    setTimeout(() => {
      startListening();
      setStatusText("Listening...");
    }, 1000);
  };

  if (!mounted) return null;

  return (
    <div className="relative w-full h-[100dvh] bg-black overflow-hidden select-none touch-none">
      {!cameraError && (
        <Webcam
          ref={webcamRef as any}
          audio={false}
          mirrored={false}
          imageSmoothing={true}
          forceScreenshotSourceSize={false}
          disablePictureInPicture={true}
          screenshotQuality={0.8}
          className="absolute top-0 left-0 w-full h-full object-cover opacity-80"
          screenshotFormat="image/jpeg"
          videoConstraints={videoConstraints}
          onUserMedia={() => console.log("📷 Camera ready")}
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