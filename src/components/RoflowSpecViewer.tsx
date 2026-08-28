import React, { useState } from 'react';
import { FileJson, Database, Copy, Check, Layers, Terminal, Play, Zap, CheckCircle2, AlertTriangle, CreditCard } from 'lucide-react';

export const RoflowSpecViewer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tester' | 'roflow' | 'sql'>('tester');
  const [copied, setCopied] = useState(false);

  // Live API Tester State - Pure dynamic origin without hardcoding
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const [testAmount, setTestAmount] = useState('100');
  const [testRobotId, setTestRobotId] = useState('KEBBI_ROBOT_001');
  const [testPin, setTestPin] = useState('1234');
  const [apiLoading, setApiLoading] = useState(false);
  const [apiResponse, setApiResponse] = useState<any | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string>('');
  const [lastQrToken, setLastQrToken] = useState<string>('');

  const curlCreateOrder = `curl -X POST "${baseUrl}/api/v1/robot/orders" \\
  -H "Content-Type: application/json" \\
  -H "X-Roflow-Key: <ROFLOW_TOKEN>" \\
  -H "X-Robot-ID: ${testRobotId}" \\
  -d '{"robot_id": "${testRobotId}", "total_amount": ${testAmount || '100'}, "items": [{"name": "凱比特調漢堡", "quantity": 1, "price": ${testAmount || '100'}}]}'`;

  const curlCheckStatus = lastOrderId
    ? `curl -X GET "${baseUrl}/api/v1/robot/orders/status?order_id=${lastOrderId}" \\
  -H "X-Roflow-Key: <ROFLOW_TOKEN>"`
    : `curl -X GET "${baseUrl}/api/v1/robot/orders/status?order_id={{ORDER_ID}}" \\
  -H "X-Roflow-Key: <ROFLOW_TOKEN>"`;

  const curlWalletPay = `curl -X POST "${baseUrl}/api/v1/wallet/pay" \\
  -H "Content-Type: application/json" \\
  -d '{"user_id": 1, "qr_code_token": "${lastQrToken || 'KEBBI_PAY_TOK_...'}", "pin": "${testPin || '1234'}"}'`;

  const handleRunApiTest = async () => {
    setApiLoading(true);
    setApiResponse(null);
    try {
      const res = await fetch('/api/v1/web/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Robot-ID': testRobotId,
        },
        body: JSON.stringify({
          robot_id: testRobotId,
          total_amount: Number(testAmount || 100),
          items: [{ name: '凱比特調點餐', quantity: 1, price: Number(testAmount || 100) }],
        }),
      });

      const json = await res.json();
      setApiResponse({ status: res.status, data: json });
      if (json?.data?.order_id) {
        setLastOrderId(json.data.order_id);
      }
      if (json?.data?.qr_code_token) {
        setLastQrToken(json.data.qr_code_token);
      }
    } catch (err: any) {
      setApiResponse({ error: err.message || '連線失敗' });
    } finally {
      setApiLoading(false);
    }
  };

  const handleRunStatusTest = async () => {
    if (!lastOrderId) return;
    setApiLoading(true);
    try {
      const res = await fetch(`/api/v1/web/orders/status?order_id=${lastOrderId}`);
      const json = await res.json();
      setApiResponse({ status: res.status, data: json });
    } catch (err: any) {
      setApiResponse({ error: err.message || '連線失敗' });
    } finally {
      setApiLoading(false);
    }
  };

  const handleRunPayTest = async () => {
    if (!lastQrToken) return;
    setApiLoading(true);
    try {
      const res = await fetch('/api/v1/wallet/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 1,
          qr_code_token: lastQrToken,
          pin: testPin,
        }),
      });
      const json = await res.json();
      setApiResponse({ status: res.status, data: json });
    } catch (err: any) {
      setApiResponse({ error: err.message || '連線失敗' });
    } finally {
      setApiLoading(false);
    }
  };

  const roflowJson = `{
  "system": "NUWA Kebbi Robot & E-Wallet REST API Specification",
  "version": "2.0.0",
  "cors_enabled": true,
  "base_url": "${baseUrl}",
  "endpoints": {
    "create_order": {
      "method": "POST",
      "path": "/api/v1/robot/orders",
      "headers": {
        "Content-Type": "application/json",
        "X-Roflow-Key": "<ROFLOW_TOKEN>",
        "X-Robot-ID": "{{ROBOT_ID}}"
      },
      "request_body": {
        "robot_id": "KEBBI_ROBOT_001",
        "total_amount": 100.00,
        "items": [{ "name": "經典套餐", "quantity": 1, "price": 100.00 }]
      },
      "response_format": {
        "success": true,
        "data": {
          "order_id": "9b1deb4d-3b7d-4bad-9bd2-2ca771600123",
          "qr_code_token": "KEBBI_PAY_TOK_9b1deb4d-3b7d-4bad-9bd2-2ca771600123",
          "qr_code_image_base64": "data:image/png;base64,...",
          "status": "PENDING",
          "total_amount": 100.00,
          "robot_id": "KEBBI_ROBOT_001"
        },
        "error": null
      }
    },
    "poll_order_status": {
      "method": "GET",
      "path": "/api/v1/robot/orders/status?order_id={{order_id}}",
      "alternative_path": "/api/v1/robot/orders/status/{{order_id}}",
      "headers": {
        "X-Roflow-Key": "<ROFLOW_TOKEN>"
      },
      "response_format": {
        "success": true,
        "data": {
          "order_id": "9b1deb4d-3b7d-4bad-9bd2-2ca771600123",
          "total_amount": 100.00,
          "status": "PENDING"
        },
        "error": null
      },
      "polling_config": {
        "interval_ms": 1500,
        "timeout_seconds": 180
      }
    },
    "wallet_pay": {
      "method": "POST",
      "path": "/api/v1/wallet/pay",
      "headers": { "Content-Type": "application/json" },
      "request_body": {
        "user_id": 1,
        "qr_code_token": "KEBBI_PAY_TOK_9b1deb4d-3b7d-4bad-9bd2-2ca771600123",
        "pin": "1234"
      },
      "response_format": {
        "success": true,
        "data": {
          "order_id": "9b1deb4d-3b7d-4bad-9bd2-2ca771600123",
          "status": "PAID",
          "paid_amount": 100.00,
          "wallet_balance_before": 150.00,
          "wallet_balance_after": 50.00,
          "auto_recharged": false,
          "auto_recharge_amount": 0,
          "transaction_id": 1
        },
        "error": null
      }
    },
    "health_check": {
      "method": "GET",
      "path": "/api/health",
      "response_format": {
        "status": "ok"
      }
    }
  }
}`;

  const sqlSchema = `-- NUWA Kebbi Robot E-Wallet Database Schema (Cloudflare D1 / SQLite)
-- 包含原子事務、整數分 (Cents) 儲存與 CHECK 約束保護

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    payment_pin_hash TEXT NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 15000 CHECK (balance_cents >= 0),
    is_auto_recharge_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_auto_recharge_enabled IN (0, 1)),
    failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mock_bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank_code TEXT NOT NULL DEFAULT '822',
    account_number TEXT UNIQUE NOT NULL,
    bank_password_hash TEXT NOT NULL,
    mock_bank_balance_cents INTEGER NOT NULL DEFAULT 5000000 CHECK (mock_bank_balance_cents >= 0),
    is_verified INTEGER NOT NULL DEFAULT 1 CHECK (is_verified IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED')),
    qr_code_token TEXT UNIQUE NOT NULL,
    items_json TEXT,
    paid_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('PAYMENT', 'MANUAL_RECHARGE', 'AUTO_RECHARGE', 'TRANSFER_OUT', 'TRANSFER_IN')),
    mock_bank_account_id INTEGER REFERENCES mock_bank_accounts(id) ON DELETE SET NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

  const copyContent = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-3xl p-6 text-slate-100 shadow-xl mt-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-800">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            女媧凱比 (NUWA Kebbi) Roflow API 串接與測試除錯工具
          </h3>
          <p className="text-xs text-slate-400">所有 API 均支援無 Cookie / 免 Google 登入呼叫，回傳標準 JSON</p>
        </div>

        {/* Tab Buttons */}
        <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800">
          <button
            onClick={() => setActiveTab('tester')}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'tester'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-yellow-300" />
            API 線上除錯
          </button>
          <button
            onClick={() => setActiveTab('roflow')}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'roflow'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileJson className="w-3.5 h-3.5" />
            Roflow JSON 規格
          </button>
          <button
            onClick={() => setActiveTab('sql')}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'sql'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            PostgreSQL Schema
          </button>
        </div>
      </div>

      {activeTab === 'tester' && (
        <div className="mt-4 space-y-4">
          {/* Instructions Box */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-xs space-y-2 text-slate-300">
            <div className="flex items-center gap-2 font-bold text-indigo-300 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>目前服務端 API 基礎網址 (動態解析)：</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                value={baseUrl}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-xs text-emerald-300"
              />
              <button
                onClick={() => copyContent(baseUrl)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-xs cursor-pointer flex-shrink-0"
              >
                複製 Base URL
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Step 1: Create Order */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
              <h4 className="font-bold text-xs text-indigo-300 flex items-center gap-1.5">
                <Terminal className="w-4 h-4" /> 1. 建立訂單 (POST)
              </h4>
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-slate-400 text-[11px]">機器人 ID (robot_id)</label>
                  <input
                    type="text"
                    value={testRobotId}
                    onChange={(e) => setTestRobotId(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 font-mono text-white text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-[11px]">總金額 (total_amount)</label>
                  <input
                    type="number"
                    value={testAmount}
                    onChange={(e) => setTestAmount(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 font-mono text-white text-xs"
                  />
                </div>

                <button
                  onClick={handleRunApiTest}
                  disabled={apiLoading}
                  className="w-full mt-2 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{apiLoading ? '發送中...' : '送出建單'}</span>
                </button>
              </div>
            </div>

            {/* Step 2: Check Status */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
              <h4 className="font-bold text-xs text-emerald-300 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-yellow-400" /> 2. 輪詢查單 (GET)
              </h4>
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-slate-400 text-[11px]">訂單 ID (order_id)</label>
                  <input
                    type="text"
                    value={lastOrderId}
                    onChange={(e) => setLastOrderId(e.target.value)}
                    placeholder="先送出建單或貼上 order_id"
                    className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 font-mono text-white text-xs"
                  />
                </div>

                <button
                  onClick={handleRunStatusTest}
                  disabled={apiLoading || !lastOrderId}
                  className="w-full mt-2 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{apiLoading ? '查詢中...' : '查詢狀態'}</span>
                </button>
              </div>
            </div>

            {/* Step 3: Wallet Pay */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
              <h4 className="font-bold text-xs text-amber-300 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-amber-400" /> 3. 錢包付款 (POST)
              </h4>
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-slate-400 text-[11px]">QR Token</label>
                  <input
                    type="text"
                    value={lastQrToken}
                    onChange={(e) => setLastQrToken(e.target.value)}
                    placeholder="建單後自動帶入"
                    className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 font-mono text-white text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-[11px]">PIN 碼</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={testPin}
                    onChange={(e) => setTestPin(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 font-mono text-white text-xs"
                  />
                </div>

                <button
                  onClick={handleRunPayTest}
                  disabled={apiLoading || !lastQrToken}
                  className="w-full mt-2 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{apiLoading ? '扣款中...' : '模擬付款'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* cURL Command Helper */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-300">cURL 測試範例（可直接複製在終端機執行）</span>
              <button
                onClick={() => copyContent(`${curlCreateOrder}\n\n${curlCheckStatus}\n\n${curlWalletPay}`)}
                className="text-xs text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" /> 複製全部 cURL
              </button>
            </div>
            <pre className="p-3 bg-slate-900 rounded-xl text-[11px] font-mono text-emerald-400 overflow-x-auto border border-slate-800">
              <code>{curlCreateOrder}</code>
            </pre>
            <pre className="p-3 bg-slate-900 rounded-xl text-[11px] font-mono text-emerald-400 overflow-x-auto border border-slate-800 mt-2">
              <code>{curlCheckStatus}</code>
            </pre>
            <pre className="p-3 bg-slate-900 rounded-xl text-[11px] font-mono text-emerald-400 overflow-x-auto border border-slate-800 mt-2">
              <code>{curlWalletPay}</code>
            </pre>
          </div>

          {/* Response Output */}
          {apiResponse && (
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
              <span className="text-xs font-bold text-slate-300">API 回傳結果 (JSON Response)</span>
              <pre className="p-3 bg-slate-900 rounded-xl text-[11px] font-mono text-amber-300 overflow-x-auto max-h-48 border border-slate-800">
                <code>{JSON.stringify(apiResponse, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {(activeTab === 'roflow' || activeTab === 'sql') && (
        <div className="mt-4 relative">
          <button
            onClick={() => copyContent(activeTab === 'roflow' ? roflowJson : sqlSchema)}
            className="absolute top-3 right-3 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 z-10 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已複製到剪貼簿' : '複製內容'}
          </button>

          <pre className="bg-slate-950 p-4 rounded-2xl text-xs font-mono text-emerald-400 overflow-x-auto max-h-[380px] leading-relaxed border border-slate-800/80">
            <code>{activeTab === 'roflow' ? roflowJson : sqlSchema}</code>
          </pre>
        </div>
      )}
    </div>
  );
};

