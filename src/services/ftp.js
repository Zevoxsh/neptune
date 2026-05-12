const pool = require('../db/index');
const bcrypt = require('bcryptjs');
const ftp = require('../system/ftp');
const { getUserRoot, resolveSafe } = require('./files');
const { getUserById } = require('./users');

const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 1 : 12;
const FTP_ACCOUNTS_FIELDS = 'id, user_id, ftp_username, ftp_password_hash, home_dir, is_active, created_at';
const FTP_USERNAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

async function createFtpAccount({ userId, ftpUsername, password, homeDir }) {
  if (!FTP_USERNAME_RE.test(ftpUsername)) {
    throw Object.assign(new Error('Invalid ftp_username'), { code: 'INVALID_FTP_USERNAME' });
  }
  if (!password || password.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters'), { code: 'WEAK_PASSWORD' });
  }
  const user = await getUserById(userId);
  const root = getUserRoot({ role: user.role, username: user.username });
  const resolved = await resolveSafe(root, homeDir);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await ftp.addFtpUser(ftpUsername, password, resolved);
  const [result] = await pool.query(
    'INSERT INTO ftp_accounts (user_id, ftp_username, ftp_password_hash, home_dir, is_active) VALUES (?, ?, ?, ?, 1)',
    [userId, ftpUsername, passwordHash, resolved]
  );
  return getFtpAccountById(result.insertId);
}

async function listFtpAccounts({ requestingUserId, requestingRole }) {
  if (requestingRole === 'admin') {
    const [rows] = await pool.query(
      `SELECT ${FTP_ACCOUNTS_FIELDS} FROM ftp_accounts WHERE is_active = 1 ORDER BY created_at DESC`
    );
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT ${FTP_ACCOUNTS_FIELDS} FROM ftp_accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC`,
    [requestingUserId]
  );
  return rows;
}

async function getFtpAccountById(id) {
  const [rows] = await pool.query(`SELECT ${FTP_ACCOUNTS_FIELDS} FROM ftp_accounts WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function changeFtpPassword(id, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters'), { code: 'WEAK_PASSWORD' });
  }
  const account = await getFtpAccountById(id);
  if (!account) throw Object.assign(new Error('FTP account not found'), { code: 'NOT_FOUND' });
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await ftp.changeFtpPassword(account.ftp_username, newPassword);
  await pool.query('UPDATE ftp_accounts SET ftp_password_hash = ? WHERE id = ?', [passwordHash, id]);
}

async function deactivateFtpAccount(id) {
  const account = await getFtpAccountById(id);
  if (!account) throw Object.assign(new Error('FTP account not found'), { code: 'NOT_FOUND' });
  await ftp.deleteFtpUser(account.ftp_username);
  await pool.query('UPDATE ftp_accounts SET is_active = 0 WHERE id = ?', [id]);
}

module.exports = { createFtpAccount, listFtpAccounts, getFtpAccountById, changeFtpPassword, deactivateFtpAccount };
