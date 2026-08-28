import React, { useState } from 'react';
import { Wallet, X, ArrowUpRight } from 'lucide-react';

interface RechargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newBalance: number, msg: string) => void;
  userId: number;
}

export const RechargeModal: React.FC<RechargeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userId,
}) => {
  const [amount, setAmount] = useState<number>(1000);
  const [pin, setPin] = useState<string>('1234');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/wallet/recharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          payment_pin: pin.trim(),
          amount: Number(amount),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '手動加值失敗');
      }

      onSuccess(data.newBalance, data.message);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 rounded-xl">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">手動儲值電子錢包</h3>
              <p className="text-xs text-slate-500">自綁定之模擬銀行帳戶進行儲值扣款</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              快速選擇儲值金額
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[1000, 5000, 10000, 50000].map((val) => (
                <button
                  type="button"
                  key={val}
                  onClick={() => setAmount(val)}
                  className={`py-2 rounded-xl font-bold text-xs border transition-all cursor-pointer ${
                    amount === val
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-600'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                  }`}
                >
                  ${val.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              或自訂儲值金額 ($，無金額上限)
            </label>
            <input
              type="number"
              min="1"
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value))}
              required
              placeholder="請輸入欲儲值之金額"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-base font-bold focus:ring-2 focus:ring-emerald-500 outline-hidden"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              請輸入 4 位數支付 PIN 碼 (預設: 1234)
            </label>
            <input
              type="password"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-center font-mono text-lg tracking-widest focus:ring-2 focus:ring-emerald-500 outline-hidden"
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
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <ArrowUpRight className="w-4 h-4" />
              {loading ? '扣款儲值中...' : `確認手動加值 $${amount}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
