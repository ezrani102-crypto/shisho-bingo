const crypto = require('crypto');
const pool = require('../database/db');

// Validates the initData passed from the Telegram Mini App
function validateTelegramWebAppData(telegramInitData) {
  const initData = new URLSearchParams(telegramInitData);
  const hash = initData.get('hash');
  let dataToCheck = [];

  initData.sort();
  initData.forEach((val, key) => {
    if (key !== 'hash') {
      dataToCheck.push(`${key}=${val}`);
    }
  });

  const secret = crypto.createHmac('sha256', 'WebAppData')
    .update(process.env.BOT_TOKEN);
    
  const _hash = crypto.createHmac('sha256', secret.digest())
    .update(dataToCheck.join('\n'))
    .digest('hex');

  return _hash === hash;
}

const requireTelegramAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Missing authorization header' });
    }

    const initData = authHeader.split(' ')[1];
    
    // 1. Cryptographic validation
    if (!validateTelegramWebAppData(initData)) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Invalid Telegram data' });
    }

    // 2. Extract user data safely
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) {
      return res.status(400).json({ error: 'USER_NOT_FOUND', message: 'User data missing in initData' });
    }
    
    const tgUser = JSON.parse(userStr);

    // 3. Attach authoritative DB user to request
    const [rows] = await pool.query('SELECT * FROM users WHERE telegram_id = ?', [tgUser.id]);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not registered in database' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[AUTH] Middleware error:', error);
    res.status(500).json({ error: 'AUTH_FAILED', message: 'Internal authentication error' });
  }
};

module.exports = { requireTelegramAuth };