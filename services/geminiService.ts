import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { GeoLocation } from "../types";

// Initialize the SDK
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Router Lane: Intent Classifier
 * MODEL: gemini-2.5-flash
 * PURPOSE: Decides if the user wants continuous navigation or specific analysis.
 */
export const classifyUserIntent = async (command: string): Promise<'NAVIGATION' | 'ANALYSIS'> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ 
            text: `Role: Intent Classifier for a Blind Assistant App.
Context: The user is visually impaired and giving a voice command.

Definitions:
1. NAVIGATION (Uses Fast Gemini Flash):
   - ANY request to move, walk, go somewhere, or find a path.
   - Finding exits, doors, or bathrooms *for the purpose of going there*.
   - Safety checks while moving.
   - Keywords: "Navigate", "Walk", "Go", "Guide", "Exit", "Path", "Door", "Safe", "Start".
   - Examples: "Navigate me out", "I want to leave", "Find the door", "Walk to kitchen", "Am I safe?", "Get me out of this room".

2. ANALYSIS (Uses Slow Gemini Pro):
   - Requests to read text, describe a static scene, or identify small objects.
   - Questions that require deep reasoning or detailed visual inspection without immediate movement.
   - Examples: "Read this label", "What color is this?", "Describe the room layout", "Is this a $10 bill?", "What is in front of me?".

Command: "${command}"

Task: Output exactly one word: NAVIGATION or ANALYSIS.` 
        }]
      },
      config: {
        temperature: 0.1,
        maxOutputTokens: 10,
      }
    });

    const text = response.text?.trim().toUpperCase();
    if (text?.includes('NAV')) return 'NAVIGATION';
    return 'ANALYSIS'; 
  } catch (error) {
    console.warn("Intent classification failed, falling back to keyword matching.", error);
    // Fallback logic
    const lower = command.toLowerCase();
    const navKeywords = ['nav', 'walk', 'go', 'guide', 'start', 'exit', 'door', 'path', 'move', 'leave'];
    
    if (navKeywords.some(k => lower.includes(k))) {
        return 'NAVIGATION';
    }
    return 'ANALYSIS';
  }
};

/**
 * Fast Lane: Navigation Mode
 * MODEL: gemini-2.5-flash
 * PURPOSE: Real-time safety and path guidance. Fast, short, actionable.
 */
export const analyzeNavigationFrame = async (base64Image: string): Promise<string> => {
  try {
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64
            }
          },
          {
            text: `Role: Guide for a blind user.
Input: Real-time camera view.
Task: Identify the main safe path and any immediate hazards.
Output: A clear, spoken sentence.
Constraints:
- No bullet points.
- Be direct and actionable.
- Length: 10-20 words.
Examples:
- "The path ahead is clear, you can walk forward confidently."
- "Stop immediately. There is a closed glass door directly in front of you."
- "There is a chair on your right, move slightly left to avoid it and continue straight."`
          }
        ]
      },
      config: {
        temperature: 0.3,
        // Increased to 150 to ensure sentences aren't cut off
        maxOutputTokens: 150, 
      }
    });

    return response.text || "Path clear.";
  } catch (error: any) {
    const errorMsg = error.toString();
    console.error("Nav Error:", errorMsg);
    
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("quota")) {
      return "QUOTA_EXCEEDED";
    }
    return "Navigation active.";
  }
};

/**
 * Smart Lane: Assistant Mode
 * MODEL: gemini-3-pro-preview
 * PURPOSE: Deep analysis, reading text, describing details. 
 * NOTE: High token limit (4096) to prevent cut-offs.
 */
export const analyzeSmartAssistant = async (
  base64Image: string, 
  userPrompt: string = "Describe this scene in detail.",
  location?: GeoLocation
): Promise<string> => {
  const cleanBase64 = base64Image.split(',')[1] || base64Image;

  // Tools configuration (Google Search/Maps) - Only used for location queries
  const tools: any[] = [];
  if (location && (userPrompt.toLowerCase().includes("where") || userPrompt.toLowerCase().includes("location"))) {
    tools.push({ googleMaps: {} });
  }

  const toolConfig = tools.length > 0 && location ? {
    retrievalConfig: {
      latLng: {
        latitude: location.latitude,
        longitude: location.longitude
      }
    }
  } : undefined;

  const promptText = `Role: Intelligent Vision Assistant for the visually impaired.
User Query: "${userPrompt}"
Instructions:
- Provide a helpful, natural language response.
- If there is text in the image, read it out clearly.
- If describing a scene, paint a picture with words (colors, objects, layout).
- Be thorough but prioritizing safety and key information.`;

  // Helper to call API
  const callModel = async (modelName: string, maxTokens: number) => {
    return await ai.models.generateContent({
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
        maxOutputTokens: maxTokens, 
        // Lower safety settings to ensure we get a description even for "sensitive" things like medicines or street signs
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        ]
      }
    });
  };

  try {
    // Attempt High-Intelligence Model (Gemini 3)
    console.log("Attempting Gemini 3...");
    // CRITICAL FIX: Increased tokens to 4096 to prevent MAX_TOKENS error with empty content
    const response = await callModel('gemini-3-pro-preview', 4096);
    
    if (!response.text) {
        console.warn("Gemini 3 returned empty text. Candidates:", response.candidates);
        throw new Error("Empty response from Gemini 3");
    }
    return response.text;

  } catch (error: any) {
    const errorMsg = error.toString();
    console.warn("Gemini 3 failed or returned empty, falling back to Flash.", errorMsg);

    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
      return "QUOTA_EXCEEDED";
    }

    // Fallback to Gemini 2.5 Flash only if Pro fails
    try {
      console.log("Attempting Gemini 2.5 Flash fallback...");
      const response = await callModel('gemini-2.5-flash', 1024);
      return response.text || "I can't see anything clearly right now.";
    } catch (fallbackError: any) {
      console.error("Fallback failed:", fallbackError);
      return "I am having trouble connecting to the vision service.";
    }
  }
};