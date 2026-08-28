import { Router, Request, Response } from 'express';
import { MockBankService } from '../services/MockBankService';
import { WalletService } from '../services/WalletService';
import { OrderService } from '../services/OrderService';
import { processAiChat } from '../services/GeminiService';
import { db } from '../db/database';
import { generateSecureToken, verifyPasswordSync } from '../utils/crypto';

const router = Router();

/**
 * Middleware: Verify X-Roflow-Key against ROFLOW_TOKEN for robot APIs
 */
function verifyRoflowAuth(req: Request, res: Response, next: Function) {
  const roflowToken = process.env.ROFLOW_TOKEN;
  const clientKey = (req.headers['x-roflow-key'] as string) || '';

  if (!roflowToken || !clientKey || clientKey.trim() !== roflowToken.trim()) {
    return res.status(401).json({
      success: false,
      data: null,
      error: '身分驗證失敗：無效或未提供 X-Roflow-Key 金鑰',
      message: '身分驗證失敗：無效或未提供 X-Roflow-Key 金鑰',
      status: 'UNAUTHORIZED',
    });
  }
  next();
}

/**
 * Auth Middleware: Get authenticated user id from session or fallback
 */
function getAuthUserId(req: Request, requestedUserId?: number): number {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (token) {
    const session = db.getSession(token);
    if (session) {
      return session.user_id;
    }
  }

  return requestedUserId || 1;
}

/**
 * Health Check API
 * GET /api/v1/health & GET /health
 */
router.get('/health', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  return res.json({ status: 'ok' });
});

/**
 * 0.1 GET /api/v1/auth/session
 */
router.get('/auth/session', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const userId = getAuthUserId(req, 1);
    const token = generateSecureToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.createSession(userId, token, expiresAt);

    const user = db.getUserById(userId);
    return res.json({
      success: true,
      data: {
        token,
        user_id: userId,
        phone: user?.phone || '',
        expires_at: expiresAt,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 0.2 POST /api/v1/auth/login
 */
router.post('/auth/login', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { phone, password } = req.body || {};
    const user = db.getUserByPhone(String(phone || '').trim());
    if (!user) {
      return res.status(404).json({ success: false, error: '找不到使用者帳號' });
    }

    const isValid = verifyPasswordSync(String(password || '').trim(), user.password_hash);
    if (!isValid) {
      return res.status(400).json({ success: false, error: '密碼不正確' });
    }

    const token = generateSecureToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.createSession(user.id, token, expiresAt);

    return res.json({
      success: true,
      data: {
        token,
        user_id: user.id,
        phone: user.phone,
        expires_at: expiresAt,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 1. POST /api/v1/bank/link
 * 綁定 / 線上開立模擬銀行帳戶
 */
router.post('/bank/link', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { user_id, account_number, bank_password, bank_code } = req.body || {};
    const userId = getAuthUserId(req, Number(user_id || 1));

    if (!account_number || !bank_password) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請輸入銀行帳號與密碼',
        message: '請輸入銀行帳號與密碼',
      });
    }

    const result = await MockBankService.linkOrRegisterBank(
      userId,
      String(account_number).trim(),
      String(bank_password).trim(),
      bank_code || '822'
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        data: null,
        error: result.message,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      data: result.bankAccount,
      error: null,
      message: result.message,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '銀行綁定服務異常',
      message: err.message || '銀行綁定服務異常',
    });
  }
});

/**
 * 1.5 POST /api/v1/bank/deposit
 * 存入資金至綁定之模擬銀行帳戶
 */
router.post('/bank/deposit', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { user_id, amount } = req.body || {};
    const userId = getAuthUserId(req, Number(user_id || 1));
    const numAmount = Number(amount);

    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請輸入有效的存款金額',
        message: '請輸入有效的存款金額',
      });
    }

    const result = await MockBankService.depositByUserId(userId, numAmount);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        data: null,
        error: result.message,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      data: result,
      error: null,
      message: result.message,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '存款操作失敗',
      message: err.message || '存款操作失敗',
    });
  }
});

/**
 * 2. POST /api/v1/wallet/recharge
 * 手動電子錢包加值 (原子操作)
 */
router.post('/wallet/recharge', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { user_id, payment_pin, pin, amount } = req.body || {};
    const userId = getAuthUserId(req, Number(user_id || 1));
    const numAmount = Number(amount);
    const pinStr = paymentPinToString(payment_pin ?? pin);

    if (!pinStr) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請輸入 4 位數支付密碼',
        message: '請輸入 4 位數支付密碼',
      });
    }

    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請輸入有效的加值金額',
        message: '請輸入有效的加值金額',
      });
    }

    const result = await WalletService.rechargeWallet(userId, pinStr, numAmount);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        data: null,
        error: result.message,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      data: {
        new_balance: result.newBalance,
        recharge_amount: numAmount,
      },
      error: null,
      message: result.message,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '加值失敗',
      message: err.message || '加值失敗',
    });
  }
});

/**
 * 2.5 POST /api/v1/wallet/transfer
 * 好友 / 手機號轉帳 (原子操作)
 */
router.post('/wallet/transfer', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { user_id, recipient_phone, payment_pin, pin, amount } = req.body || {};
    const userId = getAuthUserId(req, Number(user_id || 1));
    const numAmount = Number(amount);
    const pinStr = paymentPinToString(payment_pin ?? pin);

    if (!recipient_phone) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請輸入接收者的手機號碼',
        message: '請輸入接收者的手機號碼',
      });
    }

    if (!pinStr) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請輸入 4 位數支付密碼',
        message: '請輸入 4 位數支付密碼',
      });
    }

    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請輸入有效的轉帳金額',
        message: '請輸入有效的轉帳金額',
      });
    }

    const result = await WalletService.transferMoney(
      userId,
      String(recipient_phone).trim(),
      pinStr,
      numAmount
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        data: null,
        error: result.message,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      data: {
        new_balance: result.newBalance,
        transferred_amount: numAmount,
      },
      error: null,
      message: result.message,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '轉帳失敗',
      message: err.message || '轉帳失敗',
    });
  }
});

/**
 * 內部通用建立訂單處理函式
 */
async function processCreateOrder(req: Request, res: Response) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const body = req.body || {};
    const robotHeader = (req.headers['x-robot-id'] as string) || '';
    const robotId = body.robot_id || body.robotId || body.robot || robotHeader || 'KEBBI_ROBOT_001';

    const rawAmount = body.total_amount ?? body.amount ?? body.totalPrice ?? body.price ?? body.total;
    const numAmount = Number(rawAmount);

    if (!rawAmount || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '點餐總金額 (total_amount) 必須大於 $0',
        message: '點餐總金額 (total_amount) 必須大於 $0',
      });
    }

    let parsedItems = body.items;
    if (typeof parsedItems === 'string') {
      try {
        parsedItems = JSON.parse(parsedItems);
      } catch (e) {
        parsedItems = [{ name: '凱比特調餐點', quantity: 1, price: numAmount }];
      }
    }

    const orderResult = await OrderService.createOrder(robotId, numAmount, parsedItems);

    const host = req.get('host') || (req.headers.host as string) || '';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const qrImageUrl = host
      ? `${protocol}://${host}/api/v1/robot/qr-image/${orderResult.order_id}.png`
      : `/api/v1/robot/qr-image/${orderResult.order_id}.png`;

    return res.status(201).json({
      success: true,
      data: {
        order_id: orderResult.order_id,
        qr_code_token: orderResult.qr_code_token,
        qr_code_image_base64: orderResult.qr_code_image_base64,
        status: 'PENDING',
        total_amount: orderResult.total_amount,
        robot_id: robotId,
        qr_code_url: qrImageUrl,
        created_at: orderResult.created_at,
      },
      error: null,
      // Root-level fields for compatibility
      order_id: orderResult.order_id,
      qr_code_image_base64: orderResult.qr_code_image_base64,
      status: 'PENDING',
      total_amount: orderResult.total_amount,
      message: '訂單建立成功，請展示 QR Code 供消費者掃碼支付',
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '訂單建立失敗',
      message: err.message || '訂單建立失敗',
    });
  }
}

/**
 * 3. POST /api/v1/robot/orders
 * 外部女媧凱比點餐建立訂單 (需 X-Roflow-Key 驗證)
 */
router.post('/robot/orders', verifyRoflowAuth, processCreateOrder);

/**
 * 3.1 POST /api/v1/web/orders
 * 網頁端專用點餐模擬建單
 */
router.post('/web/orders', processCreateOrder);

/**
 * 3.5 GET /api/v1/robot/qr-image/:order_id
 * 提供女媧凱比 Roflow「媒體與工具」直接載入的真實 PNG 圖片網址
 * 必須檢查訂單是否存在！不存在則回傳 404
 */
router.get('/robot/qr-image/:order_id', async (req: Request, res: Response) => {
  try {
    const rawOrderId = req.params.order_id.replace(/\.png$/, '');
    const qrBuffer = await OrderService.getQrPngBuffer(rawOrderId);

    if (!qrBuffer) {
      return res.status(404).send('Order not found');
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(Buffer.from(qrBuffer));
  } catch (err: any) {
    return res.status(500).send('Error generating QR image');
  }
});

/**
 * 4. GET & POST /api/v1/robot/orders/status
 * 外部凱比 Roflow 輪詢訂單狀態 (需 X-Roflow-Key 驗證)
 */
const handleOrderStatus = async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const orderId =
      req.params.order_id ||
      (req.query.order_id as string) ||
      (req.query.orderId as string) ||
      (req.query.id as string) ||
      req.body?.order_id ||
      req.body?.orderId ||
      req.body?.id;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '缺少 order_id 參數 (可用 ?order_id=xxx 或 /status/:order_id)',
        message: '缺少 order_id 參數 (可用 ?order_id=xxx 或 /status/:order_id)',
      });
    }

    const order = await OrderService.getOrderStatus(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        data: null,
        error: `找不到訂單 ID: ${orderId}`,
        message: `找不到訂單 ID: ${orderId}`,
      });
    }

    const uppercaseStatus = (order.status || 'PENDING').toUpperCase();

    return res.json({
      success: true,
      data: {
        order_id: order.id,
        total_amount: order.total_amount,
        status: uppercaseStatus,
        robot_id: order.robot_id,
        qr_code_token: order.qr_code_token,
        created_at: order.created_at,
        paid_at: order.paid_at || null,
        is_paid: uppercaseStatus === 'PAID',
        is_pending: uppercaseStatus === 'PENDING',
      },
      error: null,
      // Root-level fields
      status: uppercaseStatus,
      order_id: order.id,
      total_amount: order.total_amount,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '查詢訂單狀態失敗',
      message: err.message || '查詢訂單狀態失敗',
    });
  }
};

router.get('/robot/orders/status/:order_id', verifyRoflowAuth, handleOrderStatus);
router.get('/robot/orders/status', verifyRoflowAuth, handleOrderStatus);
router.post('/robot/orders/status', verifyRoflowAuth, handleOrderStatus);

/**
 * 4.1 網頁端專用查詢訂單狀態 (無須 X-Roflow-Key)
 */
router.get('/web/orders/status/:order_id', handleOrderStatus);
router.get('/web/orders/status', handleOrderStatus);

/**
 * 4.5 GET /api/v1/robot/orders/latest
 * 取得最新一筆點餐訂單狀態 (需 X-Roflow-Key 驗證)
 */
router.get('/robot/orders/latest', verifyRoflowAuth, async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const robotId = (req.query.robot_id as string) || (req.headers['x-robot-id'] as string) || 'KEBBI_ROBOT_001';
    const order = await OrderService.getLatestOrderByRobotId(robotId);

    if (!order) {
      return res.status(404).json({
        success: false,
        data: null,
        error: '目前尚無任何訂單',
        message: '目前尚無任何訂單',
      });
    }

    const uppercaseStatus = (order.status || 'PENDING').toUpperCase();
    return res.json({
      success: true,
      data: {
        order_id: order.id,
        total_amount: order.total_amount,
        status: uppercaseStatus,
        robot_id: order.robot_id,
        qr_code_token: order.qr_code_token,
        created_at: order.created_at,
        paid_at: order.paid_at,
        is_paid: uppercaseStatus === 'PAID',
        is_pending: uppercaseStatus === 'PENDING',
      },
      error: null,
      status: uppercaseStatus,
      order_id: order.id,
      total_amount: order.total_amount,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '查詢最新訂單失敗',
      message: err.message || '查詢最新訂單失敗',
    });
  }
});

/**
 * 5. POST /api/v1/wallet/pay & POST /api/v1/payment/pay
 * 核心支付扣款與自動加值 API (原子操作)
 */
const handleWalletPay = async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { user_id, qr_code_token, pin, payment_pin } = req.body || {};
    const userId = getAuthUserId(req, Number(user_id || 1));
    const token = typeof qr_code_token === 'string' ? qr_code_token.trim() : '';
    const pinStr = paymentPinToString(pin ?? payment_pin);

    if (!token) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請提供有效的 qr_code_token',
        message: '請提供有效的 qr_code_token',
      });
    }

    if (!pinStr) {
      return res.status(400).json({
        success: false,
        data: null,
        error: '請輸入 4 位數支付密碼 pin',
        message: '請輸入 4 位數支付密碼 pin',
      });
    }

    const payResult = await WalletService.payOrder(userId, token, pinStr);

    if (!payResult.success) {
      return res.status(400).json({
        success: false,
        data: null,
        error: payResult.message,
        message: payResult.message,
        errorCode: payResult.errorCode,
        status: payResult.status,
      });
    }

    return res.json({
      success: true,
      data: {
        order_id: payResult.order_id,
        status: 'PAID',
        paid_amount: payResult.paid_amount,
        wallet_balance_before: payResult.wallet_balance_before,
        wallet_balance_after: payResult.wallet_balance_after,
        auto_recharged: payResult.auto_recharged,
        auto_recharge_amount: payResult.auto_recharge_amount,
        transaction_id: payResult.transaction_id,
      },
      error: null,
      message: payResult.message,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '付款處理異常',
      message: err.message || '付款處理異常',
    });
  }
};

router.post('/wallet/pay', handleWalletPay);
router.post('/payment/pay', handleWalletPay);

/**
 * 6. GET /api/v1/user/info/:user_id
 * 取得使用者錢包餘額與銀行綁定狀態
 */
router.get('/user/info/:user_id', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const reqUserId = Number(req.params.user_id || 1);
    const userId = getAuthUserId(req, reqUserId);
    const user = db.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: '找不到使用者',
        message: '找不到使用者',
      });
    }

    const bank = db.getBankByUserId(userId);

    return res.json({
      success: true,
      data: {
        id: user.id,
        phone: user.phone,
        balance: user.balance,
        is_auto_recharge_enabled: user.is_auto_recharge_enabled,
        linked_bank: bank
          ? {
              id: bank.id,
              bank_code: bank.bank_code,
              account_number: bank.account_number,
              mock_bank_balance: bank.mock_bank_balance,
              is_verified: bank.is_verified,
            }
          : null,
      },
      error: null,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '無法取得使用者資料',
      message: err.message || '無法取得使用者資料',
    });
  }
});

/**
 * 7. GET /api/v1/user/transactions/:user_id
 * 取得交易明細歷史
 */
router.get('/user/transactions/:user_id', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const reqUserId = Number(req.params.user_id || 1);
    const userId = getAuthUserId(req, reqUserId);
    const txns = db.getUserTransactions(userId);
    return res.json({ success: true, data: txns, error: null });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || '無法取得交易紀錄',
      message: err.message || '無法取得交易紀錄',
    });
  }
});

/**
 * 8. POST /api/v1/ai/chat
 * 受保護的 AI 對話端點 (需有效 Roflow Key 或授權)
 */
router.post('/ai/chat', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const roflowToken = process.env.ROFLOW_TOKEN;
    const clientKey = (req.headers['x-roflow-key'] as string) || '';
    const webAuth = req.headers['x-requested-with'] || req.headers['authorization'];

    if ((!roflowToken || clientKey !== roflowToken) && !webAuth) {
      return res.status(401).json({
        success: false,
        data: null,
        error: '未授權：請登入或提供有效的授權標頭',
        message: '未授權：請登入或提供有效的授權標頭',
      });
    }

    const { text, session_id, image_base64 } = req.body || {};
    const result = await processAiChat({
      text,
      session_id,
      image_base64,
    });
    return res.json({
      success: true,
      data: result,
      error: null,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      data: null,
      error: err.message || 'AI 處理異常',
      message: err.message || 'AI 處理異常',
    });
  }
});

function paymentPinToString(pin: string | number | undefined | null): string {
  if (pin === undefined || pin === null) return '';
  return String(pin).trim();
}

export default router;
