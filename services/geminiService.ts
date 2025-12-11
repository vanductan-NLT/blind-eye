import { GoogleGenAI } from "@google/genai";
import { GeoLocation } from "../types";

// Lazy initialization
let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    const apiKey = process.env.API_KEY || "";
    if (!apiKey) console.warn("API_KEY is missing");
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

const cleanTextForSpeech = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/[*#_`~]/g, '') 
    .replace(/^[\s\-\.]+/gm, '') 
    .replace(/\s+/g, ' ') 
    .trim();
};

export const classifyUserIntent = async (command: string): Promise<'NAVIGATION' | 'CHAT' | 'ADVANCED'> => {
  try {
    const ai = getAI();
    // Local fallback is handled in App.tsx mostly, this is for edge cases
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ 
            text: `Role: Intent Classifier.
Command: "${command}"
Task: Output one word: NAVIGATION, CHAT, or ADVANCED.
Rules:
- Movement/Safety/Walk -> NAVIGATION
- Read/Text/Sign/Analyze -> ADVANCED
- Hello/Describe/Object -> CHAT` 
        }]
      },
      config: {
        temperature: 0.1,
        maxOutputTokens: 10,
      }
    });

    const text = response.text?.trim().toUpperCase();
    if (text?.includes('NAV')) return 'NAVIGATION';
    if (text?.includes('ADVANCED')) return 'ADVANCED';
    return 'CHAT'; 
  } catch (error) {
    const lower = command.toLowerCase();
    if (lower.includes('nav') || lower.includes('walk') || lower.includes('go')) return 'NAVIGATION';
    if (lower.includes('read') && lower.includes('text')) return 'ADVANCED';
    return 'CHAT';
  }
};

/**
 * Fast Lane: Navigation Mode
 * CRITICAL UPDATE: Prompt now forces SPATIAL DIRECTION and ACTION.
 */
export const analyzeNavigationFrame = async (base64Image: string): Promise<string> => {
  try {
    const ai = getAI();
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          { text: `Role: Blind Guide.
Input: User View (User is walking forward).
Task: Give immediate DIRECTIONAL command.

Rules:
1. Identify immediate obstacles in the path.
2. Give relative direction: "To your left", "On your right", "12 o'clock".
3. Use ACTION verbs: "Veer left", "Stop", "Continue", "Step up".
4. If path is clear, describe the space briefly: "Hallway clear." or "Open room."

Response format: JSON.
{
  "command": "Short spoken command (Max 10 words). e.g., 'Stop. Table 12 o'clock.' or 'Veer right, person ahead.'",
  "hazard": boolean
}` 
          }
        ]
      },
      config: {
        temperature: 0.1, // Low temp for precision
        maxOutputTokens: 150,
        responseMimeType: 'application/json' 
      }
    });

    const jsonText = response.text;
    if (!jsonText) return "Path clear.";
    
    try {
        const data = JSON.parse(jsonText);
        return cleanTextForSpeech(data.command || "Path clear.");
    } catch (e) {
        return "Path clear.";
    }

  } catch (error: any) {
    if (error.toString().includes("quota")) return "QUOTA_EXCEEDED";
    return "Navigation active.";
  }
};

/**
 * Smart Assistant Mode (Hybrid)
 * CRITICAL UPDATE: Prompt forces SPATIAL CONTEXT even in chat.
 */
export const analyzeSmartAssistant = async (
  base64Image: string, 
  userPrompt: string,
  location?: GeoLocation,
  useProModel: boolean = false
): Promise<string> => {
  const ai = getAI();
  const cleanBase64 = base64Image.split(',')[1] || base64Image;

  const tools: any[] = [];
  if (location && (userPrompt.toLowerCase().includes("where") || userPrompt.toLowerCase().includes("location"))) {
    tools.push({ googleMaps: {} });
  }

  const toolConfig = tools.length > 0 && location ? {
    retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } }
  } : undefined;

  const promptText = `Role: Vision Assistant.
User Audio: "${userPrompt}"
Context: You are the user's eyes.
Instructions:
1. **Greetings/General**: If user says "Hello", describe **WHERE** objects are relative to them. (e.g., "Hello. You are facing a window. There is a desk to your right.")
2. **Identification**: Be specific.
3. **Guidance**: If the user asks what to do, give direction.

Keep it conversational but SPATIALLY ACCURATE.`;

  const modelName = useProModel ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
  const tokenLimit = useProModel ? 4096 : 500; 

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          { text: promptText }
        ]
      },
      config: {
        tools: tools.length > 0 ? tools : undefined,
        toolConfig: toolConfig,
        temperature: 0.6, 
        maxOutputTokens: tokenLimit,
      }
    });
    
    if (!response.text) throw new Error("Empty response");
    
    return cleanTextForSpeech(response.text);

  } catch (error: any) {
    if (error.toString().includes("quota")) return "QUOTA_EXCEEDED";
    if (useProModel) return "I had trouble analyzing details.";
    return "I couldn't see that clearly.";
  }
};