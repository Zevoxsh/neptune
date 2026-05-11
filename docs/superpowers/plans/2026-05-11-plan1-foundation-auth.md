# Neptune — Plan 1: Foundation & Authentication

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the Node.js project with Express, MariaDB, all database migrations, and a working JWT authentication API with role-based access control.

**Architecture:** Single Express app (factory exported for testing) with a MariaDB connection pool. Auth uses JWT access tokens (15 min) + refresh tokens (7 days stored as httpOnly cookie, hash stored in DB). Passwords hashed with bcrypt cost 12. Login rate-limited to 5 attempts per 15 min per IP. All logic tested with Jest + supertest against a real `neptune_test` database. `--forceExit` handles open handles so no manual `pool.end()` needed in tests.

**Tech Stack:** Node.js 18+, Express 4, mysql2, jsonwebtoken, bcryptjs, express-rate-limit, cookie-parser, dotenv, Jest, supertest, nodemon

---

## File Map

| File | Responsibility |
|------|----------------|
| `package.json` | Dependencies and scripts |
| `.env.example` | Environment variable template |
| `src/app.js` | Express app factory (no listen call — exported for testing) |
| `src/server.js` | Entry point — imports app, calls listen |
| `src/db/index.js` | MariaDB connection pool singleton |
| `src/db/migrate.js` | Reads SQL files from migrations/, runs each statement |
| `src/db/migrations/001_initial.sql` | All 8 table definitions |
| `src/middleware/auth.js` | `requireAuth` — verifies JWT, attaches `req.user` |
| `src/middleware/rbac.js` | `requireRole(...roles)` — checks `req.user.role` |
| `src/services/audit.js` | `log()` — inserts into audit_logs |
| `src/api/auth.js` | POST /login, POST /refresh, POST /logout |
| `src/api/index.js` | Mounts all API sub-routers under /api |
| `tests/helpers/db.js` | `clearTables()`, `createUser()` test helpers |
| `tests/db.test.js` | Pool connection + table existence tests |
| `tests/app.test.js` | Health endpoint + 404 tests |
| `tests/middleware.test.js` | requireAuth + requireRole tests |
| `tests/auth.test.js` | Login, refresh, logout endpoint tests |
| `tests/audit.test.js` | audit.log() service tests |

---

### Task 1: Initialize project

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Init npm and install dependencies**

```bash
cd /path/to/neptune
npm init -y
npm install express mysql2 jsonwebtoken bcryptjs express-rate-limit cookie-parser dotenv
npm install --save-dev jest supertest nodemon
```

- [ ] **Step 2: Update `package.json` scripts and Jest config**

Replace the `scripts` section and add `jest` key:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "migrate": "node src/db/migrate.js",
    "test": "jest --runInBand --forceExit",
    "test:watch": "jest --watch --runInBand --forceExit"
  },
  "jest": {
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 3: Create `.env.example`**

```env
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=neptune
DB_PASSWORD=changeme
DB_NAME=neptune
DB_TEST_NAME=neptune_test

JWT_SECRET=change_this_to_a_random_string_at_least_64_chars_long
JWT_REFRESH_SECRET=change_this_to_another_random_string_at_least_64_chars
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.env
*.log
.superpowers/
```

- [ ] **Step 5: Copy `.env` and fill in values**

```bash
cp .env.example .env
# Edit .env with your local MariaDB credentials
```

- [ ] **Step 6: Create the two databases in MariaDB**

Connect to MariaDB as root and run:

```sql
CREATE DATABASE IF NOT EXISTS neptune CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS neptune_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'neptune'@'localhost' IDENTIFIED BY 'changeme';
GRANT ALL PRIVILEGES ON neptune.* TO 'neptune'@'localhost';
GRANT ALL PRIVILEGES ON neptune_test.* TO 'neptune'@'localhost';
FLUSH PRIVILEGES;
```

- [ ] **Step 7: Commit**

```bash
git init
git add package.json package-lock.json .env.example .gitignore
git commit -m "chore: initialize Neptune project"
```

---

### Task 2: Database connection pool

**Files:**
- Create: `src/db/index.js`
- Create: `tests/db.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/db.test.js`:

```js
process.env.NODE_ENV = 'test';
require('dotenv').config();
const pool = require('../src/db/index');

describe('database pool', () => {
  it('connects to MariaDB and returns a result', async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npx jest tests/db.test.js
```

Expected: FAIL — "Cannot find module '../src/db/index'"

- [ ] **Step 3: Create `src/db/index.js`**

```js
require('dotenv').config();
const mysql = require('mysql2/promise');

const isTest = process.env.NODE_ENV === 'test';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: isTest ? process.env.DB_TEST_NAME : process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
NODE_ENV=test npm test -- tests/db.test.js
```

Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/db/index.js tests/db.test.js
git commit -m "feat: add MariaDB connection pool"
```

---

### Task 3: Database migrations

**Files:**
- Create: `src/db/migrations/001_initial.sql`
- Create: `src/db/migrate.js`

- [ ] **Step 1: Create `src/db/migrations/001_initial.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user', 'client') NOT NULL,
  parent_id INT NULL,
  disk_quota_mb INT NOT NULL DEFAULT 5120,
  disk_used_mb INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS domains (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(253) NOT NULL,
  type ENUM('domain', 'subdomain') NOT NULL,
  parent_domain_id INT NULL,
  document_root VARCHAR(500) NOT NULL,
  php_version VARCHAR(10) NOT NULL DEFAULT '8.2',
  ssl_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ssl_type ENUM('letsencrypt', 'manual') NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ssl_certificates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  domain_id INT NOT NULL,
  type ENUM('letsencrypt', 'manual') NOT NULL,
  cert_path VARCHAR(500) NOT NULL,
  key_path VARCHAR(500) NOT NULL,
  expires_at DATETIME NOT NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `databases` (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  db_name VARCHAR(64) NOT NULL UNIQUE,
  db_user VARCHAR(32) NOT NULL UNIQUE,
  db_password_hash VARCHAR(255) NOT NULL,
  size_mb INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ftp_accounts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  ftp_username VARCHAR(64) NOT NULL UNIQUE,
  ftp_password_hash VARCHAR(255) NOT NULL,
  home_dir VARCHAR(500) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NULL,
  target_id INT NULL,
  ip_address VARCHAR(45) NOT NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS client_permissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  permission_key VARCHAR(64) NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE KEY unique_perm (user_id, permission_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Create `src/db/migrate.js`**

```js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./index');

async function migrate() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort().filter(f => f.endsWith('.sql'));

  for (const file of files) {
    console.log(`Running: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
    console.log(`Done: ${file}`);
  }

  await pool.end();
  console.log('All migrations complete.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Run migrations on both databases**

```bash
NODE_ENV=test node src/db/migrate.js
node src/db/migrate.js
```

Expected output each time:
```
Running: 001_initial.sql
Done: 001_initial.sql
All migrations complete.
```

- [ ] **Step 4: Add table-existence test to `tests/db.test.js`**

Append this test inside the `describe('database pool', ...)` block:

```js
  it('has all required tables', async () => {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    );
    const tables = rows.map(r => r.TABLE_NAME);
    expect(tables).toEqual(expect.arrayContaining([
      'users', 'domains', 'ssl_certificates', 'databases',
      'ftp_accounts', 'audit_logs', 'client_permissions', 'refresh_tokens',
    ]));
  });
```

- [ ] **Step 5: Run tests**

```bash
NODE_ENV=test npm test -- tests/db.test.js
```

Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/db/ tests/db.test.js
git commit -m "feat: add database migrations for all Neptune tables"
```

---

### Task 4: Express app skeleton

**Files:**
- Create: `src/api/index.js`
- Create: `src/api/auth.js` (placeholder)
- Create: `src/app.js`
- Create: `src/server.js`
- Create: `tests/app.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/app.test.js`:

```js
process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');

describe('app', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown routes return 404', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/app.test.js
```

Expected: FAIL — "Cannot find module '../src/app'"

- [ ] **Step 3: Create `src/api/auth.js` (placeholder)**

```js
const router = require('express').Router();
module.exports = router;
```

- [ ] **Step 4: Create `src/api/index.js`**

```js
const router = require('express').Router();
router.use('/auth', require('./auth'));
module.exports = router;
```

- [ ] **Step 5: Create `src/app.js`**

```js
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', require('./api/index'));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
```

- [ ] **Step 6: Create `src/server.js`**

```js
const app = require('./app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Neptune running on port ${PORT}`));
```

- [ ] **Step 7: Run tests**

```bash
NODE_ENV=test npm test -- tests/app.test.js
```

Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add src/app.js src/server.js src/api/ tests/app.test.js
git commit -m "feat: add Express app skeleton with health endpoint"
```

---

### Task 5: Test helpers + auth middleware

**Files:**
- Create: `tests/helpers/db.js`
- Create: `src/middleware/auth.js`
- Create: `tests/middleware.test.js`

- [ ] **Step 1: Create `tests/helpers/db.js`**

```js
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
```

- [ ] **Step 2: Write the failing middleware test**

Create `tests/middleware.test.js`:

```js
process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { requireAuth } = require('../src/middleware/auth');
const { clearTables, createUser } = require('./helpers/db');

beforeEach(() => clearTables());

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAuth, (req, res) => res.json({ userId: req.user.id }));
  return app;
}

describe('requireAuth', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('passes with valid token and sets req.user', async () => {
    const user = await createUser();
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(user.id);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/middleware.test.js
```

Expected: FAIL — "Cannot find module '../src/middleware/auth'"

- [ ] **Step 4: Create `src/middleware/auth.js`**

```js
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
```

- [ ] **Step 5: Run tests**

```bash
NODE_ENV=test npm test -- tests/middleware.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/middleware/auth.js tests/middleware.test.js tests/helpers/db.js
git commit -m "feat: add JWT auth middleware and test helpers"
```

---

### Task 6: RBAC middleware

**Files:**
- Create: `src/middleware/rbac.js`

- [ ] **Step 1: Write the failing test**

First, add this import at the top of `tests/middleware.test.js`, after the existing requires:

```js
const { requireRole } = require('../src/middleware/rbac');
```

Then append the following at the bottom of `tests/middleware.test.js`:

```js

function makeRoleApp(...allowedRoles) {
  const app = express();
  app.use(express.json());
  app.get('/guarded', requireAuth, requireRole(...allowedRoles), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireRole', () => {
  it('returns 403 when user role is not allowed', async () => {
    const user = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com' });
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const res = await request(makeRoleApp('admin'))
      .get('/guarded')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('passes when user role is in the allowed list', async () => {
    const user = await createUser({ role: 'admin', username: 'a1', email: 'a1@t.com' });
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const res = await request(makeRoleApp('admin', 'user'))
      .get('/guarded')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/middleware.test.js
```

Expected: FAIL — "Cannot find module '../src/middleware/rbac'"

- [ ] **Step 3: Create `src/middleware/rbac.js`**

```js
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireRole };
```

- [ ] **Step 4: Run tests**

```bash
NODE_ENV=test npm test -- tests/middleware.test.js
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/middleware/rbac.js tests/middleware.test.js
git commit -m "feat: add RBAC middleware"
```

---

### Task 7: Login endpoint

**Files:**
- Modify: `src/api/auth.js`
- Create: `tests/auth.test.js`

- [ ] **Step 1: Write the failing login tests**

Create `tests/auth.test.js`:

```js
process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/db/index');
const { clearTables, createUser } = require('./helpers/db');

beforeEach(() => clearTables());

describe('POST /api/auth/login', () => {
  it('returns 400 if email is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'abc' });
    expect(res.status).toBe(400);
  });

  it('returns 400 if password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'x@x.com' });
    expect(res.status).toBe(400);
  });

  it('returns 401 if user does not exist', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'pass' });
    expect(res.status).toBe(401);
  });

  it('returns 401 if password is wrong', async () => {
    await createUser({ email: 'u@test.com', password: 'correct' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'u@test.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for inactive account', async () => {
    const { id } = await createUser({ email: 'u@test.com', password: 'pass' });
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [id]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'u@test.com', password: 'pass' });
    expect(res.status).toBe(401);
  });

  it('returns 200 with accessToken and sets refreshToken cookie on success', async () => {
    await createUser({ email: 'u@test.com', password: 'correct123' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'u@test.com', password: 'correct123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('user');
    const cookies = res.headers['set-cookie'];
    expect(cookies.some(c => c.startsWith('refreshToken='))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

```bash
NODE_ENV=test npm test -- tests/auth.test.js
```

Expected: FAIL — all tests fail (routes not implemented)

- [ ] **Step 3: Implement `src/api/auth.js`**

```js
require('dotenv').config();
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../db/index');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

function signAccess(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function signRefresh(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, password_hash, role, is_active FROM users WHERE email = ?',
      [email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.is_active) {
      return res.status(401).json({ error: 'Account disabled' });
    }
    const accessToken = signAccess(user);
    const refreshToken = signRefresh(user);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt]
    );
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ accessToken, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests**

```bash
NODE_ENV=test npm test -- tests/auth.test.js
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/auth.js tests/auth.test.js
git commit -m "feat: add login endpoint with JWT + bcrypt + refresh cookie"
```

---

### Task 8: Refresh and logout endpoints

**Files:**
- Modify: `src/api/auth.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/auth.test.js`:

```js
describe('POST /api/auth/refresh', () => {
  it('returns 401 with no cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns a new accessToken with a valid refresh cookie', async () => {
    await createUser({ email: 'u@test.com', password: 'pass123' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'u@test.com', password: 'pass123' });
    const cookie = loginRes.headers['set-cookie'].find(c => c.startsWith('refreshToken='));

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the refreshToken cookie', async () => {
    await createUser({ email: 'u@test.com', password: 'pass123' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'u@test.com', password: 'pass123' });
    const cookie = loginRes.headers['set-cookie'].find(c => c.startsWith('refreshToken='));

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const clearedCookie = res.headers['set-cookie'].find(c => c.startsWith('refreshToken='));
    expect(clearedCookie).toContain('Expires=Thu, 01 Jan 1970');
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

```bash
NODE_ENV=test npm test -- tests/auth.test.js
```

Expected: FAIL (new tests fail — routes not defined)

- [ ] **Step 3: Append refresh and logout routes to `src/api/auth.js`**

Add these routes before the `module.exports` line:

```js
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const [rows] = await pool.query(
      'SELECT id FROM refresh_tokens WHERE token_hash = ? AND expires_at > NOW() AND user_id = ?',
      [tokenHash, payload.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid refresh token' });
    const [users] = await pool.query(
      'SELECT id, username, role, is_active FROM users WHERE id = ?',
      [payload.id]
    );
    const user = users[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'User not found or disabled' });
    res.json({ accessToken: signAccess(user) });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.cookies;
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await pool.query('DELETE FROM refresh_tokens WHERE token_hash = ?', [tokenHash]).catch(() => {});
  }
  res.clearCookie('refreshToken');
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run all auth tests**

```bash
NODE_ENV=test npm test -- tests/auth.test.js
```

Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/auth.js tests/auth.test.js
git commit -m "feat: add token refresh and logout endpoints"
```

---

### Task 9: Audit log service

**Files:**
- Create: `src/services/audit.js`
- Create: `tests/audit.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/audit.test.js`:

```js
process.env.NODE_ENV = 'test';
require('dotenv').config();
const { log } = require('../src/services/audit');
const pool = require('../src/db/index');
const { clearTables, createUser } = require('./helpers/db');

beforeEach(() => clearTables());

describe('audit.log', () => {
  it('inserts an audit log entry with required fields', async () => {
    const user = await createUser();
    await log({ userId: user.id, action: 'test_action', ip: '127.0.0.1' });
    const [rows] = await pool.query('SELECT * FROM audit_logs WHERE user_id = ?', [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('test_action');
    expect(rows[0].ip_address).toBe('127.0.0.1');
    expect(rows[0].target_type).toBeNull();
    expect(rows[0].details).toBeNull();
  });

  it('stores target and details when provided', async () => {
    const user = await createUser();
    await log({
      userId: user.id,
      action: 'create_domain',
      targetType: 'domain',
      targetId: 42,
      ip: '10.0.0.1',
      details: { name: 'test.com' },
    });
    const [rows] = await pool.query('SELECT * FROM audit_logs WHERE user_id = ?', [user.id]);
    expect(rows[0].target_type).toBe('domain');
    expect(rows[0].target_id).toBe(42);
    expect(JSON.parse(rows[0].details)).toEqual({ name: 'test.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/audit.test.js
```

Expected: FAIL — "Cannot find module '../src/services/audit'"

- [ ] **Step 3: Create `src/services/audit.js`**

```js
const pool = require('../db/index');

async function log({ userId, action, targetType = null, targetId = null, ip, details = null }) {
  await pool.query(
    'INSERT INTO audit_logs (user_id, action, target_type, target_id, ip_address, details) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, targetType, targetId, ip, details ? JSON.stringify(details) : null]
  );
}

module.exports = { log };
```

- [ ] **Step 4: Run tests**

```bash
NODE_ENV=test npm test -- tests/audit.test.js
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/audit.js tests/audit.test.js
git commit -m "feat: add audit log service"
```

---

### Task 10: Full test suite verification

- [ ] **Step 1: Run all tests**

```bash
NODE_ENV=test npm test
```

Expected output:
```
PASS  tests/db.test.js
PASS  tests/app.test.js
PASS  tests/middleware.test.js
PASS  tests/auth.test.js
PASS  tests/audit.test.js

Test Suites: 5 passed, 5 total
Tests:       22 passed, 22 total
```

- [ ] **Step 2: Verify the server starts**

```bash
npm run dev
```

Expected: `Neptune running on port 3000`

Test health:
```bash
curl http://localhost:3000/health
```
Expected: `{"status":"ok"}`

Test login (replace DB_PASSWORD with yours):
```bash
# First seed an admin user directly in MariaDB:
# INSERT INTO users (username, email, password_hash, role)
# VALUES ('admin', 'admin@local.com', '$2a$12$...bcrypt...', 'admin');

curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.com","password":"yourpass"}' | jq .
```
Expected: `{"accessToken":"eyJ...","user":{"id":1,"username":"admin","role":"admin"}}`

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "chore: Plan 1 complete — Foundation & Auth"
```

---

## What's next

- **Plan 2** — Account management (User/Client CRUD, client_permissions, quotas, password change)
- **Plan 3** — Domains + Vhosts + SSL
- **Plan 4** — File manager + FTP
- **Plan 5** — MySQL database management + PHP-FPM
- **Plan 6** — Frontend panel (HTML/CSS/JS vanilla, Dark Indigo)
