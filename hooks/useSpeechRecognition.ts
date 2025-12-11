import { useState, useEffect, useCallback, useRef } from 'react';

export const useSpeechRecognition = (onCommand: (command: string) => void) => {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isMounted = useRef(false);
  const retryTimeoutRef = useRef<any>(null);

  useEffect(() => {
    isMounted.current = true;
    
    return () => {
      isMounted.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch(e){}
      }
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  const startListening = useCallback(() => {
    // Basic browser support check
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition not supported in this browser");
      return;
    }

    if (isListening) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        if (isMounted.current) setIsListening(true);
        console.log("Speech Recognition Started");
      };

      recognition.onend = () => {
        if (isMounted.current) setIsListening(false);
        console.log("Speech Recognition Ended");
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

        // RETRY LOGIC for 'aborted' or 'not-allowed' temporary glitches
        if (event.error === 'aborted' || event.error === 'network') {
            console.log("Retrying speech recognition...");
            if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = setTimeout(() => {
                if (isMounted.current && !recognitionRef.current) {
                    startListening();
                }
            }, 500);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();

    } catch (e) {
      console.error("Failed to start recognition", e);
    }
  }, [isListening, onCommand]);

  const stopListening = useCallback(() => {
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e){}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  return { isListening, startListening, stopListening };
};