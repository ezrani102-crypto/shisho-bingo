const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { Telegraf, Markup } = require('telegraf');

// --- DATABASE POOL VIA DATABASE_URL ---
let pool;
try {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[DATABASE] Critical: DATABASE_URL is missing in environment variables!');
  }
  pool = mysql.createPool({
    uri: dbUrl,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 5
  });
} catch (err) {
  console.error('[DATABASE] Failed to initialize connection pool:', err);
}

// --- BOT SETUP ---
const bot = new Telegraf(process.env.BOT_TOKEN || '');
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || '');

// Dynamic Domain Tracker (eliminates the need for MINI_APP_URL)
let currentHostUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL 
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` 
  : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

bot.catch((err, ctx) => {
  console.error(`[TELEGRAF ERROR] for update ${ctx?.updateType}:`, err);
});

bot.start(async (ctx) => {
  console.log(`[BOT] /start received from: ${ctx.from.id} (@${ctx.from.username})`);
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
      console.log(`[BOT] New player registered with ID: ${res.insertId}`);
    }
    await conn.commit();

    // Dynamically build WebApp URL using current active domain
    const targetUrl = currentHostUrl || `https://${ctx.get('host') || 'shisho-bingo.vercel.app'}`;

    await ctx.reply(
      "🏠 *Welcome to SHISHO BINGO!*\n\nClick below to open the game platform:",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("🎮 PLAY NOW", targetUrl)]
        ])
      }
    );
  } catch (e) {
    if (conn) await conn.rollback();
    console.error('[BOT /start ERROR]:', e);
    await ctx.reply("⚠️ Service initializing. Please send /start again in a moment.");
  } finally {
    if (conn) conn.release();
  }
});

// Admin Approval Actions (Atomic Ledger)
bot.action(/^dep_app_(\d+)$/, async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [deps] = await conn.query('SELECT * FROM deposit_requests WHERE id = ? FOR UPDATE', [ctx.match[1]]);
    if (deps[0]?.status !== 'PENDING') throw new Error('ALREADY_PROCESSED');

    await conn.query('UPDATE deposit_requests SET status = "APPROVED" WHERE id = ?', [ctx.match[1]]);
    const [wallets] = await conn.query('SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE', [deps[0].user_id]);
    const balanceBefore = parseFloat(wallets[0].balance);
    const amount = parseFloat(deps[0].amount);
    const balanceAfter = balanceBefore + amount;

    await conn.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [balanceAfter, deps[0].user_id]);
    await conn.query(
      'INSERT INTO wallet_transactions (user_id, type, amount, balance_before, balance_after) VALUES (?, "DEPOSIT", ?, ?, ?)', 
      [deps[0].user_id, amount, balanceBefore, balanceAfter]
    );
    await conn.commit();
    await ctx.editMessageText(`✅ *Deposit Approved!*\nAmount: ${amount} BIRR credited.`, { parse_mode: 'Markdown' });
  } catch(e) {
    if (conn) await conn.rollback();
    await ctx.answerCbQuery(e.message || 'Error processing approval');
  } finally {
    if (conn) conn.release();
  }
});

bot.action(/^dep_rej_(\d+)$/, async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  try {
    await pool.query('UPDATE deposit_requests SET status = "REJECTED" WHERE id = ? AND status = "PENDING"', [ctx.match[1]]);
    await ctx.editMessageText('❌ Deposit Rejected.');
  } catch (e) {
    await ctx.answerCbQuery('Error rejecting deposit');
  }
});

// Admin Commands
bot.command('createroom', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  try {
    const roomNum = Math.floor(Math.random() * 9000) + 1000;
    const [res] = await pool.query('INSERT INTO rooms (room_number) VALUES (?)', [roomNum]);
    for(let i = 1; i <= 100; i++) {
      await pool.query('INSERT INTO room_cartelas (room_id, cartela_number) VALUES (?, ?)', [res.insertId, i]);
    }
    ctx.reply(`✅ Room #${roomNum} created with 100 cartelas.`);
  } catch (err) {
    console.error('[ROOM ERROR]:', err);
    ctx.reply('Failed to create room.');
  }
});

bot.command('startroom', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  const parts = ctx.message.text.split(' ');
  const roomNum = parts[1];
  if (!roomNum) return ctx.reply('Usage: /startroom <room_number>');

  let draw = Array.from({ length: 75 }, (_, i) => i + 1);
  draw.sort(() => Math.random() - 0.5); // Sealed Draw Sequence
  await pool.query(
    'UPDATE rooms SET status="PLAYING", start_time=NOW(), draw_order=? WHERE room_number=?', 
    [JSON.stringify(draw), roomNum]
  );
  ctx.reply(`🎱 Room #${roomNum} started! Drawing numbers every 5 seconds.`);
});

// --- EXPRESS SERVER ---
const app = express();
app.use(cors());
app.use(express.json());

// Direct Webhook: Dynamically updates server host URL on every ping
app.post('/api/telegram/webhook', async (req, res) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) {
    currentHostUrl = `https://${host}`;
  }
  try {
    await bot.handleUpdate(req.body, res);
    if (!res.headersSent) res.status(200).send('OK');
  } catch (err) {
    console.error('[WEBHOOK EXECUTION ERROR]:', err);
    if (!res.headersSent) res.status(200).send('OK');
  }
});

// Telegram Authentication Middleware
const auth = async (req, res, next) => {
  try {
    const initData = req.headers.authorization?.split(' ')[1];
    if (!initData) throw new Error('Missing token');
    const data = new URLSearchParams(initData);
    const hash = data.get('hash');
    data.delete('hash');
    const checkString = Array.from(data.entries()).map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN || '').digest();
    if (crypto.createHmac('sha256', secret).update(checkString).digest('hex') !== hash) {
      throw new Error('Hash mismatch');
    }

    const tgUser = JSON.parse(data.get('user'));
    const [rows] = await pool.query(
      'SELECT users.*, wallets.balance, wallets.id as wallet_id FROM users JOIN wallets ON users.id = wallets.user_id WHERE telegram_id = ?', 
      [tgUser.id]
    );
    if (!rows.length) throw new Error('User not found');
    req.user = rows[0];
    next();
  } catch (e) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
  }
};

// --- MINI APP API ENDPOINTS ---

app.get('/api/health', (req, res) => {
  res.json({ success: true, database: pool ? "connected" : "offline", timestamp: new Date().toISOString() });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ balance: req.user.balance, name: req.user.first_name, id: req.user.id });
});

app.post('/api/deposits', auth, async (req, res) => {
  try {
    const [result] = await pool.query(
      'INSERT INTO deposit_requests (user_id, amount, method, transaction_id) VALUES (?, ?, "TELEBIRR", ?)', 
      [req.user.id, req.body.amount, req.body.tx]
    );
    if (ADMIN_ID) {
      await bot.telegram.sendMessage(
        ADMIN_ID, 
        `💰 *NEW DEPOSIT REQUEST*\n\nUser: ${req.user.first_name}\nAmount:${req.body.amount} BIRR\nTx ID: \`${req.body.tx}\``, 
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ APPROVE', callback_data: `dep_app_${result.insertId}` },
              { text: '❌ REJECT', callback_data: `dep_rej_${result.insertId}` }
            ]]
          }
        }
      );
    }
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Failed to record deposit' });
  }
});

app.get('/api/rooms', auth, async (req, res) => {
  try {
    const [rooms] = await pool.query('SELECT * FROM rooms WHERE status != "FINISHED" ORDER BY id DESC');
    res.json(rooms);
  } catch (e) {
    res.status(500).json({ error: 'DB_ERROR' });
  }
});

app.get('/api/rooms/:id/state', auth, async (req, res) => {
  try {
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
  } catch (e) {
    res.status(500).json({ error: 'DB_ERROR' });
  }
});

// Cartela Purchase / Deselect Toggle (Atomic Concurrency)
app.post('/api/rooms/:id/cartela', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const num = req.body.number;
    const [room] = await conn.query('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    if (room[0]?.status !== 'WAITING') throw new Error("Game already starting or in progress.");

    const [cartela] = await conn.query('SELECT * FROM room_cartelas WHERE room_id=? AND cartela_number=? FOR UPDATE', [req.params.id, num]);
    const [wallet] = await conn.query('SELECT balance FROM wallets WHERE user_id=? FOR UPDATE', [req.user.id]);

    if (cartela[0].status === 'AVAILABLE') {
      const [myCarts] = await conn.query('SELECT count(*) as c FROM room_cartelas WHERE room_id=? AND user_id=?', [req.params.id, req.user.id]);
      if (myCarts[0].c >= 2) throw new Error("Maximum 2 cartelas allowed.");
      if (parseFloat(wallet[0].balance) < 10) throw new Error("Insufficient balance (10 BIRR required).");

      await conn.query('UPDATE room_cartelas SET status="TAKEN", user_id=? WHERE id=?', [req.user.id, cartela[0].id]);
      await conn.query('UPDATE wallets SET balance = balance - 10 WHERE user_id=?', [req.user.id]);
      await conn.query('UPDATE rooms SET prize_pool = prize_pool + 10 WHERE id=?', [req.params.id]);
      await conn.query('INSERT INTO wallet_transactions (user_id, type, amount, balance_before, balance_after) VALUES (?, "GAME_STAKE", 10, ?, ?)', 
        [req.user.id, wallet[0].balance, parseFloat(wallet[0].balance) - 10]);
    } else if (cartela[0].user_id === req.user.id) {
      await conn.query('UPDATE room_cartelas SET status="AVAILABLE", user_id=NULL WHERE id=?', [cartela[0].id]);
      await conn.query('UPDATE wallets SET balance = balance + 10 WHERE user_id=?', [req.user.id]);
      await conn.query('UPDATE rooms SET prize_pool = prize_pool - 10 WHERE id=?', [req.params.id]);
      await conn.query('INSERT INTO wallet_transactions (user_id, type, amount, balance_before, balance_after) VALUES (?, "GAME_REFUND", 10, ?, ?)', 
        [req.user.id, wallet[0].balance, parseFloat(wallet[0].balance) + 10]);
    } else {
      throw new Error("Cartela was just taken by another player.");
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

// Bingo Claim Verification (Server Authority)
app.post('/api/rooms/:id/bingo', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rooms] = await conn.query('SELECT * FROM rooms WHERE id = ? FOR UPDATE', [req.params.id]);
    const room = rooms[0];
    if (room?.status !== 'PLAYING') throw new Error("Game is not active");

    const [myCarts] = await conn.query('SELECT * FROM room_cartelas WHERE room_id = ? AND user_id = ?', [room.id, req.user.id]);
    if (!myCarts.length) throw new Error("You have no cartelas in this room");

    const secondsElapsed = Math.floor((new Date() - new Date(room.start_time)) / 1000);
    const index = Math.min(Math.floor(secondsElapsed / 5), 74);
    const order = typeof room.draw_order === 'string' ? JSON.parse(room.draw_order) : room.draw_order;
    const calledNumbers = new Set(order.slice(0, index + 1));

    // Helper: Build deterministic board matrix
    const checkCardWin = (cartNum) => {
      let seed = cartNum * 1234;
      const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      let grid = Array.from({ length: 5 }, () => Array(5).fill(0));
      for (let col = 0; col < 5; col++) {
        let poolList = Array.from({ length: 15 }, (_, i) => i + 1 + (col * 15));
        for (let row = 0; row < 5; row++) {
          if (col === 2 && row === 2) { grid[row][col] = 'FREE'; continue; }
          let idx = Math.floor(rand() * poolList.length);
          grid[row][col] = poolList.splice(idx, 1)[0];
        }
      }

      const isMarked = (v) => v === 'FREE' || calledNumbers.has(v);

      // Check rows and columns
      for (let i = 0; i < 5; i++) {
        if (grid[i].every(isMarked)) return true;
        if ([0,1,2,3,4].every(r => isMarked(grid[r][i]))) return true;
      }
      // Check Four Corners
      if (isMarked(grid[0][0]) && isMarked(grid[0][4]) && isMarked(grid[4][0]) && isMarked(grid[4][4])) return true;
      return false;
    };

    let winningCartela = null;
    for (const c of myCarts) {
      if (checkCardWin(c.cartela_number)) {
        winningCartela = c.cartela_number;
        break;
      }
    }

    if (!winningCartela) {
      throw new Error("NOT_BINGO_YET");
    }

    // Winner Confirmed: Calculate 20% House Fee
    const grossPot = parseFloat(room.prize_pool);
    const houseFee = grossPot * 0.20;
    const prizeAmount = grossPot - houseFee;

    // End Game
    await conn.query('UPDATE rooms SET status = "FINISHED" WHERE id = ?', [room.id]);

    // Credit Winner
    const [wallets] = await conn.query('SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE', [req.user.id]);
    const balanceBefore = parseFloat(wallets[0].balance);
    const balanceAfter = balanceBefore + prizeAmount;
    await conn.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [balanceAfter, req.user.id]);

    await conn.query(
      'INSERT INTO wallet_transactions (user_id, type, amount, balance_before, balance_after) VALUES (?, "GAME_WIN", ?, ?, ?)',
      [req.user.id, prizeAmount, balanceBefore, balanceAfter]
    );

    await conn.query(
      'INSERT INTO game_winners (room_id, user_id, cartela_number, prize_amount) VALUES (?, ?, ?, ?)',
      [room.id, req.user.id, winningCartela, prizeAmount]
    );

    await conn.commit();
    res.json({ success: true, prize: prizeAmount, cartela: winningCartela });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(400).json({ error: e.message || 'Verification failed' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = app;