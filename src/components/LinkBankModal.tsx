import React, { useState } from 'react';
import { Building2, KeyRound, ShieldCheck, X } from 'lucide-react';
import { ref, get, update } from 'firebase/database';
import { database } from '../firebase';

interface LinkBankModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: number;
  initialAccount?: string;
  autoReason?: string;
}

export const LinkBankModal: React.FC<LinkBankModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userId,
  initialAccount = '8220011223344',
  autoReason,
}) => {
  const [accountNumber, setAccountNumber] = useState(initialAccount);
  const [bankPassword, setBankPassword] = useState('8888');
  const [bankCode, setBankCode] = useState('822');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);
  setError(null);

  try {
    const accNum = accountNumber.trim();
    const password = bankPassword.trim();

    if (!accNum || !password) {
      throw new Error('請輸入完整的銀行帳號與密碼');
    }

    // 專題模擬銀行統一使用 Demo 密碼 8888
    if (password !== '8888') {
      throw new Error('模擬銀行密碼錯誤，Demo 密碼為 8888');
    }

    // 先看看這個模擬帳戶是否已經存在
    const mockBankRef = ref(database, `mock_banks/${accNum}`);
    const bankSnapshot = await get(mockBankRef);

    let mockBankBalance = 50000;

    if (bankSnapshot.exists()) {
      const existingBank = bankSnapshot.val();
      mockBankBalance = Number(
        existingBank.mock_bank_balance ?? 50000
      );
    }

    const now = new Date().toISOString();

    const linkedBank = {
      user_id: userId,
      bank_code: bankCode,
      account_number: accNum,

      mock_bank_balance: mockBankBalance,
      mock_bank_balance_cents: Math.round(mockBankBalance * 100),

      is_verified: true,
      created_at: now,
    };

    // 同時寫入：
    // 1. 使用者目前綁定銀行
    // 2. 模擬銀行帳戶資料
    await update(ref(database), {
      [`users/${userId}/linked_bank`]: linkedBank,

      [`mock_banks/${accNum}`]: {
        ...linkedBank,
        owner_user_id: userId,
      },
    });

    onSuccess();
  } catch (err: any) {
    console.error('Firebase bank link error:', err);
    setError(err?.message || '綁定失敗');
  } finally {
    setLoading(false);
  }
   };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 rounded-xl">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                綁定 / 開立模擬銀行帳戶
              </h3>
              <p className="text-xs text-slate-500">中國信託 (822) 模擬網銀扣款系統</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {autoReason && (
          <div className="mt-4 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-800 dark:text-amber-300 font-medium leading-relaxed">
            ⚠️ {autoReason}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              選擇銀行金融機構
            </label>
            <select
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-hidden"
            >
              <option value="822">(822) 中國信託商業銀行 CTBC Mock</option>
              <option value="013">(013) 國泰世華商業銀行 Cathay Mock</option>
              <option value="808">(808) 玉山商業銀行 E.SUN Mock</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              模擬銀行帳號 (輸入不存在帳號將自動開戶贈 $50,000)
            </label>
            <input
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="例如: 8220011223344"
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-hidden"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              網銀登入/授權扣款密碼 (預設Demo密碼: 8888)
            </label>
            <div className="relative">
              <input
                type="password"
                value={bankPassword}
                onChange={(e) => setBankPassword(e.target.value)}
                placeholder="請輸入密碼"
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-hidden pr-10"
              />
              <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
            </div>
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
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-sm transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              {loading ? '驗證與綁定中...' : '確認綁定 / 開立模擬帳戶'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
