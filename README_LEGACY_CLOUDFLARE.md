> **⚠️ 注意：此為已停用舊版架構，現行系統已改為 Firebase Realtime Database + GitHub Pages。**
> 請參閱根目錄 `README.md` 獲取最新正式架構說明。

---

# [LEGACY 歷史紀錄] NUWA Kebbi 電子錢包 - Cloudflare Workers + D1 部署指南

本專案支援在 Google AI Studio 開發預覽，並可直接部署至 **Cloudflare Workers Free（免費方案）+ Cloudflare D1（免費分散式 SQLite 資料庫）**。

本專案僅用於金流模擬與機器人互動測試，**不連接真實銀行、不處理真實資金**。

---

## 快速部署步驟 (Cloudflare Workers Free)

### 1. 安裝 Wrangler CLI
```bash
npm install -g wrangler
# 登入您的 Cloudflare 免費帳號
wrangler login
```

### 2. 建立 Cloudflare D1 免費資料庫
```bash
wrangler d1 create kebbi_ewallet_db
```
執行後將終端機顯示的 `database_id` 填入 `wrangler.jsonc`：
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "kebbi_ewallet_db",
    "database_id": "填入你的-database-id"
  }
]
```

### 3. 套用資料庫 Schema 結構
```bash
# 本機測試
wrangler d1 execute kebbi_ewallet_db --local --file=./migrations/0001_init.sql

# 正式免費部署
wrangler d1 execute kebbi_ewallet_db --remote --file=./migrations/0001_init.sql
```

### 4. 設定女媧 Roflow 授權金鑰 Secret
```bash
wrangler secret put ROFLOW_TOKEN
# 輸入您自訂的 ROFLOW_TOKEN 金鑰 (例如 kebbi_secret_token_123)
```

### 5. 部署到 Cloudflare Workers
```bash
wrangler deploy
```
部署完成後，您將獲得一個專屬的 Worker 網址（例如 `https://nuwa-kebbi-ewallet.your-subdomain.workers.dev`）。

---

## 支援的 API 端點一覽

| 動作 | HTTP 方法 | API 路徑 | 授權需求 | 說明 |
|---|---|---|---|---|
| 健康檢查 | `GET` | `/api/health` | 無 | 系統連線狀態 |
| 凱比建單 | `POST` | `/api/v1/robot/orders` | `X-Roflow-Key` | 建立點餐訂單與 QR Code |
| 凱比查單 | `GET` | `/api/v1/robot/orders/status?order_id=xxx` | `X-Roflow-Key` | 查詢訂單支付狀態 |
| 最新訂單 | `GET` | `/api/v1/robot/orders/latest` | `X-Roflow-Key` | 取得最新一筆訂單 |
| 錢包支付 | `POST` | `/api/v1/wallet/pay` | PIN 驗證 | 錢包扣款與不足額自動加值 $1,000 |
| 手動儲值 | `POST` | `/api/v1/wallet/recharge` | PIN 驗證 | 從模擬銀行扣款儲值至錢包 |
| 好友轉帳 | `POST` | `/api/v1/wallet/transfer` | PIN 驗證 | 錢包即時轉帳給指定手機號 |
| 銀行存款 | `POST` | `/api/v1/bank/deposit` | 無 | 模擬銀行帳戶加值測試金 |
| 銀行開戶 | `POST` | `/api/v1/bank/link` | 無 | 綁定或開立模擬銀行帳戶 |
| 用戶資訊 | `GET` | `/api/v1/user/info/:id` | 無 | 錢包餘額與綁定銀行資訊 |
| 交易明細 | `GET` | `/api/v1/user/transactions/:id` | 無 | 歷史交易紀錄清單 |

---

## 自動加值與原子交易規則
- **單位**: 每次自動加值以 **$1,000 TWD** 為單位。
- **原子性**: 銀行扣除加值額、錢包注入加值額、錢包扣除消費額、訂單標記 PAID、交易明細寫入，全在同一筆資料庫事務（SQLite `BEGIN IMMEDIATE` 或 D1 `batch`）中完成。
- **失敗回滾**: 若銀行餘額不足以支付加值額，整筆支付將立即中止，錢包與銀行餘額保持完全不變，訂單保持 `PENDING`。
