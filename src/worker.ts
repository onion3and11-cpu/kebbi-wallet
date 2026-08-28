/**
 * Cloudflare Workers Entry Point for NUWA Kebbi Robot E-Wallet & Payment System
 * Fully compatible with Cloudflare D1 (SQLite) with atomic batch execution.
 */

import {
  toTWD,
  toCents,
  validateAmountTwd,
  computeAutoRecharge,
  AUTO_RECHARGE_UNIT_CENTS,
  ORDER_EXPIRATION_MS,
  PIN_MAX_FAILED_ATTEMPTS,
  PIN_LOCKOUT_MS,
} from './types';
import { verifyPassword, generateSecureToken } from './utils/crypto';
import { generateQrDataUrl, generateQrPngBuffer } from './utils/qr';

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[]; success: boolean; error?: string }>;
  run(): Promise<{ success: boolean; meta: any }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<any[]>;
  exec(query: string): Promise<any>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export interface Env {
  DB: D1Database;
  ROFLOW_TOKEN?: string;
  GEMINI_API_KEY?: string;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Robot-ID, X-Roflow-Key, X-Requested-With',
    },
  });
}

function corsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Robot-ID, X-Roflow-Key, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Session verification helper
 */
async function authenticateUser(request: Request, env: Env, requestedUserId?: number): Promise<{ userId: number } | null> {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (token) {
    const session: any = await env.DB.prepare(
      "SELECT user_id, expires_at FROM sessions WHERE token = ? AND datetime(expires_at) > datetime('now')"
    ).bind(token).first();

    if (session) {
      if (requestedUserId && requestedUserId !== session.user_id) {
        return null; // Cross-user unauthorized access attempt
      }
      return { userId: session.user_id };
    }
  }

  // Fallback for demo testing if no token is provided but user exists
  if (requestedUserId) {
    const user: any = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(requestedUserId).first();
    if (user) {
      return { userId: user.id };
    }
  }

  return { userId: 1 };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return corsPreflightResponse();
    }

    // Health check
    if (path === '/api/health' || path === '/api/v1/health' || path === '/health') {
      return jsonResponse({ status: 'ok' });
    }

    try {
      // =========================================================================
      // 1. AUTH API
      // =========================================================================
      if (path === '/api/v1/auth/session' && method === 'GET') {
        const auth = await authenticateUser(request, env, 1);
        if (!auth) return jsonResponse({ success: false, error: '未授權' }, 401);

        const token = generateSecureToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
          .bind(token, auth.userId, expiresAt)
          .run();

        const user: any = await env.DB.prepare('SELECT id, phone FROM users WHERE id = ?').bind(auth.userId).first();

        return jsonResponse({
          success: true,
          data: {
            token,
            user_id: auth.userId,
            phone: user?.phone || '',
            expires_at: expiresAt,
          },
        });
      }

      if (path === '/api/v1/auth/login' && method === 'POST') {
        const body: any = await request.json().catch(() => ({}));
        const phone = String(body.phone || '').trim();
        const password = String(body.password || '').trim();

        const user: any = await env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
        if (!user) return jsonResponse({ success: false, error: '找不到使用者帳號' }, 404);

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) return jsonResponse({ success: false, error: '密碼不正確' }, 400);

        const token = generateSecureToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
          .bind(token, user.id, expiresAt)
          .run();

        return jsonResponse({
          success: true,
          data: {
            token,
            user_id: user.id,
            phone: user.phone,
            expires_at: expiresAt,
          },
        });
      }

      // =========================================================================
      // 2. ORDER CREATION API (Robot / Web)
      // =========================================================================
      if ((path === '/api/v1/robot/orders' || path === '/api/v1/web/orders') && method === 'POST') {
        if (path === '/api/v1/robot/orders') {
          const clientKey = request.headers.get('x-roflow-key') || '';
          if (!env.ROFLOW_TOKEN || clientKey.trim() !== env.ROFLOW_TOKEN.trim()) {
            return jsonResponse({
              success: false,
              data: null,
              error: '身分驗證失敗：無效或未提供 X-Roflow-Key 金鑰',
              message: '身分驗證失敗：無效或未提供 X-Roflow-Key 金鑰',
              status: 'UNAUTHORIZED',
            }, 401);
          }
        }

        const body: any = await request.json().catch(() => ({}));
        const robotId = body.robot_id || body.robotId || request.headers.get('x-robot-id') || 'KEBBI_ROBOT_001';
        const rawAmount = body.total_amount ?? body.amount ?? body.totalPrice ?? body.price ?? body.total;

        const val = validateAmountTwd(rawAmount);
        if (!val.valid) {
          return jsonResponse({
            success: false,
            data: null,
            error: val.error || '點餐總金額 (total_amount) 必須大於 $0',
            message: val.error || '點餐總金額 (total_amount) 必須大於 $0',
          }, 400);
        }

        const orderId = crypto.randomUUID();
        const qrToken = `KEBBI_PAY_TOK_${orderId}`;
        const totalAmountCents = val.cents;
        const totalAmountTwd = toTWD(totalAmountCents);
        const expiresAt = new Date(Date.now() + ORDER_EXPIRATION_MS).toISOString();
        const qrCodeImageBase64 = await generateQrDataUrl(qrToken);

        let itemsJson: string | null = null;
        if (body.items) {
          itemsJson = typeof body.items === 'string' ? body.items : JSON.stringify(body.items);
        }

        await env.DB.prepare(`
          INSERT INTO orders (id, robot_id, total_amount_cents, status, qr_code_token, items_json, expires_at)
          VALUES (?, ?, ?, 'PENDING', ?, ?, ?)
        `).bind(orderId, robotId, totalAmountCents, qrToken, itemsJson, expiresAt).run();

        const host = url.host;
        const protocol = url.protocol;
        const qrImageUrl = `${protocol}//${host}/api/v1/robot/qr-image/${orderId}.png`;

        return jsonResponse({
          success: true,
          data: {
            order_id: orderId,
            qr_code_token: qrToken,
            qr_code_image_base64: qrCodeImageBase64,
            status: 'PENDING',
            total_amount: totalAmountTwd,
            robot_id: robotId,
            qr_code_url: qrImageUrl,
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          },
          error: null,
          order_id: orderId,
          qr_code_image_base64: qrCodeImageBase64,
          status: 'PENDING',
          total_amount: totalAmountTwd,
          message: '訂單建立成功，請展示 QR Code 供消費者掃碼支付',
        }, 201);
      }

      // =========================================================================
      // 3. QR PNG IMAGE (Pure Edge PNG binary output)
      // =========================================================================
      if (path.startsWith('/api/v1/robot/qr-image/')) {
        const rawOrderId = path.split('/qr-image/')[1].replace(/\.png$/, '');
        const order: any = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(rawOrderId).first();

        if (!order) {
          return new Response('Order not found', { status: 404 });
        }

        const pngBytes = await generateQrPngBuffer(order.qr_code_token);
        return new Response(pngBytes, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // =========================================================================
      // 4. ORDER STATUS QUERY (Robot / Web) - Read Only with Zero Side Effects
      // =========================================================================
      if (
        (path.startsWith('/api/v1/robot/orders/status') || path.startsWith('/api/v1/web/orders/status')) &&
        (method === 'GET' || method === 'POST')
      ) {
        if (path.startsWith('/api/v1/robot/orders/status')) {
          const clientKey = request.headers.get('x-roflow-key') || '';
          if (!env.ROFLOW_TOKEN || clientKey.trim() !== env.ROFLOW_TOKEN.trim()) {
            return jsonResponse({
              success: false,
              data: null,
              error: '身分驗證失敗：無效或未提供 X-Roflow-Key 金鑰',
              message: '身分驗證失敗：無效或未提供 X-Roflow-Key 金鑰',
              status: 'UNAUTHORIZED',
            }, 401);
          }
        }

        let orderId = path.split('/status/')[1] || '';
        if (!orderId) {
          orderId = url.searchParams.get('order_id') || url.searchParams.get('orderId') || url.searchParams.get('id') || '';
        }
        if (!orderId && method === 'POST') {
          const body: any = await request.json().catch(() => ({}));
          orderId = body.order_id || body.orderId || body.id || '';
        }

        if (!orderId) {
          return jsonResponse({ success: false, data: null, error: '缺少 order_id 參數' }, 400);
        }

        const order: any = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
        if (!order) {
          return jsonResponse({ success: false, data: null, error: `找不到訂單: ${orderId}` }, 404);
        }

        const uppercaseStatus = (order.status || 'PENDING').toUpperCase();
        return jsonResponse({
          success: true,
          data: {
            order_id: order.id,
            total_amount: toTWD(order.total_amount_cents),
            status: uppercaseStatus,
            robot_id: order.robot_id,
            qr_code_token: order.qr_code_token,
            created_at: order.created_at,
            paid_at: order.paid_at || null,
            expires_at: order.expires_at || null,
            is_paid: uppercaseStatus === 'PAID',
            is_pending: uppercaseStatus === 'PENDING',
          },
          error: null,
          status: uppercaseStatus,
          order_id: order.id,
          total_amount: toTWD(order.total_amount_cents),
        });
      }

      // =========================================================================
      // 5. ROBOT LATEST ORDER QUERY
      // =========================================================================
      if (path === '/api/v1/robot/orders/latest' && method === 'GET') {
        const clientKey = request.headers.get('x-roflow-key') || '';
        if (!env.ROFLOW_TOKEN || clientKey.trim() !== env.ROFLOW_TOKEN.trim()) {
          return jsonResponse({
            success: false,
            data: null,
            error: '身分驗證失敗：無效或未提供 X-Roflow-Key 金鑰',
            message: '身分驗證失敗：無效或未提供 X-Roflow-Key 金鑰',
            status: 'UNAUTHORIZED',
          }, 401);
        }

        const robotId = url.searchParams.get('robot_id') || request.headers.get('x-robot-id') || 'KEBBI_ROBOT_001';
        const order: any = await env.DB.prepare(
          'SELECT * FROM orders WHERE robot_id = ? ORDER BY created_at DESC LIMIT 1'
        ).bind(robotId).first();

        if (!order) {
          return jsonResponse({ success: false, data: null, error: '目前尚無任何訂單' }, 404);
        }

        const uppercaseStatus = (order.status || 'PENDING').toUpperCase();
        return jsonResponse({
          success: true,
          data: {
            order_id: order.id,
            total_amount: toTWD(order.total_amount_cents),
            status: uppercaseStatus,
            robot_id: order.robot_id,
            qr_code_token: order.qr_code_token,
            created_at: order.created_at,
            paid_at: order.paid_at || null,
            expires_at: order.expires_at || null,
            is_paid: uppercaseStatus === 'PAID',
            is_pending: uppercaseStatus === 'PENDING',
          },
          error: null,
          status: uppercaseStatus,
          order_id: order.id,
          total_amount: toTWD(order.total_amount_cents),
        });
      }

      // =========================================================================
      // 6. CORE ATOMIC PAYMENT API (D1 Batch + Concurrency Retry + Idempotency)
      // =========================================================================
      if ((path === '/api/v1/wallet/pay' || path === '/api/v1/payment/pay') && method === 'POST') {
        const body: any = await request.json().catch(() => ({}));
        const reqUserId = Number(body.user_id || 1);
        const auth = await authenticateUser(request, env, reqUserId);
        const userId = auth?.userId || reqUserId;

        const token = String(body.qr_code_token || '').trim();
        const pin = String(body.pin || body.payment_pin || '').trim();

        if (!token) return jsonResponse({ success: false, error: '缺少 qr_code_token', message: '缺少 qr_code_token' }, 400);
        if (!pin) return jsonResponse({ success: false, error: '請輸入支付密碼', message: '請輸入支付密碼' }, 400);

        // 1. Verify User and PIN with lock check
        const user: any = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
        if (!user) return jsonResponse({ success: false, error: '找不到使用者', message: '找不到使用者' }, 404);

        if (user.locked_until && new Date() < new Date(user.locked_until)) {
          return jsonResponse({
            success: false,
            status: 'PENDING',
            error: 'PIN 碼輸入錯誤次數過多，帳戶已暫時鎖定，請稍後再試',
            message: 'PIN 碼輸入錯誤次數過多，帳戶已暫時鎖定，請稍後再試',
          }, 400);
        }

        const isPinValid = await verifyPassword(pin, user.payment_pin_hash);
        if (!isPinValid) {
          const newFailedAttempts = (user.failed_pin_attempts || 0) + 1;
          let lockedUntil: string | null = null;
          if (newFailedAttempts >= PIN_MAX_FAILED_ATTEMPTS) {
            lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
          }
          await env.DB.prepare('UPDATE users SET failed_pin_attempts = ?, locked_until = ? WHERE id = ?')
            .bind(newFailedAttempts, lockedUntil, userId)
            .run();

          return jsonResponse({
            success: false,
            status: 'PENDING',
            error: '支付密碼不正確！',
            message: '支付密碼不正確！',
          }, 400);
        }

        // Reset failed PIN attempts on success
        await env.DB.prepare('UPDATE users SET failed_pin_attempts = 0, locked_until = NULL WHERE id = ?')
          .bind(userId)
          .run();

        // 2. Fetch Order
        const order: any = await env.DB.prepare('SELECT * FROM orders WHERE qr_code_token = ?').bind(token).first();
        if (!order) {
          return jsonResponse({ success: false, error: '找不到此 QR Code 訂單', message: '找不到此 QR Code 訂單' }, 404);
        }

        // 3. Check if already PAID (Idempotent replay) - even if expired
        if (order.status === 'PAID') {
          const existingPayTxn: any = await env.DB.prepare(
            "SELECT * FROM transactions WHERE order_id = ? AND type = 'PAYMENT' ORDER BY id DESC LIMIT 1"
          ).bind(order.id).first();

          const existingAutoTxn: any = await env.DB.prepare(
            "SELECT * FROM transactions WHERE order_id = ? AND type = 'AUTO_RECHARGE' ORDER BY id DESC LIMIT 1"
          ).bind(order.id).first();

          return jsonResponse({
            success: true,
            data: {
              order_id: order.id,
              status: 'PAID',
              paid_amount: toTWD(order.total_amount_cents),
              wallet_balance_before: toTWD(user.balance_cents),
              wallet_balance_after: toTWD(user.balance_cents),
              auto_recharged: Boolean(existingAutoTxn),
              auto_recharge_amount: existingAutoTxn ? toTWD(existingAutoTxn.amount_cents) : undefined,
              transaction_id: existingPayTxn?.id || 0,
            },
            message: '此訂單已完成付款 (重複提交回傳)',
          });
        }

        // 4. Check Expiration on PENDING orders
        if (order.expires_at && new Date() > new Date(order.expires_at)) {
          if (order.status === 'PENDING') {
            await env.DB.prepare("UPDATE orders SET status = 'EXPIRED' WHERE id = ?").bind(order.id).run();
          }
          return jsonResponse({
            success: false,
            order_id: order.id,
            status: 'EXPIRED',
            error: '此訂單已過期，無法進行支付',
            message: '此訂單已過期，無法進行支付',
          }, 400);
        }

        if (order.status !== 'PENDING') {
          return jsonResponse({
            success: false,
            order_id: order.id,
            status: order.status,
            error: `訂單狀態為 ${order.status}，無法付款`,
            message: `訂單狀態為 ${order.status}，無法付款`,
          }, 400);
        }

        // 5. Execute Atomic Payment with optimistic concurrency retry (up to 3 attempts)
        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          // Re-read current state
          const currentUser: any = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
          const currentOrder: any = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();

          if (!currentUser || !currentOrder) {
            return jsonResponse({ success: false, error: '讀取帳戶或訂單資料失敗' }, 500);
          }

          if (currentOrder.status === 'PAID') {
            const existingPayTxn: any = await env.DB.prepare(
              "SELECT * FROM transactions WHERE order_id = ? AND type = 'PAYMENT' ORDER BY id DESC LIMIT 1"
            ).bind(order.id).first();
            const existingAutoTxn: any = await env.DB.prepare(
              "SELECT * FROM transactions WHERE order_id = ? AND type = 'AUTO_RECHARGE' ORDER BY id DESC LIMIT 1"
            ).bind(order.id).first();

            return jsonResponse({
              success: true,
              data: {
                order_id: currentOrder.id,
                status: 'PAID',
                paid_amount: toTWD(currentOrder.total_amount_cents),
                wallet_balance_before: toTWD(currentUser.balance_cents),
                wallet_balance_after: toTWD(currentUser.balance_cents),
                auto_recharged: Boolean(existingAutoTxn),
                auto_recharge_amount: existingAutoTxn ? toTWD(existingAutoTxn.amount_cents) : undefined,
                transaction_id: existingPayTxn?.id || 0,
              },
              message: '此訂單已完成付款',
            });
          }

          const initialBalanceCents = currentUser.balance_cents;
          const orderAmountCents = currentOrder.total_amount_cents;
          let currentWalletCents = initialBalanceCents;
          let autoRecharged = false;
          let autoRechargeAmountCents = 0;

          const autoPlan = computeAutoRecharge(currentWalletCents, orderAmountCents);
          const statements: D1PreparedStatement[] = [];

          if (autoPlan.needed) {
            if (!currentUser.is_auto_recharge_enabled) {
              return jsonResponse({
                success: false,
                order_id: currentOrder.id,
                status: 'PENDING',
                error: '錢包餘額不足且自動加值已關閉',
                message: '錢包餘額不足且自動加值已關閉',
              }, 400);
            }

            const bank: any = await env.DB.prepare('SELECT * FROM mock_bank_accounts WHERE user_id = ?').bind(userId).first();
            if (!bank) {
              return jsonResponse({
                success: false,
                errorCode: 'INSUFFICIENT_BALANCE_AND_NO_BANK',
                order_id: currentOrder.id,
                status: 'PENDING',
                error: '錢包餘額不足且尚未綁定銀行帳戶',
                message: '錢包餘額不足且尚未綁定銀行帳戶',
              }, 400);
            }

            const topupCents = autoPlan.rechargeAmountCents;

            if (bank.mock_bank_balance_cents < topupCents) {
              return jsonResponse({
                success: false,
                order_id: currentOrder.id,
                status: 'PENDING',
                error: `銀行餘額不足 ($${toTWD(bank.mock_bank_balance_cents)})，無法自動加值 $${toTWD(topupCents)}`,
                message: `銀行餘額不足 ($${toTWD(bank.mock_bank_balance_cents)})，無法自動加值 $${toTWD(topupCents)}`,
              }, 400);
            }

            autoRecharged = true;
            autoRechargeAmountCents = topupCents;
            currentWalletCents += topupCents;

            // 1. Deduct from bank conditionally
            statements.push(
              env.DB.prepare(
                'UPDATE mock_bank_accounts SET mock_bank_balance_cents = mock_bank_balance_cents - ?, version = version + 1 WHERE id = ? AND mock_bank_balance_cents >= ?'
              ).bind(topupCents, bank.id, topupCents)
            );

            // 2. Insert auto-recharge transaction
            statements.push(
              env.DB.prepare(`
                INSERT INTO transactions (order_id, user_id, amount_cents, type, mock_bank_account_id, note)
                VALUES (?, ?, ?, 'AUTO_RECHARGE', ?, ?)
              `).bind(currentOrder.id, userId, topupCents, bank.id, `自動加值 $${toTWD(topupCents)}`)
            );
          }

          const finalWalletCents = currentWalletCents - orderAmountCents;
          if (finalWalletCents < 0) {
            return jsonResponse({ success: false, error: '錢包餘額不足' }, 400);
          }

          // 3. Update user wallet balance conditionally
          statements.push(
            env.DB.prepare(
              'UPDATE users SET balance_cents = ?, version = version + 1 WHERE id = ? AND version = ?'
            ).bind(finalWalletCents, userId, currentUser.version || 1)
          );

          // 4. Update order to PAID conditionally
          statements.push(
            env.DB.prepare(
              "UPDATE orders SET status = 'PAID', paid_at = datetime('now') WHERE id = ? AND status = 'PENDING'"
            ).bind(currentOrder.id)
          );

          // 5. Insert payment transaction
          statements.push(
            env.DB.prepare(`
              INSERT INTO transactions (order_id, user_id, amount_cents, type, note)
              VALUES (?, ?, ?, 'PAYMENT', ?)
            `).bind(currentOrder.id, userId, orderAmountCents, `訂單支付: ${currentOrder.id}`)
          );

          try {
            // Execute batch transaction in Cloudflare D1
            const batchResults = await env.DB.batch(statements);

            // Fetch newly created payment transaction ID
            const createdTxn: any = await env.DB.prepare(
              "SELECT id FROM transactions WHERE order_id = ? AND type = 'PAYMENT' ORDER BY id DESC LIMIT 1"
            ).bind(currentOrder.id).first();

            return jsonResponse({
              success: true,
              data: {
                order_id: currentOrder.id,
                status: 'PAID',
                paid_amount: toTWD(orderAmountCents),
                wallet_balance_before: toTWD(initialBalanceCents),
                wallet_balance_after: toTWD(finalWalletCents),
                auto_recharged: autoRecharged,
                auto_recharge_amount: autoRecharged ? toTWD(autoRechargeAmountCents) : undefined,
                transaction_id: createdTxn?.id || 0,
              },
              error: null,
              message: autoRecharged
                ? `支付成功！系統已從綁定銀行自動加值 $${toTWD(autoRechargeAmountCents)}，並完成扣款 $${toTWD(orderAmountCents)}`
                : `支付成功！成功自錢包扣款 $${toTWD(orderAmountCents)}`,
            });
          } catch (batchErr: any) {
            // If version/concurrency conflict, retry
            if (attempt < MAX_RETRIES) {
              continue;
            }
            return jsonResponse({
              success: false,
              order_id: currentOrder.id,
              status: 'PENDING',
              error: '扣款交易異常失敗: ' + (batchErr.message || String(batchErr)),
              message: '扣款交易異常失敗: ' + (batchErr.message || String(batchErr)),
            }, 500);
          }
        }
      }

      // =========================================================================
      // 7. MANUAL RECHARGE API (D1 Atomic Batch)
      // =========================================================================
      if (path === '/api/v1/wallet/recharge' && method === 'POST') {
        const body: any = await request.json().catch(() => ({}));
        const reqUserId = Number(body.user_id || 1);
        const auth = await authenticateUser(request, env, reqUserId);
        const userId = auth?.userId || reqUserId;

        const pin = String(body.pin || body.payment_pin || '').trim();
        const val = validateAmountTwd(body.amount);

        if (!pin) return jsonResponse({ success: false, error: '請輸入 4 位數支付密碼', message: '請輸入 4 位數支付密碼' }, 400);
        if (!val.valid) return jsonResponse({ success: false, error: val.error || '請輸入有效金額', message: val.error || '請輸入有效金額' }, 400);

        const amountCents = val.cents;
        const user: any = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
        if (!user) return jsonResponse({ success: false, error: '找不到使用者' }, 404);

        if (user.locked_until && new Date() < new Date(user.locked_until)) {
          return jsonResponse({ success: false, error: '帳戶已暫時鎖定，請稍後再試' }, 400);
        }

        const validPin = await verifyPassword(pin, user.payment_pin_hash);
        if (!validPin) {
          const newFailedAttempts = (user.failed_pin_attempts || 0) + 1;
          let lockedUntil: string | null = null;
          if (newFailedAttempts >= PIN_MAX_FAILED_ATTEMPTS) {
            lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
          }
          await env.DB.prepare('UPDATE users SET failed_pin_attempts = ?, locked_until = ? WHERE id = ?')
            .bind(newFailedAttempts, lockedUntil, userId)
            .run();
          return jsonResponse({ success: false, error: '支付密碼驗證失敗！', message: '支付密碼驗證失敗！' }, 400);
        }

        await env.DB.prepare('UPDATE users SET failed_pin_attempts = 0, locked_until = NULL WHERE id = ?').bind(userId).run();

        const bank: any = await env.DB.prepare('SELECT * FROM mock_bank_accounts WHERE user_id = ?').bind(userId).first();
        if (!bank) return jsonResponse({ success: false, error: '尚未綁定模擬銀行帳戶，無法進行加值' }, 400);

        if (bank.mock_bank_balance_cents < amountCents) {
          return jsonResponse({
            success: false,
            error: `銀行帳戶餘額不足 (剩餘 $${toTWD(bank.mock_bank_balance_cents)})，無法手動加值 $${toTWD(amountCents)}`,
          }, 400);
        }

        const newBankBal = bank.mock_bank_balance_cents - amountCents;
        const newWalletBal = user.balance_cents + amountCents;

        await env.DB.batch([
          env.DB.prepare('UPDATE mock_bank_accounts SET mock_bank_balance_cents = ?, version = version + 1 WHERE id = ?').bind(newBankBal, bank.id),
          env.DB.prepare('UPDATE users SET balance_cents = ?, version = version + 1 WHERE id = ?').bind(newWalletBal, userId),
          env.DB.prepare(`
            INSERT INTO transactions (user_id, amount_cents, type, mock_bank_account_id, note)
            VALUES (?, ?, 'MANUAL_RECHARGE', ?, ?)
          `).bind(userId, amountCents, bank.id, `手動加值 $${toTWD(amountCents)}`),
        ]);

        return jsonResponse({
          success: true,
          data: {
            new_balance: toTWD(newWalletBal),
            recharge_amount: toTWD(amountCents),
          },
          error: null,
          message: `手動加值 $${toTWD(amountCents)} 成功！`,
        });
      }

      // =========================================================================
      // 8. MONEY TRANSFER API (D1 Atomic Batch)
      // =========================================================================
      if (path === '/api/v1/wallet/transfer' && method === 'POST') {
        const body: any = await request.json().catch(() => ({}));
        const reqUserId = Number(body.user_id || 1);
        const auth = await authenticateUser(request, env, reqUserId);
        const senderId = auth?.userId || reqUserId;

        const recipientPhone = String(body.recipient_phone || '').trim();
        const pin = String(body.pin || body.payment_pin || '').trim();
        const val = validateAmountTwd(body.amount);

        if (!recipientPhone) return jsonResponse({ success: false, error: '請輸入接收者的手機號碼' }, 400);
        if (!pin) return jsonResponse({ success: false, error: '請輸入 4 位數支付密碼' }, 400);
        if (!val.valid) return jsonResponse({ success: false, error: val.error || '請輸入有效轉帳金額' }, 400);

        const amountCents = val.cents;
        const sender: any = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(senderId).first();
        if (!sender) return jsonResponse({ success: false, error: '找不到轉帳發起人' }, 404);

        if (sender.locked_until && new Date() < new Date(sender.locked_until)) {
          return jsonResponse({ success: false, error: '帳戶已暫時鎖定' }, 400);
        }

        const validPin = await verifyPassword(pin, sender.payment_pin_hash);
        if (!validPin) {
          const newFailedAttempts = (sender.failed_pin_attempts || 0) + 1;
          let lockedUntil: string | null = null;
          if (newFailedAttempts >= PIN_MAX_FAILED_ATTEMPTS) {
            lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
          }
          await env.DB.prepare('UPDATE users SET failed_pin_attempts = ?, locked_until = ? WHERE id = ?')
            .bind(newFailedAttempts, lockedUntil, senderId)
            .run();
          return jsonResponse({ success: false, error: '支付密碼驗證失敗！' }, 400);
        }

        await env.DB.prepare('UPDATE users SET failed_pin_attempts = 0, locked_until = NULL WHERE id = ?').bind(senderId).run();

        const recipient: any = await env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(recipientPhone).first();
        if (!recipient) return jsonResponse({ success: false, error: `找不到手機號碼為 ${recipientPhone} 的收款對象` }, 404);

        if (recipient.id === sender.id) {
          return jsonResponse({ success: false, error: '無法轉帳給自己的帳號' }, 400);
        }

        if (sender.balance_cents < amountCents) {
          return jsonResponse({
            success: false,
            error: `錢包餘額不足 ($${toTWD(sender.balance_cents)})，無法轉帳 $${toTWD(amountCents)}`,
          }, 400);
        }

        const newSenderBal = sender.balance_cents - amountCents;
        const newRecipientBal = recipient.balance_cents + amountCents;

        await env.DB.batch([
          env.DB.prepare('UPDATE users SET balance_cents = ?, version = version + 1 WHERE id = ?').bind(newSenderBal, sender.id),
          env.DB.prepare('UPDATE users SET balance_cents = ?, version = version + 1 WHERE id = ?').bind(newRecipientBal, recipient.id),
          env.DB.prepare(`
            INSERT INTO transactions (user_id, amount_cents, type, note)
            VALUES (?, ?, 'TRANSFER_OUT', ?)
          `).bind(sender.id, amountCents, `轉帳給 ${recipientPhone}`),
          env.DB.prepare(`
            INSERT INTO transactions (user_id, amount_cents, type, note)
            VALUES (?, ?, 'TRANSFER_IN', ?)
          `).bind(recipient.id, amountCents, `收到來自 ${sender.phone} 的轉帳`),
        ]);

        return jsonResponse({
          success: true,
          data: {
            new_balance: toTWD(newSenderBal),
            transferred_amount: toTWD(amountCents),
          },
          error: null,
          message: `已成功轉帳 $${toTWD(amountCents)} 給 ${recipientPhone}`,
        });
      }

      // =========================================================================
      // 9. BANK LINK & DEPOSIT API
      // =========================================================================
      if (path === '/api/v1/bank/link' && method === 'POST') {
        const body: any = await request.json().catch(() => ({}));
        const reqUserId = Number(body.user_id || 1);
        const auth = await authenticateUser(request, env, reqUserId);
        const userId = auth?.userId || reqUserId;

        const accountNumber = String(body.account_number || '').trim();
        const bankPassword = String(body.bank_password || '').trim();
        const bankCode = String(body.bank_code || '822').trim();

        if (!accountNumber || !bankPassword) {
          return jsonResponse({ success: false, error: '請輸入銀行帳號與密碼' }, 400);
        }

        const existingBank: any = await env.DB.prepare(
          'SELECT * FROM mock_bank_accounts WHERE account_number = ?'
        ).bind(accountNumber).first();

        if (!existingBank) {
          const passHash = await import('./utils/crypto').then(m => m.hashPassword(bankPassword));
          await env.DB.prepare(`
            INSERT INTO mock_bank_accounts (user_id, bank_code, account_number, bank_password_hash, mock_bank_balance_cents, is_verified, version)
            VALUES (?, ?, ?, ?, 5000000, 1, 1)
          `).bind(userId, bankCode, accountNumber, passHash).run();

          const createdBank: any = await env.DB.prepare(
            'SELECT * FROM mock_bank_accounts WHERE user_id = ?'
          ).bind(userId).first();

          return jsonResponse({
            success: true,
            data: {
              ...createdBank,
              mock_bank_balance: toTWD(createdBank.mock_bank_balance_cents),
            },
            message: '成功開立並綁定模擬銀行帳戶（獲贈 $50,000 測試金）',
          });
        } else {
          const valid = await verifyPassword(bankPassword, existingBank.bank_password_hash);
          if (!valid) {
            return jsonResponse({ success: false, error: '模擬銀行密碼驗證失敗！' }, 400);
          }

          await env.DB.prepare(
            'UPDATE mock_bank_accounts SET user_id = ?, is_verified = 1, version = version + 1 WHERE id = ?'
          ).bind(userId, existingBank.id).run();

          const updatedBank: any = await env.DB.prepare(
            'SELECT * FROM mock_bank_accounts WHERE user_id = ?'
          ).bind(userId).first();

          return jsonResponse({
            success: true,
            data: {
              ...updatedBank,
              mock_bank_balance: toTWD(updatedBank.mock_bank_balance_cents),
            },
            message: '成功綁定既有模擬銀行帳戶',
          });
        }
      }

      if (path === '/api/v1/bank/deposit' && method === 'POST') {
        const body: any = await request.json().catch(() => ({}));
        const reqUserId = Number(body.user_id || 1);
        const auth = await authenticateUser(request, env, reqUserId);
        const userId = auth?.userId || reqUserId;

        const val = validateAmountTwd(body.amount);
        if (!val.valid) return jsonResponse({ success: false, error: val.error || '請輸入有效存款金額' }, 400);

        const bank: any = await env.DB.prepare('SELECT * FROM mock_bank_accounts WHERE user_id = ?').bind(userId).first();
        if (!bank) return jsonResponse({ success: false, error: '尚未綁定模擬銀行帳戶，無法存款' }, 400);

        const newBalCents = bank.mock_bank_balance_cents + val.cents;
        await env.DB.prepare(
          'UPDATE mock_bank_accounts SET mock_bank_balance_cents = ?, version = version + 1 WHERE id = ?'
        ).bind(newBalCents, bank.id).run();

        return jsonResponse({
          success: true,
          data: {
            newBankBalance: toTWD(newBalCents),
          },
          message: `成功向模擬銀行帳戶存款 $${toTWD(val.cents)}！`,
        });
      }

      // =========================================================================
      // 10. USER INFO & TRANSACTIONS API (Read-Only)
      // =========================================================================
      if (path.startsWith('/api/v1/user/info') && method === 'GET') {
        const pathUserId = Number(path.split('/info/')[1] || path.split('/info')[1]?.replace('/', '') || 1);
        const auth = await authenticateUser(request, env, pathUserId);
        const userId = auth?.userId || pathUserId;

        const user: any = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
        if (!user) return jsonResponse({ success: false, error: '找不到使用者' }, 404);

        const bank: any = await env.DB.prepare('SELECT * FROM mock_bank_accounts WHERE user_id = ?').bind(userId).first();

        return jsonResponse({
          success: true,
          data: {
            id: user.id,
            phone: user.phone,
            balance: toTWD(user.balance_cents),
            is_auto_recharge_enabled: Boolean(user.is_auto_recharge_enabled),
            linked_bank: bank
              ? {
                  id: bank.id,
                  bank_code: bank.bank_code,
                  account_number: bank.account_number,
                  mock_bank_balance: toTWD(bank.mock_bank_balance_cents),
                  is_verified: Boolean(bank.is_verified),
                }
              : null,
          },
          error: null,
        });
      }

      if (path.startsWith('/api/v1/user/transactions') && method === 'GET') {
        const pathUserId = Number(path.split('/transactions/')[1] || path.split('/transactions')[1]?.replace('/', '') || 1);
        const auth = await authenticateUser(request, env, pathUserId);
        const userId = auth?.userId || pathUserId;

        const { results } = await env.DB.prepare(
          'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50'
        ).bind(userId).all();

        const formatted = (results || []).map((r: any) => ({
          ...r,
          amount: toTWD(r.amount_cents),
        }));

        return jsonResponse({ success: true, data: formatted, error: null });
      }

      // Static assets fallback if configured in Cloudflare Workers
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return jsonResponse({ error: 'Not Found', path }, 404);
    } catch (err: any) {
      console.error('[Worker Error]', err);
      return jsonResponse({ success: false, error: err.message || 'Internal Server Error' }, 500);
    }
  },
};
