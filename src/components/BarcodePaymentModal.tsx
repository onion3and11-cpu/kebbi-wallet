import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { RefreshCw, ShieldCheck, X, Zap } from 'lucide-react';
import { ref, set, update } from 'firebase/database';
import { database } from '../firebase';

interface BarcodePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: number;
}

export const BarcodePaymentModal: React.FC<BarcodePaymentModalProps> = ({
  isOpen,
  onClose,
  userId,
}) => {
  const [countdown, setCountdown] = useState(30);
  const [barcodeCode, setBarcodeCode] = useState('');
  const [qrBase64, setQrBase64] = useState<string>('');
  const [useExternalApi, setUseExternalApi] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const barcodeSvgRef = useRef<SVGSVGElement | null>(null);
  const activeCodeRef = useRef<string>('');

  const expireCode = async (code: string) => {
    if (!code) return;

    try {
      await update(ref(database, `payment_codes/${code}`), {
        status: 'EXPIRED',
        expired_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to expire payment code:', err);
    }
  };

  const generateNewBarcode = async () => {
    setCodeError(null);

    const oldCode = activeCodeRef.current;
    if (oldCode) {
      await expireCode(oldCode);
    }

    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const code = `PAY-${userId}-${Date.now()}-${randomSuffix}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30_000);

    try {
      await set(ref(database, `payment_codes/${code}`), {
        payment_code: code,
        user_id: userId,
        status: 'ACTIVE',
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      });

      activeCodeRef.current = code;
      setBarcodeCode(code);

      const base64 = await QRCode.toDataURL(code, {
        margin: 1,
        width: 280,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      setQrBase64(base64);
    } catch (err) {
      console.error('Failed to create Firebase payment code:', err);
      setCodeError('付款碼建立失敗，請檢查 Firebase 連線');
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    setCountdown(30);
    void generateNewBarcode();

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void generateNewBarcode();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      const codeToExpire = activeCodeRef.current;
      activeCodeRef.current = '';
      if (codeToExpire) {
        void expireCode(codeToExpire);
      }
    };
  }, [isOpen, userId]);

  useEffect(() => {
    if (barcodeSvgRef.current && barcodeCode && isOpen && !useExternalApi) {
      try {
        JsBarcode(barcodeSvgRef.current, barcodeCode, {
          format: 'CODE128',
          width: 1.5,
          height: 60,
          displayValue: true,
          fontOptions: 'bold',
          font: 'monospace',
          fontSize: 10,
          margin: 6,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch (err) {
        console.error('JsBarcode generation error:', err);
      }
    }
  }, [barcodeCode, isOpen, useExternalApi]);

  const externalBarcodeUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(
    barcodeCode
  )}&scale=3&rotate=N&includetext`;

  const externalQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(
    barcodeCode
  )}`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col items-center text-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 px-3 py-1 rounded-full text-xs font-bold mb-3">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>專題模擬付款碼</span>
        </div>

        <p className="text-xs text-slate-500 mb-3">
          請將此付款條碼 / QR Code 對準專題模擬店家掃描器
        </p>

        <div className="bg-white p-4 rounded-2xl border-2 border-slate-200 shadow-inner w-full flex flex-col items-center my-1">
          <div className="w-full bg-white p-2 border border-slate-200 rounded-xl flex flex-col items-center justify-center min-h-[90px]">
            {useExternalApi ? (
              <img
                src={externalBarcodeUrl}
                alt="Code128 Payment Barcode"
                className="max-h-20 w-full object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <svg ref={barcodeSvgRef} className="w-full max-h-20" />
            )}
          </div>

          <div className="my-3 border-t border-slate-200 w-full" />

          <div className="bg-white p-2 border-2 border-slate-900 rounded-lg shadow-xs flex flex-col items-center">
            {useExternalApi ? (
              <img
                src={externalQrUrl}
                alt="Payment QR Code"
                className="w-44 h-44 object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : qrBase64 ? (
              <img
                src={qrBase64}
                alt="Payment QR Code"
                className="w-44 h-44 object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="w-44 h-44 bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                產碼中...
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setUseExternalApi(!useExternalApi)}
              className="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline cursor-pointer"
            >
              {useExternalApi ? '切換成本地產碼' : '切換為外部產碼 API'}
            </button>
          </div>
        </div>

        {codeError && (
          <div className="mt-3 w-full p-3 bg-red-50 dark:bg-red-950/60 rounded-xl border border-red-200 dark:border-red-800 text-[11px] text-red-700 dark:text-red-300">
            {codeError}
          </div>
        )}

        <div className="flex items-center gap-2 mt-3 text-xs font-mono text-slate-600 dark:text-slate-300">
          <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />
          <span>付款碼每 30 秒自動更新：</span>
          <span className="font-bold text-blue-600 dark:text-blue-400">{countdown}s</span>
        </div>

        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/60 rounded-xl border border-blue-200 dark:border-blue-800 text-[11px] text-blue-800 dark:text-blue-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span>
            每組付款碼會同步寫入 Firebase，店家掃描後才能進行專題模擬扣款；這不是 LINE Pay、Google Pay 或支付寶的正式付款碼。
          </span>
        </div>
      </div>
    </div>
  );
};
