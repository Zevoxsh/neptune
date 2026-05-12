const pool = require('../db/index');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mysql = require('../system/mysql');
const { getUserById } = require('./users');

const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 1 : 12;
const DB_NAME_RE = /^[a-zA-Z0-9_]{1,32}$/;
const DB_FIELDS = 'id, user_id, db_name, db_user, size_mb, created_at';

function buildDbName(username, name) {
  return `${username}_${name}`;
}

// Truncation can produce collisions if two names share the first 32 chars — acceptable for typical username lengths.
function buildDbUser(username, name) {
  const full = `${username}_${name}`;
  return full.length <= 32 ? full : full.slice(0, 32);
}

async function refreshSize(row) {
  const sizeMb = await mysql.getDatabaseSizeMb(row.db_name);
  pool.query('UPDATE `databases` SET size_mb = ? WHERE id = ?', [sizeMb, row.id]).catch(e => console.warn('refreshSize update failed:', e));
  return { ...row, size_mb: sizeMb };
}

async function getDatabaseById(id) {
  const [rows] = await pool.query(`SELECT ${DB_FIELDS} FROM \`databases\` WHERE id = ?`, [id]);
  if (!rows[0]) return null;
  return refreshSize(rows[0]);
}

async function createDatabase({ userId, name }) {
  if (!DB_NAME_RE.test(name)) {
    throw Object.assign(new Error('Invalid database name'), { code: 'INVALID_DB_NAME' });
  }
  const user = await getUserById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });

  const dbName = buildDbName(user.username, name);
  if (dbName.length > 64) {
    throw Object.assign(new Error('Database name too long'), { code: 'DB_NAME_TOO_LONG' });
  }
  const dbUser = buildDbUser(user.username, name);

  const password = crypto.randomBytes(16).toString('hex');
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  await mysql.createDatabase(dbName, dbUser, password);
  try {
    const [result] = await pool.query(
      'INSERT INTO `databases` (user_id, db_name, db_user, db_password_hash) VALUES (?, ?, ?, ?)',
      [userId, dbName, dbUser, passwordHash]
    );
    const database = await getDatabaseById(result.insertId);
    return { database, password };
  } catch (err) {
    await mysql.dropDatabase(dbName, dbUser).catch(e => console.error('MySQL cleanup failed:', e));
    throw err;
  }
}

async function listDatabases({ requestingUserId, requestingRole }) {
  let rows;
  if (requestingRole === 'admin') {
    [rows] = await pool.query(`SELECT ${DB_FIELDS} FROM \`databases\` ORDER BY created_at DESC`);
  } else {
    [rows] = await pool.query(
      `SELECT ${DB_FIELDS} FROM \`databases\` WHERE user_id = ? ORDER BY created_at DESC`,
      [requestingUserId]
    );
  }
  return Promise.all(rows.map(refreshSize));
}

async function resetDatabasePassword(id) {
  const db = await getDatabaseById(id);
  if (!db) throw Object.assign(new Error('Database not found'), { code: 'NOT_FOUND' });
  const password = crypto.randomBytes(16).toString('hex');
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await mysql.changePassword(db.db_user, password);
  await pool.query('UPDATE `databases` SET db_password_hash = ? WHERE id = ?', [passwordHash, id]);
  return { password };
}

async function dropDatabase(id) {
  const db = await getDatabaseById(id);
  if (!db) throw Object.assign(new Error('Database not found'), { code: 'NOT_FOUND' });
  await mysql.dropDatabase(db.db_name, db.db_user).catch(e => console.error('MySQL drop failed:', e));
  await pool.query('DELETE FROM `databases` WHERE id = ?', [id]);
}

module.exports = { createDatabase, listDatabases, getDatabaseById, resetDatabasePassword, dropDatabase };
