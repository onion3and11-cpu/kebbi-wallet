import React, { useState, useEffect } from 'react';
import {
  Bot,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  QrCode,
  CheckCircle,
  Clock,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { MOCK_MENU, MenuItem } from '../data/mockMenu';

interface KebbiRobotPOSProps {
  onOrderCreated?: (qrToken: string) => void;
}

export const KebbiRobotPOS: React.FC<KebbiRobotPOSProps> = ({ onOrderCreated }) => {
  const [cart, setCart] = useState<{ item: MenuItem; quantity: number }[]>([]);
  const [activeOrder, setActiveOrder] = useState<any | null>(null);
  const [orderStatus, setOrderStatus] = useState<string>('IDLE');
  const [kebbiMood, setKebbiMood] = useState<'IDLE' | 'WAITING_PAYMENT' | 'HAPPY' | 'SERVED'>('IDLE');
  const [speechText, setSpeechText] = useState('您好！我是凱比機器人，請點擊餐點開始為您服務喔！');
  const [isPolling, setIsPolling] = useState(false);

  const robotId = 'KEBBI_ROBOT_001';

  const addToCart = (menuItem: MenuItem) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === menuItem.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx].quantity += 1;
        return updated;
      }
      return [...prev, { item: menuItem, quantity: 1 }];
    });
  };

  const updateCartQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.item.id === id) {
            const newQty = c.quantity + delta;
            return newQty > 0 ? { ...c, quantity: newQty } : null;
          }
          return c;
        })
        .filter(Boolean) as { item: MenuItem; quantity: number }[]
    );
  };

  const totalCartAmount = cart.reduce((sum, c) => sum + c.item.price * c.quantity, 0);

  // Submit Order & Generate QR Code
  const handleCreateOrder = async () => {
    if (cart.length === 0) return;

    try {
      const res = await fetch('/api/v1/web/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          robot_id: robotId,
          total_amount: totalCartAmount,
          items: cart.map((c) => ({
            name: c.item.name,
            quantity: c.quantity,
            price: c.item.price,
          })),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setActiveOrder(data.data);
        setOrderStatus('PENDING');
        setKebbiMood('WAITING_PAYMENT');
        setSpeechText('訂單已建立！請使用手機電子錢包掃描螢幕上的 QR Code 完成結帳喔！');

        if (onOrderCreated) {
          onOrderCreated(data.data.qr_code_token);
        }
      }
    } catch (err) {
      console.error('Failed to create order:', err);
    }
  };

  // NUWA Kebbi Roflow Polling Loop Simulator (Every 1.5 Seconds)
  useEffect(() => {
    if (!activeOrder || orderStatus !== 'PENDING') return;

    setIsPolling(true);
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/web/orders/status/${activeOrder.order_id}`);
        const data = await res.json();

        if (data.success && data.data) {
          if (data.data.status === 'PAID') {
            setOrderStatus('PAID');
            setKebbiMood('HAPPY');
            setSpeechText('🎉 付款成功！感謝您的訂購，餐點正在現做中！請至取餐口等候呼叫。');
            setIsPolling(false);
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error('Roflow polling error:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeOrder, orderStatus]);

  const resetOrder = () => {
    setCart([]);
    setActiveOrder(null);
    setOrderStatus('IDLE');
    setKebbiMood('IDLE');
    setSpeechText('您好！我是凱比機器人，請點擊餐點開始點餐！');
  };

  return (
    <div className="max-w-4xl mx-auto bg-slate-900 text-slate-100 rounded-3xl p-6 shadow-2xl border border-slate-800 flex flex-col md:flex-row gap-6 relative overflow-hidden">
      {/* Kebbi Screen Header / Robot Avatar Section */}
      <div className="w-full md:w-1/3 flex flex-col items-center bg-slate-950 p-6 rounded-2xl border border-slate-800 text-center">
        {/* Kebbi Ears Animation */}
        <div className="relative w-48 h-44 my-2 flex items-center justify-center">
          {/* Kebbi Robot Screen Box */}
          <div
            className={`w-40 h-36 rounded-3xl border-4 p-3 flex flex-col items-center justify-center transition-all duration-300 shadow-xl relative ${
              kebbiMood === 'HAPPY'
                ? 'border-emerald-500 bg-emerald-950/40 shadow-emerald-500/20'
                : kebbiMood === 'WAITING_PAYMENT'
                ? 'border-indigo-500 bg-indigo-950/40 shadow-indigo-500/20'
                : 'border-blue-500 bg-slate-900'
            }`}
          >
            {/* Robot Eyes & Mouth Expressions */}
            {kebbiMood === 'HAPPY' ? (
              <div className="space-y-3">
                <div className="flex gap-6">
                  <div className="w-6 h-4 border-t-4 border-emerald-400 rounded-t-full animate-bounce" />
                  <div className="w-6 h-4 border-t-4 border-emerald-400 rounded-t-full animate-bounce" />
                </div>
                <div className="w-8 h-4 border-b-4 border-emerald-400 rounded-b-full mx-auto" />
              </div>
            ) : kebbiMood === 'WAITING_PAYMENT' ? (
              <div className="space-y-3">
                <div className="flex gap-6">
                  <div className="w-6 h-6 rounded-full bg-indigo-400 animate-pulse" />
                  <div className="w-6 h-6 rounded-full bg-indigo-400 animate-pulse" />
                </div>
                <div className="w-10 h-1.5 bg-indigo-400 rounded-full mx-auto" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-6">
                  <div className="w-5 h-5 rounded-full bg-blue-400" />
                  <div className="w-5 h-5 rounded-full bg-blue-400" />
                </div>
                <div className="w-8 h-2 bg-blue-400 rounded-full mx-auto" />
              </div>
            )}

            <span className="absolute top-2 right-2 text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 font-mono">
              Roflow POS
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-slate-300 mt-2">
          <Bot className="w-4 h-4 text-indigo-400" />
          <span>NUWA Kebbi Air ({robotId})</span>
        </div>

        {/* Kebbi TTS Speech Bubble */}
        <div className="mt-4 p-3.5 bg-indigo-950/60 border border-indigo-800/60 rounded-2xl text-xs text-indigo-200 relative text-left leading-relaxed w-full">
          <div className="flex items-center gap-1.5 font-bold text-indigo-400 mb-1">
            <Volume2 className="w-3.5 h-3.5 animate-pulse" />
            <span>凱比語音引導 (TTS)：</span>
          </div>
          {speechText}
        </div>

        {/* Order QR Code Display Area */}
        {activeOrder && orderStatus === 'PENDING' && (
          <div className="mt-4 w-full p-4 bg-white text-slate-900 rounded-2xl flex flex-col items-center animate-in zoom-in duration-300">
            <span className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1">
              <QrCode className="w-4 h-4 text-indigo-600" /> 凱比點餐結帳 QR Code
            </span>
            <img
              src={activeOrder.qr_code_image_base64}
              alt="Payment QR Code"
              className="w-44 h-44 rounded-xl border border-slate-200 shadow-md"
            />
            <span className="text-[10px] text-slate-500 font-mono mt-2 bg-slate-100 px-2 py-0.5 rounded">
              {activeOrder.qr_code_token}
            </span>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-indigo-600 font-bold bg-indigo-50 px-3 py-1 rounded-full">
              <Clock className="w-3.5 h-3.5 animate-spin" />
              <span>Roflow API 輪詢監聽中...</span>
            </div>
          </div>
        )}

        {orderStatus === 'PAID' && (
          <div className="mt-4 w-full p-4 bg-emerald-950/80 border border-emerald-500/40 rounded-2xl flex flex-col items-center animate-in zoom-in duration-300 text-emerald-200">
            <CheckCircle className="w-12 h-12 text-emerald-400 mb-2 animate-bounce" />
            <h4 className="font-bold text-sm text-white">點餐扣款完成！</h4>
            <p className="text-xs text-emerald-300 mt-1">訂單編號: {activeOrder.order_id.slice(0, 8)}</p>
            <button
              onClick={resetOrder}
              className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              再點一單
            </button>
          </div>
        )}
      </div>

      {/* POS Menu & Cart Selection Area */}
      <div className="w-full md:w-2/3 flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              智慧機器人無人自助點餐機
            </h3>
            <span className="text-xs text-slate-400">點擊新增餐點</span>
          </div>

          {/* Menu Items Grid */}
          <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-1">
            {MOCK_MENU.map((item) => (
              <div
                key={item.id}
                onClick={() => addToCart(item)}
                className="p-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 rounded-2xl transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <span className="text-2xl">{item.image}</span>
                    <span className="font-mono text-sm font-bold text-amber-400">${item.price}</span>
                  </div>
                  <h4 className="font-bold text-xs text-white mt-2 group-hover:text-indigo-300 transition-colors">
                    {item.name}
                  </h4>
                  <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{item.description}</p>
                </div>
                <div className="mt-2 text-right">
                  <span className="inline-flex items-center gap-1 text-[10px] bg-indigo-600/30 text-indigo-300 font-bold px-2 py-0.5 rounded-full border border-indigo-500/30">
                    <Plus className="w-3 h-3" /> 加入購物車
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cart Summary & Order Button */}
        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <ShoppingCart className="w-4 h-4 text-indigo-400" /> 已選餐點清單 ({cart.reduce((s, c) => s + c.quantity, 0)})
            </span>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-[11px] text-slate-400 hover:text-red-400 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" /> 清空
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
              購物車是空的，請上方選擇美味餐點
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[120px] overflow-y-auto mb-3 pr-1">
              {cart.map((c) => (
                <div
                  key={c.item.id}
                  className="flex justify-between items-center bg-slate-950/60 px-3 py-1.5 rounded-xl text-xs"
                >
                  <span className="font-medium text-slate-200">
                    {c.item.image} {c.item.name}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-slate-400">${c.item.price * c.quantity}</span>
                    <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-700">
                      <button
                        onClick={() => updateCartQty(c.item.id, -1)}
                        className="text-slate-400 hover:text-white cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="font-mono font-bold text-xs px-1">{c.quantity}</span>
                      <button
                        onClick={() => updateCartQty(c.item.id, 1)}
                        className="text-slate-400 hover:text-white cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Submit Order Bar */}
          <div className="flex items-center justify-between pt-2">
            <div>
              <span className="text-xs text-slate-400 block">總金額 (Total)</span>
              <span className="text-2xl font-black font-mono text-amber-400">${totalCartAmount}</span>
            </div>
            <button
              onClick={handleCreateOrder}
              disabled={cart.length === 0 || orderStatus === 'PENDING'}
              className="px-6 py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center gap-2 disabled:opacity-50 transition-all cursor-pointer"
            >
              <QrCode className="w-5 h-5" />
              <span>送出點餐並產生付款 QR Code</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
