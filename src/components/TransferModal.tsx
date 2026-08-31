import React, { useState } from 'react';
import { Send, Smartphone, ShieldCheck, X, AlertCircle } from 'lucide-react';
import { ref, get, update, push } from 'firebase/database';
import { database } from '../firebase';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newBalance: number, msg: string) => void;
  userId: number;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userId,
}) => {
  const [recipientPhone, setRecipientPhone] = useState('0987654321');
  const [amount, setAmount] = useState('200');
  const [paymentPin, setPaymentPin] = useState('1234');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setErrorMsg('');

  const phone = recipientPhone.trim();
  const transferAmount = Number(amount);

  if (!phone) {
    setErrorMsg('請輸入收款人手機號碼');
    return;
  }

  if (!transferAmount || transferAmount <= 0) {
    setErrorMsg('請輸入有效的轉帳金額');
    return;
  }

  if (paymentPin.trim() !== '1234') {
    setErrorMsg('支付 PIN 碼錯誤');
    return;
  }

  try {
    setLoading(true);

    // 1. 讀取付款人
    const senderRef = ref(database, `users/${userId}`);
    const senderSnapshot = await get(senderRef);

    if (!senderSnapshot.exists()) {
      throw new Error('找不到目前使用者');
    }

    const sender = senderSnapshot.val();
    const senderBalance = Number(sender.balance ?? 0);

    if (senderBalance < transferAmount) {
      throw new Error('錢包餘額不足');
    }

    // 2. 搜尋收款人的手機號碼
    const usersSnapshot = await get(ref(database, 'users'));

    if (!usersSnapshot.exists()) {
      throw new Error('找不到使用者資料');
    }

    const users = usersSnapshot.val();

    const recipientEntry = Object.entries(users).find(
      ([id, value]: [string, any]) =>
        String(value?.phone ?? '') === phone
    );

    if (!recipientEntry) {
      throw new Error('找不到此手機號碼的使用者');
    }

    const [recipientId, recipient] = recipientEntry as [string, any];

    if (String(recipientId) === String(userId)) {
      throw new Error('不能轉帳給自己');
    }

    const recipientBalance = Number(recipient.balance ?? 0);

    const senderBalanceAfter = senderBalance - transferAmount;
    const recipientBalanceAfter = recipientBalance + transferAmount;

    const now = new Date().toISOString();

    // 3. 建立雙方交易紀錄
    const senderTxnRef = push(
      ref(database, `transactions/${userId}`)
    );

    const recipientTxnRef = push(
      ref(database, `transactions/${recipientId}`)
    );

    if (!senderTxnRef.key || !recipientTxnRef.key) {
      throw new Error('無法建立交易紀錄');
    }

    // 4. 一次更新 Firebase
    await update(ref(database), {
      [`users/${userId}/balance`]: senderBalanceAfter,

      [`users/${recipientId}/balance`]: recipientBalanceAfter,

      [`transactions/${userId}/${senderTxnRef.key}`]: {
        user_id: userId,
        amount: transferAmount,
        amount_cents: Math.round(transferAmount * 100),
        type: 'TRANSFER_OUT',
        note: `轉帳給 ${phone}`,
        recipient_user_id: recipientId,
        recipient_phone: phone,
        created_at: now,
      },

      [`transactions/${recipientId}/${recipientTxnRef.key}`]: {
        user_id: Number(recipientId),
        amount: transferAmount,
        amount_cents: Math.round(transferAmount * 100),
        type: 'TRANSFER_IN',
        note: `收到 ${sender.phone ?? '好友'} 的轉帳`,
        sender_user_id: userId,
        sender_phone: sender.phone ?? '',
        created_at: now,
      },
    });

    onSuccess(
      senderBalanceAfter,
      `成功轉帳 $${transferAmount} 給 ${phone}`
    );

    onClose();
  } catch (err: any) {
    console.error('Firebase transfer error:', err);
    setErrorMsg(err?.message || '轉帳失敗');
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-2xl">
            <Send className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">好友 / 手機號轉帳</h3>
            <p className="text-xs text-slate-500">LINE Pay / 支付寶風格 即時轉帳</p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
              收款人手機號碼
            </label>
            <div className="relative">
              <input
                type="text"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder="例如 0987654321"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 pl-9 text-slate-900 dark:text-white font-mono font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              <Smartphone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            </div>
            <div className="flex gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => setRecipientPhone('0987654321')}
                className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200 cursor-pointer"
              >
                帶入測試號碼 (0987654321)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
              轉帳金額 (TWD)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="輸入金額"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white font-mono font-bold text-base focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 mt-2">
              {['100', '200', '500', '1000'].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmount(val)}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-950 hover:text-blue-600 cursor-pointer"
                >
                  ${val}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
              4 位數支付密碼 (PIN)
            </label>
            <input
              type="password"
              maxLength={4}
              value={paymentPin}
              onChange={(e) => setPaymentPin(e.target.value)}
              placeholder="預設密碼 1234"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white font-mono font-bold tracking-widest text-center text-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-500" /> 測試預設支付 PIN 碼：1234
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? '轉帳處理中...' : '確認即時轉帳'}
          </button>
        </form>
      </div>
    </div>
  );
};
