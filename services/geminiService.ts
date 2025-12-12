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
    'compare', 'navigate', 'plan', 'calculate', 'translate',
    'menu', 'receipt', 'book', 'sign', 'detail', 'history'
  ];
  const isComplex = complexKeywords.some(k => lowerQuery.includes(k));
  return isComplex ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
};

/**
 * Enhanced Smart Assistant Mode with FAILOVER
 * Token limit increased to 2048 to ensure complete sentences.
 */
export const analyzeSmartAssistant = async (
  base64Image: string,
  userPrompt: string,
  modelName: 'gemini-3-pro-preview' | 'gemini-2.5-flash',
  location?: GeoLocation
): Promise<string> => {
  const ai = getAI();
  const cleanBase64 = base64Image.split(',')[1] || base64Image;

  // Context-aware prompt as a trusted friend (English)
  const getContextPrompt = (query: string): string => {
    const q = query.toLowerCase();

    // Reading request
    if (q.includes('read') || q.includes('text') || q.includes('sign') || q.includes('book')) {
      return `You are a reading assistant for a visually impaired user.
Request: "${userPrompt}"
Read the text clearly and naturally. If there is a lot of text, summarize the key information first.
CRITICAL: ALWAYS finish your last sentence. Do not cut off.`;
    }

    // Navigation/direction request
    if (q.includes('go') || q.includes('walk') || q.includes('way') || q.includes('direction') || q.includes('where')) {
      return `You are a navigation companion for a visually impaired user.
Question: "${userPrompt}"
Describe the environment and guide them safely. Use clock-face directions (e.g., "door at 12 o'clock") and specific distances.
CRITICAL: ALWAYS finish your last sentence.`;
    }

    // Object identification
    if (q.includes('what') || q.includes('identify') || q.includes('look') || q.includes('see')) {
      return `You are the eyes of a visually impaired user.
Question: "${userPrompt}"
Describe the object specifically: name, color, size, and position relative to the user. Be concise and natural.
CRITICAL: ALWAYS finish your last sentence.`;
    }

    // Default - general assistance
    return `You are a trusted friend and visual assistant for a visually impaired user.
User's Question: "${userPrompt}"

Response Rules:
- Speak naturally and warmly, like a friend.
- Be specific and helpful.
- Focus on the most important visual information.
- If relevant to movement, use clock-face directions (12 o'clock ahead, 3 o'clock right, 9 o'clock left).
- Maximum 3-4 sentences.
- CRITICAL: ALWAYS finish your last sentence. Do not cut off.`;
  };

  const promptText = getContextPrompt(userPrompt);

  // Helper to generate content with specific config
  const callAI = async (model: string, tools: any[], toolConfig: any) => {
    return await ai.models.generateContent({
      model: model,
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
        // Increased to 2048 to prevent truncated sentences for "Ask AI" queries
        maxOutputTokens: 2048, 
      }
    });
  };

  try {
    // 1. Configure Tools (only for Pro models)
    const tools: any[] = [];
    if (modelName === 'gemini-3-pro-preview' && location && (userPrompt.toLowerCase().includes("where") || userPrompt.toLowerCase().includes("location"))) {
      tools.push({ googleMaps: {} });
    }

    const toolConfig = tools.length > 0 && location ? {
      retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } }
    } : undefined;

    // 2. Primary Attempt
    const response = await callAI(modelName, tools, toolConfig);

    if (!response.text) throw new Error("Empty response");
    return cleanTextForSpeech(response.text);

  } catch (error: any) {
    console.warn(`⚠️ Primary model ${modelName} failed. Reason: ${error.message || error}`);

    // 3. Fallback to Flash (Simpler, more robust, no tools)
    try {
      console.log("🔄 Retrying with Gemini 2.5 Flash...");
      const fallbackResponse = await callAI('gemini-2.5-flash', [], undefined);
      
      if (!fallbackResponse.text) throw new Error("Fallback empty response");
      return cleanTextForSpeech(fallbackResponse.text);

    } catch (fallbackError: any) {
      console.error("❌ Fallback failed:", fallbackError);
      return "I'm having trouble connecting to my vision services right now.";
    }
  }
};

/**
 * CONTINUOUS NAVIGATION MODE
 * Designed as a trusted companion for a blind person.
 * Think: "What would I tell my blind friend walking beside me?"
 */
export const analyzeForNavigation = async (base64Image: string): Promise<string> => {
  try {
    const ai = getAI();
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          {
            text: `You are a trusted guide walking beside a blind person. You are seeing through their camera.

MISSION: Briefly describe what you see to help them navigate safely.

MANDATORY RULES:
1. Speak naturally, like a friend.
2. PRIORITY: HAZARDS > Obstacles > Clear Path > Surroundings.
3. Use clock directions: 12 o'clock (straight), 3 o'clock (right), 9 o'clock (left).
4. Distance: Use steps or meters.
5. Mention floor conditions if relevant (wet, uneven, steps).
6. ALWAYS finish your sentences.
7. MAX 2 short sentences.

GOOD EXAMPLES:
- "Path is clear, keep going straight."
- "Stop! Stairs going down right in front of you."
- "There is a chair at 2 o'clock, about 3 steps away. Bear left."
- "Doorway at 1 o'clock. Floor looks slippery."
- "Person approaching from 10 o'clock."
- "Wall directly ahead. Turn right."

BAD EXAMPLES:
- "I see a..."
- Long descriptions.
- No directional guidance.
- "The path ahead" (incomplete)

Now, look at the image and guide your friend:`
          }
        ]
      },
      config: {
        temperature: 0.5,
        // Increased from 150 to 512 to prevent truncated sentences in navigation
        maxOutputTokens: 512,
      }
    });

    const text = response.text?.trim();
    if (!text) return "";

    let finalSpeech = cleanTextForSpeech(text);

    // Safety Clipper: trim incomplete sentences if the model fails to obey instructions
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