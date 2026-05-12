const pool = require('../db/index');

const VALID_PHP_VERSIONS = ['7.4', '8.0', '8.1', '8.2', '8.3'];
const DOMAIN_FIELDS = 'id, user_id, name, type, parent_domain_id, document_root, php_version, ssl_enabled, ssl_type, is_active, created_at';

function buildDocumentRoot(username, hostname) {
  const root = process.env.NEPTUNE_SITES_ROOT || '/var/www/neptune';
  return `${root}/${username}/${hostname}`;
}

async function createDomain({ userId, username, name, type, parentDomainId = null, phpVersion = '8.2' }) {
  let hostname = name;
  if (type === 'subdomain' && parentDomainId) {
    const parent = await getDomainById(parentDomainId);
    if (!parent) throw Object.assign(new Error('Parent domain not found'), { code: 'PARENT_NOT_FOUND' });
    hostname = `${name}.${parent.name}`;
  }
  const documentRoot = buildDocumentRoot(username, hostname);
  const [result] = await pool.query(
    `INSERT INTO domains (user_id, name, type, parent_domain_id, document_root, php_version) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, name, type, parentDomainId, documentRoot, phpVersion]
  );
  return getDomainById(result.insertId);
}

async function getDomainById(id) {
  const [rows] = await pool.query(`SELECT ${DOMAIN_FIELDS} FROM domains WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function getHostname(domain) {
  if (domain.type === 'domain') return domain.name;
  if (domain.parent_domain_id) {
    const parent = await getDomainById(domain.parent_domain_id);
    if (parent) return `${domain.name}.${parent.name}`;
  }
  return domain.name;
}

async function listDomains({ requestingUserId, requestingRole }) {
  if (requestingRole === 'admin') {
    const [rows] = await pool.query(`SELECT ${DOMAIN_FIELDS} FROM domains WHERE is_active = 1 ORDER BY created_at DESC`);
    return rows;
  }
  // Returns only domains owned by this user (clients see their own subdomains)
  const [rows] = await pool.query(
    `SELECT ${DOMAIN_FIELDS} FROM domains WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC`,
    [requestingUserId]
  );
  return rows;
}

async function updateDomain(id, { phpVersion, sslEnabled, sslType }) {
  const fields = [];
  const values = [];
  if (phpVersion !== undefined) { fields.push('php_version = ?'); values.push(phpVersion); }
  if (sslEnabled !== undefined) { fields.push('ssl_enabled = ?'); values.push(sslEnabled ? 1 : 0); }
  if (sslType !== undefined) { fields.push('ssl_type = ?'); values.push(sslType); }
  if (!fields.length) return getDomainById(id);
  values.push(id);
  await pool.query(`UPDATE domains SET ${fields.join(', ')} WHERE id = ?`, values);
  return getDomainById(id);
}

async function deactivateDomain(id) {
  const [result] = await pool.query('UPDATE domains SET is_active = 0 WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = { createDomain, getDomainById, getHostname, listDomains, updateDomain, deactivateDomain, VALID_PHP_VERSIONS, buildDocumentRoot };
