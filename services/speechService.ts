export const speak = (text: string, priority: 'high' | 'normal' = 'normal') => {
  if (!window.speechSynthesis) return;

  // Cancel current speech if high priority (safety warning)
  if (priority === 'high') {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  
  // Select a good voice if available (preference for Google US English)
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(v => v.name.includes('Google US English')) || voices[0];
  if (preferredVoice) utterance.voice = preferredVoice;

  utterance.rate = 1.25; // Faster rate for efficiency
  utterance.pitch = 1.0;

  window.speechSynthesis.speak(utterance);
};

export const stopSpeaking = () => {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
};