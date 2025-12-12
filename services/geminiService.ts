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
 * ENHANCED DECISION ENGINE: Uses Flash to intelligently route the query.
 * Returns 'gemini-3-pro-preview' (Gemini 3) for complex tasks, 'gemini-2.5-flash' for simple ones.
 */
export const selectBestModelForQuery = async (query: string): Promise<'gemini-3-pro-preview' | 'gemini-2.5-flash'> => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{
          text: `Task: Intelligent AI Model Router.
Query: "${query}"
Output: "GEMINI3" (Complex/Reading/Reasoning) or "FLASH" (Simple/Vision/Speed).
Only output the word.`
        }]
      },
      config: { temperature: 0.1, maxOutputTokens: 10 }
    });

    const decision = response.text?.trim().toUpperCase();

    if (decision?.includes("GEMINI3") || decision?.includes("PRO")) {
      return 'gemini-3-pro-preview';
    } else if (decision?.includes("FLASH")) {
      return 'gemini-2.5-flash';
    } else {
      return analyzeQueryComplexity(query);
    }
  } catch (e) {
    console.error("Model selection error:", e);
    return analyzeQueryComplexity(query);
  }
};

/**
 * Fallback complexity analyzer
 */
const analyzeQueryComplexity = (query: string): 'gemini-3-pro-preview' | 'gemini-2.5-flash' => {
  const lowerQuery = query.toLowerCase();
  const complexKeywords = [
    'read', 'scan', 'document', 'text', 'explain', 'analyze',
    'compare', 'navigate to', 'plan', 'calculate', 'translate', 
    'menu', 'receipt', 'book', 'sign', 'đọc', 'quét', 'tài liệu', 
    'văn bản', 'giải thích', 'chi tiết'
  ];
  const isComplex = complexKeywords.some(k => lowerQuery.includes(k));
  return isComplex ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
};

/**
 * Enhanced Smart Assistant Mode
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
    tools.push({ googleMaps: {} });
  }

  const toolConfig = tools.length > 0 && location ? {
    retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } }
  } : undefined;

  const promptText = `You are a vision assistant for a blind person.
User Query: "${userPrompt}"
Rules: Be concise, actionable, and safe. Maximum 3 sentences.`;

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
        temperature: 0.5,
        maxOutputTokens: 1000,
      }
    });

    if (!response.text) throw new Error("Empty response");
    return cleanTextForSpeech(response.text);

  } catch (error: any) {
    if (error.toString().includes("quota")) return "Quota exceeded.";
    console.error("Smart Assistant Error:", error);
    return "I couldn't analyze that.";
  }
};

/**
 * CONTINUOUS NAVIGATION MODE
 * Optimized for complete sentences and reliability.
 */
export const analyzeForNavigation = async (base64Image: string): Promise<string> => {
  try {
    const ai = getAI();
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    // Use generateContent instead of stream to ensure we get a complete thought
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          {
            text: `You are a guide for the blind.
Analyze this image for immediate navigation.

OUTPUT RULES:
1. MAX 15 words.
2. MUST use complete sentences.
3. Prioritize: Hazards > Path Status > Objects.
4. Examples:
   - "Path clear."
   - "Stop. Wall ahead."
   - "Chair on the left."
   - "Stairs downward ahead."

Output guidance:` 
          }
        ]
      },
      config: {
        temperature: 0.4, // Slightly higher to avoid repetitive loops, but still focused
        maxOutputTokens: 256, // Increased to prevent mid-sentence cutoff
      }
    });

    const text = response.text?.trim();
    if (!text) return "";

    let finalSpeech = cleanTextForSpeech(text);

    // Safety Clipper: If the string doesn't end with punctuation, trim to the last punctuation
    // This handles cases where the model starts a new sentence but gets cut off
    if (!/[.!?]$/.test(finalSpeech)) {
        const lastPunctuation = Math.max(
            finalSpeech.lastIndexOf('.'),
            finalSpeech.lastIndexOf('!'),
            finalSpeech.lastIndexOf('?')
        );
        if (lastPunctuation > 0) {
            finalSpeech = finalSpeech.substring(0, lastPunctuation + 1);
        }
    }

    return finalSpeech || "Scanning...";

  } catch (error: any) {
    console.error("Navigation analyze error:", error);
    return "";
  }
};