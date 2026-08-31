import React, { useState } from 'react';
import {
  Building2,
  X,
  PlusCircle,
  AlertCircle,
  ArrowDownRight,
  CheckCircle2,
} from 'lucide-react';

import { ref, get, update } from 'firebase/database';
import { database } from '../firebase';

interface BankDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newBankBalance: number, msg: string) => void;
  userId: number;
  bankAccountInfo?: {
    bank_code: string;
    account_number: string;
    mock_bank_balance: number;
  };
}

export const BankDepositModal: React.FC<BankDepositModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userId,
  bankAccountInfo,
}) => {
  const [amount, setAmount] = useState('50000');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setErrorMsg('');

  const numAmount = Number(amount);

  if (!numAmount || numAmount <= 0) {
    setErrorMsg('請輸入有效的存款金額');
    return;
  }

  try {
    setLoading(true);

    // 1. 找目前使用者
    const userSnapshot = await get(
      ref(database, `users/${userId}`)
    );

    if (!userSnapshot.exists()) {
      throw new Error('找不到使用者資料');
    }

    const user = userSnapshot.val();

    if (!user.linked_bank?.account_number) {
      throw new Error('尚未綁定模擬銀行');
    }

    const accountNumber =
      String(user.linked_bank.account_number);

    // 2. 找模擬銀行
    const bankSnapshot = await get(
      ref(database, `mock_banks/${accountNumber}`)
    );

    if (!bankSnapshot.exists()) {
      throw new Error('找不到模擬銀行帳戶');
    }

    const bank = bankSnapshot.val();

    const currentBalance = Number(
      bank.mock_bank_balance ?? 0
    );

    const newBankBalance =
      currentBalance + numAmount;

    // 3. 同步更新兩份銀行餘額
    await update(ref(database), {
      [`mock_banks/${accountNumber}/mock_bank_balance`]:
        newBankBalance,

      [`mock_banks/${accountNumber}/mock_bank_balance_cents`]:
        Math.round(newBankBalance * 100),

      [`users/${userId}/linked_bank/mock_bank_balance`]:
        newBankBalance,

      [`users/${userId}/linked_bank/mock_bank_balance_cents`]:
        Math.round(newBankBalance * 100),
    });

    onSuccess(
      newBankBalance,
      `成功存入模擬銀行 $${numAmount}`
    );

    onClose();
  } catch (err: any) {
    console.error('Firebase bank deposit error:', err);
    setErrorMsg(err?.message || '銀行存款失敗');
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
          <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-2xl">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">存款至模擬銀行帳戶</h3>
            <p className="text-xs text-slate-500">補充銀行帳戶餘額，避免自動加值失敗</p>
          </div>
        </div>

        {bankAccountInfo && (
          <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs">
            <p className="text-slate-500">當前綁定帳戶</p>
            <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
              ({bankAccountInfo.bank_code}) {bankAccountInfo.account_number}
            </p>
            <p className="text-slate-500 mt-1">目前銀行帳戶餘額：</p>
            <p className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-base">
              ${bankAccountInfo.mock_bank_balance.toFixed(2)} TWD
            </p>
          </div>
        )}

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
              存款金額 (TWD)
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="輸入金額"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white font-mono font-bold text-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Quick Amount Buttons */}
            <div className="grid grid-cols-4 gap-1.5 mt-2.5">
              {[
                { label: '+$1萬', val: '10000' },
                { label: '+$5萬', val: '50000' },
                { label: '+$10萬', val: '100000' },
                { label: '+$50萬', val: '500000' },
              ].map((item) => (
                <button
                  key={item.val}
                  type="button"
                  onClick={() => setAmount(item.val)}
                  className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold text-[11px] text-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:text-emerald-600 cursor-pointer transition-all border border-slate-200 dark:border-slate-700"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{loading ? '存款處理中...' : '確認存入銀行帳戶'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
