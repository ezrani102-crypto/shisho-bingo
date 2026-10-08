const express = require('express');
const { requireTelegramAuth } = require('../middleware/auth');
const { createDepositRequest } = require('../services/walletService');
const pool = require('../database/db');
const bot = require('../bot/index');

const router = express.Router();

// User submits a deposit
router.post('/deposits', requireTelegramAuth, async (req, res) => {
  const { amount, method, transactionId } = req.body;

  if (!amount || amount < 10 || !method || !transactionId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Minimum deposit is 10 BIRR. All fields required.' });
  }

  try {
    const depositId = await createDepositRequest(req.user.id, amount, method, transactionId);

    // Notify Admin via Telegram Bot
    const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;
    if (adminTelegramId) {
      const msg = `💰 *NEW DEPOSIT REQUEST*\n\n` +
                  `User: ${req.user.first_name}\n` +
                  `Amount: ${amount} BIRR\n` +
                  `Method: ${method}\n` +
                  `Tx ID: \`${transactionId}\`\n` +
                  `Status: PENDING`;
      
      await bot.telegram.sendMessage(adminTelegramId, msg, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ APPROVE', callback_data: `dep_app_${depositId}` },
              { text: '❌ REJECT', callback_data: `dep_rej_${depositId}` }
            ]
          ]
        }
      });
    }

    res.json({ success: true, message: 'Deposit submitted and pending approval.' });
  } catch (error) {
    if (error.message === 'DUPLICATE_TRANSACTION') {
      return res.status(409).json({ error: 'DUPLICATE', message: 'This transaction ID has already been submitted.' });
    }
    console.error('[DEPOSIT]', error);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// User views their deposit history
router.get('/deposits', requireTelegramAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, amount, method, transaction_id, status, created_at FROM deposit_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ success: true, deposits: rows });
  } catch (error) {
    res.status(500).json({ error: 'DATABASE_ERROR' });
  }
});

module.exports = router;