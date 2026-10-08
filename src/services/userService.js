const pool = require('../database/db');

async function findOrCreateUser(tgUser) {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    // Check if user exists
    const [rows] = await connection.query('SELECT * FROM users WHERE telegram_id = ?', [tgUser.id]);
    let user = rows[0];

    if (!user) {
      // Insert new user
      const [insertResult] = await connection.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name, language) 
         VALUES (?, ?, ?, ?, 'en')`,
        [tgUser.id, tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null]
      );
      
      const newUserId = insertResult.insertId;

      // Create authoritative wallet
      await connection.query(
        `INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)`,
        [newUserId]
      );

      // Fetch the newly created user
      const [newRows] = await connection.query('SELECT * FROM users WHERE id = ?', [newUserId]);
      user = newRows[0];
    } else {
      // Update basic info in case they changed their Telegram name
      await connection.query(
        `UPDATE users SET username = ?, first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?`,
        [tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, tgUser.id]
      );
    }

    await connection.commit();
    return user;
  } catch (error) {
    await connection.rollback();
    console.error('[AUTH] User registration failed:', error);
    throw error;
  } finally {
    connection.release();
  }
}

async function updateLanguage(telegramId, lang) {
  await pool.query('UPDATE users SET language = ? WHERE telegram_id = ?', [lang, telegramId]);
}

module.exports = { findOrCreateUser, updateLanguage };