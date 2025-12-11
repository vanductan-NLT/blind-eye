import { GoogleGenAI, LiveServerMessage } from "@google/genai";
import { base64ToUint8Array, decodeAudioData, float32ToB64PCM } from "./audioUtils";

const API_KEY = process.env.API_KEY || "";
// Using the Preview model for Live API
const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-09-2025"; 

interface LiveClientCallbacks {
  onAudioData: (text: string | null) => void; 
  onStatusChange: (status: 'connected' | 'disconnected' | 'error') => void;
}

export class LiveClient {
  private ai: GoogleGenAI;
  private session: any = null; // Hold the active session
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private audioQueue: AudioBufferSourceNode[] = [];
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private callbacks: LiveClientCallbacks;
  private isConnected: boolean = false;

  constructor(callbacks: LiveClientCallbacks) {
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
    this.callbacks = callbacks;
  }

  public async connect() {
    try {
      this.callbacks.onStatusChange('connected');
      
      // 1. Setup Audio Output (Speaker)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.outputAudioContext = new AudioContextClass({ sampleRate: 24000 });
      
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }
      this.nextStartTime = this.outputAudioContext.currentTime;

      // 2. Connect to Gemini Live Session
      // We assign the session result to this.session
      this.session = await this.ai.live.connect({
        model: MODEL_NAME,
        config: {
          // Use string 'AUDIO' to avoid Enum transpilation issues in some ESM environments
          responseModalities: ['AUDIO'], 
          systemInstruction: "You are a guide for the blind. Speak fast. Warn of hazards. Use clock directions (12 o'clock). Say 'Ready' now.",
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } 
          }
        },
        callbacks: {
          onopen: () => {
            console.log(">> Gemini Live Connected");
            this.isConnected = true;
            this.startAudioInput();
          },
          onmessage: (msg: LiveServerMessage) => this.handleServerMessage(msg),
          onclose: () => {
            console.log(">> Gemini Live Closed");
            this.isConnected = false;
            this.disconnect();
          },
          onerror: (err) => {
            console.error(">> Gemini Live Error:", JSON.stringify(err, null, 2));
            this.callbacks.onStatusChange('error');
            this.disconnect();
          }
        }
      });

    } catch (error) {
      console.error("Connection failed", error);
      this.callbacks.onStatusChange('error');
    }
  }

  public disconnect() {
    this.isConnected = false;

    // Close Session safely
    if (this.session) {
      try { 
        this.session.close(); 
      } catch(e) { 
        // ignore if already closed 
      }
      this.session = null;
    }

    // Stop Microphone & Input Processing
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.inputAudioContext) {
      if (this.inputAudioContext.state !== 'closed') {
        this.inputAudioContext.close().catch(() => {});
      }
      this.inputAudioContext = null;
    }

    // Stop Speaker Output
    this.stopAudioQueue();
    if (this.outputAudioContext) {
      if (this.outputAudioContext.state !== 'closed') {
        this.outputAudioContext.close().catch(() => {});
      }
      this.outputAudioContext = null;
    }

    this.callbacks.onStatusChange('disconnected');
  }

  private stopAudioQueue() {
    this.audioQueue.forEach(source => {
        try { source.stop(); } catch(e){}
    });
    this.audioQueue = [];
  }

  private async startAudioInput() {
    if (!this.isConnected) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.inputAudioContext = new AudioContextClass({ sampleRate: 16000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          channelCount: 1, 
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
      this.mediaStream = stream;

      const source = this.inputAudioContext.createMediaStreamSource(stream);
      this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        if (!this.session || !this.isConnected) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const b64Data = float32ToB64PCM(inputData);

        try {
          this.session.sendRealtimeInput({
            media: {
              mimeType: "audio/pcm;rate=16000",
              data: b64Data
            }
          });
        } catch (err) {
            console.warn("Failed to send audio", err);
        }
      };

      source.connect(this.processor);
      
      // Keep processor alive
      const mute = this.inputAudioContext.createGain();
      mute.gain.value = 0;
      this.processor.connect(mute);
      mute.connect(this.inputAudioContext.destination);

    } catch (err) {
      console.error("Mic Access Error", err);
    }
  }

  public sendVideoFrame(base64Image: string) {
    if (!this.session || !this.isConnected) return;
    
    const data = base64Image.split(',')[1] || base64Image;
    
    try {
      this.session.sendRealtimeInput({
        media: {
          mimeType: "image/jpeg",
          data: data
        }
      });
    } catch (err) {
       console.warn("Failed to send video frame", err);
    }
  }

  private async handleServerMessage(message: LiveServerMessage) {
    const serverContent = message.serverContent;

    // 1. Interruption
    if (serverContent?.interrupted) {
        console.log(">> Interrupted");
        this.stopAudioQueue();
        if (this.outputAudioContext) {
            this.nextStartTime = this.outputAudioContext.currentTime;
        }
        return;
    }

    // 2. Audio Processing
    const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && this.outputAudioContext) {
      try {
        const audioBytes = base64ToUint8Array(audioData);
        const audioBuffer = await decodeAudioData(audioBytes, this.outputAudioContext);

        if (this.nextStartTime < this.outputAudioContext.currentTime) {
            this.nextStartTime = this.outputAudioContext.currentTime;
        }
        
        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.outputAudioContext.destination);
        source.start(this.nextStartTime);
        
        this.audioQueue.push(source);
        this.nextStartTime += audioBuffer.duration;
      } catch (e) {
        console.error("Audio Decode Error", e);
      }
    }
  }
}