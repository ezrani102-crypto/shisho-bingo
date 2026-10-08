const pool = require('../database/db');

async function createDepositRequest(userId, amount, method, transactionId) {
  // Prevent duplicate submission of the same receipt
  const [existing] = await pool.query(
    'SELECT id FROM deposit_requests WHERE transaction_id = ?', 
    [transactionId]
  );
  if (existing.length > 0) {
    throw new Error('DUPLICATE_TRANSACTION');
  }

  const [result] = await pool.query(
    `INSERT INTO deposit_requests (user_id, amount, method, transaction_id, status) 
     VALUES (?, ?, ?, ?, 'PENDING')`,
    [userId, amount, method, transactionId]
  );
  
  return result.insertId;
}

// Atomic approval/rejection process
async function resolveDeposit(depositId, adminId, isApproved) {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    // 1. Lock the deposit record to prevent concurrent processing
    const [deposits] = await connection.query(
      'SELECT * FROM deposit_requests WHERE id = ? FOR UPDATE',
      [depositId]
    );
    const deposit = deposits[0];

    if (!deposit) throw new Error('DEPOSIT_NOT_FOUND');
    if (deposit.status !== 'PENDING') throw new Error('ALREADY_PROCESSED');

    const newStatus = isApproved ? 'APPROVED' : 'REJECTED';

    // 2. Update deposit status
    await connection.query(
      `UPDATE deposit_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ?`,
      [newStatus, adminId, depositId]
    );

    if (isApproved) {
      // 3. Lock user's wallet
      const [wallets] = await connection.query(
        'SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE',
        [deposit.user_id]
      );
      
      const balanceBefore = parseFloat(wallets[0].balance);
      const amount = parseFloat(deposit.amount);
      const balanceAfter = balanceBefore + amount;

      // 4. Safely credit the wallet
      await connection.query(
        'UPDATE wallets SET balance = ? WHERE user_id = ?',
        [balanceAfter, deposit.user_id]
      );

      // 5. Create immutable ledger record
      await connection.query(
        `INSERT INTO wallet_transactions 
        (user_id, type, amount, balance_before, balance_after, reference_id, description) 
        VALUES (?, 'DEPOSIT', ?, ?, ?, ?, 'Manual Deposit Approved')`,
        [deposit.user_id, amount, balanceBefore, balanceAfter, deposit.id]
      );
    }

    await connection.commit();
    return deposit;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createDepositRequest, resolveDeposit };