export const AUTO_RECHARGE_UNIT_TWD = 1000;
export const AUTO_RECHARGE_UNIT_CENTS = 100000; // 1,000.00 TWD in cents
export const CENTS_PER_TWD = 100;
export const ORDER_EXPIRATION_MS = 15 * 60 * 1000; // 15 minutes
export const PIN_MAX_FAILED_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface AmountValidationResult {
  valid: boolean;
  cents: number;
  error?: string;
}

/**
 * 嚴格驗證 TWD 金額：
 * 1. 必須是有限數值 (Finite Number)
 * 2. 必須大於 0
 * 3. 不允許小於 1 分錢 (0.01 TWD) 的分數 (例如 0.001 不得無條件進位或捨去造成 0 元)
 * 4. 金額上限安全保護 (單筆不超過 10,000,000 TWD)
 */
export function validateAmountTwd(twd: any): AmountValidationResult {
  if (twd === undefined || twd === null || twd === '') {
    return { valid: false, cents: 0, error: '金額不能為空' };
  }
  const num = Number(twd);
  if (!Number.isFinite(num) || isNaN(num)) {
    return { valid: false, cents: 0, error: '金額必須為有效數字' };
  }
  if (num <= 0) {
    return { valid: false, cents: 0, error: '金額必須大於 $0' };
  }
  if (num > 10000000) {
    return { valid: false, cents: 0, error: '單筆金額超過系統上限 ($10,000,000)' };
  }
  // Check for fractional cents (sub-cent values like 0.001)
  const cents = Math.round(num * CENTS_PER_TWD);
  const diff = Math.abs(num * CENTS_PER_TWD - cents);
  if (diff > 1e-5 && cents === 0) {
    return { valid: false, cents: 0, error: '金額過小，不可小於 0.01 元' };
  }
  if (cents <= 0) {
    return { valid: false, cents: 0, error: '金額換算分後必須大於 0 分' };
  }
  return { valid: true, cents };
}

export function toCents(twd: number): number {
  const result = validateAmountTwd(twd);
  if (!result.valid) {
    throw new Error(result.error || '無效的金額數值');
  }
  return result.cents;
}

export function toTWD(cents: number): number {
  if (typeof cents !== 'number' || !Number.isFinite(cents) || isNaN(cents)) {
    return 0;
  }
  return cents / CENTS_PER_TWD;
}

export function isValidPositiveAmount(twd: number): boolean {
  return validateAmountTwd(twd).valid;
}

/**
 * 依據規格計算不足額與自動加值金額：
 * 不足額 = 訂單金額 - 錢包餘額
 * 不足額 > 0 時：
 * 加值額 = ceil(不足額 / 1000) * 1000
 */
export function computeAutoRecharge(
  walletBalanceCents: number,
  orderAmountCents: number
): {
  needed: boolean;
  shortfallCents: number;
  rechargeAmountCents: number;
} {
  const shortfallCents = orderAmountCents - walletBalanceCents;
  if (shortfallCents <= 0) {
    return { needed: false, shortfallCents: 0, rechargeAmountCents: 0 };
  }
  const units = Math.ceil(shortfallCents / AUTO_RECHARGE_UNIT_CENTS);
  const rechargeAmountCents = units * AUTO_RECHARGE_UNIT_CENTS;
  return {
    needed: true,
    shortfallCents,
    rechargeAmountCents,
  };
}

export interface User {
  id: number;
  phone: string;
  password_hash: string;
  payment_pin_hash: string;
  balance_cents: number;
  balance: number; // TWD for API compatibility
  is_auto_recharge_enabled: boolean;
  failed_pin_attempts: number;
  locked_until?: string | null;
  version?: number;
  created_at: string;
}

export interface Session {
  token: string;
  user_id: number;
  phone: string;
  expires_at: string;
  created_at?: string;
}

export interface MockBankAccount {
  id: number;
  user_id: number;
  bank_code: string;
  account_number: string;
  bank_password_hash: string;
  mock_bank_balance_cents: number;
  mock_bank_balance: number; // TWD for API compatibility
  is_verified: boolean;
  version?: number;
  created_at: string;
}

export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED';

export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string; // UUID
  robot_id: string;
  total_amount_cents: number;
  total_amount: number; // TWD for API compatibility
  status: OrderStatus;
  qr_code_token: string;
  items?: OrderItem[];
  items_json?: string;
  paid_at?: string | null;
  expires_at?: string | null;
  created_at: string;
}

export type TransactionType = 'PAYMENT' | 'MANUAL_RECHARGE' | 'AUTO_RECHARGE' | 'TRANSFER_OUT' | 'TRANSFER_IN';

export interface Transaction {
  id: number | string;
  order_id?: string | null;
  user_id: number;
  amount_cents: number;
  amount: number; // TWD for API compatibility
  type: TransactionType;
  mock_bank_account_id?: number | null;
  note?: string | null;
  created_at: string;
}

export interface BankLinkRequest {
  user_id?: number;
  account_number: string;
  bank_password: string;
  bank_code?: string;
}

export interface WalletRechargeRequest {
  user_id?: number;
  payment_pin: string;
  amount: number;
}

export interface CreateOrderRequest {
  robot_id: string;
  total_amount: number;
  items?: OrderItem[];
}

export interface PayOrderRequest {
  user_id?: number;
  qr_code_token: string;
  payment_pin: string;
}

export interface PayOrderResult {
  success: boolean;
  order_id: string;
  status: OrderStatus;
  paid_amount: number;
  wallet_balance_before: number;
  wallet_balance_after: number;
  auto_recharged: boolean;
  auto_recharge_amount?: number;
  transaction_id: number | string;
  message: string;
  errorCode?: string;
}
