import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { base64ToUint8Array, decodeAudioData, float32ToInt16, arrayBufferToBase64 } from "./audioUtils";

const API_KEY = process.env.API_KEY || "";
const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-09-2025"; 

interface LiveClientCallbacks {
  onAudioData: (text: string | null) => void; 
  onStatusChange: (status: 'connected' | 'disconnected' | 'error') => void;
}

export class LiveClient {
  private ai: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private audioQueue: AudioBufferSourceNode[] = [];
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private callbacks: LiveClientCallbacks;

  constructor(callbacks: LiveClientCallbacks) {
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
    this.callbacks = callbacks;
  }

  public async connect() {
    try {
      this.callbacks.onStatusChange('connected');
      
      // 1. Setup Audio Output
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      this.nextStartTime = this.outputAudioContext.currentTime;

      // 2. Connect to Gemini Live
      // Store the promise immediately so we can latch onto it in callbacks
      this.sessionPromise = this.ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "You are a blind guide. NAVIGATION MODE: If path is clear, say nothing. If hazard, say STOP + object. Give clock directions (2 o'clock). Be rude, fast, max 5 words. INTERACTION: Answer questions briefly.",
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } 
          }
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Opened");
            this.startAudioInput();
          },
          onmessage: (msg: LiveServerMessage) => this.handleServerMessage(msg),
          onclose: () => {
            console.log("Gemini Live Session Closed");
            this.disconnect();
          },
          onerror: (err) => {
            console.error("Gemini Live Error", err);
            this.callbacks.onStatusChange('error');
            this.disconnect();
          }
        }
      });

      // We await it here just to catch initial connection errors, 
      // but the class property sessionPromise is already set for other methods to use.
      await this.sessionPromise;

    } catch (error) {
      console.error("Connection failed", error);
      this.callbacks.onStatusChange('error');
    }
  }

  public disconnect() {
    if (this.sessionPromise) {
      this.sessionPromise.then(session => {
        // Try to close if method exists, otherwise just ignore
        try { session.close(); } catch(e) {}
      }).catch(() => {}); // Ignore errors if promise failed
      this.sessionPromise = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.inputAudioContext) {
      this.inputAudioContext.close();
      this.inputAudioContext = null;
    }

    this.audioQueue.forEach(source => {
        try { source.stop(); } catch(e){}
    });
    this.audioQueue = [];
    if (this.outputAudioContext) {
      this.outputAudioContext.close();
      this.outputAudioContext = null;
    }

    this.callbacks.onStatusChange('disconnected');
  }

  private async startAudioInput() {
    try {
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        if (!this.sessionPromise) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcmInt16 = float32ToInt16(inputData);
        const pcmBase64 = arrayBufferToBase64(pcmInt16.buffer);

        this.sessionPromise.then(session => {
            session.sendRealtimeInput({
                media: {
                    mimeType: "audio/pcm;rate=16000",
                    data: pcmBase64
                }
            });
        });
      };

      source.connect(this.processor);
      this.processor.connect(this.inputAudioContext.destination);

    } catch (err) {
      console.error("Mic Error", err);
    }
  }

  public sendVideoFrame(base64Image: string) {
    if (!this.sessionPromise) return;
    
    const data = base64Image.split(',')[1];
    
    this.sessionPromise.then(session => {
        session.sendRealtimeInput({
            media: {
                mimeType: "image/jpeg",
                data: data
            }
        });
    });
  }

  private async handleServerMessage(message: LiveServerMessage) {
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    
    if (audioData && this.outputAudioContext) {
      const audioBytes = base64ToUint8Array(audioData);
      const audioBuffer = await decodeAudioData(audioBytes, this.outputAudioContext);

      this.nextStartTime = Math.max(this.outputAudioContext.currentTime, this.nextStartTime);
      
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAudioContext.destination);
      source.start(this.nextStartTime);
      
      this.audioQueue.push(source);
      this.nextStartTime += audioBuffer.duration;
    }
  }
}