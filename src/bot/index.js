const { resolveDeposit } = require('../services/walletService');
const pool = require('../database/db'); // Required to fetch user for notification

// ... existing bot code ...

// Admin Action: Approve Deposit
bot.action(/^dep_app_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_TELEGRAM_ID) {
    return ctx.answerCbQuery('⛔ Unauthorized');
  }
  
  const depositId = ctx.match[1];
  try {
    const deposit = await resolveDeposit(depositId, ctx.from.id, true);
    
    await ctx.answerCbQuery('✅ Deposit Approved!');
    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n✅ *STATUS: APPROVED*`, { parse_mode: 'Markdown' });

    // Notify User
    const [users] = await pool.query('SELECT telegram_id FROM users WHERE id = ?', [deposit.user_id]);
    if (users[0]) {
      await ctx.telegram.sendMessage(
        users[0].telegram_id, 
        `✅ *Deposit Approved!*\n\n${deposit.amount} BIRR has been added to your wallet.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    if (error.message === 'ALREADY_PROCESSED') {
      return ctx.answerCbQuery('⚠️ Already processed.');
    }
    console.error('[ADMIN APPROVE ERROR]', error);
    ctx.answerCbQuery('❌ Error approving deposit.');
  }
});

// Admin Action: Reject Deposit
bot.action(/^dep_rej_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_TELEGRAM_ID) {
    return ctx.answerCbQuery('⛔ Unauthorized');
  }

  const depositId = ctx.match[1];
  try {
    const deposit = await resolveDeposit(depositId, ctx.from.id, false);
    
    await ctx.answerCbQuery('❌ Deposit Rejected!');
    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n❌ *STATUS: REJECTED*`, { parse_mode: 'Markdown' });

    // Notify User
    const [users] = await pool.query('SELECT telegram_id FROM users WHERE id = ?', [deposit.user_id]);
    if (users[0]) {
      await ctx.telegram.sendMessage(
        users[0].telegram_id, 
        `❌ *Deposit Rejected.*\n\nYour deposit request for ${deposit.amount} BIRR was declined. Contact support if this is a mistake.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    if (error.message === 'ALREADY_PROCESSED') {
      return ctx.answerCbQuery('⚠️ Already processed.');
    }
    console.error('[ADMIN REJECT ERROR]', error);
    ctx.answerCbQuery('❌ Error rejecting deposit.');
  }
});