import { Request, Response } from 'express';
import { processAiChat } from '../services/GeminiService';

/**
 * NUWA Robotics Roflow HTTP API Endpoint
 * POST /api/roflow
 */
export async function handleRoflowRequest(req: Request, res: Response) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const startTime = Date.now();
  const sessionId = (req.body && typeof req.body.session_id === 'string' && req.body.session_id) || '';

  // 1. Authentication Check (X-Roflow-Key vs process.env.ROFLOW_TOKEN)
  const expectedToken = process.env.ROFLOW_TOKEN;
  const clientKey = (req.headers['x-roflow-key'] as string) || '';

  if (!expectedToken || !clientKey || clientKey !== expectedToken) {
    const latency = Date.now() - startTime;
    console.warn(`[Roflow API Log] id=${requestId} session=${sessionId} status=401 latency=${latency}ms success=false - Authentication failed`);
    return res.status(401).json({
      status: 0,
      reply: '身分驗證失敗：無效或缺失的 X-Roflow-Key 標頭',
      route: 'error',
      session_id: sessionId,
    });
  }

  // 2. Request Validation
  const text = req.body?.text;
  const imageBase64 = req.body?.image_base64;

  if (typeof text !== 'string' && !imageBase64) {
    const latency = Date.now() - startTime;
    console.warn(`[Roflow API Log] id=${requestId} session=${sessionId} status=400 latency=${latency}ms success=false - Invalid request body`);
    return res.status(400).json({
      status: 0,
      reply: '請求無效：text 必須為字串或必須提供 image_base64 圖片內容',
      route: 'error',
      session_id: sessionId,
    });
  }

  // 3. Process Gemini AI
  try {
    const aiResult = await processAiChat({
      text: typeof text === 'string' ? text : '',
      session_id: sessionId,
      image_base64: typeof imageBase64 === 'string' ? imageBase64 : undefined,
    });

    const latency = Date.now() - startTime;
    console.log(`[Roflow API Log] id=${requestId} session=${sessionId} status=200 latency=${latency}ms success=true route=${aiResult.route}`);

    return res.json({
      status: 1,
      reply: aiResult.reply,
      route: aiResult.route || 'default',
      session_id: sessionId,
    });
  } catch (err: any) {
    const latency = Date.now() - startTime;
    console.error(`[Roflow API Error] id=${requestId} session=${sessionId} status=500 latency=${latency}ms success=false error=${err?.message || 'Unknown error'}`);

    return res.json({
      status: 0,
      reply: '系統目前無法處理這個要求，請稍後再試。',
      route: 'error',
      session_id: sessionId,
    });
  }
}
