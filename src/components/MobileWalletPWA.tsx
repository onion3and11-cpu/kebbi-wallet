import React, { useState, useEffect } from 'react';
import {
  Wallet,
  Building2,
  QrCode,
  ArrowUpRight,
  History,
  ShieldCheck,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Smartphone,
  ChevronRight,
  Send,
  Eye,
  EyeOff,
  ScanLine,
  CreditCard,
} from 'lucide-react';
import { LinkBankModal } from './LinkBankModal';
import { RechargeModal } from './RechargeModal';
import { PaymentPinModal } from './PaymentPinModal';
import { QRScannerModal } from './QRScannerModal';
import { TransferModal } from './TransferModal';
import { BarcodePaymentModal } from './BarcodePaymentModal';
import { BankDepositModal } from './BankDepositModal';
import { PayOrderResult, Transaction } from '../types';
import { ref, get } from 'firebase/database';
import { database } from '../firebase';

interface MobileWalletPWAProps {
  userId: number;
  latestRobotToken?: string;
}

export const MobileWalletPWA: React.FC<MobileWalletPWAProps> = ({
  userId,
  latestRobotToken,
}) => {
  const [userInfo, setUserInfo] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBalance, setShowBalance] = useState(true);
  const [filterType, setFilterType] = useState<'ALL' | 'PAYMENT' | 'RECHARGE' | 'AUTO'>('ALL');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Modals state
  const [isLinkBankOpen, setIsLinkBankOpen] = useState(false);
  const [linkBankReason, setLinkBankReason] = useState<string | undefined>(undefined);
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);
  const [isBankDepositOpen, setIsBankDepositOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isBarcodeOpen, setIsBarcodeOpen] = useState(false);
  const [currentScannedToken, setCurrentScannedToken] = useState<string>('');

  // Auto-retry pending payment after linking bank
  const [pendingPaymentToken, setPendingPaymentToken] = useState<string | null>(null);

const fetchUserData = async () => {
  try {
    setLoading(true);

    // 讀取使用者資料
    const userRef = ref(database, `users/${userId}`);
    const userSnapshot = await get(userRef);

    if (userSnapshot.exists()) {
      const firebaseUser = userSnapshot.val();

      setUserInfo({
        id: userId,
        ...firebaseUser,
      });
    }

    // 讀取交易紀錄
    const txnRef = ref(database, `transactions/${userId}`);
    const txnSnapshot = await get(txnRef);

    if (txnSnapshot.exists()) {
      const txnData = txnSnapshot.val();

      const txnList = Object.entries(txnData)
        .map(([key, value]: [string, any], index: number) => ({
          id: value.id || key || `txn-${index}`,
          ...value,
        }))
        .sort(
          (a, b) =>
            new Date(b.created_at || 0).getTime() -
            new Date(a.created_at || 0).getTime()
        );

      setTransactions(txnList);
    } else {
      setTransactions([]);
    }
  } catch (err) {
    console.error('Error fetching Firebase data:', err);
  } finally {
    setLoading(false);
  }
};
  useEffect(() => {
  fetchUserData();
}, [userId]);

const handleScanSuccess = (token: string) => {
  setCurrentScannedToken(token);
  setIsScannerOpen(false);
  setIsPinModalOpen(true);
};

const handlePaymentComplete = async (
  result: PayOrderResult & {
    errorCode?: string;
    message?: string;
  }
) => {
  setIsPinModalOpen(false);

  // 餘額不足且未綁定銀行時引導綁定
  if (
    !result.success &&
    result.errorCode === 'INSUFFICIENT_BALANCE_AND_NO_BANK'
  ) {
    setPendingPaymentToken(currentScannedToken);

    setLinkBankReason(
      '您的錢包餘額不足以支付款項，且尚未綁定銀行。請即刻完成模擬銀行綁定，系統將為您自動扣取 $1,000 並無縫完成支付！'
    );

    setIsLinkBankOpen(true);
    return;
  }

  if (result.success) {
    setNotice({
      type: 'success',
      message: result.message || '支付成功！',
    });

    await fetchUserData();
  } else {
    setNotice({
      type: 'error',
      message: result.message || '交易失敗',
    });
  }
  };
  const handleBankLinkSuccess = async () => {
    setIsLinkBankOpen(false);
    setLinkBankReason(undefined);
    await fetchUserData();

    // SEAMLESS AUTO RETRY
    if (pendingPaymentToken) {
      const tokenToRetry = pendingPaymentToken;
      setPendingPaymentToken(null);
      setNotice({
        type: 'info',
        message: '銀行綁定完成！系統正在自動為您接續支付...',
      });

      // Automatically popup PIN modal or execute retry
      setTimeout(() => {
        setCurrentScannedToken(tokenToRetry);
        setIsPinModalOpen(true);
      }, 600);
    } else {
      setNotice({
        type: 'success',
        message: '成功綁定/開立模擬銀行帳戶！獲贈 $50,000 測試額度。',
      });
    }
  };

  const filteredTransactions = transactions.filter((txn) => {
    if (filterType === 'PAYMENT') return txn.type === 'PAYMENT' || txn.type === 'TRANSFER_OUT';
    if (filterType === 'RECHARGE') return txn.type === 'MANUAL_RECHARGE';
    if (filterType === 'AUTO') return txn.type === 'AUTO_RECHARGE';
    return true;
  });

  return (
    <div className="max-w-md mx-auto min-h-[720px] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col relative">
      {/* Top Header Bar (LINE Pay / Alipay Style) */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 p-6 text-white relative">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-1 rounded-full border border-white/20">
            <Wallet className="w-3.5 h-3.5 text-emerald-300" />
            <span className="text-xs font-bold tracking-tight">數位支付錢包 (LINE Pay / Google Pay / 支付寶)</span>
          </div>
          <button
            onClick={fetchUserData}
            className="p-1.5 hover:bg-white/20 rounded-full transition-all cursor-pointer"
            title="重新整理資料"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Balance Display */}
        <div className="mt-1 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-emerald-100 font-medium">
              <span>電子錢包可用餘額</span>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="text-emerald-200 hover:text-white cursor-pointer"
              >
                {showBalance ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-3xl font-black font-mono tracking-tight">
                {showBalance ? `$${userInfo ? userInfo.balance.toFixed(2) : '0.00'}` : '••••••'}
              </span>
              <span className="text-xs text-emerald-200 font-bold">TWD</span>
            </div>
          </div>

          <button
            onClick={() => setIsBarcodeOpen(true)}
            className="p-2.5 bg-white text-emerald-700 hover:bg-emerald-50 rounded-2xl shadow-md font-bold text-xs flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95"
          >
            <ScanLine className="w-5 h-5 text-emerald-600" />
            <span className="text-[10px]">出示付款碼</span>
          </button>
        </div>

        {/* Auto Recharge Badge */}
        <div className="mt-4 flex items-center justify-between bg-black/20 backdrop-blur-sm px-3.5 py-2 rounded-xl text-xs">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-300 fill-amber-300 animate-pulse" />
            <span>餘額不足自動加值 $1,000 觸發機制</span>
          </div>
          <span className="bg-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded-full font-bold text-[10px] border border-emerald-400/40">
            自動觸發已開啟
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-5 flex-1 space-y-5 overflow-y-auto">
        {/* Banner Alert Notice */}
        {notice && (
          <div
            className={`p-3.5 rounded-2xl text-xs font-medium flex items-start justify-between gap-2 border animate-in fade-in duration-200 ${
              notice.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800'
                : notice.type === 'error'
                ? 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800'
                : 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {notice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              ) : notice.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              ) : (
                <Zap className="w-4 h-4 text-blue-600 flex-shrink-0" />
              )}
              <span>{notice.message}</span>
            </div>
            <button
              onClick={() => setNotice(null)}
              className="text-slate-400 hover:text-slate-600 font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* 4 Core Quick Action Icons Grid (LINE Pay / Alipay Grid) */}
        <div className="grid grid-cols-4 gap-2.5">
          {/* Barcode Pay */}
          <button
            onClick={() => setIsBarcodeOpen(true)}
            className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-center hover:border-emerald-500 transition-all shadow-xs group cursor-pointer flex flex-col items-center"
          >
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-2xl mb-1.5 group-hover:scale-110 transition-transform">
              <ScanLine className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">出示付款碼</span>
          </button>

          {/* Scan QR */}
          <button
            onClick={() => setIsScannerOpen(true)}
            className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-center hover:border-blue-500 transition-all shadow-xs group cursor-pointer flex flex-col items-center"
          >
            <div className="p-2.5 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-2xl mb-1.5 group-hover:scale-110 transition-transform">
              <QrCode className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">掃碼支付</span>
          </button>

          {/* Transfer */}
          <button
            onClick={() => setIsTransferOpen(true)}
            className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-center hover:border-indigo-500 transition-all shadow-xs group cursor-pointer flex flex-col items-center"
          >
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-2xl mb-1.5 group-hover:scale-110 transition-transform">
              <Send className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">好友轉帳</span>
          </button>

          {/* Recharge */}
          <button
            onClick={() => setIsRechargeOpen(true)}
            className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-center hover:border-purple-500 transition-all shadow-xs group cursor-pointer flex flex-col items-center"
          >
            <div className="p-2.5 bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 rounded-2xl mb-1.5 group-hover:scale-110 transition-transform">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">手動儲值</span>
          </button>
        </div>

        {/* Linked Bank / Cards Card */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                綁定之扣款銀行 / 帳戶
              </h4>
            </div>
            {userInfo?.linked_bank ? (
              <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> 已驗證綁定
              </span>
            ) : (
              <span className="text-[10px] bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 font-bold px-2 py-0.5 rounded-full">
                未綁定
              </span>
            )}
          </div>

          {userInfo?.linked_bank ? (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs">
              <div>
                <p className="font-bold text-slate-900 dark:text-white font-mono">
                  ({userInfo.linked_bank.bank_code}) {userInfo.linked_bank.account_number}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  模擬銀行帳戶餘額：
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                    ${userInfo.linked_bank.mock_bank_balance.toFixed(2)}
                  </span>
                </p>
              </div>
              <div className="flex flex-col gap-1 items-end">
                <button
                  onClick={() => setIsBankDepositOpen(true)}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] shadow-xs cursor-pointer flex items-center gap-1 transition-all"
                >
                  <span>+ 銀行存款</span>
                </button>
                <button
                  onClick={() => {
                    setLinkBankReason(undefined);
                    setIsLinkBankOpen(true);
                  }}
                  className="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline"
                >
                  變更/重綁
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex justify-between items-center">
              <span>尚未綁定銀行帳戶，點擊可直接線上開戶與綁定。</span>
              <button
                onClick={() => setIsLinkBankOpen(true)}
                className="font-bold text-amber-900 dark:text-amber-200 underline flex items-center gap-0.5"
              >
                立即開戶綁定 <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Transactions List with Filter Tabs */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-purple-600" />
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                交易明細歷史
              </h4>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">即時連線</span>
          </div>

          {/* Filter Pills */}
          <div className="flex gap-1.5 mb-3 text-[11px] border-b border-slate-100 dark:border-slate-800 pb-2">
            {[
              { key: 'ALL', label: '全部' },
              { key: 'PAYMENT', label: '扣款支付' },
              { key: 'RECHARGE', label: '手動儲值' },
              { key: 'AUTO', label: '自動加值' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilterType(tab.key as any)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  filterType === tab.key
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredTransactions.length === 0 ? (
            <p className="text-center py-6 text-xs text-slate-400">尚無符合此條件的交易紀錄</p>
          ) : (
            <div className="space-y-2.5 max-h-[240px] overflow-y-auto pr-1">
              {filteredTransactions.map((txn, index) => (
                <div
                  key={String(txn.id || `txn-${index}`)}
                  className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                          txn.type === 'AUTO_RECHARGE'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : txn.type === 'MANUAL_RECHARGE'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : txn.type === 'TRANSFER_IN'
                            ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300'
                            : txn.type === 'TRANSFER_OUT'
                            ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                        }`}
                      >
                        {txn.type === 'AUTO_RECHARGE'
                          ? '自動加值 $1,000'
                          : txn.type === 'MANUAL_RECHARGE'
                          ? '手動加值'
                          : txn.type === 'TRANSFER_IN'
                          ? '轉帳存入'
                          : txn.type === 'TRANSFER_OUT'
                          ? '好友轉帳'
                          : '消費扣款'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(txn.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`font-bold font-mono text-sm ${
                      txn.type === 'PAYMENT' || txn.type === 'TRANSFER_OUT'
                        ? 'text-slate-900 dark:text-white'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {txn.type === 'PAYMENT' || txn.type === 'TRANSFER_OUT' ? `-$${txn.amount}` : `+$${txn.amount}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <LinkBankModal
        isOpen={isLinkBankOpen}
        onClose={() => setIsLinkBankOpen(false)}
        onSuccess={handleBankLinkSuccess}
        userId={userId}
        autoReason={linkBankReason}
      />

      <RechargeModal
        isOpen={isRechargeOpen}
        onClose={() => setIsRechargeOpen(false)}
        onSuccess={async (newBalance, msg) => {
          setNotice({ type: 'success', message: msg });
          await fetchUserData();
        }}
        userId={userId}
      />

      <BankDepositModal
        isOpen={isBankDepositOpen}
        onClose={() => setIsBankDepositOpen(false)}
        onSuccess={async (newBankBal, msg) => {
          setNotice({ type: 'success', message: msg });
          await fetchUserData();
        }}
        userId={userId}
        bankAccountInfo={userInfo?.linked_bank}
      />

      <TransferModal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        onSuccess={async (newBalance, msg) => {
          setNotice({ type: 'success', message: msg });
          await fetchUserData();
        }}
        userId={userId}
      />

      <BarcodePaymentModal
        isOpen={isBarcodeOpen}
        onClose={() => setIsBarcodeOpen(false)}
        userId={userId}
      />

      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
        latestRobotToken={latestRobotToken}
      />

      <PaymentPinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onPaymentComplete={handlePaymentComplete}
        userId={userId}
        qrCodeToken={currentScannedToken}
      />
    </div>
  );
};
