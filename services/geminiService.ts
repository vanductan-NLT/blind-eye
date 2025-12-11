import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { GeoLocation } from "../types";

// Initialize the SDK
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * UTILITY: Clean text for Text-to-Speech
 * Removes markdown symbols that sound bad when read aloud (e.g., "asterisk", "dash").
 */
const cleanTextForSpeech = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/[*#_`~]/g, '') // Remove Markdown bold/italic/headers
    .replace(/^[\s\-\.]+/gm, '') // Remove bullet points at start of lines
    .replace(/\s+/g, ' ') // Collapse extra whitespace
    .trim();
};

/**
 * Router Lane: Intent Classifier
 * MODEL: gemini-2.5-flash
 * PURPOSE: Decides between Navigation, Simple Chat, or Advanced Analysis.
 */
export const classifyUserIntent = async (command: string): Promise<'NAVIGATION' | 'CHAT' | 'ADVANCED'> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ 
            text: `Role: Intent Classifier for a Blind Assistant.
Context: User is visually impaired.
Definitions:
1. NAVIGATION: Movement, finding paths/exits/bathrooms, safety checks while walking. (Output: NAVIGATION)
2. CHAT: General Q&A, greetings, simple object identification ("What is this?"), color check, light check. Quick answers. (Output: CHAT)
3. ADVANCED: Reading text (OCR), "Describe in detail", complex reasoning, analysis of documents/bills. (Output: ADVANCED)

Command: "${command}"

Task: Output exactly one word: NAVIGATION, CHAT, or ADVANCED.` 
        }]
      },
      config: {
        temperature: 0.1,
        maxOutputTokens: 10,
      }
    });

    const text = response.text?.trim().toUpperCase();
    if (text?.includes('NAV')) return 'NAVIGATION';
    if (text?.includes('ADVANCED') || text?.includes('READ')) return 'ADVANCED';
    return 'CHAT'; 
  } catch (error) {
    console.warn("Intent classification failed, falling back to simple logic.", error);
    const lower = command.toLowerCase();
    if (lower.includes('nav') || lower.includes('walk') || lower.includes('go') || lower.includes('exit')) return 'NAVIGATION';
    if (lower.includes('read') || lower.includes('describe') || lower.includes('detail')) return 'ADVANCED';
    return 'CHAT';
  }
};

/**
 * Fast Lane: Navigation Mode
 * MODEL: gemini-2.5-flash
 */
export const analyzeNavigationFrame = async (base64Image: string): Promise<string> => {
  try {
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          { text: `Role: You are "SonarAI," an advanced spatial navigation engine for the visually impaired.
Input: A camera frame from the user's perspective (frontal view).
User Intent: The user is walking indoors and needs immediate, actionable safety guidance.

CORE REASONING PROCESS (Thinking Chain):
1. Scan & Detect: Identify dynamic hazards (people, closing doors), static obstacles (chairs, bags), and navigational signs (Exit, Room Numbers, Warnings like "Wet Floor").
2. Spatial Parsing: Determine the "Walkable Path". Is it clear? Is it blocked?
3. Semantic Analysis: If text is detected (e.g., "WET FLOOR"), prioritize this as a HIGH-LEVEL HAZARD even if the path looks physically clear.
4. Coordinate Mapping: Locate the center of the primary target or the safest path gap on a horizontal axis from 0.0 (Left) to 1.0 (Right).

OUTPUT FORMAT (Strict JSON Only):
{
  "safety_status": "SAFE" | "CAUTION" | "STOP",
  "reasoning_summary": "Detected wet floor sign directly in path.",
  "navigation_command": "Short, imperative voice command (Max 8 words). E.g., 'Stop. Wet floor sign ahead. Go left.'",
  "stereo_pan": 0.0, // A float between -1.0 (Left) and 1.0 (Right) representing where the clear path or target is. 0.0 is Center.
  "visual_debug": {
    "hazards": [ {"label": "Bag", "box_2d": [ymin, xmin, ymax, xmax]} ], // For drawing red boxes
    "safe_path": [ {"label": "Path", "box_2d": [ymin, xmin, ymax, xmax]} ] // For drawing green boxes
  }
}` 
          }
        ]
      },
      config: {
        temperature: 0.5,
        maxOutputTokens: 500,
        responseMimeType: 'application/json' 
      }
    });

    const jsonText = response.text;
    if (!jsonText) return "Path clear.";
    
    try {
        const data = JSON.parse(jsonText);
        return cleanTextForSpeech(data.navigation_command || "Path clear.");
    } catch (e) {
        console.warn("SonarAI JSON parse error", e);
        return "Path clear.";
    }

  } catch (error: any) {
    const errorMsg = error.toString();
    if (errorMsg.includes("429") || errorMsg.includes("quota")) return "QUOTA_EXCEEDED";
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
  const cleanBase64 = base64Image.split(',')[1] || base64Image;

  // Tools (Maps) - Only for location queries
  const tools: any[] = [];
  if (location && (userPrompt.toLowerCase().includes("where") || userPrompt.toLowerCase().includes("location"))) {
    tools.push({ googleMaps: {} });
  }

  const toolConfig = tools.length > 0 && location ? {
    retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } }
  } : undefined;

  // Optimized System Prompt for Audio Output
  const promptText = `Role: Vision Assistant.
User Query: "${userPrompt}"
Instructions:
- Output PLAIN TEXT ONLY. NO Markdown (no * or # or -).
- Keep it CONCISE and conversational (max 2 sentences unless reading text).
- If reading text, read it naturally.
- If identifying objects, be direct.`;

  const modelName = useProModel ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
  const tokenLimit = useProModel ? 4096 : 1024; // Pro needs room to think/read, Flash needs speed

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
        temperature: 0.4,
        maxOutputTokens: tokenLimit,
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        ]
      }
    });
    
    if (!response.text) throw new Error("Empty response");
    
    // Clean the text before returning to UI/TTS
    return cleanTextForSpeech(response.text);

  } catch (error: any) {
    console.warn(`${modelName} failed`, error);
    if (error.toString().includes("quota")) return "QUOTA_EXCEEDED";
    
    // Simple fallback if it was a pro request that failed
    if (useProModel) {
        return "I had trouble analyzing the details. Try again.";
    }
    return "I couldn't see that clearly.";
  }
};