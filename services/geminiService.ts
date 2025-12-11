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

/**
 * DECISION ENGINE: Uses Flash to route the query.
 * Returns 'gemini-3-pro-preview' for complex tasks, 'gemini-2.5-flash' for simple ones.
 */
export const selectBestModelForQuery = async (query: string): Promise<'gemini-3-pro-preview' | 'gemini-2.5-flash'> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [{
                    text: `Task: Router.
Input: "${query}"
Output: Either "PRO" or "FLASH".
Rules:
- Reading text, handwriting, detailed scene analysis, reasoning -> PRO
- Simple identification, color, brief question -> FLASH`
                }]
            },
            config: {
                temperature: 0.0,
                maxOutputTokens: 5,
            }
        });

        const decision = response.text?.trim().toUpperCase();
        return decision?.includes("PRO") ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
    } catch (e) {
        // Fallback to Flash for speed if router fails
        return 'gemini-2.5-flash';
    }
};

/**
 * Smart Assistant Mode (Hybrid)
 * Analyzes image using the specific model passed in.
 */
export const analyzeSmartAssistant = async (
  base64Image: string, 
  userPrompt: string,
  modelName: 'gemini-3-pro-preview' | 'gemini-2.5-flash',
  location?: GeoLocation
): Promise<string> => {
  const ai = getAI();
  const cleanBase64 = base64Image.split(',')[1] || base64Image;

  const tools: any[] = [];
  if (modelName === 'gemini-3-pro-preview' && location && (userPrompt.toLowerCase().includes("where") || userPrompt.toLowerCase().includes("location"))) {
    // Only Pro supports tools reliably in this context
    tools.push({ googleMaps: {} });
  }

  const toolConfig = tools.length > 0 && location ? {
    retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } }
  } : undefined;

  const promptText = `Role: Vision Assistant.
User Audio: "${userPrompt}"
Context: You are the user's eyes.
Instructions:
1. **Greetings/General**: If user says "Hello", describe **WHERE** objects are relative to them.
2. **Identification**: Be specific.
3. **Guidance**: If the user asks what to do, give direction.

Keep it conversational but SPATIALLY ACCURATE.`;

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
        maxOutputTokens: 500,
      }
    });
    
    if (!response.text) throw new Error("Empty response");
    return cleanTextForSpeech(response.text);

  } catch (error: any) {
    if (error.toString().includes("quota")) return "Quota exceeded. Please try again.";
    return "I couldn't analyze that clearly.";
  }
};