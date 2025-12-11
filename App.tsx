import React, { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { HUD } from './components/HUD';
import { AppMode } from './types';
import { LiveClient } from './services/liveClient';
import { stopSpeaking as stopBrowserTTS } from './services/speechService';

// Video Frame Rate for AI (Frames per second)
// 2 FPS is usually sufficient for navigation without killing bandwidth, 
// but for "Realtime" feel we can go up to 5 FPS if connection allows.
const VIDEO_FPS = 3; 

// Webcam configuration
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
  
  // Refs for Live Client
  const liveClientRef = useRef<LiveClient | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => stopSession(); // Cleanup on unmount
  }, []);

  const handleCameraError = useCallback((error: string | DOMException) => {
    console.error("Camera access error:", error);
    setCameraError(true);
    setStatusText("Camera Error");
  }, []);

  // --- Session Management ---

  const startSession = useCallback(async () => {
    if (cameraError) return;
    
    // Stop any browser TTS from previous modes
    stopBrowserTTS();

    setMode(AppMode.NAVIGATING);
    setStatusText("Connecting to Gemini Live...");

    liveClientRef.current = new LiveClient({
      onAudioData: () => {}, // Not used in this UI yet
      onStatusChange: (status) => {
        if (status === 'disconnected' || status === 'error') {
           setMode(AppMode.IDLE);
           setStatusText(status === 'error' ? "Connection Error" : "Ready");
           stopSession();
        } else if (status === 'connected') {
           setStatusText("Live Navigation Active");
        }
      }
    });

    await liveClientRef.current.connect();

    // Start Video Stream Loop
    frameIntervalRef.current = setInterval(() => {
      if (webcamRef.current && liveClientRef.current) {
        const imageSrc = webcamRef.current.getScreenshot();
        if (imageSrc) {
          liveClientRef.current.sendVideoFrame(imageSrc);
        }
      }
    }, 1000 / VIDEO_FPS);

  }, [cameraError]);

  const stopSession = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    
    if (liveClientRef.current) {
      liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }
    
    setMode(AppMode.IDLE);
    setStatusText("Ready");
  }, []);

  const toggleSession = () => {
    if (mode === AppMode.IDLE) {
      startSession();
    } else {
      stopSession();
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
                  <p className="text-gray-400">Please allow camera access.</p>
              </div>
          </div>
      )}

      {/* Reusing HUD but simplifying interaction since it's now all Voice-driven via Live API */}
      <HUD 
        mode={mode} 
        lastMessage={statusText} 
        isListening={mode === AppMode.NAVIGATING} // Visual feedback
        onMicClick={toggleSession}
        onStop={stopSession}
        isProMode={false} // Live API uses Flash specialized model
      />
    </div>
  );
};

export default App;