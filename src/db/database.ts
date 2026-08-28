import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { hashPasswordSync, generateSecureToken } from '../utils/crypto';
import {
  User,
  MockBankAccount,
  Order,
  Transaction,
  Session,
  toTWD,
  toCents,
  OrderStatus,
  TransactionType,
} from '../types';

let dbInstance: DatabaseSync | null = null;

function getDatabase(): DatabaseSync {
  if (dbInstance) return dbInstance;

  // Try to use persistent file storage in ./data or root
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // Ignore if cannot create
    }
  }

  const dbPath = fs.existsSync(dataDir)
    ? path.join(dataDir, 'kebbi_wallet.sqlite')
    : ':memory:';

  dbInstance = new DatabaseSync(dbPath);

  // Enable foreign keys & WAL mode for performance & concurrency
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  try {
    dbInstance.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // In-memory might not support WAL, which is fine
  }

  initSchema(dbInstance);
  seedDefaultData(dbInstance);

  return dbInstance;
}

function initSchema(db: DatabaseSync) {
  db.exec(`
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
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_orders_qr_code_token ON orders(qr_code_token);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_mock_bank_user_id ON mock_bank_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_order_payment ON transactions(order_id) WHERE type = 'PAYMENT';
  `);

  // Ensure newly added columns exist on existing databases
  const tryAddColumn = (sql: string) => {
    try {
      db.exec(sql);
    } catch {
      // Column already exists, ignore
    }
  };

  tryAddColumn('ALTER TABLE users ADD COLUMN failed_pin_attempts INTEGER NOT NULL DEFAULT 0');
  tryAddColumn('ALTER TABLE users ADD COLUMN locked_until TEXT');
  tryAddColumn('ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  tryAddColumn('ALTER TABLE mock_bank_accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  tryAddColumn('ALTER TABLE orders ADD COLUMN expires_at TEXT');
}

function seedDefaultData(db: DatabaseSync) {
  // Check if Demo User 1 exists
  const checkUserStmt = db.prepare('SELECT id FROM users WHERE id = 1');
  const existingUser = checkUserStmt.get() as { id: number } | undefined;

  if (!existingUser) {
    const passwordHash = hashPasswordSync('123456');
    const pinHash = hashPasswordSync('1234');
    const bankPassHash = hashPasswordSync('8888');

    db.exec('BEGIN IMMEDIATE;');
    try {
      const insertUser = db.prepare(`
        INSERT INTO users (id, phone, password_hash, payment_pin_hash, balance_cents, is_auto_recharge_enabled, version)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `);
      // Demo User 1: 0912345678, balance 15000 ($150)
      insertUser.run(1, '0912345678', passwordHash, pinHash, 15000, 1);
      // Demo User 2: 0987654321, balance 0 ($0)
      insertUser.run(2, '0987654321', passwordHash, pinHash, 0, 1);

      const insertBank = db.prepare(`
        INSERT INTO mock_bank_accounts (id, user_id, bank_code, account_number, bank_password_hash, mock_bank_balance_cents, is_verified, version)
        VALUES (1, 1, '822', '8220011223344', ?, 5000000, 1, 1)
      `);
      insertBank.run(bankPassHash);

      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      console.error('[DB Seed Notice]', e);
    }
  }
}

// Database helper object
export const db = {
  get raw(): DatabaseSync {
    return getDatabase();
  },

  /**
   * Reset database completely for clean, repeatable test runs
   */
  resetForTesting(): void {
    const database = getDatabase();
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(`
        DELETE FROM sessions;
        DELETE FROM transactions;
        DELETE FROM orders;
        DELETE FROM mock_bank_accounts;
        DELETE FROM users;
      `);
      const passwordHash = hashPasswordSync('123456');
      const pinHash = hashPasswordSync('1234');
      const bankPassHash = hashPasswordSync('8888');

      const insertUser = database.prepare(`
        INSERT INTO users (id, phone, password_hash, payment_pin_hash, balance_cents, is_auto_recharge_enabled, failed_pin_attempts, locked_until, version)
        VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 1)
      `);
      insertUser.run(1, '0912345678', passwordHash, pinHash, 15000, 1);
      insertUser.run(2, '0987654321', passwordHash, pinHash, 0, 1);

      const insertBank = database.prepare(`
        INSERT INTO mock_bank_accounts (id, user_id, bank_code, account_number, bank_password_hash, mock_bank_balance_cents, is_verified, version)
        VALUES (1, 1, '822', '8220011223344', ?, 5000000, 1, 1)
      `);
      insertBank.run(bankPassHash);

      database.exec('COMMIT;');
    } catch (err) {
      database.exec('ROLLBACK;');
      throw err;
    }
  },

  /**
   * Run operations in an atomic SQLite transaction
   */
  transaction<T>(fn: () => T): T {
    const database = getDatabase();
    database.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      database.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        database.exec('ROLLBACK;');
      } catch {
        // Rollback error ignore
      }
      throw err;
    }
  },

  // User Operations
  getUserById(id: number): User | null {
    const row = getDatabase()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      phone: row.phone,
      password_hash: row.password_hash,
      payment_pin_hash: row.payment_pin_hash,
      balance_cents: row.balance_cents,
      balance: toTWD(row.balance_cents),
      is_auto_recharge_enabled: Boolean(row.is_auto_recharge_enabled),
      failed_pin_attempts: row.failed_pin_attempts || 0,
      locked_until: row.locked_until || null,
      version: row.version || 1,
      created_at: row.created_at,
    };
  },

  getUserByPhone(phone: string): User | null {
    const row = getDatabase()
      .prepare('SELECT * FROM users WHERE phone = ?')
      .get(phone) as any;
    if (!row) return null;
    return {
      id: row.id,
      phone: row.phone,
      password_hash: row.password_hash,
      payment_pin_hash: row.payment_pin_hash,
      balance_cents: row.balance_cents,
      balance: toTWD(row.balance_cents),
      is_auto_recharge_enabled: Boolean(row.is_auto_recharge_enabled),
      failed_pin_attempts: row.failed_pin_attempts || 0,
      locked_until: row.locked_until || null,
      version: row.version || 1,
      created_at: row.created_at,
    };
  },

  updateUserBalance(userId: number, newBalanceCents: number): void {
    const stmt = getDatabase().prepare('UPDATE users SET balance_cents = ?, version = version + 1 WHERE id = ?');
    stmt.run(newBalanceCents, userId);
  },

  recordFailedPinAttempt(userId: number, currentAttempts: number): void {
    const newCount = currentAttempts + 1;
    let lockedUntil: string | null = null;
    if (newCount >= 5) {
      // Lock for 5 minutes
      lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }
    const stmt = getDatabase().prepare(
      'UPDATE users SET failed_pin_attempts = ?, locked_until = ? WHERE id = ?'
    );
    stmt.run(newCount, lockedUntil, userId);
  },

  resetFailedPinAttempts(userId: number): void {
    const stmt = getDatabase().prepare(
      'UPDATE users SET failed_pin_attempts = 0, locked_until = NULL WHERE id = ?'
    );
    stmt.run(userId);
  },

  // Session Operations
  createSession(userId: number, customToken?: string, customExpiresAt?: string): Session {
    const token = customToken || generateSecureToken();
    const expiresAt = customExpiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const stmt = getDatabase().prepare(`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(token, userId, expiresAt);
    const user = this.getUserById(userId);
    return {
      token,
      user_id: userId,
      phone: user?.phone || '',
      expires_at: expiresAt,
    };
  },

  getSession(token: string): Session | null {
    if (!token) return null;
    const row = getDatabase()
      .prepare("SELECT * FROM sessions WHERE token = ? AND datetime(expires_at) > datetime('now')")
      .get(token) as any;
    if (!row) return null;
    const user = this.getUserById(row.user_id);
    return {
      token: row.token,
      user_id: row.user_id,
      phone: user?.phone || '',
      expires_at: row.expires_at,
      created_at: row.created_at,
    };
  },

  deleteSession(token: string): void {
    const stmt = getDatabase().prepare('DELETE FROM sessions WHERE token = ?');
    stmt.run(token);
  },

  // Mock Bank Operations
  getBankByUserId(userId: number): MockBankAccount | null {
    const row = getDatabase()
      .prepare('SELECT * FROM mock_bank_accounts WHERE user_id = ? LIMIT 1')
      .get(userId) as any;
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      bank_code: row.bank_code,
      account_number: row.account_number,
      bank_password_hash: row.bank_password_hash,
      mock_bank_balance_cents: row.mock_bank_balance_cents,
      mock_bank_balance: toTWD(row.mock_bank_balance_cents),
      is_verified: Boolean(row.is_verified),
      version: row.version || 1,
      created_at: row.created_at,
    };
  },

  getBankByAccountNumber(accountNumber: string): MockBankAccount | null {
    const row = getDatabase()
      .prepare('SELECT * FROM mock_bank_accounts WHERE account_number = ?')
      .get(accountNumber) as any;
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      bank_code: row.bank_code,
      account_number: row.account_number,
      bank_password_hash: row.bank_password_hash,
      mock_bank_balance_cents: row.mock_bank_balance_cents,
      mock_bank_balance: toTWD(row.mock_bank_balance_cents),
      is_verified: Boolean(row.is_verified),
      version: row.version || 1,
      created_at: row.created_at,
    };
  },

  createBank(
    userId: number,
    bankCode: string,
    accountNumber: string,
    bankPasswordHash: string,
    initialBalanceCents: number = 5000000
  ): MockBankAccount {
    const stmt = getDatabase().prepare(`
      INSERT INTO mock_bank_accounts (user_id, bank_code, account_number, bank_password_hash, mock_bank_balance_cents, is_verified, version)
      VALUES (?, ?, ?, ?, ?, 1, 1)
    `);
    const res = stmt.run(userId, bankCode, accountNumber, bankPasswordHash, initialBalanceCents);
    const id = Number(res.lastInsertRowid);
    return this.getBankByUserId(userId)!;
  },

  linkBankToUser(bankId: number, userId: number): void {
    const stmt = getDatabase().prepare('UPDATE mock_bank_accounts SET user_id = ?, is_verified = 1, version = version + 1 WHERE id = ?');
    stmt.run(userId, bankId);
  },

  updateBankBalance(bankId: number, newBalanceCents: number): void {
    const stmt = getDatabase().prepare('UPDATE mock_bank_accounts SET mock_bank_balance_cents = ?, version = version + 1 WHERE id = ?');
    stmt.run(newBalanceCents, bankId);
  },

  // Order Operations
  createOrder(order: {
    id: string;
    robot_id: string;
    total_amount_cents: number;
    qr_code_token: string;
    items_json?: string;
    expires_at?: string;
  }): Order {
    const stmt = getDatabase().prepare(`
      INSERT INTO orders (id, robot_id, total_amount_cents, status, qr_code_token, items_json, expires_at)
      VALUES (?, ?, ?, 'PENDING', ?, ?, ?)
    `);
    stmt.run(
      order.id,
      order.robot_id,
      order.total_amount_cents,
      order.qr_code_token,
      order.items_json || null,
      order.expires_at || null
    );
    return this.getOrderById(order.id)!;
  },

  getOrderById(id: string): Order | null {
    const row = getDatabase()
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(id) as any;
    if (!row) return null;
    return mapOrderRow(row);
  },

  getOrderByToken(token: string): Order | null {
    const row = getDatabase()
      .prepare('SELECT * FROM orders WHERE qr_code_token = ?')
      .get(token) as any;
    if (!row) return null;
    return mapOrderRow(row);
  },

  getLatestOrderByRobotId(robotId: string): Order | null {
    const row = getDatabase()
      .prepare('SELECT * FROM orders WHERE robot_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(robotId) as any;
    if (!row) return null;
    return mapOrderRow(row);
  },

  setOrderStatus(orderId: string, status: OrderStatus, paidAt?: string): void {
    const stmt = getDatabase().prepare(
      'UPDATE orders SET status = ?, paid_at = ? WHERE id = ?'
    );
    stmt.run(status, paidAt || null, orderId);
  },

  // Transaction Operations
  createTransaction(txn: {
    order_id?: string | null;
    user_id: number;
    amount_cents: number;
    type: TransactionType;
    mock_bank_account_id?: number | null;
    note?: string | null;
  }): Transaction {
    const stmt = getDatabase().prepare(`
      INSERT INTO transactions (order_id, user_id, amount_cents, type, mock_bank_account_id, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      txn.order_id || null,
      txn.user_id,
      txn.amount_cents,
      txn.type,
      txn.mock_bank_account_id || null,
      txn.note || null
    );
    const id = Number(res.lastInsertRowid);
    return {
      id,
      order_id: txn.order_id || null,
      user_id: txn.user_id,
      amount_cents: txn.amount_cents,
      amount: toTWD(txn.amount_cents),
      type: txn.type,
      mock_bank_account_id: txn.mock_bank_account_id || null,
      note: txn.note || null,
      created_at: new Date().toISOString(),
    };
  },

  getTransactionByOrderId(orderId: string, type: TransactionType): Transaction | null {
    const row = getDatabase()
      .prepare('SELECT * FROM transactions WHERE order_id = ? AND type = ? ORDER BY id DESC LIMIT 1')
      .get(orderId, type) as any;
    if (!row) return null;
    return {
      id: row.id,
      order_id: row.order_id,
      user_id: row.user_id,
      amount_cents: row.amount_cents,
      amount: toTWD(row.amount_cents),
      type: row.type,
      mock_bank_account_id: row.mock_bank_account_id,
      note: row.note,
      created_at: row.created_at,
    };
  },

  getUserTransactions(userId: number): Transaction[] {
    const rows = getDatabase()
      .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50')
      .all(userId) as any[];
    return rows.map((r) => ({
      id: r.id,
      order_id: r.order_id,
      user_id: r.user_id,
      amount_cents: r.amount_cents,
      amount: toTWD(r.amount_cents),
      type: r.type,
      mock_bank_account_id: r.mock_bank_account_id,
      note: r.note,
      created_at: r.created_at,
    }));
  },
};

function mapOrderRow(row: any): Order {
  let items = undefined;
  if (row.items_json) {
    try {
      items = JSON.parse(row.items_json);
    } catch {
      // Ignore JSON parse error
    }
  }
  return {
    id: row.id,
    robot_id: row.robot_id,
    total_amount_cents: row.total_amount_cents,
    total_amount: toTWD(row.total_amount_cents),
    status: row.status,
    qr_code_token: row.qr_code_token,
    items,
    items_json: row.items_json,
    paid_at: row.paid_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export function isDatabaseConnected(): boolean {
  try {
    const database = getDatabase();
    database.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
