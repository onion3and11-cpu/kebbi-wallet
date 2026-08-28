-- =============================================================================
-- NUWA Kebbi Robot E-Wallet & Payment System Database Schema
-- Compatible with Cloudflare D1 (SQLite) and local SQLite engine
-- All monetary amounts stored as integer cents to avoid floating-point errors.
-- =============================================================================

-- 1. Users Table (使用者表)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    payment_pin_hash TEXT NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 15000 CHECK (balance_cents >= 0),
    is_auto_recharge_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_auto_recharge_enabled IN (0, 1)),
    failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Mock Bank Accounts Table (內建模擬銀行帳戶表)
CREATE TABLE IF NOT EXISTS mock_bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank_code TEXT NOT NULL DEFAULT '822',
    account_number TEXT UNIQUE NOT NULL,
    bank_password_hash TEXT NOT NULL,
    mock_bank_balance_cents INTEGER NOT NULL DEFAULT 5000000 CHECK (mock_bank_balance_cents >= 0),
    is_verified INTEGER NOT NULL DEFAULT 1 CHECK (is_verified IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Orders Table (凱比機器人訂單表)
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

-- 4. Transactions Table (交易明細紀錄表)
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('PAYMENT', 'MANUAL_RECHARGE', 'AUTO_RECHARGE', 'TRANSFER_OUT', 'TRANSFER_IN')),
    mock_bank_account_id INTEGER REFERENCES mock_bank_accounts(id) ON DELETE SET NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Sessions Table (使用者會話表)
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_orders_qr_code_token ON orders(qr_code_token);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_bank_user_id ON mock_bank_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_order_payment ON transactions(order_id) WHERE type = 'PAYMENT';

-- Default Demo Data Seed (Pre-hashed PIN '1234' and Password '123456')
-- Demo User 1: 0912345678 (Balance $150, Auto-Recharge Enabled, Linked Bank with $50,000)
INSERT OR IGNORE INTO users (id, phone, password_hash, payment_pin_hash, balance_cents, is_auto_recharge_enabled, version)
VALUES (1, '0912345678', '$2a$10$7EqJtq98hPqEX7fNZaFWoO0oM8h3bE7J7VqVlK0c3aM6p4E7A2WvS', '$2a$10$7EqJtq98hPqEX7fNZaFWoO0oM8h3bE7J7VqVlK0c3aM6p4E7A2WvS', 15000, 1, 1);

-- Demo User 2: 0987654321 (Balance $0)
INSERT OR IGNORE INTO users (id, phone, password_hash, payment_pin_hash, balance_cents, is_auto_recharge_enabled, version)
VALUES (2, '0987654321', '$2a$10$7EqJtq98hPqEX7fNZaFWoO0oM8h3bE7J7VqVlK0c3aM6p4E7A2WvS', '$2a$10$7EqJtq98hPqEX7fNZaFWoO0oM8h3bE7J7VqVlK0c3aM6p4E7A2WvS', 0, 1, 1);

-- Mock Bank for User 1
INSERT OR IGNORE INTO mock_bank_accounts (id, user_id, bank_code, account_number, bank_password_hash, mock_bank_balance_cents, is_verified, version)
VALUES (1, 1, '822', '8220011223344', '$2a$10$7EqJtq98hPqEX7fNZaFWoO0oM8h3bE7J7VqVlK0c3aM6p4E7A2WvS', 5000000, 1, 1);
