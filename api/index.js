const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { Telegraf, Markup } = require('telegraf');

// --- DATABASE POOL ---
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'test',
  port: Number(process.env.DB_PORT) || 4000,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 5
});

// --- BOT SETUP ---
if (!process.env.BOT_TOKEN) {
  console.error('[CONFIG] Missing BOT_TOKEN environment variable');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;

// Catch any unhandled bot errors so Vercel logs them
bot.catch((err, ctx) => {
  console.error(`[TELEGRAF ERROR] for update ${ctx.updateType}:`, err);
});

bot.start(async (ctx) => {
  console.log(`[BOT] Received /start from user: ${ctx.from.id} (@${ctx.from.username})`);
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT id FROM users WHERE telegram_id = ?', [ctx.from.id]);
    if (!rows.length) {
      const [res] = await conn.query(
        'INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)', 
        [ctx.from.id, ctx.from.username || null, ctx.from.first_name || 'Player']
      );
      await conn.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [res.insertId]);
      console.log(`[BOT] Registered new user ID: ${res.insertId}`);
    }
    await conn.commit();

    const appUrl = process.env.MINI_APP_URL || `https://${process.env.VERCEL_URL}`;
    const keyboard = appUrl.startsWith('https://')
      ? Markup.inlineKeyboard([[Markup.button.webApp("🎮 PLAY NOW", appUrl)]])
      : Markup.inlineKeyboard([[Markup.button.callback("⚠️ Set MINI_APP_URL in Vercel", "noop")]]);

    await ctx.reply("🏠 Welcome to SHISHO BINGO!\nClick below to open the game:", keyboard);
  } catch (e) {
    if (conn) await conn.rollback();
    console.error('[BOT ERROR] /start failed:', e);
    await ctx.reply("⚠️ Service temporarily initializing. Please try /start again in a few seconds.");
  } finally {
    if (conn) conn.release();
  }
});

// Admin Approval Actions
bot.action(/^dep_app_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [deps] = await conn.query('SELECT * FROM deposit_requests WHERE id = ? FOR UPDATE', [ctx.match[1]]);
    if (deps[0]?.status !== 'PENDING') throw new Error('ALREADY_PROCESSED');
    
    await conn.query('UPDATE deposit_requests SET status = "APPROVED" WHERE id = ?', [ctx.match[1]]);
    const [wallets] = await conn.query('SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE', [deps[0].user_id]);
    const newBal = parseFloat(wallets[0].balance) + parseFloat(deps[0].amount);
    await conn.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [newBal, deps[0].user_id]);
    await conn.query(
      'INSERT INTO wallet_transactions (user_id, type, amount, balance_before, balance_after) VALUES (?, "DEPOSIT", ?, ?, ?)', 
      [deps[0].user_id, deps[0].amount, wallets[0].balance, newBal]
    );
    await conn.commit();
    await ctx.editMessageText('✅ Deposit Approved.');
  } catch(e) {
    if (conn) await conn.rollback();
    await ctx.answerCbQuery(e.message || 'Error');
  } finally {
    if (conn) conn.release();
  }
});

// Admin command: /createroom
bot.command('createroom', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;
  try {
    const roomNum = Math.floor(Math.random() * 9000) + 1000;
    const [res] = await pool.query('INSERT INTO rooms (room_number) VALUES (?)', [roomNum]);
    for(let i = 1; i <= 100; i++) {
      await pool.query('INSERT INTO room_cartelas (room_id, cartela_number) VALUES (?, ?)', [res.insertId, i]);
    }
    ctx.reply(`Room #${roomNum} created with 100 cartelas.`);
  } catch (err) {
    console.error('[ROOM ERROR]:', err);
    ctx.reply('Failed to create room.');
  }
});

// Admin command: /startroom <roomNumber>
bot.command('startroom', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;
  const parts = ctx.message.text.split(' ');
  const roomNum = parts[1];
  if (!roomNum) return ctx.reply('Usage: /startroom <room_number>');
  
  let draw = Array.from({ length: 75 }, (_, i) => i + 1);
  draw.sort(() => Math.random() - 0.5);
  await pool.query(
    'UPDATE rooms SET status="PLAYING", start_time=NOW(), draw_order=? WHERE room_number=?', 
    [JSON.stringify(draw), roomNum]
  );
  ctx.reply(`Room #${roomNum} started! Numbers drawing every 5s.`);
});

// --- EXPRESS SERVER ---
const app = express();
app.use(cors());
app.use(express.json());

// DIRECT WEBHOOK HANDLER: Completely avoids Telegraf path-matching issues on Vercel
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
    if (!res.headersSent) {
      res.status(200).send('OK');
    }
  } catch (err) {
    console.error('[WEBHOOK EXECUTION ERROR]:', err);
    if (!res.headersSent) {
      res.status(200).send('OK'); // Always return 200 so Telegram does not stop sending
    }
  }
});

// Auth Middleware for Mini App
const auth = async (req, res, next) => {
  try {
    const initData = req.headers.authorization?.split(' ')[1];
    if (!initData) throw new Error('Missing token');
    const data = new URLSearchParams(initData);
    const hash = data.get('hash');
    data.delete('hash');
    const checkString = Array.from(data.entries()).map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    if (crypto.createHmac('sha256', secret).update(checkString).digest('hex') !== hash) {
      throw new Error('Hash mismatch');
    }
    
    const tgUser = JSON.parse(data.get('user'));
    const [rows] = await pool.query(
      'SELECT users.*, wallets.balance, wallets.id as wallet_id FROM users JOIN wallets ON users.id = wallets.user_id WHERE telegram_id = ?', 
      [tgUser.id]
    );
    if (!rows.length) throw new Error('User not registered');
    req.user = rows[0];
    next();
  } catch(e) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
  }
};

// Endpoints
app.get('/api/health', (req, res) => res.json({ success: true, timestamp: new Date().toISOString() }));

app.get('/api/me', auth, (req, res) => {
  res.json({ balance: req.user.balance, name: req.user.first_name });
});

app.post('/api/deposits', auth, async (req, res) => {
  try {
    const [result] = await pool.query(
      'INSERT INTO deposit_requests (user_id, amount, method, transaction_id) VALUES (?, ?, "TELEBIRR", ?)', 
      [req.user.id, req.body.amount, req.body.tx]
    );
    if (ADMIN_ID) {
      await bot.telegram.sendMessage(ADMIN_ID, `💰 DEPOSIT\nUser: ${req.user.first_name}\nAmount: ${req.body.amount} BIRR\nTx: ${req.body.tx}`, {
        reply_markup: { inline_keyboard: [[ { text: 'APPROVE', callback_data: `dep_app_${result.insertId}` } ]] }
      });
    }
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/rooms', auth, async (req, res) => {
  const [rooms] = await pool.query('SELECT * FROM rooms WHERE status != "FINISHED"');
  res.json(rooms);
});

app.get('/api/rooms/:id/state', auth, async (req, res) => {
  const [rooms] = await pool.query('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
  const room = rooms[0];
  if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });

  const [cartelas] = await pool.query('SELECT cartela_number, user_id, status FROM room_cartelas WHERE room_id = ?', [room.id]);
  
  let game = { status: room.status, called: [], current: null };
  if (room.status === 'PLAYING' && room.start_time && room.draw_order) {
    const secondsElapsed = Math.floor((new Date() - new Date(room.start_time)) / 1000);
    const index = Math.min(Math.floor(secondsElapsed / 5), 74);
    const order = typeof room.draw_order === 'string' ? JSON.parse(room.draw_order) : room.draw_order;
    game.called = order.slice(0, index + 1);
    game.current = game.called[game.called.length - 1];
  }
  res.json({ room, cartelas, game, myId: req.user.id });
});

app.post('/api/rooms/:id/cartela', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const num = req.body.number;
    const [room] = await conn.query('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    if (room[0].status !== 'WAITING') throw new Error("Game Started");

    const [cartela] = await conn.query('SELECT * FROM room_cartelas WHERE room_id=? AND cartela_number=? FOR UPDATE', [req.params.id, num]);
    const [wallet] = await conn.query('SELECT balance FROM wallets WHERE user_id=? FOR UPDATE', [req.user.id]);

    if (cartela[0].status === 'AVAILABLE') {
      const [myCarts] = await conn.query('SELECT count(*) as c FROM room_cartelas WHERE room_id=? AND user_id=?', [req.params.id, req.user.id]);
      if (myCarts[0].c >= 2) throw new Error("MAX_2");
      if (parseFloat(wallet[0].balance) < 10) throw new Error("INSUFFICIENT_FUNDS");

      await conn.query('UPDATE room_cartelas SET status="TAKEN", user_id=? WHERE id=?', [req.user.id, cartela[0].id]);
      await conn.query('UPDATE wallets SET balance = balance - 10 WHERE user_id=?', [req.user.id]);
      await conn.query('UPDATE rooms SET prize_pool = prize_pool + 10 WHERE id=?', [req.params.id]);
    } else if (cartela[0].user_id === req.user.id) {
      await conn.query('UPDATE room_cartelas SET status="AVAILABLE", user_id=NULL WHERE id=?', [cartela[0].id]);
      await conn.query('UPDATE wallets SET balance = balance + 10 WHERE user_id=?', [req.user.id]);
      await conn.query('UPDATE rooms SET prize_pool = prize_pool - 10 WHERE id=?', [req.params.id]);
    } else {
      throw new Error("TAKEN");
    }
    await conn.commit();
    res.json({ success: true });
  } catch(e) {
    if (conn) await conn.rollback();
    res.status(400).json({ error: e.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = app;