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

  // Context-aware prompt as a trusted friend
  const getContextPrompt = (query: string): string => {
    const q = query.toLowerCase();

    // Reading request
    if (q.includes('đọc') || q.includes('read') || q.includes('text') || q.includes('chữ')) {
      return `Bạn là người bạn đang giúp đọc cho người khiếm thị.
Yêu cầu: "${userPrompt}"
Hãy đọc rõ ràng nội dung trong ảnh. Nếu có nhiều văn bản, đọc phần quan trọng nhất trước.`;
    }

    // Navigation/direction request
    if (q.includes('đi') || q.includes('đường') || q.includes('where') || q.includes('direction') || q.includes('đâu')) {
      return `Bạn là người bạn đồng hành của người khiếm thị.
Câu hỏi: "${userPrompt}"
Mô tả môi trường xung quanh và hướng dẫn di chuyển an toàn. Dùng hướng đồng hồ và khoảng cách cụ thể.`;
    }

    // Object identification
    if (q.includes('cái gì') || q.includes('what') || q.includes('là gì') || q.includes('identify')) {
      return `Bạn là đôi mắt của người khiếm thị.
Câu hỏi: "${userPrompt}"
Mô tả vật thể một cách cụ thể: tên, màu sắc, kích thước, vị trí. Nói ngắn gọn như nói với bạn thân.`;
    }

    // Default - general assistance
    return `Bạn là người bạn thân đáng tin cậy của một người khiếm thị.
Câu hỏi của họ: "${userPrompt}"

Quy tắc trả lời:
- Nói tự nhiên như nói chuyện với bạn thân
- Mô tả cụ thể, hữu ích
- Tập trung vào thông tin quan trọng nhất
- Nếu liên quan đến di chuyển, dùng hướng đồng hồ (12h trước mặt, 3h bên phải, 9h bên trái)
- Tối đa 3-4 câu`;
  };

  const promptText = getContextPrompt(userPrompt);

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
            text: `Bạn là người bạn đồng hành đáng tin cậy của một người khiếm thị. Bạn đang đi bên cạnh họ và nhìn qua camera điện thoại của họ.

NHIỆM VỤ: Mô tả ngắn gọn những gì bạn thấy để giúp họ di chuyển an toàn.

QUY TẮC BẮT BUỘC:
1. Nói như đang nói chuyện với bạn thân - tự nhiên, ấm áp
2. Ưu tiên: NGUY HIỂM > Chướng ngại vật > Đường đi > Môi trường xung quanh
3. Sử dụng hướng đồng hồ: 12h (trước mặt), 3h (phải), 9h (trái), 6h (sau)
4. Khoảng cách: số bước chân hoặc mét
5. Mô tả mặt đất nếu có vấn đề: trơn, gồ ghề, có bậc, dốc
6. Tối đa 2 câu ngắn

VÍ DỤ TỐT:
- "Đường thông thoáng, cứ đi thẳng nhé."
- "Dừng lại! Có bậc thang đi xuống ngay trước mặt."
- "Có ghế ở hướng 2h, cách 3 bước. Đi vòng bên trái."
- "Cửa ra vào ở hướng 1h. Sàn trơn, đi cẩn thận."
- "Có người đang đi tới từ hướng 10h."
- "Tường ở ngay trước mặt, 2 bước nữa. Rẽ phải."

VÍ DỤ XẤU (KHÔNG LÀM):
- Mô tả quá dài dòng
- Nói "tôi thấy..." hoặc "trong hình..."
- Liệt kê tất cả mọi thứ trong ảnh
- Không đưa ra hướng dẫn cụ thể

Bây giờ, nhìn vào ảnh và hướng dẫn bạn của bạn:`
          }
        ]
      },
      config: {
        temperature: 0.5,
        maxOutputTokens: 150,
      }
    });

    const text = response.text?.trim();
    if (!text) return "";

    let finalSpeech = cleanTextForSpeech(text);

    // Safety Clipper: trim incomplete sentences
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

    return finalSpeech || "Đang quan sát...";

  } catch (error: any) {
    console.error("Navigation analyze error:", error);
    return "";
  }
};