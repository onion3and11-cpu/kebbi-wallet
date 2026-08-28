import { GoogleGenAI } from '@google/genai';

export interface RoflowRequest {
  text?: string;
  session_id?: string;
  image_base64?: string;
}

export interface RoflowResponse {
  status: number;
  reply: string;
  route: string;
  session_id: string;
}

/**
 * 徹底清理文字中的 Markdown 標點、HTML 標籤、程式碼區塊等不適合 TTS 唸出的字元
 */
export function cleanTextForTts(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, '') // 移除 Code block
    .replace(/<[^>]*>/g, '') // 移除 HTML 標籤
    .replace(/\*\*(.*?)\*\*/g, '$1') // 移除粗體標記 **
    .replace(/\*(.*?)\*/g, '$1') // 移除斜體標記 *
    .replace(/__(.*?)__/g, '$1') // 移除下劃線
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#+\s+/gm, '') // 移除 Markdown 標題符號 #
    .replace(/^[*-]\s+/gm, '') // 移除清單符號
    .replace(/^\d+\.\s+/gm, '') // 移除數字清單字首
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 移除超連結網址僅留文字
    .replace(/[`~]/g, '') // 移除反引號與波浪號
    .replace(/[\r\n]+/g, ' ') // 換行轉換成空格以利 TTS 連貫朗讀
    .replace(/\s+/g, ' ') // 多重空格轉單一空格
    .trim();
}

const SYSTEM_INSTRUCTION = `你是女媧凱比 (NUWA Kebbi) 智慧機器人助手，負責協助使用者點餐、查詢點餐與錢包功能、解說照片內容，並進行親切自然的人機互動。
請使用溫和、親切、繁體中文回答，內容必須簡明扼要、適合機器人 TTS 語音朗讀。
切記：絕對不要使用 Markdown 語法（如星號 **粗體**、井號標題 #、程式碼區塊 \`\`\` 等），也不要使用 HTML 標籤。`;

/**
 * 共用核心 Gemini AI 呼叫邏輯 (Web UI 與 /api/roflow 均呼叫此函式)
 */
export async function processAiChat(input: RoflowRequest): Promise<{ reply: string; route: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server');
  }

  const ai = new GoogleGenAI({ apiKey });

  const contents: any[] = [];

  // 1. 多模態圖片處理 (支援 raw base64 與 data URL 格式)
  if (input.image_base64 && typeof input.image_base64 === 'string') {
    let cleanBase64 = input.image_base64.trim();
    let mimeType = 'image/jpeg';

    const dataUrlMatch = cleanBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/s);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      cleanBase64 = dataUrlMatch[2].replace(/\s/g, '');
    } else {
      cleanBase64 = cleanBase64.replace(/\s/g, '');
    }

    if (cleanBase64.length > 0) {
      contents.push({
        inlineData: {
          mimeType,
          data: cleanBase64,
        },
      });
    }
  }

  // 2. 文字輸入處理
  const userText = input.text && typeof input.text === 'string' ? input.text.trim() : '';
  const promptText = userText || (contents.length > 0 ? '請看看這張照片並簡短描述說明' : '你好');
  contents.push(promptText);

  // 3. 設定 15 秒 Timeout
  const timeoutMs = 15000;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Gemini API 請求逾時 (Timeout)')), timeoutMs);
  });

  const apiCallPromise = ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7,
      maxOutputTokens: 500,
    },
  });

  const response = await Promise.race([apiCallPromise, timeoutPromise]);
  const rawReply = response.text || '好的，請問還有什麼我可以幫您的嗎？';
  const cleanReply = cleanTextForTts(rawReply);

  // 4. 意圖路由歸一化 (簡單固定的 route 字串)
  let route = 'default';
  const lowerText = promptText.toLowerCase();
  if (lowerText.includes('點餐') || lowerText.includes('菜單') || lowerText.includes('訂單') || lowerText.includes('付款')) {
    route = 'order';
  } else if (lowerText.includes('餘額') || lowerText.includes('錢包') || lowerText.includes('儲值')) {
    route = 'wallet';
  }

  return {
    reply: cleanReply || '好的，請說。',
    route,
  };
}
