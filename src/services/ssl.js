const fs = require('fs/promises');
const path = require('path');
const pool = require('../db/index');
const { runCertbot } = require('../system/vhost');

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

function sslDir() { return process.env.NEPTUNE_SSL_DIR || '/etc/ssl/neptune'; }

async function enableLetsEncrypt(domainId, hostname, documentRoot) {
  const certbotEmail = process.env.NEPTUNE_CERTBOT_EMAIL;
  if (!certbotEmail) throw Object.assign(new Error('NEPTUNE_CERTBOT_EMAIL env var is not set'), { code: 'CONFIG_ERROR' });
  await runCertbot(hostname, documentRoot, certbotEmail);
  const certPath = `/etc/letsencrypt/live/${hostname}/fullchain.pem`;
  const keyPath = `/etc/letsencrypt/live/${hostname}/privkey.pem`;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM ssl_certificates WHERE domain_id = ?', [domainId]);
    await conn.query(
      `INSERT INTO ssl_certificates (domain_id, type, cert_path, key_path, expires_at, auto_renew)
       VALUES (?, 'letsencrypt', ?, ?, ?, 1)`,
      [domainId, certPath, keyPath, expiresAt]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { certPath, keyPath };
}

async function uploadManualCert(domainId, hostname, certPem, keyPem) {
  if (!HOSTNAME_RE.test(hostname)) throw Object.assign(new Error(`Invalid hostname: ${hostname}`), { code: 'INVALID_HOSTNAME' });
  const domainDir = path.join(sslDir(), hostname);
  await fs.mkdir(domainDir, { recursive: true, mode: 0o700 });
  const certPath = path.join(domainDir, 'fullchain.pem');
  const keyPath = path.join(domainDir, 'privkey.pem');
  await fs.writeFile(certPath, certPem, { encoding: 'utf8', mode: 0o600 });
  await fs.writeFile(keyPath, keyPem, { encoding: 'utf8', mode: 0o600 });
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year default
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM ssl_certificates WHERE domain_id = ?', [domainId]);
    await conn.query(
      `INSERT INTO ssl_certificates (domain_id, type, cert_path, key_path, expires_at, auto_renew)
       VALUES (?, 'manual', ?, ?, ?, 0)`,
      [domainId, certPath, keyPath, expiresAt]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { certPath, keyPath };
}

async function getSslRecord(domainId) {
  const [rows] = await pool.query(
    'SELECT * FROM ssl_certificates WHERE domain_id = ? ORDER BY created_at DESC LIMIT 1',
    [domainId]
  );
  return rows[0] || null;
}

async function removeSslRecord(domainId) {
  const rec = await getSslRecord(domainId);
  if (rec && rec.type === 'manual') {
    await fs.unlink(rec.cert_path).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await fs.unlink(rec.key_path).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
  await pool.query('DELETE FROM ssl_certificates WHERE domain_id = ?', [domainId]);
}

module.exports = { enableLetsEncrypt, uploadManualCert, getSslRecord, removeSslRecord };
