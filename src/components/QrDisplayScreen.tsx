import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Bot, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';

export const QrDisplayScreen: React.FC = () => {
  const pathParts = window.location.pathname.split('/');
  const orderId = pathParts[pathParts.length - 1] || '';

  const [order, setOrder] = useState<any | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  // Fetch Order Details
  const fetchOrder = async () => {
    if (!orderId) {
      setError('無效的訂單編號');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/v1/robot/orders/status/${orderId}`);
      if (!res.ok) {
        throw new Error(`找不到訂單 ID: ${orderId}`);
      }
      const json = await res.json();
      const orderData = json.data || json;
      setOrder(orderData);

      if (orderData.qr_code_token) {
        const url = await QRCode.toDataURL(orderData.qr_code_token, {
          width: 400,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setQrCodeDataUrl(url);
      }
    } catch (err: any) {
      setError(err.message || '無法載入訂單');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
    // Poll every 1.5 seconds for payment state change
    const interval = setInterval(() => {
      fetchOrder();
    }, 1500);

    return () => clearInterval(interval);
  }, [orderId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6">
        <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <p className="text-slate-300 font-bold">載入點餐付款 QR Code 中...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="p-4 bg-red-950/80 border border-red-800 rounded-3xl max-w-sm">
          <p className="font-bold text-red-300 text-lg mb-2">無法載入付款頁面</p>
          <p className="text-xs text-red-200">{error || '訂單不存在或已過期'}</p>
        </div>
      </div>
    );
  }

  const isPaid = order.status === 'PAID';

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 select-none">
      <div className="w-full max-w-sm bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center space-y-5 relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 text-emerald-400">
          <Bot className="w-6 h-6" />
          <span className="font-bold tracking-wide text-sm">女媧凱比點餐 - 電子支付專區</span>
        </div>

        {/* Order Price Display */}
        <div className="bg-slate-950 w-full py-3 px-4 rounded-2xl border border-slate-800">
          <p className="text-xs text-slate-400">點餐消費總金額</p>
          <p className="text-3xl font-extrabold text-amber-400 tracking-tight mt-0.5">
            ${order.total_amount || 100}
          </p>
        </div>

        {/* QR Code or Success Animation */}
        {!isPaid ? (
          <div className="space-y-4 w-full flex flex-col items-center">
            <div className="p-3 bg-white rounded-3xl shadow-xl border-4 border-emerald-500/80 inline-block">
              {qrCodeDataUrl ? (
                <img
                  src={qrCodeDataUrl}
                  alt="Order QR Code"
                  className="w-64 h-64 object-contain rounded-2xl"
                />
              ) : (
                <div className="w-64 h-64 flex items-center justify-center text-slate-500">
                  產生條碼中...
                </div>
              )}
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-emerald-300 bg-emerald-950/80 px-4 py-2 rounded-full border border-emerald-800/80 animate-pulse">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>請打開手機 Onion Pay 錢包，掃描上方 QR Code 付款</span>
            </div>
          </div>
        ) : (
          <div className="py-8 space-y-4 w-full flex flex-col items-center animate-in zoom-in-95 duration-300">
            <div className="p-4 bg-emerald-500/20 rounded-full border-4 border-emerald-500">
              <CheckCircle2 className="w-20 h-20 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-emerald-400">付款成功！</h2>
              <p className="text-xs text-slate-300 mt-1">感謝您的消費，凱比正在為您準備餐點！</p>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-800/80 w-full">
          訂單編號: <span className="font-mono text-slate-400">{order.id}</span>
        </div>
      </div>
    </div>
  );
};
