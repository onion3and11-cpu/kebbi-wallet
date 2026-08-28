import { db } from '../db/database';
import { verifyPasswordSync, hashPasswordSync } from '../utils/crypto';
import { MockBankAccount, toCents, toTWD, isValidPositiveAmount } from '../types';

export class MockBankService {
  /**
   * 綁定或線上直接開立模擬銀行帳戶
   * 若帳號不存在則自動開戶並給予 $50,000 測試金；若存在則驗證密碼後綁定。
   */
  static async linkOrRegisterBank(
    userId: number,
    accountNumber: string,
    bankPassword: string,
    bankCode: string = '822'
  ): Promise<{ success: boolean; bankAccount?: MockBankAccount; message: string }> {
    const accNum = accountNumber.trim();
    const pass = bankPassword.trim();

    if (!accNum || !pass) {
      return { success: false, message: '請提供完整的銀行帳號與密碼' };
    }

    try {
      return db.transaction(() => {
        const existingAcc = db.getBankByAccountNumber(accNum);

        if (!existingAcc) {
          // Auto create new bank account with $50,000 demo balance
          const passHash = hashPasswordSync(pass);
          const newAcc = db.createBank(userId, bankCode, accNum, passHash, 5000000);
          return {
            success: true,
            bankAccount: newAcc,
            message: '成功開立並綁定模擬銀行帳戶（獲贈 $50,000 測試金）',
          };
        } else {
          // Verify bank password
          const isValidPass = verifyPasswordSync(pass, existingAcc.bank_password_hash);
          if (!isValidPass) {
            return { success: false, message: '模擬銀行密碼驗證失敗！' };
          }

          // Link to user
          db.linkBankToUser(existingAcc.id, userId);
          const updated = db.getBankByUserId(userId);
          return {
            success: true,
            bankAccount: updated || existingAcc,
            message: '成功綁定既有模擬銀行帳戶',
          };
        }
      });
    } catch (err: any) {
      console.error('linkOrRegisterBank Error:', err);
      return { success: false, message: '銀行綁定服務異常: ' + err.message };
    }
  }

  /**
   * 存入資金至模擬銀行帳戶 (Deposit into Mock Bank Account)
   */
  static async depositByUserId(
    userId: number,
    amountTwd: number
  ): Promise<{ success: boolean; newBankBalance?: number; message: string }> {
    if (!isValidPositiveAmount(amountTwd)) {
      return { success: false, message: '存款金額必須大於 $0' };
    }

    const amountCents = toCents(amountTwd);

    try {
      return db.transaction(() => {
        const bank = db.getBankByUserId(userId);
        if (!bank) {
          return { success: false, message: '尚未綁定模擬銀行帳戶，無法存款' };
        }

        const newBalCents = bank.mock_bank_balance_cents + amountCents;
        db.updateBankBalance(bank.id, newBalCents);

        return {
          success: true,
          newBankBalance: toTWD(newBalCents),
          message: `成功向模擬銀行帳戶存款 $${amountTwd}！`,
        };
      });
    } catch (err: any) {
      return { success: false, message: '存款失敗: ' + err.message };
    }
  }
}
