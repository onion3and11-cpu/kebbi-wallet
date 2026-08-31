# NUWA Kebbi Robot E-Wallet & Ordering System (Onion Pay)

基於 **React + Vite + Firebase Realtime Database** 的女媧凱比機器人 (NUWA Kebbi) 智慧點餐與電子支付錢包系統。

---

## 系統架構

```text
       GitHub Pages
            │
            ▼
   React / Vite Onion Pay
            │
            ▼
Firebase Realtime Database
            ▲
            │
    NUWA Kebbi Roflow
```

- **前端與展示部署**：[GitHub Pages 正式版](https://onion3and11-cpu.github.io/kebbi-wallet/)
- **正式 Firebase Realtime Database**：`https://kebbi-wallet-default-rtdb.asia-southeast1.firebasedatabase.app`
- **點餐機器人整合**：NUWA Kebbi Roflow 透過 Firebase REST API 進行無伺服器直接串接

---

## 核心功能模組

1. **行動電子錢包 (Mobile Wallet PWA)**：
   - 錢包即時餘額顯示
   - 好友轉帳（以手機號碼即時轉帳）
   - 銀行存款與模擬銀行帳戶綁定
   - 手動儲值至電子錢包
   - 不足額自動加值（以 $1,000 為單位）
   - 6 位數安全交易密碼 (Payment PIN) 驗證
   - 交易紀錄歷史清單

2. **多模式結帳與支付**：
   - **掃碼支付 (QR Scanner)**：手機鏡頭即時辨識凱比螢幕 QR Code，支援「一鍵帶入最新待結帳訂單」
   - **出示付款碼 (Barcode Payment)**：生成一維條碼與二維付款碼供店家掃描扣款
   - **凱比點餐 POS (Kebbi Robot POS)**：模擬機器人點餐、出單、倒數 3 分鐘逾時機制及即時狀態監聽
   - **獨立 QR 螢幕展示 (QrDisplayScreen)**：獨立大螢幕或平板顯示專用點餐 QR Code

3. **女媧 Roflow 串接規格 (Firebase REST API)**：
   - **建立訂單 (POST)**：
     - URL: `https://kebbi-wallet-default-rtdb.asia-southeast1.firebasedatabase.app/orders.json`
     - 回傳: `{ "name": "-Oxxxxxxxx" }`（對應 `order_id`）
   - **查詢訂單狀態 (GET)**：
     - URL: `https://kebbi-wallet-default-rtdb.asia-southeast1.firebasedatabase.app/orders/{{order_id}}.json`
     - 狀態包含: `PENDING`、`PAID`、`EXPIRED`
   - **QR Code 內容**：直接使用 `{{order_id}}`

---

## 本地開發與建置指令

```bash
# 啟動開發伺服器
npm run dev

# 檢查 TypeScript 型別
npm run lint

# 打包產出靜態網站 (輸出至 dist/)
npm run build

# 本地預覽打包結果
npm run preview
```
