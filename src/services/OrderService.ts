import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { generateQrDataUrl, generateQrPngBuffer } from '../utils/qr';
import {
  Order,
  OrderItem,
  toCents,
  toTWD,
  isValidPositiveAmount,
  validateAmountTwd,
  ORDER_EXPIRATION_MS,
} from '../types';

export class OrderService {
  /**
   * 供女媧凱比機器人或網頁建立點餐訂單，產生 UUID 與 QR Code Token
   */
  static async createOrder(
    robotId: string,
    totalAmountTwd: number,
    items?: OrderItem[]
  ): Promise<{
    order_id: string;
    total_amount: number;
    qr_code_token: string;
    qr_code_image_base64: string;
    status: string;
    expires_at: string;
    created_at: string;
  }> {
    const val = validateAmountTwd(totalAmountTwd);
    if (!val.valid) {
      throw new Error(val.error || '點餐總金額 (total_amount) 必須大於 $0');
    }

    const orderId = uuidv4();
    const qrToken = `KEBBI_PAY_TOK_${orderId}`;
    const totalAmountCents = val.cents;
    const expiresAt = new Date(Date.now() + ORDER_EXPIRATION_MS).toISOString();

    // Generate QR Code Image Base64
    const qrCodeImageBase64 = await generateQrDataUrl(qrToken);

    const itemsJson = items && items.length > 0 ? JSON.stringify(items) : undefined;

    const newOrder = db.createOrder({
      id: orderId,
      robot_id: robotId || 'KEBBI_ROBOT_001',
      total_amount_cents: totalAmountCents,
      qr_code_token: qrToken,
      items_json: itemsJson,
      expires_at: expiresAt,
    });

    return {
      order_id: newOrder.id,
      total_amount: newOrder.total_amount,
      qr_code_token: newOrder.qr_code_token,
      qr_code_image_base64: qrCodeImageBase64,
      status: newOrder.status,
      expires_at: expiresAt,
      created_at: newOrder.created_at,
    };
  }

  /**
   * 供凱比 Roflow 輪詢查詢訂單狀態 (唯讀無副作用)
   */
  static async getOrderStatus(orderId: string): Promise<Order | null> {
    if (!orderId) return null;
    return db.getOrderById(orderId);
  }

  /**
   * 根據 QR Code Token 查詢訂單 (唯讀無副作用)
   */
  static async getOrderByToken(token: string): Promise<Order | null> {
    if (!token) return null;
    return db.getOrderByToken(token);
  }

  /**
   * 取得機器人最新一筆訂單
   */
  static async getLatestOrderByRobotId(robotId: string): Promise<Order | null> {
    return db.getLatestOrderByRobotId(robotId);
  }

  /**
   * 產生特定訂單的 QR Code PNG 圖片二進位 buffer
   */
  static async getQrPngBuffer(orderId: string): Promise<Uint8Array | null> {
    const order = db.getOrderById(orderId);
    if (!order) return null;
    return generateQrPngBuffer(order.qr_code_token);
  }
}
