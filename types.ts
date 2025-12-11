export enum AppMode {
  IDLE = 'IDLE',
  NAVIGATING = 'NAVIGATING', // Fast Lane
  READING = 'READING',       // Smart Lane (Assistant)
  ERROR = 'ERROR'
}

export interface AILogEntry {
  id: string;
  timestamp: Date;
  mode: AppMode;
  text: string;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
}

// Extend Window for Web Speech API support in TypeScript
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}