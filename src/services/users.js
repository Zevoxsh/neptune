const pool = require('../db/index');
const bcrypt = require('bcryptjs');

const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 1 : 12;
const USER_FIELDS = 'id, username, email, role, parent_id, disk_quota_mb, disk_used_mb, is_active, created_at';

async function createUser({ username, email, password, role, parentId = null, diskQuotaMb = 5120 }) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const [result] = await pool.query(
    'INSERT INTO users (username, email, password_hash, role, parent_id, disk_quota_mb) VALUES (?, ?, ?, ?, ?, ?)',
    [username, email, hash, role, parentId, diskQuotaMb]
  );
  return getUserById(result.insertId);
}

async function getUserById(id) {
  const [rows] = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function listUsers({ requestingUserId, requestingRole }) {
  if (requestingRole === 'admin') {
    const [rows] = await pool.query(`SELECT ${USER_FIELDS} FROM users ORDER BY created_at DESC`);
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT ${USER_FIELDS} FROM users WHERE parent_id = ? ORDER BY created_at DESC`,
    [requestingUserId]
  );
  return rows;
}

async function updateUser(id, { username, email, diskQuotaMb, isActive }) {
  const fields = [];
  const values = [];
  if (username !== undefined) { fields.push('username = ?'); values.push(username); }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (diskQuotaMb !== undefined) { fields.push('disk_quota_mb = ?'); values.push(diskQuotaMb); }
  if (isActive !== undefined) { fields.push('is_active = ?'); values.push(isActive ? 1 : 0); }
  if (!fields.length) return getUserById(id);
  values.push(id);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  return getUserById(id);
}

async function changePassword(id, newPassword) {
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const [result] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  return result.affectedRows > 0;
}

async function getClientPermissions(clientId) {
  const [rows] = await pool.query(
    'SELECT permission_key, allowed FROM client_permissions WHERE user_id = ?',
    [clientId]
  );
  return rows.reduce((acc, r) => ({ ...acc, [r.permission_key]: Boolean(r.allowed) }), {});
}

async function setClientPermissions(clientId, permissions) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const [key, allowed] of Object.entries(permissions)) {
      await conn.query(
        `INSERT INTO client_permissions (user_id, permission_key, allowed) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)`,
        [clientId, key, allowed ? 1 : 0]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getClientPermissions(clientId);
}

module.exports = { createUser, getUserById, listUsers, updateUser, changePassword, getClientPermissions, setClientPermissions };
