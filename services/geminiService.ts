import { GoogleGenAI } from "@google/genai";
import { GeoLocation } from "../types";

// Lazy initialization to prevent crash on module load
let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    // Ensure process.env.API_KEY exists or handle gracefully
    const apiKey = process.env.API_KEY || "";
    if (!apiKey) {
      console.warn("API_KEY is missing from process.env");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

/**
 * UTILITY: Clean text for Text-to-Speech
 * Removes markdown symbols that sound bad when read aloud.
 */
const cleanTextForSpeech = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/[*#_`~]/g, '') 
    .replace(/^[\s\-\.]+/gm, '') 
    .replace(/\s+/g, ' ') 
    .trim();
};

/**
 * Router Lane: Intent Classifier
 * MODEL: gemini-2.5-flash
 * PURPOSE: Decides between Navigation, Simple Chat (Flash), or Advanced (Pro).
 */
export const classifyUserIntent = async (command: string): Promise<'NAVIGATION' | 'CHAT' | 'ADVANCED'> => {
  try {
    const ai = getAI();
    // Quick keyword check to save latency
    const lower = command.toLowerCase();
    if (lower.startsWith('hello') || lower.startsWith('hi ')) return 'CHAT';
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ 
            text: `Role: Intent Classifier.
Context: User is visually impaired.
Definitions:
1. NAVIGATION (Flash): Movement, walking, finding exits, finding bathrooms, "Where is the door?", "Am I safe?".
2. CHAT (Flash): **DEFAULT.** "Hello", "Hi", "What is this?", "Describe the room", "What is in front of me?", Colors, Lights.
3. ADVANCED (Pro): **STRICTLY ONLY FOR:** Reading dense text (OCR), Reading documents, or explicit requests for "Deep/Detailed analysis".

Command: "${command}"

Task: Output one word: NAVIGATION, CHAT, or ADVANCED.` 
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
    console.warn("Intent fallback triggered.", error);
    const lower = command.toLowerCase();
    if (lower.includes('nav') || lower.includes('walk') || lower.includes('go')) return 'NAVIGATION';
    if (lower.includes('read') && lower.includes('text')) return 'ADVANCED';
    return 'CHAT';
  }
};

/**
 * Fast Lane: Navigation Mode
 * MODEL: gemini-2.5-flash
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
          { text: `Role: SonarAI (Blind Guide).
Input: Camera view.
Task: Navigation & Safety.
Output: JSON.

Output Rules:
- "navigation_command": MAX 8 WORDS. Imperative. No filler.
- If safe: "Path clear. Continue."
- If hazard: "Stop. Chair ahead."

JSON Schema:
{
  "navigation_command": "string",
  "safety_status": "SAFE" | "CAUTION" | "STOP"
}` 
          }
        ]
      },
      config: {
        temperature: 0.3,
        maxOutputTokens: 300, // Increased to prevent JSON truncation
        responseMimeType: 'application/json' 
      }
    });

    const jsonText = response.text;
    if (!jsonText) return "Path clear.";
    
    try {
        const data = JSON.parse(jsonText);
        return cleanTextForSpeech(data.navigation_command || "Path clear.");
    } catch (e) {
        // If JSON fails (likely cut off), try to salvage text or default
        return "Path clear.";
    }

  } catch (error: any) {
    if (error.toString().includes("quota")) return "QUOTA_EXCEEDED";
    return "Navigation active.";
  }
};

/**
 * Smart Assistant Mode (Hybrid)
 * MODEL: Switches between 'gemini-2.5-flash' (Chat) and 'gemini-3-pro-preview' (Advanced)
 */
export const analyzeSmartAssistant = async (
  base64Image: string, 
  userPrompt: string,
  location?: GeoLocation,
  useProModel: boolean = false
): Promise<string> => {
  const ai = getAI();
  const cleanBase64 = base64Image.split(',')[1] || base64Image;

  // Tools (Maps) - Only for location queries
  const tools: any[] = [];
  if (location && (userPrompt.toLowerCase().includes("where") || userPrompt.toLowerCase().includes("location"))) {
    tools.push({ googleMaps: {} });
  }

  const toolConfig = tools.length > 0 && location ? {
    retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } }
  } : undefined;

  // Context-aware prompt to handle greetings vs queries
  const promptText = `Role: Friendly Vision Assistant for the blind.
User Audio: "${userPrompt}"
Context: You are seeing what is in front of the user (or the user themselves if facing the camera).

Instructions:
1. **Greetings ("Hello", "Hi")**: Reply warmly, then briefly describe the scene. (e.g. "Hello! I see a desk in front of you.")
2. **Identification ("What is this?")**: Directly identify the object.
3. **General**: Speak naturally and clearly. Keep responses helpful and around 2-3 sentences.
4. **NO Markdown**.`;

  const modelName = useProModel ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
  // Increased tokens to prevent mid-sentence cutoff
  const tokenLimit = useProModel ? 4096 : 500; 

  try {
    console.log(`Analyzing with ${modelName}...`);
    
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
        temperature: 0.7, 
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