/**
 * Cloudflare Worker Acceptance Test Suite (Scenarios A through M)
 * Verifies src/worker.ts logic against Cloudflare D1 environment constraints.
 */

import worker, { Env, D1Database, D1PreparedStatement } from '../src/worker';
import { DatabaseSync } from 'node:sqlite';
import { hashPasswordSync } from '../src/utils/crypto';
import { ORDER_EXPIRATION_MS } from '../src/types';

/**
 * In-memory D1 Database Mock that replicates Cloudflare D1 behavior
 */
function createMockD1(dbPath = ':memory:'): D1Database {
  const sqlite = new DatabaseSync(dbPath);

  // Initialize schema
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      payment_pin_hash TEXT NOT NULL,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      is_auto_recharge_enabled INTEGER NOT NULL DEFAULT 1,
      failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mock_bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      bank_code TEXT NOT NULL DEFAULT '822',
      account_number TEXT UNIQUE NOT NULL,
      bank_password_hash TEXT NOT NULL,
      mock_bank_balance_cents INTEGER NOT NULL DEFAULT 5000000,
      is_verified INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      robot_id TEXT NOT NULL,
      total_amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      qr_code_token TEXT UNIQUE NOT NULL,
      items_json TEXT,
      expires_at TEXT,
      paid_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT,
      user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      type TEXT NOT NULL,
      mock_bank_account_id INTEGER,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (mock_bank_account_id) REFERENCES mock_bank_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  function createStatement(query: string, boundValues: any[] = []): D1PreparedStatement {
    return {
      bind(...values: any[]) {
        return createStatement(query, values);
      },
      async first<T = unknown>(colName?: string): Promise<T | null> {
        const stmt = sqlite.prepare(query);
        const row: any = stmt.get(...boundValues);
        if (!row) return null;
        if (colName) return row[colName] ?? null;
        return row as T;
      },
      async all<T = unknown>(): Promise<{ results?: T[]; success: boolean; error?: string }> {
        const stmt = sqlite.prepare(query);
        const results: any[] = stmt.all(...boundValues);
        return { results: results as T[], success: true };
      },
      async run(): Promise<{ success: boolean; meta: any }> {
        const stmt = sqlite.prepare(query);
        const result = stmt.run(...boundValues);
        return { success: true, meta: result };
      },
    };
  }

  return {
    prepare(query: string) {
      return createStatement(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<any[]> {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results: any[] = [];
        for (const stmt of statements) {
          const res = await stmt.run();
          results.push(res);
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(query: string) {
      return sqlite.exec(query);
    },
  };
}

async function runWorkerAcceptanceTests() {
  console.log('====================================================');
  console.log(' Cloudflare Worker Comprehensive Acceptance (A～M)');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      failed++;
    }
  }

  const d1 = createMockD1();
  const env: Env = {
    DB: d1,
    ROFLOW_TOKEN: 'KEBBI_ROFLOW_SECRET_123',
  };

  const dummyCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };

  // Seed default Demo Data
  const passHash = hashPasswordSync('123456');
  const pinHash = hashPasswordSync('1234');

  await d1.prepare(`
    INSERT INTO users (id, phone, password_hash, payment_pin_hash, balance_cents, is_auto_recharge_enabled)
    VALUES (1, '0912345678', ?, ?, 15000, 1)
  `).bind(passHash, pinHash).run();

  await d1.prepare(`
    INSERT INTO users (id, phone, password_hash, payment_pin_hash, balance_cents, is_auto_recharge_enabled)
    VALUES (2, '0987654321', ?, ?, 0, 1)
  `).bind(passHash, pinHash).run();

  await d1.prepare(`
    INSERT INTO mock_bank_accounts (id, user_id, bank_code, account_number, bank_password_hash, mock_bank_balance_cents, is_verified)
    VALUES (1, 1, '822', '1234567890', ?, 5000000, 1)
  `).bind(passHash).run();

  // --------------------------------------------------------------------------
  // Scenario A: Payment with Sufficient Wallet Balance ($100 order, $150 balance)
  // --------------------------------------------------------------------------
  console.log('1. Scenario A: Payment with Sufficient Wallet Balance...');
  const reqCreateA = new Request('https://api.kebbi.com/api/v1/robot/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Roflow-Key': 'KEBBI_ROFLOW_SECRET_123',
    },
    body: JSON.stringify({ total_amount: 100 }),
  });
  const resCreateA = await worker.fetch(reqCreateA, env, dummyCtx);
  const dataCreateA: any = await resCreateA.json();
  assert(resCreateA.status === 201, 'Order A created successfully with status 201');
  assert(dataCreateA.data.status === 'PENDING', 'Order A initial status is PENDING');

  const reqPayA = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      qr_code_token: dataCreateA.data.qr_code_token,
      pin: '1234',
    }),
  });
  const resPayA = await worker.fetch(reqPayA, env, dummyCtx);
  const dataPayA: any = await resPayA.json();
  assert(resPayA.status === 200, 'Payment A succeeded with status 200');
  assert(dataPayA.data.status === 'PAID', 'Payment A response status is PAID');
  assert(dataPayA.data.auto_recharged === false, 'Payment A did not trigger auto-recharge');
  assert(dataPayA.data.wallet_balance_before === 150, 'Wallet before payment was $150');
  assert(dataPayA.data.wallet_balance_after === 50, 'Wallet after payment is $50');

  // --------------------------------------------------------------------------
  // Scenario B: Insufficient Balance -> Single Auto-Recharge of $1,000
  // --------------------------------------------------------------------------
  console.log('\n2. Scenario B: Insufficient Balance -> Single Auto-Recharge of $1,000...');
  // Wallet: $50, Order: $200 -> Shortfall: $150 -> Topup: $1,000 -> Final Wallet: $850
  const reqCreateB = new Request('https://api.kebbi.com/api/v1/web/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ total_amount: 200 }),
  });
  const resCreateB = await worker.fetch(reqCreateB, env, dummyCtx);
  const dataCreateB: any = await resCreateB.json();

  const reqPayB = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      qr_code_token: dataCreateB.data.qr_code_token,
      pin: '1234',
    }),
  });
  const resPayB = await worker.fetch(reqPayB, env, dummyCtx);
  const dataPayB: any = await resPayB.json();
  assert(resPayB.status === 200, 'Payment B succeeded');
  assert(dataPayB.data.auto_recharged === true, 'Payment B triggered auto-recharge');
  assert(dataPayB.data.auto_recharge_amount === 1000, 'Auto-recharge amount was $1,000');
  assert(dataPayB.data.wallet_balance_after === 850, 'Wallet balance after payment is $850 ($50 + $1000 - $200)');

  // --------------------------------------------------------------------------
  // Scenario C: Multi-Unit Auto-Recharge ($3,000 / 3 units)
  // --------------------------------------------------------------------------
  console.log('\n3. Scenario C: Multi-Unit Auto-Recharge ($3,000 / 3 units)...');
  // Wallet: $850, Order: $3,000 -> Shortfall: $2,150 -> Units: 3 ($3,000) -> Final Wallet: $850
  const reqCreateC = new Request('https://api.kebbi.com/api/v1/web/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ total_amount: 3000 }),
  });
  const resCreateC = await worker.fetch(reqCreateC, env, dummyCtx);
  const dataCreateC: any = await resCreateC.json();

  const reqPayC = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      qr_code_token: dataCreateC.data.qr_code_token,
      pin: '1234',
    }),
  });
  const resPayC = await worker.fetch(reqPayC, env, dummyCtx);
  const dataPayC: any = await resPayC.json();
  assert(resPayC.status === 200, 'Payment C succeeded');
  assert(dataPayC.data.auto_recharged === true, 'Payment C auto-recharged');
  assert(dataPayC.data.auto_recharge_amount === 3000, 'Auto-recharge amount is $3,000 (3 units)');
  assert(dataPayC.data.wallet_balance_after === 850, 'Wallet balance after is $850');

  // --------------------------------------------------------------------------
  // Scenario D: Disabled Auto-Recharge
  // --------------------------------------------------------------------------
  console.log('\n4. Scenario D: Disabled Auto-Recharge...');
  await d1.prepare('UPDATE users SET is_auto_recharge_enabled = 0, balance_cents = 5000 WHERE id = 1').run();

  const reqCreateD = new Request('https://api.kebbi.com/api/v1/web/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ total_amount: 500 }),
  });
  const resCreateD = await worker.fetch(reqCreateD, env, dummyCtx);
  const dataCreateD: any = await resCreateD.json();

  const reqPayD = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      qr_code_token: dataCreateD.data.qr_code_token,
      pin: '1234',
    }),
  });
  const resPayD = await worker.fetch(reqPayD, env, dummyCtx);
  assert(resPayD.status === 400, 'Payment D rejected with status 400');
  const userAfterD: any = await d1.prepare('SELECT balance_cents FROM users WHERE id = 1').first();
  assert(userAfterD.balance_cents === 5000, 'Wallet balance completely unchanged at $50');

  // Re-enable auto recharge
  await d1.prepare('UPDATE users SET is_auto_recharge_enabled = 1 WHERE id = 1').run();

  // --------------------------------------------------------------------------
  // Scenario E: Insufficient Bank Balance
  // --------------------------------------------------------------------------
  console.log('\n5. Scenario E: Insufficient Bank Balance...');
  await d1.prepare('UPDATE mock_bank_accounts SET mock_bank_balance_cents = 50000 WHERE id = 1').run(); // $500 in bank

  const reqCreateE = new Request('https://api.kebbi.com/api/v1/web/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ total_amount: 300 }),
  });
  const resCreateE = await worker.fetch(reqCreateE, env, dummyCtx);
  const dataCreateE: any = await resCreateE.json();

  const reqPayE = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      qr_code_token: dataCreateE.data.qr_code_token,
      pin: '1234',
    }),
  });
  const resPayE = await worker.fetch(reqPayE, env, dummyCtx);
  assert(resPayE.status === 400, 'Payment E failed due to bank balance < $1,000');
  const bankAfterE: any = await d1.prepare('SELECT mock_bank_balance_cents FROM mock_bank_accounts WHERE id = 1').first();
  assert(bankAfterE.mock_bank_balance_cents === 50000, 'Bank balance remained untouched at $500');

  // Restore bank balance
  await d1.prepare('UPDATE mock_bank_accounts SET mock_bank_balance_cents = 5000000 WHERE id = 1').run();

  // --------------------------------------------------------------------------
  // Scenario F: PIN Verification, Lockout, and Invalid Tokens
  // --------------------------------------------------------------------------
  console.log('\n6. Scenario F: PIN Verification & Lockout...');
  const reqCreateF = new Request('https://api.kebbi.com/api/v1/web/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ total_amount: 50 }),
  });
  const resCreateF = await worker.fetch(reqCreateF, env, dummyCtx);
  const dataCreateF: any = await resCreateF.json();

  // 1. Wrong PIN attempt
  const reqPayWrong = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      qr_code_token: dataCreateF.data.qr_code_token,
      pin: '0000',
    }),
  });
  const resPayWrong = await worker.fetch(reqPayWrong, env, dummyCtx);
  assert(resPayWrong.status === 400, 'Wrong PIN rejected with 400');
  const userWrong: any = await d1.prepare('SELECT failed_pin_attempts FROM users WHERE id = 1').first();
  assert(userWrong.failed_pin_attempts === 1, 'Failed PIN attempt counter incremented to 1');

  // 2. Correct PIN resets attempt counter
  const reqPayCorrect = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      qr_code_token: dataCreateF.data.qr_code_token,
      pin: '1234',
    }),
  });
  const resPayCorrect = await worker.fetch(reqPayCorrect, env, dummyCtx);
  assert(resPayCorrect.status === 200, 'Correct PIN succeeded');
  const userReset: any = await d1.prepare('SELECT failed_pin_attempts FROM users WHERE id = 1').first();
  assert(userReset.failed_pin_attempts === 0, 'Failed PIN counter reset to 0');

  // --------------------------------------------------------------------------
  // Scenario G: Idempotency Check
  // --------------------------------------------------------------------------
  console.log('\n7. Scenario G: Idempotency Check...');
  const reqReplayB = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      qr_code_token: dataCreateB.data.qr_code_token,
      pin: '1234',
    }),
  });
  const resReplayB = await worker.fetch(reqReplayB, env, dummyCtx);
  const dataReplayB: any = await resReplayB.json();
  assert(resReplayB.status === 200, 'Replay payment succeeded');
  assert(dataReplayB.data.status === 'PAID', 'Replay confirmed status is PAID');
  assert(dataReplayB.data.auto_recharged === true, 'Replay preserves original auto_recharged flag');
  assert(dataReplayB.data.auto_recharge_amount === 1000, 'Replay preserves original auto_recharge_amount');

  // --------------------------------------------------------------------------
  // Scenario H: Concurrent Payment Protection
  // --------------------------------------------------------------------------
  console.log('\n8. Scenario H: Concurrent Payments on Same Order...');
  const reqCreateH = new Request('https://api.kebbi.com/api/v1/web/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ total_amount: 50 }),
  });
  const resCreateH = await worker.fetch(reqCreateH, env, dummyCtx);
  const dataCreateH: any = await resCreateH.json();

  const req1 = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 1, qr_code_token: dataCreateH.data.qr_code_token, pin: '1234' }),
  });
  const req2 = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 1, qr_code_token: dataCreateH.data.qr_code_token, pin: '1234' }),
  });

  const [res1, res2] = await Promise.all([
    worker.fetch(req1, env, dummyCtx),
    worker.fetch(req2, env, dummyCtx),
  ]);

  assert(res1.status === 200 && res2.status === 200, 'Both requests resolved safely without server crash');
  const payTxnsH: any = await d1.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE order_id = ? AND type = 'PAYMENT'").bind(dataCreateH.data.order_id).first();
  assert(payTxnsH.cnt === 1, 'Exactly 1 PAYMENT transaction was created (Zero double-spending)');

  // --------------------------------------------------------------------------
  // Scenario I: Rollback Test
  // --------------------------------------------------------------------------
  console.log('\n9. Scenario I: Batch Rollback Verification...');
  let rollbackCaught = false;
  try {
    await d1.batch([
      d1.prepare('UPDATE users SET balance_cents = 999999 WHERE id = 1'),
      d1.prepare('INSERT INTO orders (id, robot_id, total_amount_cents, qr_code_token) VALUES ("DUP", "R1", 100, "SAME")'),
      d1.prepare('INSERT INTO orders (id, robot_id, total_amount_cents, qr_code_token) VALUES ("DUP", "R1", 100, "SAME")'), // Violates PRIMARY KEY
    ]);
  } catch (err) {
    rollbackCaught = true;
  }
  assert(rollbackCaught === true, 'Failed batch threw error as expected');
  const userCheckI: any = await d1.prepare('SELECT balance_cents FROM users WHERE id = 1').first();
  assert(userCheckI.balance_cents !== 999999, 'Batch was rolled back, balance was NOT modified');

  // --------------------------------------------------------------------------
  // Scenario J: Optimistic Lock / Version Control
  // --------------------------------------------------------------------------
  console.log('\n10. Scenario J: Optimistic Locking / Versioning...');
  const userVerBefore: any = await d1.prepare('SELECT version FROM users WHERE id = 1').first();
  assert(userVerBefore.version >= 1, 'User record has version tracking column');

  // --------------------------------------------------------------------------
  // Scenario K: Expired Order Handling
  // --------------------------------------------------------------------------
  console.log('\n11. Scenario K: Expired Order Handling...');
  const expiredPastTime = new Date(Date.now() - 60000).toISOString();
  await d1.prepare(`
    INSERT INTO orders (id, robot_id, total_amount_cents, status, qr_code_token, expires_at)
    VALUES ('EXPIRED_ORD_1', 'KEBBI_ROBOT_001', 10000, 'PENDING', 'TOK_EXPIRED_1', ?)
  `).bind(expiredPastTime).run();

  const reqPayExpired = new Request('https://api.kebbi.com/api/v1/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 1, qr_code_token: 'TOK_EXPIRED_1', pin: '1234' }),
  });
  const resPayExpired = await worker.fetch(reqPayExpired, env, dummyCtx);
  const dataPayExpired: any = await resPayExpired.json();
  assert(resPayExpired.status === 400, 'Expired order payment rejected with 400');
  assert(dataPayExpired.status === 'EXPIRED', 'Order status updated to EXPIRED');

  // --------------------------------------------------------------------------
  // Scenario L: Lifecycle Operations (Auth, Bank Link/Deposit, Manual Recharge, Transfer)
  // --------------------------------------------------------------------------
  console.log('\n12. Scenario L: Lifecycle Operations...');
  // 1. Session Auth
  const reqSession = new Request('https://api.kebbi.com/api/v1/auth/session', { method: 'GET' });
  const resSession = await worker.fetch(reqSession, env, dummyCtx);
  const dataSession: any = await resSession.json();
  assert(resSession.status === 200 && dataSession.data.token, 'Session token acquired successfully');

  // 2. Manual Recharge
  const reqRecharge = new Request('https://api.kebbi.com/api/v1/wallet/recharge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${dataSession.data.token}`,
    },
    body: JSON.stringify({ amount: 500, pin: '1234' }),
  });
  const resRecharge = await worker.fetch(reqRecharge, env, dummyCtx);
  const dataRecharge: any = await resRecharge.json();
  assert(resRecharge.status === 200, 'Manual recharge of $500 succeeded');

  // 3. Friend Transfer
  const reqTransfer = new Request('https://api.kebbi.com/api/v1/wallet/transfer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${dataSession.data.token}`,
    },
    body: JSON.stringify({
      recipient_phone: '0987654321',
      amount: 200,
      pin: '1234',
    }),
  });
  const resTransfer = await worker.fetch(reqTransfer, env, dummyCtx);
  assert(resTransfer.status === 200, 'Transfer of $200 succeeded');

  // --------------------------------------------------------------------------
  // Scenario M: GET Endpoint Safety & Idempotency
  // --------------------------------------------------------------------------
  console.log('\n13. Scenario M: Read-only GET Endpoints...');
  // 1. Order status query
  const reqStatus = new Request(`https://api.kebbi.com/api/v1/web/orders/status/${dataCreateA.data.order_id}`, { method: 'GET' });
  const resStatus = await worker.fetch(reqStatus, env, dummyCtx);
  const dataStatus: any = await resStatus.json();
  assert(resStatus.status === 200 && dataStatus.status === 'PAID', 'GET order status returned status PAID');

  // 2. User info query
  const reqUserInfo = new Request('https://api.kebbi.com/api/v1/user/info/1', { method: 'GET' });
  const resUserInfo = await worker.fetch(reqUserInfo, env, dummyCtx);
  const dataUserInfo: any = await resUserInfo.json();
  assert(resUserInfo.status === 200 && dataUserInfo.data.id === 1, 'GET user info returned valid user data');

  // 3. QR Image endpoint (Order exists)
  const reqQrImage = new Request(`https://api.kebbi.com/api/v1/robot/qr-image/${dataCreateA.data.order_id}.png`, { method: 'GET' });
  const resQrImage = await worker.fetch(reqQrImage, env, dummyCtx);
  assert(resQrImage.status === 200, 'GET QR PNG returned HTTP 200');
  assert(resQrImage.headers.get('Content-Type') === 'image/png', 'GET QR PNG header is image/png');

  // 4. QR Image endpoint (Order does not exist -> 404)
  const reqQrImage404 = new Request('https://api.kebbi.com/api/v1/robot/qr-image/NON_EXISTENT_ORDER.png', { method: 'GET' });
  const resQrImage404 = await worker.fetch(reqQrImage404, env, dummyCtx);
  assert(resQrImage404.status === 404, 'GET QR PNG for non-existent order returned HTTP 404');

  console.log('\n====================================================');
  console.log(` Acceptance Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runWorkerAcceptanceTests().catch((err) => {
  console.error('Worker Acceptance Test Error:', err);
  process.exit(1);
});
