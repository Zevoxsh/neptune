require('dotenv').config();
const pool = require('../../src/db/index');
const bcrypt = require('bcryptjs');

async function clearTables() {
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  await pool.query('TRUNCATE TABLE audit_logs');
  await pool.query('TRUNCATE TABLE refresh_tokens');
  await pool.query('TRUNCATE TABLE client_permissions');
  await pool.query('TRUNCATE TABLE ftp_accounts');
  await pool.query('TRUNCATE TABLE ssl_certificates');
  await pool.query('TRUNCATE TABLE domains');
  await pool.query('TRUNCATE TABLE `databases`');
  await pool.query('TRUNCATE TABLE users');
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function createUser({
  username = 'testuser',
  email = 'test@test.com',
  password = 'password123',
  role = 'user',
  parentId = null,
} = {}) {
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    'INSERT INTO users (username, email, password_hash, role, parent_id) VALUES (?, ?, ?, ?, ?)',
    [username, email, hash, role, parentId]
  );
  return { id: result.insertId, username, email, role };
}

module.exports = { clearTables, createUser };
