import React, { useState } from 'react';
import { FileJson, Database, Copy, Check, Layers, Terminal, Play, Zap, CheckCircle2, CreditCard } from 'lucide-react';

export const RoflowSpecViewer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tester' | 'roflow' | 'sql'>('tester');
  const [copied, setCopied] = useState(false);

  // Live API Tester State - Pure dynamic origin without hardcoding
  const baseUrl =
  'https://kebbi-wallet-default-rtdb.asia-southeast1.firebasedatabase.app';
  const [testAmount, setTestAmount] = useState('100');
  const [testRobotId, setTestRobotId] = useState('KEBBI_ROBOT_001');
  const [apiLoading, setApiLoading] = useState(false);
  const [apiResponse, setApiResponse] = useState<any | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string>('');

  const curlCreateOrder = `curl -X POST "${baseUrl}/orders.json" \\
  -H "Content-Type: application/json" \\
  -d '{"robot_id":"${testRobotId}","total_amount":${testAmount || '100'},"status":"PENDING","items":[{"name":"凱比特調漢堡","quantity":1,"price":${testAmount || '100'}}]}'`;

  const curlCheckStatus = lastOrderId
  ? `curl -X GET "${baseUrl}/orders/${lastOrderId}.json"`
  : `curl -X GET "${baseUrl}/orders/{{ORDER_ID}}.json"`;

  const curlWalletPay = lastOrderId
  ? `curl -X PATCH "${baseUrl}/orders/${lastOrderId}.json" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"PAID"}'`
  : `curl -X PATCH "${baseUrl}/orders/{{ORDER_ID}}.json" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"PAID"}'`;

  const handleRunApiTest = async () => {
  setApiLoading(true);
  setApiResponse(null);

  try {
    const amount = Number(testAmount || 100);

    const res = await fetch(
      `${baseUrl}/orders.json`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          robot_id: testRobotId,

          total_amount: amount,

          total_amount_cents:
            Math.round(amount * 100),

          status: 'PENDING',

          items: [
            {
              name: '凱比特調點餐',
              quantity: 1,
              price: amount,
            },
          ],

          created_at:
            new Date().toISOString(),
        }),
      }
    );

    const json = await res.json();

    setApiResponse({
      status: res.status,
      data: json,
    });

    // Firebase POST 回傳：
    // { "name": "-Oxxxxxxx" }

    if (json?.name) {
      setLastOrderId(json.name);
    }

  } catch (err: any) {
    setApiResponse({
      error:
        err.message || 'Firebase 連線失敗',
    });
  } finally {
    setApiLoading(false);
  }
};

  const handleRunStatusTest = async () => {
  if (!lastOrderId) return;

  setApiLoading(true);

  try {
    const res = await fetch(
      `${baseUrl}/orders/${lastOrderId}.json`
    );

    const json = await res.json();

    setApiResponse({
      status: res.status,
      data: json,
    });

  } catch (err: any) {
    setApiResponse({
      error:
        err.message || 'Firebase 連線失敗',
    });
  } finally {
    setApiLoading(false);
  }
};

  const handleRunPayTest = async () => {
  if (!lastOrderId) return;

  setApiLoading(true);

  try {
    const res = await fetch(
      `${baseUrl}/orders/${lastOrderId}.json`,
      {
        method: 'PATCH',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          status: 'PAID',
          paid_at:
            new Date().toISOString(),
        }),
      }
    );

    const json = await res.json();

    setApiResponse({
      status: res.status,
      data: json,
      note:
        '此按鈕僅模擬 PAID，不會真正扣除錢包餘額',
    });

  } catch (err: any) {
    setApiResponse({
      error:
        err.message || 'Firebase 更新失敗',
    });
  } finally {
    setApiLoading(false);
  }
};

  const roflowJson = `{
  "system": "NUWA Kebbi + Firebase Realtime Database",
  "version": "3.0.0",

  "base_url": "${baseUrl}",

  "create_order": {
    "method": "POST",
    "url": "${baseUrl}/orders.json",

    "headers": {
      "Content-Type": "application/json"
    },

    "body": {
      "robot_id": "KEBBI_ROBOT_001",
      "total_amount": 100,
      "status": "PENDING",

      "items": [
        {
          "name": "餐點",
          "quantity": 1,
          "price": 100
        }
      ]
    },

    "firebase_response": {
      "name": "-Oxxxxxxxxxxxxxxxx"
    },

    "roflow_mapping": {
      "name": "order_id"
    }
  },

  "qr_code": {
    "content": "{{order_id}}",
    "image_url": "https://quickchart.io/qr?size=300&text={{order_id}}"
  },

  "check_order": {
    "method": "GET",
    "url": "${baseUrl}/orders/{{order_id}}.json",

    "roflow_mapping": {
      "status": "order_status"
    },

    "statuses": [
      "PENDING",
      "PAID",
      "EXPIRED"
    ]
  }
}`;

  const firebaseSchema = `{
  "users": {
    "1": {
      "name": "Onion",
      "phone": "0912345678",
      "balance": 500,
      "linked_bank": {
        "account_number": "8220011223344",
        "is_verified": true,
        "mock_bank_balance": 50000
      }
    }
  },

  "orders": {
    "-Oxxxxxxxx": {
      "robot_id": "KEBBI_ROBOT_001",
      "total_amount": 100,
      "total_amount_cents": 10000,
      "status": "PENDING",
      "items": [
        {
          "name": "餐點",
          "quantity": 1,
          "price": 100
        }
      ],
      "created_at": "ISO_DATE"
    }
  },

  "transactions": {
    "1": {
      "-Otransaction": {
        "type": "PAYMENT",
        "amount": 100,
        "amount_cents": 10000,
        "order_id": "-Oxxxxxxxx",
        "created_at": "ISO_DATE"
      }
    }
  },

  "mock_banks": {
    "8220011223344": {
      "owner_user_id": 1,
      "mock_bank_balance": 50000,
      "mock_bank_balance_cents": 5000000,
      "is_verified": true
    }
  }
}`;

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
            Firebase Schema
          </button>
        </div>
      </div>

      {activeTab === 'tester' && (
        <div className="mt-4 space-y-4">
          {/* Instructions Box */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-xs space-y-2 text-slate-300">
            <div className="flex items-center gap-2 font-bold text-indigo-300 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Firebase Realtime Database API 基礎網址：</span>
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

            {/* Step 3: Simulate PAID Status */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
              <h4 className="font-bold text-xs text-amber-300 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-amber-400" /> 3. 模擬付款狀態 (PATCH)
              </h4>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                除錯用途：只會把 Firebase 訂單狀態改成 PAID，不會扣除錢包或模擬銀行餘額。
              </p>
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-slate-400 text-[11px]">訂單 ID (order_id)</label>
                  <input
                    type="text"
                    value={lastOrderId}
                    onChange={(e) => setLastOrderId(e.target.value)}
                    placeholder="建單後自動帶入"
                    className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 font-mono text-white text-xs"
                  />
                </div>

                <button
                  onClick={handleRunPayTest}
                  disabled={apiLoading || !lastOrderId}
                  className="w-full mt-2 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{apiLoading ? '更新中...' : '模擬 PAID'}</span>
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
            onClick={() => copyContent(activeTab === 'roflow' ? roflowJson : firebaseSchema)}
            className="absolute top-3 right-3 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 z-10 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已複製到剪貼簿' : '複製內容'}
          </button>

          <pre className="bg-slate-950 p-4 rounded-2xl text-xs font-mono text-emerald-400 overflow-x-auto max-h-[380px] leading-relaxed border border-slate-800/80">
            <code>{activeTab === 'roflow' ? roflowJson : firebaseSchema}</code>
          </pre>
        </div>
      )}
    </div>
  );
};

