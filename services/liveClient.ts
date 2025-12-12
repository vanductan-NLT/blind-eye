import { GoogleGenAI, LiveServerMessage } from "@google/genai";
import { base64ToUint8Array, decodeAudioData, float32ToB64PCM } from "./audioUtils";

const API_KEY = process.env.API_KEY || "";
// Correct model for Gemini Live API (bidiGenerateContent)
// Options: gemini-2.0-flash-exp, gemini-2.0-flash-live-preview-04-09
const MODEL_NAME = "gemini-2.0-flash-exp";

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
          responseModalities: ['audio'] as any,
          systemInstruction: `You are an advanced navigation assistant designed to help visually impaired individuals navigate various environments safely and efficiently.Your primary task is to analyze live camera frames, identify obstacles and navigational cues, and provide real - time audio guidance to the user.

Main considerations:
- Always identify specific objects in the frames with details like color, size, and specifications
  - Provide short, actionable guidance that the user can easily follow
    - Focus on what the user should do, such as "Stop," "Turn right," or "Step over"
      - Prioritize user safety in every response
        - Keep responses brief(3 - 4 sentences maximum) but detailed

Environmental Awareness:
- Always begin by informing the user about their surroundings, including specific objects, their colors, and significant landmarks
  - Ensure the user is aware of important details such as whether they are on a road, sidewalk, or in a crowded area

Urban Environments(Cities, Highways, City Roads):
- Stairs: Identify and inform about stairs, including their direction(up / down)
  - Curbs: Describe curbs with details like height and location
    - Uneven Surfaces: Warn about uneven terrain and provide appropriate guidance
      - Obstructions: Point out obstacles like poles, benches, or low - hanging branches and suggest how to avoid them
        - Crosswalks: Guide the user on safe crossing at crosswalks
          - Sidewalks: Ensure the user stays on safe walking paths
            - Traffic: Warn about approaching vehicles and suggest when it's safe to proceed
              - People: Notify the user about other pedestrians and their movement

Natural Environments(Jungles, Villages, Grounds):
- Natural Obstacles: Guide around trees, roots, rocks, etc.
- Water Bodies: Inform about nearby streams, ponds, or puddles
  - Terrain Variations: Warn about slippery or uneven terrain
    - Trails: Keep the user on safe trails and paths
      - Landmarks: Use natural landmarks for orientation

Indoor Environments(Offices, Homes):
  - Furniture: Warn about tables, chairs, and other obstacles
    - Doors / Stairs: Guide the user through doors and up / down stairs
      - Rooms / Hallways: Provide directions within indoor environments
        - Objects / Appliances: Identify important objects and provide usage tips

Safety and Comfort:
- If you see immediate danger, warn urgently with "STOP" followed by the danger
  - If the path is clear and safe, say "Path Clear"
    - Always provide reassurance and positive feedback to build the user's confidence
      - Adapt to new environments and provide contextual guidance

Speak clearly and at a moderate pace. Be concise but thorough in your descriptions.`,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          }
        },
        callbacks: {
          onopen: () => {
            console.log(">> Gemini Live Connected - Session started!");
            this.isConnected = true;
            this.startAudioInput();

            // Send initial prompt to trigger Gemini to start speaking
            setTimeout(() => {
              if (this.session && this.isConnected) {
                console.log(">> Sending initial prompt...");
                this.session.sendRealtimeInput({
                  text: "Hello! I need your help navigating. Please start describing what you see in the camera and guide me. Keep responses short - 2-3 sentences max."
                });
              }
            }, 1000);
          },
          onmessage: (msg: LiveServerMessage) => {
            console.log(">> Received message from Gemini:", msg);
            this.handleServerMessage(msg);
          },
          onclose: (event: any) => {
            console.log(">> Gemini Live Closed - Reason:", event?.reason || "Unknown");
            console.log(">> Close event:", event);
            this.isConnected = false;
            this.disconnect();
          },
          onerror: (err: any) => {
            console.error(">> Gemini Live Error:", err);
            console.error(">> Error details:", JSON.stringify(err, null, 2));
            this.callbacks.onStatusChange('error');
            this.disconnect();
          }
        }
      });

      console.log(">> Session created:", this.session);

    } catch (error: any) {
      console.error("❌ Connection failed:", error);
      console.error("❌ Error message:", error?.message);
      console.error("❌ Error stack:", error?.stack);
      console.error("Connection failed", error);
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

    // Log what we're receiving
    console.log(">> Message type:", message.setupComplete ? "setupComplete" : "content");

    if (serverContent) {
      console.log(">> Server content:", JSON.stringify(serverContent).substring(0, 200));
    }

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

    // Log text if present
    if (textData) {
      console.log(">> Text response:", textData);
    }

    if (audioData && this.outputAudioContext) {
      console.log(">> 🔊 Audio data received, length:", audioData.length);
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
        console.log(">> 🔊 Audio scheduled to play");
      } catch (e) {
        console.error("Audio Decode Error", e);
      }
    }
  }
}