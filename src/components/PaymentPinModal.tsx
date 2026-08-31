import React, { useState } from 'react';
import { Lock, CreditCard, X, ShieldAlert } from 'lucide-react';
import type { PayOrderResult } from '../types';
import {
  ref,
  get,
  update,
  push,
} from 'firebase/database';

import { database } from '../firebase';

interface PaymentPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentComplete: (result: PayOrderResult & { errorCode?: string }) => void;
  userId: number;
  qrCodeToken: string;
}

export const PaymentPinModal: React.FC<PaymentPinModalProps> = ({
  isOpen,
  onClose,
  onPaymentComplete,
  userId,
  qrCodeToken,
}) => {
  const [pin, setPin] = useState<string>('1234');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePay = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!pin || pin.length < 4) {
    setError('請輸入完整的 4 位數支付 PIN 密碼');
    return;
  }

  setLoading(true);
  setError(null);

  try {
    // 專題測試 PIN
    if (pin.trim() !== '1234') {
      setError('PIN 碼錯誤');
      return;
    }

    // 1. 用 QR Token 找 Firebase 訂單
  const orderId = qrCodeToken.trim();

  const orderRef = ref(database, `orders/${orderId}`);
  const orderSnapshot = await get(orderRef);

  if (!orderSnapshot.exists()) {
  setError('找不到此 QR Code 對應的訂單');
  return;
    }

  const order = orderSnapshot.val();
  // 檢查訂單是否已超過付款期限
if (
  order.status === 'PENDING' &&
  order.expires_at &&
  Date.now() >= new Date(order.expires_at).getTime()
) {
  const expiredAt = new Date().toISOString();

  await update(orderRef, {
    status: 'EXPIRED',
    expired_at: expiredAt,
  });

  setError('此訂單已超過 3 分鐘付款期限，請重新點餐');
  return;
}

    // 2. 確認還沒付款
    if (order.status !== 'PENDING') {
      if (order.status === 'PAID') {
        setError('此訂單已完成付款');
      } else {
        setError('此訂單已失效');
      }
      return;
    }

    // 3. 讀使用者餘額
    const userRef = ref(database, `users/${userId}`);
    const userSnapshot = await get(userRef);

    if (!userSnapshot.exists()) {
      setError('找不到使用者資料');
      return;
    }

    const user = userSnapshot.val();

    const balanceBefore = Number(user.balance ?? 0);
const amount = Number(order.total_amount ?? 0);

let balanceAfterRecharge = balanceBefore;
let finalBalance = balanceBefore;

let autoRecharged = false;
let autoRechargeAmount = 0;

const now = new Date().toISOString();

const updates: Record<string, any> = {};

// =====================================================
// 餘額不足 → 自動加值
// =====================================================
if (balanceBefore < amount) {
  const linkedBank = user.linked_bank;

  // 沒有銀行 → 引導使用者綁定
  if (
    !linkedBank ||
    !linkedBank.account_number ||
    linkedBank.is_verified !== true
  ) {
    onPaymentComplete({
      success: false,
      order_id: orderId,
      status: 'PENDING',
      paid_amount: 0,
      wallet_balance_before: balanceBefore,
      wallet_balance_after: balanceBefore,
      auto_recharged: false,
      transaction_id: 0,
      message: '錢包餘額不足，請先綁定模擬銀行',
      errorCode: 'INSUFFICIENT_BALANCE_AND_NO_BANK',
    });

    return;
  }

  const accountNumber =
    String(linkedBank.account_number);

  // 計算缺多少
  const shortfall = amount - balanceBefore;

  // 每次以 $1,000 為單位自動加值
  autoRechargeAmount =
    Math.ceil(shortfall / 1000) * 1000;

  const bankSnapshot = await get(
    ref(database, `mock_banks/${accountNumber}`)
  );

  if (!bankSnapshot.exists()) {
    setError('找不到綁定的模擬銀行帳戶');
    return;
  }

  const bank = bankSnapshot.val();

  const bankBalance = Number(
    bank.mock_bank_balance ?? 0
  );

  // 銀行自己也沒錢
  if (bankBalance < autoRechargeAmount) {
    setError(
      `模擬銀行餘額不足，需要自動加值 $${autoRechargeAmount}`
    );
    return;
  }

  const bankBalanceAfter =
    bankBalance - autoRechargeAmount;

  balanceAfterRecharge =
    balanceBefore + autoRechargeAmount;

  autoRecharged = true;

  // 更新模擬銀行
  updates[
    `mock_banks/${accountNumber}/mock_bank_balance`
  ] = bankBalanceAfter;

  updates[
    `mock_banks/${accountNumber}/mock_bank_balance_cents`
  ] = Math.round(bankBalanceAfter * 100);

  // 同步使用者的銀行副本
  updates[
    `users/${userId}/linked_bank/mock_bank_balance`
  ] = bankBalanceAfter;

  updates[
    `users/${userId}/linked_bank/mock_bank_balance_cents`
  ] = Math.round(bankBalanceAfter * 100);

  // 建立 AUTO_RECHARGE 紀錄
  const autoTxnRef = push(
    ref(database, `transactions/${userId}`)
  );

  if (!autoTxnRef.key) {
    throw new Error('無法建立自動加值交易紀錄');
  }

  updates[
    `transactions/${userId}/${autoTxnRef.key}`
  ] = {
    user_id: userId,
    amount: autoRechargeAmount,
    amount_cents:
      Math.round(autoRechargeAmount * 100),
    type: 'AUTO_RECHARGE',
    note: '餘額不足自動加值',
    created_at: now,
  };
}

// =====================================================
// 執行付款
// =====================================================

finalBalance =
  balanceAfterRecharge - amount;

const paymentTxnRef = push(
  ref(database, `transactions/${userId}`)
);

if (!paymentTxnRef.key) {
  throw new Error('無法建立付款交易紀錄');
}

// 錢包最後餘額
updates[
  `users/${userId}/balance`
] = finalBalance;

// 訂單變成 PAID
updates[
  `orders/${orderId}/status`
] = 'PAID';

updates[
  `orders/${orderId}/paid_at`
] = now;

const robotId =
  String(order.robot_id ?? 'KEBBI_ROBOT_001');

const latestOrderSnapshot = await get(
  ref(database, `robots/${robotId}/latest_order`)
);

if (
  latestOrderSnapshot.exists() &&
  latestOrderSnapshot.val()?.order_id === orderId
) {
  updates[`robots/${robotId}/latest_order/status`] = 'PAID';
  updates[`robots/${robotId}/latest_order/paid_at`] = now;
}

// 建立 PAYMENT 交易
updates[
  `transactions/${userId}/${paymentTxnRef.key}`
] = {
  user_id: userId,
  order_id: orderId,
  amount: amount,
  amount_cents: Math.round(amount * 100),
  type: 'PAYMENT',
  note: '掃碼支付',
  created_at: now,
};

// 一次更新 Firebase
await update(ref(database), updates);

// 告訴 UI 付款成功
onPaymentComplete({
  success: true,
  order_id: orderId,
  status: 'PAID',
  paid_amount: amount,
  wallet_balance_before: balanceBefore,
  wallet_balance_after: finalBalance,
  auto_recharged: autoRecharged,
  auto_recharge_amount:
    autoRecharged ? autoRechargeAmount : undefined,
  transaction_id: paymentTxnRef.key,
  message: autoRecharged
    ? `自動加值 $${autoRechargeAmount} 並完成付款！`
    : '付款成功！',
});

  } catch (err: any) {
    console.error('Firebase payment error:', err);
    setError(err?.message || '付款失敗');
  } finally {
    setLoading(false);
  }
};

return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
    <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">

      <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400 rounded-xl">
            <Lock className="w-6 h-6" />
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              輸入支付 PIN 碼
            </h3>
            <p className="text-xs text-slate-500">
              掃碼授權支付扣款
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handlePay} className="mt-5 space-y-4">

        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-indigo-500 flex-shrink-0" />

          <span>
            目前偵測到之 QR Token：
            <code className="font-mono text-[10px] bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">
              {qrCodeToken.slice(0, 22)}...
            </code>
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 text-center">
            4 位數安全 PIN 碼 (測試預設: 1234)
          </label>

          <input
            type="password"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
            required
            className="w-full px-4 py-3 rounded-xl border-2 border-indigo-500/50 dark:border-indigo-500/60 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-center font-mono text-2xl tracking-[0.5em] focus:ring-2 focus:ring-indigo-500 outline-hidden"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300 text-xs rounded-xl border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <CreditCard className="w-4 h-4" />

            {loading
              ? '扣款驗證與自動加值處理中...'
              : '確認付款'}
          </button>
        </div>

      </form>
    </div>
  </div>
);

};