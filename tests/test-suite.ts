import { db } from '../src/db/database';
import { WalletService } from '../src/services/WalletService';
import { OrderService } from '../src/services/OrderService';
import { MockBankService } from '../src/services/MockBankService';
import { toTWD, toCents } from '../src/types';

async function runTestSuite() {
  console.log('====================================================');
  console.log(' Starting NUWA Kebbi E-Wallet Verification Tests');
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

  // --- Reset Baseline Test Data ---
  console.log('1. Testing Database & Schema Initialization...');
  db.raw.exec(`
    UPDATE users SET balance_cents = 15000, is_auto_recharge_enabled = 1, failed_pin_attempts = 0, locked_until = NULL WHERE id = 1;
    UPDATE users SET balance_cents = 0, is_auto_recharge_enabled = 1, failed_pin_attempts = 0, locked_until = NULL WHERE id = 2;
    UPDATE mock_bank_accounts SET mock_bank_balance_cents = 5000000 WHERE id = 1;
  `);

  const user1 = db.getUserById(1);
  assert(user1 !== null && user1.phone === '0912345678', 'Demo User 1 exists with phone 0912345678');
  assert(user1?.balance === 150, 'Demo User 1 default balance is $150.00 TWD');
  assert(user1?.is_auto_recharge_enabled === true, 'Demo User 1 auto-recharge is enabled by default');

  const bank1 = db.getBankByUserId(1);
  assert(bank1 !== null && bank1.mock_bank_balance === 50000, 'Demo Bank account linked with $50,000 balance');

  // --- Test Case A: Sufficient Wallet Balance ---
  console.log('\n2. Test Case A: Payment with sufficient wallet balance...');
  const orderA = await OrderService.createOrder('KEBBI_ROBOT_001', 100);
  assert(orderA.status === 'PENDING', 'Order A created with status PENDING');

  const payResultA = await WalletService.payOrder(1, orderA.qr_code_token, '1234');
  assert(payResultA.success === true, 'Payment A succeeded');
  assert(payResultA.status === 'PAID', 'Order A status updated to PAID');
  assert(payResultA.auto_recharged === false, 'Order A did NOT trigger auto-recharge');
  assert(payResultA.wallet_balance_before === 150, 'Wallet balance before was $150');
  assert(payResultA.wallet_balance_after === 50, 'Wallet balance after is $50 ($150 - $100)');

  const userAfterA = db.getUserById(1)!;
  assert(userAfterA.balance === 50, 'Database user balance verified at $50');

  // --- Test Case B: Insufficient Wallet Balance -> Single Auto-Recharge ($1,000) ---
  console.log('\n3. Test Case B: Insufficient balance -> Single Auto-Recharge of $1,000...');
  // Current wallet balance: $50. Order: $200. Shortfall: $150 -> Topup $1,000.
  // Final wallet: $50 + $1000 - $200 = $850.
  // Bank before: $50,000 -> Bank after: $49,000.
  const orderB = await OrderService.createOrder('KEBBI_ROBOT_001', 200);
  const payResultB = await WalletService.payOrder(1, orderB.qr_code_token, '1234');
  assert(payResultB.success === true, 'Payment B succeeded');
  assert(payResultB.status === 'PAID', 'Order B status is PAID');
  assert(payResultB.auto_recharged === true, 'Payment B triggered auto-recharge');
  assert(payResultB.auto_recharge_amount === 1000, 'Auto-recharge amount is exactly $1,000');
  assert(payResultB.wallet_balance_before === 50, 'Wallet before was $50');
  assert(payResultB.wallet_balance_after === 850, 'Wallet after is $850 ($50 + $1,000 - $200)');

  const bankAfterB = db.getBankByUserId(1)!;
  assert(bankAfterB.mock_bank_balance === 49000, 'Bank balance deducted $1,000 -> $49,000');

  // --- Test Case C: Large Order -> Multi-Unit Auto-Recharge ($3,000) ---
  console.log('\n4. Test Case C: Multi-unit auto-recharge...');
  // Current wallet: $850. Order: $3,000. Shortfall: $2,150 -> Units = 3 -> Topup: $3,000.
  // Final wallet: $850 + $3,000 - $3,000 = $850.
  // Bank before: $49,000 -> Bank after: $46,000.
  const orderC = await OrderService.createOrder('KEBBI_ROBOT_001', 3000);
  const payResultC = await WalletService.payOrder(1, orderC.qr_code_token, '1234');
  assert(payResultC.success === true, 'Payment C succeeded');
  assert(payResultC.auto_recharged === true, 'Payment C triggered auto-recharge');
  assert(payResultC.auto_recharge_amount === 3000, 'Auto-recharge amount is $3,000 (3 units)');
  assert(payResultC.wallet_balance_after === 850, 'Wallet balance after is $850');

  const bankAfterC = db.getBankByUserId(1)!;
  assert(bankAfterC.mock_bank_balance === 46000, 'Bank balance is now $46,000');

  // --- Test Case D: Auto-Recharge Disabled ---
  console.log('\n5. Test Case D: Auto-recharge disabled by user setting...');
  db.raw.prepare('UPDATE users SET is_auto_recharge_enabled = 0, balance_cents = 5000 WHERE id = 1').run(); // $50 wallet
  const orderD = await OrderService.createOrder('KEBBI_ROBOT_001', 200);
  const payResultD = await WalletService.payOrder(1, orderD.qr_code_token, '1234');
  assert(payResultD.success === false, 'Payment D failed as expected');
  assert(payResultD.status === 'PENDING', 'Order D remains PENDING');
  const userAfterD = db.getUserById(1)!;
  assert(userAfterD.balance === 50, 'Wallet balance remained completely untouched at $50');

  // Restore auto recharge setting
  db.raw.prepare('UPDATE users SET is_auto_recharge_enabled = 1 WHERE id = 1').run();

  // --- Test Case E: Insufficient Bank Balance -> Entire Transaction Aborts ---
  console.log('\n6. Test Case E: Insufficient bank balance rollback test...');
  // Set bank balance to $500 (less than 1 auto-recharge unit of $1,000)
  db.raw.prepare('UPDATE mock_bank_accounts SET mock_bank_balance_cents = 50000 WHERE id = 1').run(); // $500
  const orderE = await OrderService.createOrder('KEBBI_ROBOT_001', 200);
  const payResultE = await WalletService.payOrder(1, orderE.qr_code_token, '1234');
  assert(payResultE.success === false, 'Payment E failed due to bank balance < $1,000');
  const bankAfterE = db.getBankByUserId(1)!;
  const userAfterE = db.getUserById(1)!;
  assert(bankAfterE.mock_bank_balance === 500, 'Bank balance remained untouched at $500');
  assert(userAfterE.balance === 50, 'Wallet balance remained untouched at $50');
  const orderEAfter = OrderService.getOrderStatus(orderE.order_id);
  assert((await orderEAfter)?.status === 'PENDING', 'Order E remains PENDING without partial modifications');

  // Restore bank balance
  db.raw.prepare('UPDATE mock_bank_accounts SET mock_bank_balance_cents = 5000000 WHERE id = 1').run();

  // --- Test Case F: Idempotent Payment Replay ---
  console.log('\n7. Test Case F: Idempotent replay of already paid order...');
  const replayResultA = await WalletService.payOrder(1, orderA.qr_code_token, '1234');
  assert(replayResultA.success === true, 'Replay returned success: true');
  assert(replayResultA.status === 'PAID', 'Replay confirmed status is PAID');
  assert(replayResultA.auto_recharged === false, 'Replay did not perform duplicate auto-recharge');

  // --- Test Case G: Invalid PIN & Lockout Protection ---
  console.log('\n8. Test Case G: PIN validation and wrong attempt tracking...');
  const orderG = await OrderService.createOrder('KEBBI_ROBOT_001', 50);
  const payWrongPin = await WalletService.payOrder(1, orderG.qr_code_token, '9999');
  assert(payWrongPin.success === false, 'Wrong PIN was rejected');
  const userWrong = db.getUserById(1)!;
  assert(userWrong.failed_pin_attempts === 1, 'Failed PIN attempt counter incremented to 1');

  // Successful PIN resets counter
  const payCorrectPin = await WalletService.payOrder(1, orderG.qr_code_token, '1234');
  assert(payCorrectPin.success === true, 'Correct PIN succeeded');
  const userReset = db.getUserById(1)!;
  assert(userReset.failed_pin_attempts === 0, 'Failed PIN attempt counter reset to 0');

  // --- Test Case H: Friend Transfer Atomic Operation ---
  console.log('\n9. Test Case H: Peer-to-peer transfer...');
  // User 1 balance is currently $0 (after paying $50 from $50). Let's recharge $500.
  const rechargeRes = await WalletService.rechargeWallet(1, '1234', 500);
  assert(rechargeRes.success === true, 'Manual recharge of $500 succeeded');
  const user1AfterRecharge = db.getUserById(1)!;
  assert(user1AfterRecharge.balance === 500, 'User 1 balance is $500');

  // Transfer $200 from User 1 to User 2 (0987654321)
  const transferRes = await WalletService.transferMoney(1, '0987654321', '1234', 200);
  assert(transferRes.success === true, 'Transfer of $200 succeeded');
  const user1AfterTransfer = db.getUserById(1)!;
  const user2AfterTransfer = db.getUserByPhone('0987654321')!;
  assert(user1AfterTransfer.balance === 300, 'Sender balance deducted to $300 ($500 - $200)');
  assert(user2AfterTransfer.balance === 200, 'Recipient balance increased to $200 ($0 + $200)');

  // Check transaction history
  const txns = db.getUserTransactions(1);
  assert(txns.length > 0, 'Transactions recorded in database');
  assert(txns.some((t) => t.type === 'TRANSFER_OUT'), 'TRANSFER_OUT transaction found for User 1');

  console.log('\n====================================================');
  console.log(` Verification Complete: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
