import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, QrCode, Sparkles } from 'lucide-react';
import {
  ref,
  get,
  update,
} from 'firebase/database';

import { database } from '../firebase';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (token: string) => void;
  latestRobotToken?: string;
}

const ROBOT_ID = 'KEBBI_ROBOT_001';

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  latestRobotToken,
}) => {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [firebaseLatestOrderId, setFirebaseLatestOrderId] =
    useState<string>('');
  const [latestOrderLoading, setLatestOrderLoading] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isScanningRef = useRef(false);

  const fetchLatestRobotOrder = useCallback(async () => {
    try {
      setLatestOrderLoading(true);

      const latestRef = ref(
        database,
        `robots/${ROBOT_ID}/latest_order`
      );

      const latestSnapshot = await get(latestRef);

      if (!latestSnapshot.exists()) {
        setFirebaseLatestOrderId('');
        return;
      }

      const latest = latestSnapshot.val();
      const orderId = String(latest?.order_id ?? '').trim();

      if (!orderId) {
        setFirebaseLatestOrderId('');
        return;
      }

      // 再讀真正的 orders 資料，避免 latest_order 狀態過舊。
      const orderRef = ref(database, `orders/${orderId}`);
      const orderSnapshot = await get(orderRef);

      if (!orderSnapshot.exists()) {
        setFirebaseLatestOrderId('');
        return;
      }

      const order = orderSnapshot.val();

      // 已付款或已失效的訂單不提供一鍵帶入。
      if (order.status !== 'PENDING') {
        setFirebaseLatestOrderId('');

        // 順便同步 latest_order 狀態，避免指標過舊。
        const currentLatestSnapshot = await get(latestRef);
        if (
          currentLatestSnapshot.exists() &&
          currentLatestSnapshot.val()?.order_id === orderId &&
          latest.status !== order.status
        ) {
          await update(latestRef, {
            status: order.status,
          });
        }

        return;
      }

      // PENDING 但已超過付款期限 → 標記 EXPIRED。
      if (
        order.expires_at &&
        Date.now() >= new Date(order.expires_at).getTime()
      ) {
        const expiredAt = new Date().toISOString();
        const currentLatestSnapshot = await get(latestRef);

        const updatesOnExpire: Record<string, any> = {
          [`orders/${orderId}/status`]: 'EXPIRED',
          [`orders/${orderId}/expired_at`]: expiredAt,
        };

        if (
          currentLatestSnapshot.exists() &&
          currentLatestSnapshot.val()?.order_id === orderId
        ) {
          updatesOnExpire[`robots/${ROBOT_ID}/latest_order/status`] = 'EXPIRED';
          updatesOnExpire[`robots/${ROBOT_ID}/latest_order/expired_at`] = expiredAt;
        }

        await update(ref(database), updatesOnExpire);

        setFirebaseLatestOrderId('');
        return;
      }

      setFirebaseLatestOrderId(orderId);
    } catch (err) {
      console.error('Fetch latest Kebbi order error:', err);
      setFirebaseLatestOrderId('');
    } finally {
      setLatestOrderLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    isScanningRef.current = false;
    setCameraError(null);

    void fetchLatestRobotOrder();

    let html5Qrcode: Html5Qrcode | null = null;

    const startScanner = async () => {
      try {
        html5Qrcode = new Html5Qrcode('qr-reader-element');
        scannerRef.current = html5Qrcode;

        await html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            const token = decodedText.trim();

            if (token && !isScanningRef.current) {
              isScanningRef.current = true;

              if (html5Qrcode?.isScanning) {
                html5Qrcode.stop().catch(() => {});
              }

              onScanSuccess(token);
            }
          },
          () => {
            // 連續掃描時的單幀辨識失敗屬正常情況，不顯示錯誤。
          }
        );
      } catch (err: any) {
        console.warn('Camera scanner init notice:', err);

        setCameraError(
          '未偵測到鏡頭或鏡頭權限被瀏覽器/iFrame 限制，可使用下方「一鍵帶入最新訂單」或手動輸入 order_id。'
        );
      }
    };

    const timer = window.setTimeout(() => {
      void startScanner();
    }, 300);

    return () => {
      window.clearTimeout(timer);

      const scanner = html5Qrcode ?? scannerRef.current;

      if (scanner?.isScanning) {
        scanner
          .stop()
          .catch((e) =>
            console.log('Stop scanner error:', e)
          );
      }

      scannerRef.current = null;
      isScanningRef.current = false;
    };
  }, [isOpen, fetchLatestRobotOrder, onScanSuccess]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const token = manualToken.trim();

    if (token) {
      onScanSuccess(token);
    }
  };

  const handleQuickFillLatest = () => {
    const latestToken =
      firebaseLatestOrderId ||
      latestRobotToken?.trim() ||
      '';

    if (latestToken) {
      onScanSuccess(latestToken);
    }
  };

  if (!isOpen) return null;

  const hasLatestOrder = Boolean(
    firebaseLatestOrderId || latestRobotToken
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400 rounded-xl">
              <Camera className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                掃描凱比螢幕 QR Code
              </h3>
              <p className="text-xs text-slate-500">
                將鏡頭對準凱比機器人螢幕
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center">
          <div className="w-full relative overflow-hidden rounded-2xl bg-slate-950 min-h-[260px] flex flex-col items-center justify-center border-2 border-dashed border-purple-500/30">
            <div
              id="qr-reader-element"
              className="w-full h-full text-white text-xs"
            />

            {cameraError && (
              <div className="p-4 text-center text-xs text-slate-300 space-y-2">
                <Camera className="w-8 h-8 mx-auto text-purple-400 opacity-60" />
                <p>{cameraError}</p>
              </div>
            )}
          </div>

          {/* Firebase / 同頁最新訂單快速帶入 */}
          {(hasLatestOrder || latestOrderLoading) && (
            <div className="w-full mt-4 p-3 bg-purple-50 dark:bg-purple-950/40 rounded-2xl border border-purple-200 dark:border-purple-800 flex items-center justify-between gap-3">
              <div className="text-xs text-purple-900 dark:text-purple-300 font-medium flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-purple-600 flex-shrink-0" />
                <span>
                  {latestOrderLoading
                    ? '正在讀取凱比最新待結帳訂單...'
                    : '已偵測到凱比最新待結帳訂單'}
                </span>
              </div>

              <button
                type="button"
                onClick={handleQuickFillLatest}
                disabled={latestOrderLoading || !hasLatestOrder}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {latestOrderLoading
                  ? '讀取中...'
                  : '一鍵帶入'}
              </button>
            </div>
          )}

          {/* Manual order_id input */}
          <form
            onSubmit={handleManualSubmit}
            className="w-full mt-4 space-y-2"
          >
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
              手動貼上或輸入訂單 ID（order_id）
            </label>

            <div className="flex gap-2">
              <input
                type="text"
                value={manualToken}
                onChange={(e) =>
                  setManualToken(e.target.value)
                }
                placeholder="-Oxxxxxxxxxxxxxxxx"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-purple-500 outline-hidden"
              />

              <button
                type="submit"
                className="px-4 py-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                確定
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
