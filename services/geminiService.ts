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
 * 
 * ROUTING STRATEGY:
 * - Flash (2.5): Fast conversation, instant decisions, simple recognition
 * - Gemini 3 (Pro): Document scanning, text reading, complex analysis, deep reasoning
 */
export const selectBestModelForQuery = async (query: string): Promise<'gemini-3-pro-preview' | 'gemini-2.5-flash'> => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{
          text: `Task: Intelligent AI Model Router for Vision Assistant.
Analyze the user's query and determine the optimal AI model for the task.

Input Query: "${query}"

Output: Either "GEMINI3" or "FLASH" (exactly one word, nothing else).

Routing Rules:
COMPLEX TASKS -> USE GEMINI3 (for deep analysis and accuracy):
- Reading text, handwriting, documents, signs, labels, books
- Scanning documents, receipts, papers, menus
- OCR and text extraction tasks
- Detailed scene analysis with multiple objects
- Complex reasoning, comparisons, or explanations
- Navigation planning with multiple steps
- Mathematical problems or calculations
- Code analysis or technical explanations
- Historical or contextual information
- Creative writing or detailed storytelling
- Translation or multilingual content
- Medical or legal document reading
- Đọc văn bản, tài liệu, biển báo (Vietnamese reading tasks)

SIMPLE TASKS -> USE FLASH (for speed and quick responses):
- Simple object identification ("What is this?", "Cái gì đây?")
- Color identification ("What color is this?", "Màu gì?")
- Brief factual questions
- Quick navigation decisions ("Should I turn left?", "Rẽ trái không?")
- Simple yes/no questions
- Basic counting or quantity questions
- Immediate obstacle detection ("Is path clear?", "Đường có thông không?")
- Quick orientation questions ("Where am I facing?")
- Simple greetings or casual conversation

Examples:
"Read this sign" -> GEMINI3
"Đọc biển báo này" -> GEMINI3
"What color is that car?" -> FLASH
"Màu xe là gì?" -> FLASH
"Help me navigate to the nearest exit" -> GEMINI3
"Scan this document" -> GEMINI3
"Is the path clear?" -> FLASH
"Explain how this machine works" -> GEMINI3
"What's in front of me?" -> FLASH
"Có gì phía trước?" -> FLASH`
        }]
      },
      config: {
        temperature: 0.1,
        maxOutputTokens: 10,
      }
    });

    const decision = response.text?.trim().toUpperCase();

    // Enhanced validation and fallback logic
    if (decision?.includes("GEMINI3") || decision?.includes("PRO")) {
      return 'gemini-3-pro-preview';
    } else if (decision?.includes("FLASH")) {
      return 'gemini-2.5-flash';
    } else {
      // Fallback: analyze query complexity directly
      return analyzeQueryComplexity(query);
    }
  } catch (e) {
    console.error("Model selection error:", e);
    // Enhanced fallback: analyze query complexity directly
    return analyzeQueryComplexity(query);
  }
};

/**
 * Fallback complexity analyzer when API routing fails
 */
const analyzeQueryComplexity = (query: string): 'gemini-3-pro-preview' | 'gemini-2.5-flash' => {
  const lowerQuery = query.toLowerCase();

  // Complex task keywords (English + Vietnamese)
  const complexKeywords = [
    // English
    'read', 'scan', 'document', 'text', 'explain', 'analyze',
    'compare', 'navigate to', 'plan', 'calculate', 'how does',
    'why is', 'what is the meaning', 'describe in detail',
    'write', 'create', 'story', 'history', 'technical',
    'translate', 'menu', 'receipt', 'paper', 'book', 'sign',
    'label', 'instructions', 'directions', 'guide me',
    // Vietnamese
    'đọc', 'quét', 'tài liệu', 'văn bản', 'giải thích', 'phân tích',
    'so sánh', 'điều hướng', 'lên kế hoạch', 'tính toán',
    'tại sao', 'ý nghĩa', 'mô tả chi tiết', 'viết', 'tạo',
    'dịch', 'thực đơn', 'hóa đơn', 'giấy tờ', 'sách', 'biển báo',
    'nhãn', 'hướng dẫn', 'chỉ đường'
  ];

  const hasComplexKeyword = complexKeywords.some(keyword =>
    lowerQuery.includes(keyword)
  );

  // Also check for document-related patterns
  const documentPatterns = /read|scan|document|text|sign|label|menu|book|paper|đọc|quét|tài liệu|biển|sách/i;
  const hasDocumentPattern = documentPatterns.test(lowerQuery);

  return (hasComplexKeyword || hasDocumentPattern) ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
};

/**
 * Enhanced Smart Assistant Mode (Hybrid)
 * Analyzes image using the specific model passed in with context-aware prompts.
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
    // Only Gemini 3 supports tools reliably in this context
    tools.push({ googleMaps: {} });
  }

  const toolConfig = tools.length > 0 && location ? {
    retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } }
  } : undefined;

  // Enhanced context-aware prompt system - CONCISE for navigation
  const getEnhancedPrompt = (prompt: string): string => {
    const lowerPrompt = prompt.toLowerCase();

    // Navigation-specific prompts
    if (lowerPrompt.includes('navigate') || lowerPrompt.includes('direction') || lowerPrompt.includes('where') || lowerPrompt.includes('how to') || lowerPrompt.includes('đi') || lowerPrompt.includes('đâu')) {
      return `You are a concise navigation assistant for a blind person.
User asked: "${userPrompt}"

RULES:
- Maximum 2-3 short sentences
- Focus ONLY on: obstacles ahead, safe path, immediate actions
- Use clock directions (e.g., "obstacle at 2 o'clock")
- Start with most urgent info first
- No lengthy descriptions

Example good response: "Path clear ahead. Step forward 3 meters. Slight turn right at the wall."`;
    }

    // Reading/Text analysis prompts
    if (lowerPrompt.includes('read') || lowerPrompt.includes('text') || lowerPrompt.includes('document') || lowerPrompt.includes('sign') || lowerPrompt.includes('đọc')) {
      return `You are a text reader for a blind person.
User asked: "${userPrompt}"

RULES:
- Read the text exactly as written
- Keep it brief - main content only
- If it's a sign, state what type first
- Maximum 4 sentences`;
    }

    // Object identification prompts
    if (lowerPrompt.includes('what is') || lowerPrompt.includes('identify') || lowerPrompt.includes('object') || lowerPrompt.includes('cái gì') || lowerPrompt.includes('là gì')) {
      return `You are identifying objects for a blind person.
User asked: "${userPrompt}"

RULES:
- Name the object simply
- State its position (left/right/ahead, distance)
- Mention if it's a hazard
- Maximum 2 sentences

Example: "A black chair, 2 meters ahead on your left. Not blocking your path."`;
    }

    // Safety and obstacle prompts
    if (lowerPrompt.includes('danger') || lowerPrompt.includes('safe') || lowerPrompt.includes('obstacle') || lowerPrompt.includes('hazard') || lowerPrompt.includes('nguy')) {
      return `You are a safety assistant for a blind person. BE URGENT.
User asked: "${userPrompt}"

RULES:
- State danger immediately if any
- Give clear action: "Stop", "Turn left", "Step over"
- If safe, say "Path clear, continue straight"
- Maximum 2 sentences`;
    }

    // Default general assistant prompt - CONCISE
    return `You are a vision assistant for a blind person.
User asked: "${userPrompt}"

CRITICAL RULES:
- Maximum 3 short sentences
- Focus on actionable information
- State obstacles and safe paths
- Use simple directional language (left, right, ahead)
- No unnecessary details

Be their eyes, not a tour guide.`;
  };

  const promptText = getEnhancedPrompt(userPrompt);

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
        maxOutputTokens: 1500,
      }
    });

    if (!response.text) throw new Error("Empty response");
    return cleanTextForSpeech(response.text);

  } catch (error: any) {
    if (error.toString().includes("quota")) return "Quota exceeded. Please try again.";
    console.error("Smart Assistant Error:", error);
    return "I couldn't analyze that clearly.";
  }
};

/**
 * CONTINUOUS NAVIGATION MODE - Similar to blind-nav-android
 * Analyzes camera frame and provides short navigation guidance
 * Uses streaming for faster first response
 */
export const analyzeForNavigation = async (base64Image: string): Promise<string> => {
  try {
    const ai = getAI();
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    // Use streaming like Android app for faster response
    // CHANGED: gemini-1.5-flash (deprecated) -> gemini-2.5-flash
    const stream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          {
            text: `You are guiding a blind person. Look at this image.

DESCRIBE what you see and give walking directions in 2-3 SHORT sentences.

Examples:
- "Table ahead, 2 meters. Go right."
- "Clear hallway. Door on right."
- "Stop! Person on left."
- "Chair blocking path. Step right."

Give directions NOW:` }
        ]
      },
      config: {
        temperature: 0.3,
        maxOutputTokens: 150,
      }
    });

    // Collect stream response
    let fullResponse = "";
    for await (const chunk of stream) {
      if (chunk.text) {
        fullResponse += chunk.text;
      }
    }

    if (!fullResponse) return "Cannot see clearly.";
    return cleanTextForSpeech(fullResponse);

  } catch (error: any) {
    console.error("Navigation analyze error:", error);
    return "Unable to analyze.";
  }
};