import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { base64ToUint8Array, decodeAudioData, float32ToInt16, arrayBufferToBase64 } from "./audioUtils";

const API_KEY = process.env.API_KEY || "";
const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-09-2025"; // Optimized for low latency

interface LiveClientCallbacks {
  onAudioData: (text: string | null) => void; // Optional: if we want to show transcription
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
  private isProcessing: boolean = false;

  constructor(callbacks: LiveClientCallbacks) {
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
    this.callbacks = callbacks;
  }

  public async connect() {
    try {
      this.callbacks.onStatusChange('connected'); // Optimistic update
      
      // 1. Setup Audio Output (Speaker) - 24kHz is standard for Gemini Flash Live
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      this.nextStartTime = this.outputAudioContext.currentTime;

      // 2. Connect to Gemini Live
      this.session = await this.ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: {
            parts: [{
              text: `Role: Ultra-Fast Navigation Guide for the Blind.
Input: Real-time video stream + user voice.
Output: Audio ONLY.

Directives:
1. **NAVIGATION MODE**:
   - If path is clear, say NOTHING or just "Clear".
   - If hazard detected (within 3 meters), say "STOP" immediately + object name.
   - Give relative clock directions: "Door at 2 o'clock", "Veer left".
   - Be rude, be fast. No polite sentences. "Chair ahead", "Stairs down".

2. **INTERACTION**:
   - If user asks "What is this?", describe it briefly (1 sentence).

CRITICAL: Latency is priority. Keep responses under 5 words unless asked a question.`
            }]
          },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } // 'Kore' is usually authoritative/clear
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

    } catch (error) {
      console.error("Connection failed", error);
      this.callbacks.onStatusChange('error');
    }
  }

  public disconnect() {
    // 1. Close Session
    if (this.session) {
      // session.close() might not exist on the type depending on SDK version, 
      // but usually closing the socket is handled internally or via end of script.
      // We'll just nullify it to stop sending data.
      this.session = null;
    }

    // 2. Stop Microphone
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

    // 3. Stop Audio Output
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

  /**
   * Captures microphone audio, downsamples to 16kHz PCM, and streams to Gemini.
   */
  private async startAudioInput() {
    try {
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      // Buffer size 4096 = ~250ms latency at 16kHz
      this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        if (!this.session) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const pcmInt16 = float32ToInt16(inputData);
        // Encode to Base64
        const pcmBase64 = arrayBufferToBase64(pcmInt16.buffer);

        this.session.sendRealtimeInput({
          media: {
            mimeType: "audio/pcm;rate=16000",
            data: pcmBase64
          }
        });
      };

      source.connect(this.processor);
      this.processor.connect(this.inputAudioContext.destination);

    } catch (err) {
      console.error("Mic Error", err);
    }
  }

  /**
   * Sends a video frame (JPEG base64) to the model.
   * Should be called 2-5 times per second by the UI loop.
   */
  public sendVideoFrame(base64Image: string) {
    if (!this.session) return;
    
    // Clean base64 header
    const data = base64Image.split(',')[1];
    
    this.session.sendRealtimeInput({
      media: {
        mimeType: "image/jpeg",
        data: data
      }
    });
  }

  /**
   * Handles incoming audio chunks from Gemini and queues them for playback.
   */
  private async handleServerMessage(message: LiveServerMessage) {
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    
    if (audioData && this.outputAudioContext) {
      const audioBytes = base64ToUint8Array(audioData);
      const audioBuffer = await decodeAudioData(audioBytes, this.outputAudioContext);

      // Schedule playback
      // Ensure we don't schedule in the past
      this.nextStartTime = Math.max(this.outputAudioContext.currentTime, this.nextStartTime);
      
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAudioContext.destination);
      source.start(this.nextStartTime);
      
      this.audioQueue.push(source);
      
      // Advance time cursor
      this.nextStartTime += audioBuffer.duration;
    }
  }
}