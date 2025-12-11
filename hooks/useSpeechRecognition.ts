import { useState, useEffect, useCallback, useRef } from 'react';

export const useSpeechRecognition = (onCommand: (command: string) => void) => {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // Single command mode
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        if (isMounted.current) setIsListening(true);
      };

      recognition.onend = () => {
        if (isMounted.current) setIsListening(false);
      };
      
      recognition.onresult = (event: any) => {
        const lastResultIndex = event.results.length - 1;
        if (event.results[lastResultIndex].isFinal) {
          const transcript = event.results[lastResultIndex][0].transcript.trim().toLowerCase();
          console.log("Recognized:", transcript);
          onCommand(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error", event.error);
        if (isMounted.current) setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      isMounted.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [onCommand]);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn("Speech start failed", e);
      }
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  return { isListening, startListening, stopListening };
};