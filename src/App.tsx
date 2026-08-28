import React, { useState } from 'react';
import { Wallet, Smartphone, Bot, LayoutGrid, ShieldAlert, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { MobileWalletPWA } from './components/MobileWalletPWA';
import { KebbiRobotPOS } from './components/KebbiRobotPOS';
import { RoflowSpecViewer } from './components/RoflowSpecViewer';
import { QrDisplayScreen } from './components/QrDisplayScreen';
export default function App() {
  // If opening QR Display route
  if (
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith(
    `${import.meta.env.BASE_URL}qr/`
  )
) {
  return <QrDisplayScreen />;
}

  const [viewMode, setViewMode] = useState<'mobile' | 'split' | 'pos'>('mobile');
  const [showPOSHelper, setShowPOSHelper] = useState(false);

  const [latestRobotToken, setLatestRobotToken] = useState<string | undefined>(undefined);
  const demoUserId = 1; // Default Demo User (Phone 0912345678, PIN 1234)
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-emerald-500 selection:text-white pb-12">
      {/* Top Banner Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-emerald-600 to-teal-600 rounded-2xl shadow-lg shadow-emerald-500/20">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base text-white tracking-tight flex items-center gap-2">
                電子支付與數位錢包系統 (LINE Pay / Google Pay / 支付寶)
              </h1>
              <p className="text-xs text-slate-400">
                出示付款碼、掃碼支付、銀行卡綁定、餘額不足自動加值 $1,000 與好友即時轉帳
              </p>
            </div>
          </div>

          {/* View Mode Toggle Buttons */}
          <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800 text-xs">
            <button
              onClick={() => setViewMode('mobile')}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'mobile'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>數位錢包主介面</span>
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'split'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>與點餐機器人對接測試</span>
            </button>
          </div>
        </div>
      </header>

      {/* Guidance Banner */}
      <div className="max-w-7xl mx-auto px-4 mt-4">
        <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/60 rounded-2xl text-xs text-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>
              💡 <b>錢包功能總覽：</b>支援【出示付款碼】、【掃碼支付】、【好友轉帳】與【手動儲值】。若餘額不足且已綁定銀行，系統將<b>自動從模擬銀行加值 $1,000 完成扣款</b>！支付 PIN 碼預設為 <code className="font-mono font-bold bg-emerald-900 px-1 py-0.5 rounded text-emerald-100">1234</code>。
            </span>
          </div>
          <button
            onClick={() => setShowPOSHelper(!showPOSHelper)}
            className="text-[11px] font-bold text-emerald-300 hover:text-white flex items-center gap-1 cursor-pointer underline flex-shrink-0"
          >
            {showPOSHelper ? '收起機器人點餐模擬' : '展開凱比機器人點餐對接模擬'}
            {showPOSHelper ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Collapsible POS simulation for testing scan */}
      {showPOSHelper && (
        <div className="max-w-7xl mx-auto px-4 mt-4 animate-in fade-in duration-200">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-3xl">
            <h3 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-400" />
              凱比機器人點餐 POS (用於產生測試付款 QR Code 條碼)
            </h3>
            <KebbiRobotPOS onOrderCreated={(token) => setLatestRobotToken(token)} />
          </div>
        </div>
      )}

      {/* Main Workspace Layout */}
      <main className="max-w-7xl mx-auto px-4 mt-6">
        {viewMode === 'mobile' && (
          <div className="max-w-md mx-auto">
            <MobileWalletPWA userId={demoUserId} latestRobotToken={latestRobotToken} />
          </div>
        )}

        {viewMode === 'split' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5">
              <MobileWalletPWA userId={demoUserId} latestRobotToken={latestRobotToken} />
            </div>
            <div className="lg:col-span-7">
              <KebbiRobotPOS onOrderCreated={(token) => setLatestRobotToken(token)} />
            </div>
          </div>
        )}

        {/* Specifications & SQL Viewer */}
        <RoflowSpecViewer />
      </main>
    </div>
  );
}
