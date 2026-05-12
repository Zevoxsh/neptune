const router = require('express').Router();
const fs = require('fs/promises');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const audit = require('../services/audit');
const domains = require('../services/domains');
const ssl = require('../services/ssl');
const vhost = require('../system/vhost');
const { getUserById, getClientPermissions } = require('../services/users');

const VALID_PHP_VERSIONS = domains.VALID_PHP_VERSIONS;
const DOMAIN_RE = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const LABEL_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;

function parseId(param) {
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function canAccessDomain(requester, domain) {
  if (requester.role === 'admin') return true;
  return domain.user_id === requester.id;
}

// GET /api/domains
router.get('/', requireAuth, async (req, res) => {
  try {
    const list = await domains.listDomains({ requestingUserId: req.user.id, requestingRole: req.user.role });
    res.json({ domains: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/domains/:id
router.get('/:id', requireAuth, async (req, res) => {
  const domainId = parseId(req.params.id);
  if (domainId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const domain = await domains.getDomainById(domainId);
    if (!domain || !domain.is_active) return res.status(404).json({ error: 'Domain not found' });
    if (!canAccessDomain(req.user, domain)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ domain });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/domains
router.post('/', requireAuth, async (req, res) => {
  const { name, type, parent_domain_id, php_version = '8.2' } = req.body;

  if (!name || !type) return res.status(400).json({ error: 'name and type required' });
  if (!['domain', 'subdomain'].includes(type)) return res.status(400).json({ error: 'type must be domain or subdomain' });
  if (type === 'domain' && !DOMAIN_RE.test(name)) return res.status(400).json({ error: 'Invalid domain name' });
  if (type === 'subdomain' && !LABEL_RE.test(name)) return res.status(400).json({ error: 'Invalid subdomain label' });
  if (!VALID_PHP_VERSIONS.includes(php_version)) return res.status(400).json({ error: `php_version must be one of: ${VALID_PHP_VERSIONS.join(', ')}` });

  // Role-based creation rules
  if (req.user.role === 'client') {
    if (type !== 'subdomain') return res.status(403).json({ error: 'Clients can only create subdomains' });
    const perms = await getClientPermissions(req.user.id);
    if (!perms.allow_subdomain) return res.status(403).json({ error: 'Subdomain creation not allowed for this account' });
    if (php_version !== '8.2' && !perms.allow_php_version_choice) {
      return res.status(403).json({ error: 'PHP version choice not allowed for this account' });
    }
  }

  // For subdomains: validate parent domain ownership
  if (type === 'subdomain') {
    if (!parent_domain_id) return res.status(400).json({ error: 'parent_domain_id required for subdomain' });
    const parsedParentId = parseId(parent_domain_id);
    if (!parsedParentId) return res.status(400).json({ error: 'parent_domain_id must be a positive integer' });
    const parentDomain = await domains.getDomainById(parsedParentId);
    if (!parentDomain || !parentDomain.is_active) return res.status(400).json({ error: 'Parent domain not found or inactive' });
    if (req.user.role === 'user' && parentDomain.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Parent domain not owned by you' });
    }
    // client parent-ownership check moved inside try block
  }

  try {
    const self = await getUserById(req.user.id);
    if (!self) return res.status(403).json({ error: 'Forbidden' });

    // Client subdomain: verify parent domain belongs to client's parent user
    if (req.user.role === 'client' && type === 'subdomain' && parent_domain_id) {
      const parsedParentId = parseId(parent_domain_id);
      const parentDomain = await domains.getDomainById(parsedParentId);
      if (!self.parent_id || !parentDomain || parentDomain.user_id !== self.parent_id) {
        return res.status(403).json({ error: 'Parent domain does not belong to your parent user' });
      }
    }

    const domain = await domains.createDomain({
      userId: req.user.id,
      username: self.username,
      name,
      type,
      parentDomainId: parent_domain_id || null,
      phpVersion: php_version,
    });
    const hostname = await domains.getHostname(domain);
    await fs.mkdir(domain.document_root, { recursive: true, mode: 0o755 });
    await vhost.writeVhostFiles({ hostname, documentRoot: domain.document_root, phpVersion: php_version });
    await vhost.reloadWeb();
    await audit.log({ userId: req.user.id, action: 'create_domain', targetType: 'domain', targetId: domain.id, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.status(201).json({ domain });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Domain name already exists' });
    if (err.code === 'PARENT_NOT_FOUND') return res.status(400).json({ error: 'Parent domain not found' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/domains/:id
router.put('/:id', requireAuth, async (req, res) => {
  const domainId = parseId(req.params.id);
  if (domainId === null) return res.status(400).json({ error: 'Invalid id' });

  const { php_version } = req.body;
  if (php_version !== undefined && !VALID_PHP_VERSIONS.includes(php_version)) {
    return res.status(400).json({ error: `php_version must be one of: ${VALID_PHP_VERSIONS.join(', ')}` });
  }

  try {
    const domain = await domains.getDomainById(domainId);
    if (!domain || !domain.is_active) return res.status(404).json({ error: 'Domain not found' });
    if (!canAccessDomain(req.user, domain)) return res.status(403).json({ error: 'Forbidden' });

    if (req.user.role === 'client' && php_version !== undefined) {
      const perms = await getClientPermissions(req.user.id);
      if (!perms.allow_php_version_choice) return res.status(403).json({ error: 'PHP version choice not allowed for this account' });
    }

    const updated = await domains.updateDomain(domainId, { phpVersion: php_version });
    const hostname = await domains.getHostname(domain);
    const sslRec = await ssl.getSslRecord(domainId);
    await vhost.writeVhostFiles({
      hostname,
      documentRoot: domain.document_root,
      phpVersion: updated.php_version,
      sslEnabled: Boolean(domain.ssl_enabled),
      certPath: sslRec ? sslRec.cert_path : null,
      keyPath: sslRec ? sslRec.key_path : null,
    });
    await vhost.reloadWeb();
    await audit.log({ userId: req.user.id, action: 'update_domain', targetType: 'domain', targetId: domainId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ domain: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/domains/:id
router.delete('/:id', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const domainId = parseId(req.params.id);
  if (domainId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const domain = await domains.getDomainById(domainId);
    if (!domain || !domain.is_active) return res.status(404).json({ error: 'Domain not found' });
    if (!canAccessDomain(req.user, domain)) return res.status(403).json({ error: 'Forbidden' });
    const hostname = await domains.getHostname(domain);
    await domains.deactivateDomain(domainId);
    await ssl.removeSslRecord(domainId);
    await vhost.removeVhostFiles(hostname);
    await vhost.reloadWeb();
    await audit.log({ userId: req.user.id, action: 'delete_domain', targetType: 'domain', targetId: domainId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/domains/:id/ssl
router.post('/:id/ssl', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const domainId = parseId(req.params.id);
  if (domainId === null) return res.status(400).json({ error: 'Invalid id' });

  const { type, cert, key: keyPem } = req.body;
  if (!type || !['letsencrypt', 'manual'].includes(type)) {
    return res.status(400).json({ error: 'type must be letsencrypt or manual' });
  }
  if (type === 'manual' && (!cert || !keyPem)) {
    return res.status(400).json({ error: 'cert and key required for manual SSL' });
  }

  try {
    const domain = await domains.getDomainById(domainId);
    if (!domain || !domain.is_active) return res.status(404).json({ error: 'Domain not found' });
    if (!canAccessDomain(req.user, domain)) return res.status(403).json({ error: 'Forbidden' });

    const hostname = await domains.getHostname(domain);
    let certPath, keyPath;
    if (type === 'letsencrypt') {
      ({ certPath, keyPath } = await ssl.enableLetsEncrypt(domainId, hostname, domain.document_root));
    } else {
      ({ certPath, keyPath } = await ssl.uploadManualCert(domainId, hostname, cert, keyPem));
    }

    const updated = await domains.updateDomain(domainId, { sslEnabled: true, sslType: type });
    await vhost.writeVhostFiles({
      hostname,
      documentRoot: domain.document_root,
      phpVersion: domain.php_version,
      sslEnabled: true,
      certPath,
      keyPath,
    });
    await vhost.reloadWeb();
    await audit.log({ userId: req.user.id, action: 'enable_ssl', targetType: 'domain', targetId: domainId, ip: req.ip }).catch(e => console.error('audit failure:', e));

    const sslRecord = await ssl.getSslRecord(domainId);
    res.json({ domain: updated, ssl: sslRecord });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/domains/:id/ssl
router.delete('/:id/ssl', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const domainId = parseId(req.params.id);
  if (domainId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const domain = await domains.getDomainById(domainId);
    if (!domain || !domain.is_active) return res.status(404).json({ error: 'Domain not found' });
    if (!canAccessDomain(req.user, domain)) return res.status(403).json({ error: 'Forbidden' });

    await ssl.removeSslRecord(domainId);
    const updated = await domains.updateDomain(domainId, { sslEnabled: false, sslType: null });
    const hostname = await domains.getHostname(domain);
    await vhost.writeVhostFiles({
      hostname,
      documentRoot: domain.document_root,
      phpVersion: domain.php_version,
      sslEnabled: false,
    });
    await vhost.reloadWeb();
    await audit.log({ userId: req.user.id, action: 'disable_ssl', targetType: 'domain', targetId: domainId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true, domain: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
