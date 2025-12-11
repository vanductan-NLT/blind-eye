
export const speak = (text: string, priority: 'high' | 'normal' = 'normal') => {
  if (!window.speechSynthesis) return;

  // Cancel current speech if high priority (safety warning)
  if (priority === 'high') {
    window.speechSynthesis.cancel();
  }

  const performSpeak = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Attempt to find preferred voices
    const voices = window.speechSynthesis.getVoices();
    // Prioritize high quality Google voices, then standard English
    const preferredVoice = voices.find(v => v.name.includes('Google US English')) || 
                           voices.find(v => v.lang.startsWith('en-US')) ||
                           voices[0];
                           
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.rate = 1.25; 
    utterance.pitch = 1.0;
    
    // Add event handlers for debugging
    utterance.onerror = (e) => console.error("TTS Error:", e);

    window.speechSynthesis.speak(utterance);
  };

  // Chrome sometimes needs a moment to load voices
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
        performSpeak();
        window.speechSynthesis.onvoiceschanged = null;
    };
  } else {
    performSpeak();
  }
};

export const stopSpeaking = () => {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
};