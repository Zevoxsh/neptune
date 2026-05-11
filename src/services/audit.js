const pool = require('../db/index');

async function log({ userId, action, targetType = null, targetId = null, ip, details = null }) {
  await pool.query(
    'INSERT INTO audit_logs (user_id, action, target_type, target_id, ip_address, details) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, targetType, targetId, ip, details ? JSON.stringify(details) : null]
  );
}

module.exports = { log };
