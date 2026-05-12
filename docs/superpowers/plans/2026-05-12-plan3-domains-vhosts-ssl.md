# Neptune — Plan 3: Domains + Vhosts + SSL

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement domain/subdomain CRUD with automatic Apache/Nginx vhost file generation, server reload, and SSL certificate management (Let's Encrypt + manual upload) via a `/api/domains` REST API.

**Architecture:** Three focused layers — `src/services/domains.js` (DB CRUD only), `src/system/vhost.js` (config file generation + system calls), `src/services/ssl.js` (cert file storage + certbot invocation + DB). The `src/api/domains.js` router orchestrates them: validate → DB write → vhost write → reload → audit log. All system paths (vhost dirs, reload script, certbot) are configurable via env vars so tests can use temp directories without sudo. Domain `name` stores only the subdomain label for subdomains (e.g. `blog`); the full hostname (`blog.example.com`) is computed on demand via `getHostname()`.

**Tech Stack:** Node.js, Express 4, mysql2, fs/promises, child_process (all built-in — no new npm packages)

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/services/domains.js` | DB CRUD: createDomain, getDomainById, getHostname, listDomains, updateDomain, deactivateDomain |
| `src/system/vhost.js` | generateApacheConfig, generateNginxConfig, writeVhostFiles, removeVhostFiles, reloadWeb, runCertbot |
| `src/services/ssl.js` | enableLetsEncrypt, uploadManualCert, getSslRecord, removeSslRecord |
| `src/api/domains.js` | 7 endpoints: GET /, GET /:id, POST /, PUT /:id, DELETE /:id, POST /:id/ssl, DELETE /:id/ssl |
| Modify: `src/api/index.js` | Add `router.use('/domains', require('./domains'))` |
| `scripts/neptune-reload-web.sh` | Validate + reload Nginx and Apache2 |
| `scripts/neptune-certbot.sh` | Run certbot --webroot for a domain |
| `tests/domains.service.test.js` | 8 service tests (real DB, no filesystem) |
| `tests/vhost.test.js` | 6 vhost tests (temp dir, no DB, no sudo) |
| `tests/domains.test.js` | 20 API integration tests (real DB, vhost + ssl mocked) |
| Modify: `tests/helpers/db.js` | Add createDomain helper |

---

### Task 1: Domain service

**Files:**
- Create: `src/services/domains.js`
- Modify: `tests/helpers/db.js`
- Create: `tests/domains.service.test.js`

- [ ] **Step 1: Write the failing service tests**

Create `tests/domains.service.test.js`:

```js
require('dotenv').config();
const {
  createDomain, getDomainById, getHostname, listDomains, updateDomain, deactivateDomain,
} = require('../src/services/domains');
const { clearTables, createUser } = require('./helpers/db');

beforeEach(() => clearTables());

describe('domains service', () => {
  it('createDomain inserts domain with auto-calculated document_root', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    expect(domain.id).toBeDefined();
    expect(domain.name).toBe('example.com');
    expect(domain.type).toBe('domain');
    expect(domain.php_version).toBe('8.2');
    expect(domain.ssl_enabled).toBe(0);
    expect(domain.document_root).toMatch(/alice.*example\.com/);
  });

  it('createDomain for subdomain stores label and builds hostname document_root', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const parent = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    const sub = await createDomain({ userId: user.id, username: 'alice', name: 'blog', type: 'subdomain', parentDomainId: parent.id });
    expect(sub.name).toBe('blog');
    expect(sub.parent_domain_id).toBe(parent.id);
    expect(sub.document_root).toMatch(/blog\.example\.com/);
  });

  it('getDomainById returns null for unknown id', async () => {
    expect(await getDomainById(99999)).toBeNull();
  });

  it('getHostname returns name for domain, full hostname for subdomain', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const parent = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    const sub = await createDomain({ userId: user.id, username: 'alice', name: 'blog', type: 'subdomain', parentDomainId: parent.id });
    expect(await getHostname(parent)).toBe('example.com');
    expect(await getHostname(sub)).toBe('blog.example.com');
  });

  it('listDomains as admin returns all active domains', async () => {
    const u1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const u2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    await createDomain({ userId: u1.id, username: 'u1', name: 'a.com', type: 'domain' });
    await createDomain({ userId: u2.id, username: 'u2', name: 'b.com', type: 'domain' });
    const list = await listDomains({ requestingUserId: u1.id, requestingRole: 'admin' });
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('listDomains as user returns only their domains', async () => {
    const u1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const u2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    await createDomain({ userId: u1.id, username: 'u1', name: 'a.com', type: 'domain' });
    await createDomain({ userId: u2.id, username: 'u2', name: 'b.com', type: 'domain' });
    const list = await listDomains({ requestingUserId: u1.id, requestingRole: 'user' });
    expect(list.every(d => d.user_id === u1.id)).toBe(true);
    expect(list.some(d => d.name === 'a.com')).toBe(true);
  });

  it('updateDomain changes php_version only', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'x.com', type: 'domain' });
    const updated = await updateDomain(domain.id, { phpVersion: '8.3' });
    expect(updated.php_version).toBe('8.3');
    expect(updated.name).toBe('x.com');
  });

  it('deactivateDomain sets is_active to 0 and returns true', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'x.com', type: 'domain' });
    expect(await deactivateDomain(domain.id)).toBe(true);
    const fetched = await getDomainById(domain.id);
    expect(fetched.is_active).toBe(0);
  });

  it('deactivateDomain returns false for unknown id', async () => {
    expect(await deactivateDomain(99999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/domains.service.test.js
```

Expected: FAIL — "Cannot find module '../src/services/domains'"

NOTE: MariaDB is not available on this Windows dev machine. Skip actual execution — write files and commit.

- [ ] **Step 3: Create `src/services/domains.js`**

```js
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
```

- [ ] **Step 4: Add `createDomain` helper to `tests/helpers/db.js`**

Add at the bottom of `tests/helpers/db.js`, before `module.exports`:

```js
async function createDomain({ userId, username, name, type = 'domain', parentDomainId = null, phpVersion = '8.2' }) {
  const { createDomain: svcCreate } = require('../../src/services/domains');
  return svcCreate({ userId, username, name, type, parentDomainId, phpVersion });
}
```

And add `createDomain` to `module.exports`:
```js
module.exports = { clearTables, createUser, createDomain };
```

- [ ] **Step 5: Syntax check**

```bash
node --check src/services/domains.js
```

Expected: no output

- [ ] **Step 6: Commit**

```bash
git add src/services/domains.js tests/domains.service.test.js tests/helpers/db.js
git commit -m "feat: add domain service (CRUD, hostname, list)"
```

---

### Task 2: Vhost system module + shell scripts

**Files:**
- Create: `src/system/vhost.js`
- Create: `scripts/neptune-reload-web.sh`
- Create: `scripts/neptune-certbot.sh`
- Create: `tests/vhost.test.js`

- [ ] **Step 1: Write the failing vhost tests**

Create `tests/vhost.test.js`:

```js
const path = require('path');
const os = require('os');
const fs = require('fs/promises');

const TMP = path.join(os.tmpdir(), `neptune-vhost-test-${Date.now()}`);

beforeAll(async () => {
  process.env.APACHE_VHOST_DIR = path.join(TMP, 'apache2', 'sites-available');
  process.env.NGINX_VHOST_DIR = path.join(TMP, 'nginx', 'sites-available');
  await fs.mkdir(process.env.APACHE_VHOST_DIR, { recursive: true });
  await fs.mkdir(process.env.NGINX_VHOST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

const { generateApacheConfig, generateNginxConfig, writeVhostFiles, removeVhostFiles } = require('../src/system/vhost');

describe('vhost config generation', () => {
  it('generateApacheConfig contains ServerName, DocumentRoot and PHP-FPM socket', () => {
    const config = generateApacheConfig({ hostname: 'example.com', documentRoot: '/var/www/alice/example.com', phpVersion: '8.2' });
    expect(config).toContain('ServerName example.com');
    expect(config).toContain('DocumentRoot /var/www/alice/example.com');
    expect(config).toContain('php8.2-fpm.sock');
    expect(config).toContain('VirtualHost *:8080');
  });

  it('generateNginxConfig HTTP-only has server_name, proxy_pass, no 443 block', () => {
    const config = generateNginxConfig({ hostname: 'example.com', documentRoot: '/var/www/alice/example.com' });
    expect(config).toContain('server_name example.com');
    expect(config).toContain('proxy_pass http://127.0.0.1:8080');
    expect(config).not.toContain('listen 443');
  });

  it('generateNginxConfig with SSL adds listen 443 block and cert paths', () => {
    const config = generateNginxConfig({
      hostname: 'example.com',
      documentRoot: '/var/www/alice/example.com',
      sslEnabled: true,
      certPath: '/etc/letsencrypt/live/example.com/fullchain.pem',
      keyPath: '/etc/letsencrypt/live/example.com/privkey.pem',
    });
    expect(config).toContain('listen 443 ssl http2');
    expect(config).toContain('ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem');
    expect(config).toContain('ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem');
  });
});

describe('vhost file operations', () => {
  it('writeVhostFiles creates apache and nginx config files with correct content', async () => {
    await writeVhostFiles({ hostname: 'test.com', documentRoot: '/var/www/alice/test.com', phpVersion: '8.1' });
    const apacheContent = await fs.readFile(path.join(process.env.APACHE_VHOST_DIR, 'neptune-test.com.conf'), 'utf8');
    const nginxContent = await fs.readFile(path.join(process.env.NGINX_VHOST_DIR, 'neptune-test.com.conf'), 'utf8');
    expect(apacheContent).toContain('ServerName test.com');
    expect(apacheContent).toContain('php8.1-fpm.sock');
    expect(nginxContent).toContain('server_name test.com');
  });

  it('removeVhostFiles deletes both config files', async () => {
    await writeVhostFiles({ hostname: 'del.com', documentRoot: '/tmp/del', phpVersion: '8.2' });
    await removeVhostFiles('del.com');
    await expect(fs.access(path.join(process.env.APACHE_VHOST_DIR, 'neptune-del.com.conf'))).rejects.toThrow();
    await expect(fs.access(path.join(process.env.NGINX_VHOST_DIR, 'neptune-del.com.conf'))).rejects.toThrow();
  });

  it('removeVhostFiles does not throw if files do not exist', async () => {
    await expect(removeVhostFiles('nonexistent.com')).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/vhost.test.js
```

Expected: FAIL — "Cannot find module '../src/system/vhost'"

NOTE: MariaDB not required for this test. Skip execution on Windows dev machine.

- [ ] **Step 3: Create `src/system/vhost.js`**

```js
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// Lazy accessors — read env vars at call time so tests can override in beforeAll
function apacheDir() { return process.env.APACHE_VHOST_DIR || '/etc/apache2/sites-available'; }
function nginxDir() { return process.env.NGINX_VHOST_DIR || '/etc/nginx/sites-available'; }
function reloadScript() { return process.env.NEPTUNE_RELOAD_WEB || '/usr/local/bin/neptune-reload-web'; }
function certbotScript() { return process.env.NEPTUNE_CERTBOT || '/usr/local/bin/neptune-certbot'; }

function generateApacheConfig({ hostname, documentRoot, phpVersion }) {
  return `<VirtualHost *:8080>
    ServerName ${hostname}
    DocumentRoot ${documentRoot}

    <Directory "${documentRoot}">
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch "\\.php$">
        SetHandler "proxy:unix:/run/php/php${phpVersion}-fpm.sock|fcgi://localhost"
    </FilesMatch>
</VirtualHost>
`;
}

function generateNginxConfig({ hostname, documentRoot, sslEnabled = false, certPath = null, keyPath = null }) {
  const sslBlock = sslEnabled && certPath && keyPath ? `
server {
    listen 443 ssl http2;
    server_name ${hostname};
    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}` : '';

  return `server {
    listen 80;
    server_name ${hostname};

    location /.well-known/acme-challenge/ {
        root ${documentRoot};
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
${sslBlock}`;
}

async function writeVhostFiles({ hostname, documentRoot, phpVersion, sslEnabled = false, certPath = null, keyPath = null }) {
  await fs.mkdir(apacheDir(), { recursive: true });
  await fs.mkdir(nginxDir(), { recursive: true });
  await fs.writeFile(
    path.join(apacheDir(), `neptune-${hostname}.conf`),
    generateApacheConfig({ hostname, documentRoot, phpVersion }),
    'utf8'
  );
  await fs.writeFile(
    path.join(nginxDir(), `neptune-${hostname}.conf`),
    generateNginxConfig({ hostname, documentRoot, sslEnabled, certPath, keyPath }),
    'utf8'
  );
}

async function removeVhostFiles(hostname) {
  await Promise.all([
    fs.unlink(path.join(apacheDir(), `neptune-${hostname}.conf`)).catch(() => {}),
    fs.unlink(path.join(nginxDir(), `neptune-${hostname}.conf`)).catch(() => {}),
  ]);
}

async function reloadWeb() {
  await execFileAsync('sudo', [reloadScript()]);
}

async function runCertbot(domain, webroot) {
  await execFileAsync('sudo', [certbotScript(), domain, webroot]);
}

module.exports = { generateApacheConfig, generateNginxConfig, writeVhostFiles, removeVhostFiles, reloadWeb, runCertbot };
```

- [ ] **Step 4: Create `scripts/neptune-reload-web.sh`**

```bash
#!/bin/bash
set -e
nginx -t
systemctl reload nginx
apache2ctl configtest
systemctl reload apache2
```

- [ ] **Step 5: Create `scripts/neptune-certbot.sh`**

```bash
#!/bin/bash
set -e
DOMAIN="$1"
WEBROOT="$2"

if [[ -z "$DOMAIN" || -z "$WEBROOT" ]]; then
  echo "Usage: neptune-certbot.sh <domain> <webroot>" >&2
  exit 1
fi

# Validate domain — only alphanumeric, dots, hyphens
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9.\-]+$ ]]; then
  echo "Invalid domain: $DOMAIN" >&2
  exit 1
fi

# Validate webroot — must be an absolute path that exists
if [[ ! "$WEBROOT" =~ ^/ ]] || [[ ! -d "$WEBROOT" ]]; then
  echo "Invalid or non-existent webroot: $WEBROOT" >&2
  exit 1
fi

certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --non-interactive --agree-tos
```

- [ ] **Step 6: Syntax check**

```bash
node --check src/system/vhost.js
```

Expected: no output

- [ ] **Step 7: Commit**

```bash
git add src/system/vhost.js scripts/neptune-reload-web.sh scripts/neptune-certbot.sh tests/vhost.test.js
git commit -m "feat: add vhost system module and sudo scripts"
```

---

### Task 3: SSL service

**Files:**
- Create: `src/services/ssl.js`
- Create: `tests/ssl.service.test.js`

- [ ] **Step 1: Write the failing SSL service tests**

Create `tests/ssl.service.test.js`:

```js
require('dotenv').config();
const path = require('path');
const os = require('os');
const fs = require('fs/promises');

// Mock runCertbot before requiring ssl service (certbot can't run in tests)
jest.mock('../src/system/vhost', () => ({
  runCertbot: jest.fn().mockResolvedValue(undefined),
}));

const { enableLetsEncrypt, uploadManualCert, getSslRecord, removeSslRecord } = require('../src/services/ssl');
const pool = require('../src/db/index');
const { clearTables, createUser, createDomain } = require('./helpers/db');

const TMP_SSL = path.join(os.tmpdir(), `neptune-ssl-test-${Date.now()}`);

beforeAll(() => {
  process.env.NEPTUNE_SSL_DIR = TMP_SSL;
});

afterAll(async () => {
  await fs.rm(TMP_SSL, { recursive: true, force: true });
});

beforeEach(() => clearTables());

describe('ssl service', () => {
  it('getSslRecord returns null when no cert exists for domain', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    expect(await getSslRecord(domain.id)).toBeNull();
  });

  it('enableLetsEncrypt calls runCertbot and inserts ssl_certificates row', async () => {
    const { runCertbot } = require('../src/system/vhost');
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    const { certPath, keyPath } = await enableLetsEncrypt(domain.id, 'example.com', domain.document_root);
    expect(runCertbot).toHaveBeenCalledWith('example.com', domain.document_root);
    expect(certPath).toContain('example.com');
    expect(keyPath).toContain('example.com');
    const rec = await getSslRecord(domain.id);
    expect(rec).not.toBeNull();
    expect(rec.type).toBe('letsencrypt');
    expect(rec.auto_renew).toBe(1);
  });

  it('uploadManualCert writes files to disk and inserts ssl_certificates row', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'manual.com', type: 'domain' });
    const { certPath, keyPath } = await uploadManualCert(domain.id, 'manual.com', 'FAKE_CERT_PEM', 'FAKE_KEY_PEM');
    const certContent = await fs.readFile(certPath, 'utf8');
    expect(certContent).toBe('FAKE_CERT_PEM');
    const rec = await getSslRecord(domain.id);
    expect(rec.type).toBe('manual');
    expect(rec.auto_renew).toBe(0);
  });

  it('enableLetsEncrypt replaces existing cert record (idempotent)', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    await enableLetsEncrypt(domain.id, 'example.com', domain.document_root);
    await enableLetsEncrypt(domain.id, 'example.com', domain.document_root);
    const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM ssl_certificates WHERE domain_id = ?', [domain.id]);
    expect(rows[0].cnt).toBe(1);
  });

  it('removeSslRecord deletes DB row and manual cert files', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'del.com', type: 'domain' });
    const { certPath } = await uploadManualCert(domain.id, 'del.com', 'CERT', 'KEY');
    await removeSslRecord(domain.id);
    expect(await getSslRecord(domain.id)).toBeNull();
    await expect(fs.access(certPath)).rejects.toThrow();
  });

  it('removeSslRecord does not throw when no cert exists', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'empty.com', type: 'domain' });
    await expect(removeSslRecord(domain.id)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/ssl.service.test.js
```

Expected: FAIL — "Cannot find module '../src/services/ssl'"

NOTE: Skip execution on Windows dev machine.

- [ ] **Step 3: Create `src/services/ssl.js`**

```js
const fs = require('fs/promises');
const path = require('path');
const pool = require('../db/index');
const { runCertbot } = require('../system/vhost');

function sslDir() { return process.env.NEPTUNE_SSL_DIR || '/etc/ssl/neptune'; }

async function enableLetsEncrypt(domainId, hostname, documentRoot) {
  await runCertbot(hostname, documentRoot);
  const certPath = `/etc/letsencrypt/live/${hostname}/fullchain.pem`;
  const keyPath = `/etc/letsencrypt/live/${hostname}/privkey.pem`;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
  await pool.query('DELETE FROM ssl_certificates WHERE domain_id = ?', [domainId]);
  await pool.query(
    `INSERT INTO ssl_certificates (domain_id, type, cert_path, key_path, expires_at, auto_renew)
     VALUES (?, 'letsencrypt', ?, ?, ?, 1)`,
    [domainId, certPath, keyPath, expiresAt]
  );
  return { certPath, keyPath };
}

async function uploadManualCert(domainId, hostname, certPem, keyPem) {
  const domainDir = path.join(sslDir(), hostname);
  await fs.mkdir(domainDir, { recursive: true });
  const certPath = path.join(domainDir, 'fullchain.pem');
  const keyPath = path.join(domainDir, 'privkey.pem');
  await fs.writeFile(certPath, certPem, { encoding: 'utf8', mode: 0o600 });
  await fs.writeFile(keyPath, keyPem, { encoding: 'utf8', mode: 0o600 });
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year default
  await pool.query('DELETE FROM ssl_certificates WHERE domain_id = ?', [domainId]);
  await pool.query(
    `INSERT INTO ssl_certificates (domain_id, type, cert_path, key_path, expires_at, auto_renew)
     VALUES (?, 'manual', ?, ?, ?, 0)`,
    [domainId, certPath, keyPath, expiresAt]
  );
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
    await fs.unlink(rec.cert_path).catch(() => {});
    await fs.unlink(rec.key_path).catch(() => {});
  }
  await pool.query('DELETE FROM ssl_certificates WHERE domain_id = ?', [domainId]);
}

module.exports = { enableLetsEncrypt, uploadManualCert, getSslRecord, removeSslRecord };
```

- [ ] **Step 4: Syntax check**

```bash
node --check src/services/ssl.js
```

Expected: no output

- [ ] **Step 5: Commit**

```bash
git add src/services/ssl.js tests/ssl.service.test.js
git commit -m "feat: add SSL service (letsencrypt, manual upload)"
```

---

### Task 4: Domain API routes + wire-up

**Files:**
- Create: `src/api/domains.js`
- Create: `tests/domains.test.js`
- Modify: `src/api/index.js`

- [ ] **Step 1: Write the failing API tests**

Create `tests/domains.test.js`:

```js
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { clearTables, createUser, createDomain } = require('./helpers/db');

// Mock filesystem/system calls — domain logic tested in service tests
jest.mock('../src/system/vhost', () => ({
  writeVhostFiles: jest.fn().mockResolvedValue(undefined),
  removeVhostFiles: jest.fn().mockResolvedValue(undefined),
  reloadWeb: jest.fn().mockResolvedValue(undefined),
  runCertbot: jest.fn().mockResolvedValue(undefined),
  generateApacheConfig: jest.fn().mockReturnValue(''),
  generateNginxConfig: jest.fn().mockReturnValue(''),
}));

jest.mock('../src/services/ssl', () => ({
  enableLetsEncrypt: jest.fn().mockResolvedValue({ certPath: '/tmp/cert.pem', keyPath: '/tmp/key.pem' }),
  uploadManualCert: jest.fn().mockResolvedValue({ certPath: '/tmp/cert.pem', keyPath: '/tmp/key.pem' }),
  getSslRecord: jest.fn().mockResolvedValue({ type: 'manual', expires_at: new Date('2027-01-01'), auto_renew: 0 }),
  removeSslRecord: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => clearTables());

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

// ── GET /api/domains ─────────────────────────────────────────────────────────

describe('GET /api/domains', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/domains');
    expect(res.status).toBe(401);
  });

  it('admin sees all domains', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).get('/api/domains').set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.domains.length).toBeGreaterThanOrEqual(1);
  });

  it('user sees only their own domains', async () => {
    const u1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const u2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const d1 = await createDomain({ userId: u1.id, username: 'u1', name: 'a.com', type: 'domain' });
    await createDomain({ userId: u2.id, username: 'u2', name: 'b.com', type: 'domain' });
    const res = await request(app).get('/api/domains').set('Authorization', `Bearer ${makeToken(u1)}`);
    expect(res.status).toBe(200);
    const ids = res.body.domains.map(d => d.id);
    expect(ids).toContain(d1.id);
    expect(ids.every(id => id === d1.id)).toBe(true);
  });
});

// ── GET /api/domains/:id ──────────────────────────────────────────────────────

describe('GET /api/domains/:id', () => {
  it('returns 404 for unknown domain', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const res = await request(app).get('/api/domains/99999').set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(404);
  });

  it('admin can view any domain', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).get(`/api/domains/${domain.id}`).set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.domain.id).toBe(domain.id);
  });

  it('user cannot view another user domain', async () => {
    const u1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const u2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const domain = await createDomain({ userId: u2.id, username: 'u2', name: 'x.com', type: 'domain' });
    const res = await request(app).get(`/api/domains/${domain.id}`).set('Authorization', `Bearer ${makeToken(u1)}`);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/domains ─────────────────────────────────────────────────────────

describe('POST /api/domains', () => {
  it('returns 400 without name', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app).post('/api/domains')
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ type: 'domain', php_version: '8.2' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid PHP version', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app).post('/api/domains')
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ name: 'x.com', type: 'domain', php_version: '5.6' });
    expect(res.status).toBe(400);
  });

  it('user creates a domain', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app).post('/api/domains')
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ name: 'mysite.com', type: 'domain', php_version: '8.2' });
    expect(res.status).toBe(201);
    expect(res.body.domain.name).toBe('mysite.com');
    expect(res.body.domain.user_id).toBe(u.id);
  });

  it('returns 409 for duplicate domain name', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    await createDomain({ userId: u.id, username: 'u1', name: 'dup.com', type: 'domain' });
    const res = await request(app).post('/api/domains')
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ name: 'dup.com', type: 'domain' });
    expect(res.status).toBe(409);
  });

  it('client cannot create a top-level domain', async () => {
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com' });
    const res = await request(app).post('/api/domains')
      .set('Authorization', `Bearer ${makeToken(client)}`)
      .send({ name: 'hack.com', type: 'domain' });
    expect(res.status).toBe(403);
  });

  it('client can create a subdomain when allow_subdomain is true', async () => {
    const parent = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: parent.id });
    const parentDomain = await createDomain({ userId: parent.id, username: 'u1', name: 'base.com', type: 'domain' });
    // Set permission
    const pool = require('../src/db/index');
    await pool.query(
      `INSERT INTO client_permissions (user_id, permission_key, allowed) VALUES (?, 'allow_subdomain', 1)`,
      [client.id]
    );
    const res = await request(app).post('/api/domains')
      .set('Authorization', `Bearer ${makeToken(client)}`)
      .send({ name: 'blog', type: 'subdomain', parent_domain_id: parentDomain.id });
    expect(res.status).toBe(201);
    expect(res.body.domain.name).toBe('blog');
  });

  it('client cannot create subdomain when allow_subdomain is false', async () => {
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com' });
    const res = await request(app).post('/api/domains')
      .set('Authorization', `Bearer ${makeToken(client)}`)
      .send({ name: 'blog', type: 'subdomain', parent_domain_id: 1 });
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/domains/:id ──────────────────────────────────────────────────────

describe('PUT /api/domains/:id', () => {
  it('returns 400 for invalid PHP version', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).put(`/api/domains/${domain.id}`)
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ php_version: '5.3' });
    expect(res.status).toBe(400);
  });

  it('user updates PHP version of their domain', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).put(`/api/domains/${domain.id}`)
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ php_version: '8.3' });
    expect(res.status).toBe(200);
    expect(res.body.domain.php_version).toBe('8.3');
  });

  it('user cannot update another user domain', async () => {
    const u1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const u2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const domain = await createDomain({ userId: u2.id, username: 'u2', name: 'x.com', type: 'domain' });
    const res = await request(app).put(`/api/domains/${domain.id}`)
      .set('Authorization', `Bearer ${makeToken(u1)}`)
      .send({ php_version: '8.1' });
    expect(res.status).toBe(403);
  });

  it('client cannot change PHP version without allow_php_version_choice', async () => {
    const parent = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: parent.id });
    const domain = await createDomain({ userId: client.id, username: 'c1', name: 'sub.base.com', type: 'domain' });
    const res = await request(app).put(`/api/domains/${domain.id}`)
      .set('Authorization', `Bearer ${makeToken(client)}`)
      .send({ php_version: '8.1' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/domains/:id ───────────────────────────────────────────────────

describe('DELETE /api/domains/:id', () => {
  it('user deactivates their own domain', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).delete(`/api/domains/${domain.id}`)
      .set('Authorization', `Bearer ${makeToken(u)}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('user cannot delete another user domain', async () => {
    const u1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const u2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const domain = await createDomain({ userId: u2.id, username: 'u2', name: 'x.com', type: 'domain' });
    const res = await request(app).delete(`/api/domains/${domain.id}`)
      .set('Authorization', `Bearer ${makeToken(u1)}`);
    expect(res.status).toBe(403);
  });

  it('client cannot delete a domain', async () => {
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com' });
    const res = await request(app).delete('/api/domains/1')
      .set('Authorization', `Bearer ${makeToken(client)}`);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/domains/:id/ssl ─────────────────────────────────────────────────

describe('POST /api/domains/:id/ssl', () => {
  it('returns 400 for invalid SSL type', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).post(`/api/domains/${domain.id}/ssl`)
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ type: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for manual type without cert and key', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).post(`/api/domains/${domain.id}/ssl`)
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ type: 'manual' });
    expect(res.status).toBe(400);
  });

  it('user enables letsencrypt SSL on their domain', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).post(`/api/domains/${domain.id}/ssl`)
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ type: 'letsencrypt' });
    expect(res.status).toBe(200);
    expect(res.body.domain.ssl_enabled).toBe(1);
    expect(res.body.domain.ssl_type).toBe('letsencrypt');
  });

  it('user uploads manual SSL cert', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).post(`/api/domains/${domain.id}/ssl`)
      .set('Authorization', `Bearer ${makeToken(u)}`)
      .send({ type: 'manual', cert: 'CERT_PEM_CONTENT', key: 'KEY_PEM_CONTENT' });
    expect(res.status).toBe(200);
    expect(res.body.domain.ssl_type).toBe('manual');
  });

  it('client cannot enable SSL', async () => {
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com' });
    const res = await request(app).post('/api/domains/1/ssl')
      .set('Authorization', `Bearer ${makeToken(client)}`)
      .send({ type: 'letsencrypt' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/domains/:id/ssl ───────────────────────────────────────────────

describe('DELETE /api/domains/:id/ssl', () => {
  it('user disables SSL on their domain', async () => {
    const u = await createUser({ username: 'u1', email: 'u1@t.com' });
    const domain = await createDomain({ userId: u.id, username: 'u1', name: 'x.com', type: 'domain' });
    const res = await request(app).delete(`/api/domains/${domain.id}/ssl`)
      .set('Authorization', `Bearer ${makeToken(u)}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/domains.test.js
```

Expected: FAIL — routes not mounted yet

NOTE: Skip execution on Windows dev machine.

- [ ] **Step 3: Create `src/api/domains.js`**

```js
const router = require('express').Router();
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
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
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
    const parentDomain = await domains.getDomainById(parent_domain_id);
    if (!parentDomain || !parentDomain.is_active) return res.status(400).json({ error: 'Parent domain not found or inactive' });
    if (req.user.role === 'user' && parentDomain.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Parent domain not owned by you' });
    }
    if (req.user.role === 'client') {
      // Client's parent user must own the parent domain
      const self = await getUserById(req.user.id);
      if (!self.parent_id || parentDomain.user_id !== self.parent_id) {
        return res.status(403).json({ error: 'Parent domain does not belong to your parent user' });
      }
    }
  }

  try {
    const self = await getUserById(req.user.id);
    const domain = await domains.createDomain({
      userId: req.user.id,
      username: self.username,
      name,
      type,
      parentDomainId: parent_domain_id || null,
      phpVersion: php_version,
    });
    const hostname = await domains.getHostname(domain);
    await vhost.writeVhostFiles({ hostname, documentRoot: domain.document_root, phpVersion: php_version });
    await vhost.reloadWeb();
    await audit.log({ userId: req.user.id, action: 'create_domain', targetType: 'domain', targetId: domain.id, ip: req.ip });
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

  if (req.user.role === 'client' && php_version !== undefined) {
    const perms = await getClientPermissions(req.user.id);
    if (!perms.allow_php_version_choice) return res.status(403).json({ error: 'PHP version choice not allowed for this account' });
  }

  try {
    const domain = await domains.getDomainById(domainId);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    if (!canAccessDomain(req.user, domain)) return res.status(403).json({ error: 'Forbidden' });

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
    await audit.log({ userId: req.user.id, action: 'update_domain', targetType: 'domain', targetId: domainId, ip: req.ip });
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
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    if (!canAccessDomain(req.user, domain)) return res.status(403).json({ error: 'Forbidden' });
    const hostname = await domains.getHostname(domain);
    await domains.deactivateDomain(domainId);
    await vhost.removeVhostFiles(hostname);
    await vhost.reloadWeb();
    await audit.log({ userId: req.user.id, action: 'delete_domain', targetType: 'domain', targetId: domainId, ip: req.ip });
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
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
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
    await audit.log({ userId: req.user.id, action: 'enable_ssl', targetType: 'domain', targetId: domainId, ip: req.ip });

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
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
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
    await audit.log({ userId: req.user.id, action: 'disable_ssl', targetType: 'domain', targetId: domainId, ip: req.ip });
    res.json({ ok: true, domain: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount domains router in `src/api/index.js`**

Replace `src/api/index.js` with:

```js
const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/domains', require('./domains'));
module.exports = router;
```

- [ ] **Step 5: Syntax check all new files**

```bash
node --check src/api/domains.js
node --check src/api/index.js
```

Expected: no output

- [ ] **Step 6: Commit**

```bash
git add src/api/domains.js src/api/index.js tests/domains.test.js
git commit -m "feat: add domain API routes + SSL endpoints + mount router"
```

---

## What's next

- **Plan 4** — File manager + FTP accounts
- **Plan 5** — MySQL database management + PHP-FPM pool management
- **Plan 6** — Frontend panel (HTML/CSS/JS vanilla, Dark Indigo theme)
