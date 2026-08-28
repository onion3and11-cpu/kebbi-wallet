import { db } from '../db/database';
import { verifyPasswordSync } from '../utils/crypto';
import {
  PayOrderResult,
  User,
  MockBankAccount,
  Order,
  AUTO_RECHARGE_UNIT_CENTS,
  AUTO_RECHARGE_UNIT_TWD,
  toCents,
  toTWD,
  isValidPositiveAmount,
  validateAmountTwd,
  computeAutoRecharge,
} from '../types';

export class WalletService {
  /**
   * 手動錢包加值 (從綁定之模擬銀行扣款加值)
   * 共用同一原子交易：銀行扣款 + 錢包入帳 + 交易紀錄
   */
  static async rechargeWallet(
    userId: number,
    paymentPin: string,
    amountTwd: number
  ): Promise<{ success: boolean; newBalance?: number; message: string }> {
    const val = validateAmountTwd(amountTwd);
    if (!val.valid) {
      return { success: false, message: val.error || '加值金額無效' };
    }

    const amountCents = val.cents;

    try {
      return db.transaction(() => {
        // 1. Check user
        const user = db.getUserById(userId);
        if (!user) {
          return { success: false, message: '找不到使用者' };
        }

        // Check if locked
        if (user.locked_until && new Date() < new Date(user.locked_until)) {
          return { success: false, message: 'PIN 碼輸入錯誤次數過多，帳戶已暫時鎖定，請稍後再試' };
        }

        // 2. Verify PIN
        const isPinValid = verifyPasswordSync(paymentPin, user.payment_pin_hash);
        if (!isPinValid) {
          db.recordFailedPinAttempt(userId, user.failed_pin_attempts);
          return { success: false, message: '支付密碼驗證失敗！' };
        }
        db.resetFailedPinAttempts(userId);

        // 3. Find linked bank
        const bank = db.getBankByUserId(userId);
        if (!bank) {
          return { success: false, message: '尚未綁定模擬銀行帳戶，無法進行加值' };
        }

        // 4. Check bank balance
        if (bank.mock_bank_balance_cents < amountCents) {
          return {
            success: false,
            message: `銀行帳戶餘額不足 (剩餘 $${bank.mock_bank_balance})，無法手動加值 $${amountTwd}`,
          };
        }

        // 5. Execute atomic deduction and deposit
        const newBankBalCents = bank.mock_bank_balance_cents - amountCents;
        const newWalletBalCents = user.balance_cents + amountCents;

        db.updateBankBalance(bank.id, newBankBalCents);
        db.updateUserBalance(userId, newWalletBalCents);

        // 6. Record transaction
        db.createTransaction({
          user_id: userId,
          amount_cents: amountCents,
          type: 'MANUAL_RECHARGE',
          mock_bank_account_id: bank.id,
          note: `手動加值 $${amountTwd}`,
        });

        return {
          success: true,
          newBalance: toTWD(newWalletBalCents),
          message: `手動加值 $${amountTwd} 成功！`,
        };
      });
    } catch (err: any) {
      return { success: false, message: '加值流程失敗: ' + err.message };
    }
  }

  /**
   * 好友轉帳 (Transfer to friend / phone)
   * 共用同一原子交易：扣除發送者 + 增加接收者 + 驗證接收者存在 + 雙向交易明細
   */
  static async transferMoney(
    senderId: number,
    recipientPhone: string,
    paymentPin: string,
    amountTwd: number
  ): Promise<{ success: boolean; message: string; newBalance?: number }> {
    const val = validateAmountTwd(amountTwd);
    if (!val.valid) {
      return { success: false, message: val.error || '轉帳金額無效' };
    }

    const amountCents = val.cents;

    try {
      return db.transaction(() => {
        // 1. Verify Sender
        const sender = db.getUserById(senderId);
        if (!sender) {
          return { success: false, message: '找不到轉帳發起人' };
        }

        if (sender.locked_until && new Date() < new Date(sender.locked_until)) {
          return { success: false, message: 'PIN 碼輸入錯誤次數過多，帳戶已暫時鎖定' };
        }

        const isPinValid = verifyPasswordSync(paymentPin, sender.payment_pin_hash);
        if (!isPinValid) {
          db.recordFailedPinAttempt(senderId, sender.failed_pin_attempts);
          return { success: false, message: '支付密碼驗證失敗！' };
        }
        db.resetFailedPinAttempts(senderId);

        // 2. Verify Recipient
        const recipient = db.getUserByPhone(recipientPhone);
        if (!recipient) {
          return { success: false, message: `找不到手機號碼為 ${recipientPhone} 的收款對象` };
        }

        if (recipient.id === sender.id) {
          return { success: false, message: '無法轉帳給自己的帳號' };
        }

        // 3. Check Sender Balance
        if (sender.balance_cents < amountCents) {
          return {
            success: false,
            message: `錢包餘額不足 ($${sender.balance})，無法轉帳 $${amountTwd}`,
          };
        }

        // 4. Atomic Transfer
        const newSenderBalCents = sender.balance_cents - amountCents;
        const newRecipientBalCents = recipient.balance_cents + amountCents;

        db.updateUserBalance(sender.id, newSenderBalCents);
        db.updateUserBalance(recipient.id, newRecipientBalCents);

        // 5. Record Dual Transactions
        db.createTransaction({
          user_id: sender.id,
          amount_cents: amountCents,
          type: 'TRANSFER_OUT',
          note: `轉帳給 ${recipientPhone}`,
        });

        db.createTransaction({
          user_id: recipient.id,
          amount_cents: amountCents,
          type: 'TRANSFER_IN',
          note: `收到來自 ${sender.phone} 的轉帳`,
        });

        return {
          success: true,
          message: `已成功轉帳 $${amountTwd} 給 ${recipientPhone}`,
          newBalance: toTWD(newSenderBalCents),
        };
      });
    } catch (err: any) {
      return { success: false, message: '轉帳失敗: ' + err.message };
    }
  }

  /**
   * 核心結帳扣款與自動加值 (CRITICAL FINTECH ATOMIC PAYMENT LOGIC)
   */
  static async payOrder(
    userId: number,
    qrCodeToken: string,
    paymentPin: string
  ): Promise<PayOrderResult> {
    const token = (qrCodeToken || '').trim();
    if (!token) {
      return {
        success: false,
        order_id: '',
        status: 'PENDING',
        paid_amount: 0,
        wallet_balance_before: 0,
        wallet_balance_after: 0,
        auto_recharged: false,
        transaction_id: 0,
        message: '請提供有效的 QR Code Token',
      };
    }

    // 1. Verify User and PIN check before lock
    const userPre = db.getUserById(userId);
    if (!userPre) {
      return {
        success: false,
        order_id: '',
        status: 'PENDING',
        paid_amount: 0,
        wallet_balance_before: 0,
        wallet_balance_after: 0,
        auto_recharged: false,
        transaction_id: 0,
        message: '找不到使用者紀錄',
      };
    }

    if (userPre.locked_until && new Date() < new Date(userPre.locked_until)) {
      return {
        success: false,
        order_id: '',
        status: 'PENDING',
        paid_amount: 0,
        wallet_balance_before: userPre.balance,
        wallet_balance_after: userPre.balance,
        auto_recharged: false,
        transaction_id: 0,
        message: 'PIN 碼輸入錯誤次數過多，帳戶已暫時鎖定，請稍後再試',
      };
    }

    const isPinValid = verifyPasswordSync(paymentPin, userPre.payment_pin_hash);
    if (!isPinValid) {
      db.recordFailedPinAttempt(userId, userPre.failed_pin_attempts);
      return {
        success: false,
        order_id: '',
        status: 'PENDING',
        paid_amount: 0,
        wallet_balance_before: userPre.balance,
        wallet_balance_after: userPre.balance,
        auto_recharged: false,
        transaction_id: 0,
        message: '支付密碼不正確！',
      };
    }
    db.resetFailedPinAttempts(userId);

    // 2. Find Order by token
    const orderPre = db.getOrderByToken(token);
    if (!orderPre) {
      return {
        success: false,
        order_id: '',
        status: 'PENDING',
        paid_amount: 0,
        wallet_balance_before: userPre.balance,
        wallet_balance_after: userPre.balance,
        auto_recharged: false,
        transaction_id: 0,
        message: '無效或找不到該支付 QR Code 訂單',
      };
    }

    // Check if already PAID (Idempotent replay) - even if expired now!
    if (orderPre.status === 'PAID') {
      const existingPayTxn = db.getTransactionByOrderId(orderPre.id, 'PAYMENT');
      const existingAutoTxn = db.getTransactionByOrderId(orderPre.id, 'AUTO_RECHARGE');
      return {
        success: true,
        order_id: orderPre.id,
        status: 'PAID',
        paid_amount: orderPre.total_amount,
        wallet_balance_before: userPre.balance,
        wallet_balance_after: userPre.balance,
        auto_recharged: Boolean(existingAutoTxn),
        auto_recharge_amount: existingAutoTxn ? existingAutoTxn.amount : undefined,
        transaction_id: existingPayTxn?.id || 0,
        message: '此訂單已完成付款 (重複提交回傳)',
      };
    }

    // Check expiration
    if (orderPre.expires_at && new Date() > new Date(orderPre.expires_at)) {
      if (orderPre.status === 'PENDING') {
        db.setOrderStatus(orderPre.id, 'EXPIRED');
      }
      return {
        success: false,
        order_id: orderPre.id,
        status: 'EXPIRED',
        paid_amount: 0,
        wallet_balance_before: userPre.balance,
        wallet_balance_after: userPre.balance,
        auto_recharged: false,
        transaction_id: 0,
        message: '此訂單已過期，無法進行支付',
      };
    }

    // 3. Execute Core Atomic Payment in Transaction
    try {
      return db.transaction(() => {
        // Re-read latest state inside transaction
        const user = db.getUserById(userId);
        const order = db.getOrderByToken(token);

        if (!user || !order) {
          return {
            success: false,
            order_id: orderPre.id,
            status: 'PENDING',
            paid_amount: 0,
            wallet_balance_before: userPre.balance,
            wallet_balance_after: userPre.balance,
            auto_recharged: false,
            transaction_id: 0,
            message: '資料庫讀取異常',
          };
        }

        if (order.status === 'PAID') {
          const existingPayTxn = db.getTransactionByOrderId(order.id, 'PAYMENT');
          const existingAutoTxn = db.getTransactionByOrderId(order.id, 'AUTO_RECHARGE');
          return {
            success: true,
            order_id: order.id,
            status: 'PAID',
            paid_amount: order.total_amount,
            wallet_balance_before: user.balance,
            wallet_balance_after: user.balance,
            auto_recharged: Boolean(existingAutoTxn),
            auto_recharge_amount: existingAutoTxn ? existingAutoTxn.amount : undefined,
            transaction_id: existingPayTxn?.id || 0,
            message: '此訂單已完成付款',
          };
        }

        if (order.status !== 'PENDING') {
          return {
            success: false,
            order_id: order.id,
            status: order.status,
            paid_amount: 0,
            wallet_balance_before: user.balance,
            wallet_balance_after: user.balance,
            auto_recharged: false,
            transaction_id: 0,
            message: `訂單狀態為 ${order.status}，無法付款`,
          };
        }

        const initialBalanceCents = user.balance_cents;
        const orderAmountCents = order.total_amount_cents;
        let currentWalletCents = initialBalanceCents;
        let autoRecharged = false;
        let autoRechargeAmountCents = 0;

        const autoPlan = computeAutoRecharge(currentWalletCents, orderAmountCents);

        if (autoPlan.needed) {
          // Auto-recharge required
          if (!user.is_auto_recharge_enabled) {
            return {
              success: false,
              order_id: order.id,
              status: 'PENDING',
              paid_amount: 0,
              wallet_balance_before: toTWD(initialBalanceCents),
              wallet_balance_after: toTWD(currentWalletCents),
              auto_recharged: false,
              transaction_id: 0,
              message: '錢包餘額不足，且自動加值功能已停用',
            };
          }

          const bank = db.getBankByUserId(userId);
          if (!bank) {
            return {
              success: false,
              errorCode: 'INSUFFICIENT_BALANCE_AND_NO_BANK',
              order_id: order.id,
              status: 'PENDING',
              paid_amount: 0,
              wallet_balance_before: toTWD(initialBalanceCents),
              wallet_balance_after: toTWD(currentWalletCents),
              auto_recharged: false,
              transaction_id: 0,
              message: '錢包餘額不足，且尚未綁定銀行帳戶！請即刻綁定銀行帳戶以使用自動加值服務。',
            };
          }

          const topupCents = autoPlan.rechargeAmountCents;

          if (bank.mock_bank_balance_cents < topupCents) {
            // Insufficient bank balance: entire payment FAILS cleanly
            return {
              success: false,
              order_id: order.id,
              status: 'PENDING',
              paid_amount: 0,
              wallet_balance_before: toTWD(initialBalanceCents),
              wallet_balance_after: toTWD(initialBalanceCents),
              auto_recharged: false,
              transaction_id: 0,
              message: `錢包餘額不足，嘗試自動加值 $${toTWD(topupCents)} 失敗：綁定之銀行帳戶餘額僅剩 $${bank.mock_bank_balance}`,
            };
          }

          // Deduct from bank
          const newBankBalCents = bank.mock_bank_balance_cents - topupCents;
          db.updateBankBalance(bank.id, newBankBalCents);

          // Add to wallet
          currentWalletCents += topupCents;
          autoRecharged = true;
          autoRechargeAmountCents = topupCents;

          // Record AUTO_RECHARGE Transaction
          db.createTransaction({
            order_id: order.id,
            user_id: userId,
            amount_cents: topupCents,
            type: 'AUTO_RECHARGE',
            mock_bank_account_id: bank.id,
            note: `自動加值 $${toTWD(topupCents)}`,
          });
        }

        // Deduct payment from wallet
        const finalWalletCents = currentWalletCents - orderAmountCents;
        if (finalWalletCents < 0) {
          throw new Error('計算錯誤：最終錢包餘額小於 0');
        }

        db.updateUserBalance(userId, finalWalletCents);

        // Update Order to PAID
        const paidAt = new Date().toISOString();
        db.setOrderStatus(order.id, 'PAID', paidAt);

        // Record PAYMENT Transaction
        const txn = db.createTransaction({
          order_id: order.id,
          user_id: userId,
          amount_cents: orderAmountCents,
          type: 'PAYMENT',
          note: `訂單支付: ${order.id}`,
        });

        return {
          success: true,
          order_id: order.id,
          status: 'PAID',
          paid_amount: order.total_amount,
          wallet_balance_before: toTWD(initialBalanceCents),
          wallet_balance_after: toTWD(finalWalletCents),
          auto_recharged: autoRecharged,
          auto_recharge_amount: autoRecharged ? toTWD(autoRechargeAmountCents) : undefined,
          transaction_id: txn.id,
          message: autoRecharged
            ? `支付成功！系統已從綁定銀行自動加值 $${toTWD(autoRechargeAmountCents)}，並完成扣款 $${order.total_amount}`
            : `支付成功！成功自錢包扣款 $${order.total_amount}`,
        };
      });
    } catch (err: any) {
      console.error('payOrder atomic error:', err);
      return {
        success: false,
        order_id: orderPre.id,
        status: 'PENDING',
        paid_amount: 0,
        wallet_balance_before: userPre.balance,
        wallet_balance_after: userPre.balance,
        auto_recharged: false,
        transaction_id: 0,
        message: '扣款交易異常失敗: ' + err.message,
      };
    }
  }
}
