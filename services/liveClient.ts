import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { base64ToUint8Array, decodeAudioData, float32ToB64PCM } from "./audioUtils";

const API_KEY = process.env.API_KEY || "";
// Correct model for Gemini Live API (Native Audio)
const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-09-2025";

console.log("🔑 API Key loaded:", API_KEY ? `${API_KEY.substring(0, 10)}...` : "MISSING!");

interface LiveClientCallbacks {
  onAudioData: (text: string | null) => void;
  onStatusChange: (status: 'connected' | 'disconnected' | 'error') => void;
}

export class LiveClient {
  private ai: GoogleGenAI;
  private session: any = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private audioQueue: AudioBufferSourceNode[] = [];
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private callbacks: LiveClientCallbacks;
  private isConnected: boolean = false;

  constructor(callbacks: LiveClientCallbacks) {
    console.log("🔧 Creating LiveClient with API key:", API_KEY ? "Present" : "Missing");
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
    this.callbacks = callbacks;
  }

  public async connect() {
    try {
      console.log("📡 Attempting to connect to model:", MODEL_NAME);
      this.callbacks.onStatusChange('connected'); // Optimistic update

      // 1. Initialize Output Audio (Speaker) immediately
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.outputAudioContext = new AudioContextClass({ sampleRate: 24000 });

      // Resume immediately (browser policy)
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }
      this.nextStartTime = this.outputAudioContext.currentTime;

      // 2. Connect to Gemini Live
      this.session = await this.ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are a trusted visual companion for a blind person. You are walking alongside them.

RULES:
- Speak natural English, warm and helpful.
- PRIORITY: HAZARDS > Obstacles > Path info.
- Use clock-face directions: 12 o'clock (front), 3 o'clock (right), 9 o'clock (left).
- Estimate distances in steps or meters.
- Mention floor conditions if relevant.
- Keep it concise (max 2 sentences usually).

When the session starts, say: "I'm with you. Ready to guide."`,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          }
        },
        callbacks: {
          onopen: () => {
            console.log(">> Gemini Live Connected - Session started!");
            this.isConnected = true;
            this.startAudioInput();
          },
          onmessage: (msg: LiveServerMessage) => {
            this.handleServerMessage(msg);
          },
          onclose: (event: any) => {
            console.log(">> Gemini Live Closed");
            this.isConnected = false;
            this.disconnect();
          },
          onerror: (err: any) => {
            console.error(">> Gemini Live Error:", err);
            this.callbacks.onStatusChange('error');
            this.disconnect();
          }
        }
      });

    } catch (error: any) {
      console.error("❌ Connection failed:", error);
      this.callbacks.onStatusChange('error');
      this.disconnect();
    }
  }

  public disconnect() {
    this.isConnected = false;

    // 1. Close Session
    if (this.session) {
      try { this.session.close(); } catch (e) { }
      this.session = null;
    }

    // 2. Stop Mic Stream (CRITICAL for switching modes)
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      this.mediaStream = null;
    }

    // 3. Clean up Input Context
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.inputAudioContext) {
      this.inputAudioContext.close().catch(() => { });
      this.inputAudioContext = null;
    }

    // 4. Clean up Output Context
    this.stopAudioQueue();
    if (this.outputAudioContext) {
      this.outputAudioContext.close().catch(() => { });
      this.outputAudioContext = null;
    }

    this.callbacks.onStatusChange('disconnected');
  }

  private stopAudioQueue() {
    this.audioQueue.forEach(source => {
      try { source.stop(); } catch (e) { }
    });
    this.audioQueue = [];
  }

  private async startAudioInput() {
    if (!this.isConnected || !this.session) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      // Use 16kHz for Gemini Input
      this.inputAudioContext = new AudioContextClass({ sampleRate: 16000 });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
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
          // connection might have dropped
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
      this.disconnect();
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
      // ignore drop
    }
  }

  private async handleServerMessage(message: LiveServerMessage) {
    const serverContent = message.serverContent;

    if (serverContent?.interrupted) {
      console.log(">> Interrupted");
      this.stopAudioQueue();
      if (this.outputAudioContext) {
        this.nextStartTime = this.outputAudioContext.currentTime;
      }
      return;
    }

    const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    const textData = serverContent?.modelTurn?.parts?.[0]?.text;

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