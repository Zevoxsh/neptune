# Plan 5 — MySQL Database Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MySQL database management — create, list, password-reset, and delete per-user MariaDB databases via a dedicated `neptune_admin` management connection.

**Architecture:** A new `src/system/mysql.js` wraps a dedicated `mysql2` pool (using `neptune_admin` credentials) for raw CREATE/DROP/ALTER operations. `src/services/databases.js` handles naming, validation, bcrypt password hashing, and DB CRUD. `src/api/databases.js` exposes 5 REST endpoints. The generated MySQL password is returned plaintext once (at creation or reset) and stored only as a bcrypt hash — never retrievable after that.

**Tech Stack:** Node.js, Express 4, mysql2 (already in package.json), bcryptjs, MariaDB.

> **Important:** Tests require a live MariaDB connection and cannot run on Windows dev. Write test code and verify it is syntactically correct; run `npm test` on the Linux server only.

---

## File Map

| File | Action |
|------|--------|
| `src/system/mysql.js` | Create |
| `src/services/databases.js` | Create |
| `src/api/databases.js` | Create |
| `src/api/index.js` | Modify — add `router.use('/databases', require('./databases'))` |
| `tests/databases.service.test.js` | Create |

---

### Task 1: `src/system/mysql.js` — Management pool and raw MySQL operations

**Files:**
- Create: `src/system/mysql.js`

This module opens a dedicated `mysql2` pool using `neptune_admin` credentials. It is NOT the same pool as `src/db/index.js` (which is for Neptune's own application data). This module is mocked entirely in service tests — it has no unit tests of its own.

- [ ] **Step 1: Create `src/system/mysql.js`**

```js
const mysql2 = require('mysql2/promise');

let _pool = null;

function getMgmtPool() {
  if (!_pool) {
    _pool = mysql2.createPool({
      host: process.env.NEPTUNE_MYSQL_MGMT_HOST || '127.0.0.1',
      port: parseInt(process.env.NEPTUNE_MYSQL_MGMT_PORT || '3306', 10),
      user: process.env.NEPTUNE_MYSQL_MGMT_USER,
      password: process.env.NEPTUNE_MYSQL_MGMT_PASS,
      waitForConnections: true,
      connectionLimit: 5,
    });
  }
  return _pool;
}

async function createDatabase(dbName, dbUser, password) {
  const conn = await getMgmtPool().getConnection();
  try {
    await conn.query('CREATE DATABASE ??', [dbName]);
    await conn.query("CREATE USER ?@'localhost' IDENTIFIED BY ?", [dbUser, password]);
    await conn.query("GRANT ALL PRIVILEGES ON ??.* TO ?@'localhost'", [dbName, dbUser]);
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    conn.release();
  }
}

async function dropDatabase(dbName, dbUser) {
  const conn = await getMgmtPool().getConnection();
  try {
    await conn.query('DROP DATABASE IF EXISTS ??', [dbName]);
    await conn.query("DROP USER IF EXISTS ?@'localhost'", [dbUser]);
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    conn.release();
  }
}

async function changePassword(dbUser, newPassword) {
  const conn = await getMgmtPool().getConnection();
  try {
    await conn.query("ALTER USER ?@'localhost' IDENTIFIED BY ?", [dbUser, newPassword]);
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    conn.release();
  }
}

async function getDatabaseSizeMb(dbName) {
  const [rows] = await getMgmtPool().query(
    'SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb FROM information_schema.TABLES WHERE table_schema = ?',
    [dbName]
  );
  return parseFloat(rows[0]?.size_mb) || 0;
}

module.exports = { createDatabase, dropDatabase, changePassword, getDatabaseSizeMb };
```

- [ ] **Step 2: Commit**

```bash
git add src/system/mysql.js
git commit -m "feat: add mysql system module with management pool and raw DB operations"
```

---

### Task 2: `src/services/databases.js` — Business logic with TDD

**Files:**
- Create: `src/services/databases.js`
- Create: `tests/databases.service.test.js`

**Context:**
- `src/db/index.js` exports a `mysql2` pool for Neptune's own tables — use this for INSERT/SELECT/UPDATE/DELETE on the `databases` table.
- `src/system/mysql.js` is mocked entirely in tests (same pattern as `src/system/ftp.js` in `tests/ftp.service.test.js`).
- `tests/helpers/db.js` exports `clearTables()` (truncates all tables including `` `databases` ``) and `createUser({ username, email, role })`.
- The `` `databases` `` table columns: `id, user_id, db_name, db_user, db_password_hash, size_mb, created_at`.
- `db_password_hash` must NEVER appear in query field lists returned to callers — excluded from `DB_FIELDS`.
- `BCRYPT_COST = process.env.NODE_ENV === 'test' ? 1 : 12` — same pattern as `src/services/ftp.js`.

- [ ] **Step 1: Write the failing tests**

Create `tests/databases.service.test.js`:

```js
require('dotenv').config();
const { clearTables, createUser } = require('./helpers/db');
const {
  createDatabase, listDatabases, getDatabaseById, resetDatabasePassword, dropDatabase,
} = require('../src/services/databases');

jest.mock('../src/system/mysql', () => ({
  createDatabase: jest.fn().mockResolvedValue(undefined),
  dropDatabase: jest.fn().mockResolvedValue(undefined),
  changePassword: jest.fn().mockResolvedValue(undefined),
  getDatabaseSizeMb: jest.fn().mockResolvedValue(0),
}));

beforeEach(() => clearTables());

describe('createDatabase', () => {
  it('inserts a database record and returns it with a 32-char plaintext password', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const { database, password } = await createDatabase({ userId: user.id, name: 'mydb' });
    expect(database.id).toBeDefined();
    expect(database.db_name).toBe('alice_mydb');
    expect(database.db_user).toBe('alice_mydb');
    expect(database.user_id).toBe(user.id);
    expect(password).toHaveLength(32);
    expect(database.db_password_hash).toBeUndefined();
  });

  it('throws INVALID_DB_NAME for names with spaces or special chars', async () => {
    const user = await createUser({ username: 'bob', email: 'bob@t.com' });
    await expect(createDatabase({ userId: user.id, name: 'bad name!' }))
      .rejects.toMatchObject({ code: 'INVALID_DB_NAME' });
  });

  it('throws NOT_FOUND for a non-existent userId', async () => {
    await expect(createDatabase({ userId: 999999, name: 'mydb' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws DB_NAME_TOO_LONG when username + name exceeds 64 chars', async () => {
    const user = await createUser({ username: 'a'.repeat(33), email: 'long@t.com' });
    await expect(createDatabase({ userId: user.id, name: 'b'.repeat(32) }))
      .rejects.toMatchObject({ code: 'DB_NAME_TOO_LONG' });
  });
});

describe('listDatabases', () => {
  it('admin sees all databases', async () => {
    const admin = await createUser({ role: 'admin', username: 'adm', email: 'adm@t.com' });
    const u1 = await createUser({ username: 'u1lst', email: 'u1lst@t.com' });
    await createDatabase({ userId: u1.id, name: 'site1' });
    const list = await listDatabases({ requestingUserId: admin.id, requestingRole: 'admin' });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('user sees only their own databases', async () => {
    const u1 = await createUser({ username: 'u1own', email: 'u1own@t.com' });
    const u2 = await createUser({ username: 'u2own', email: 'u2own@t.com' });
    await createDatabase({ userId: u1.id, name: 'siteA' });
    await createDatabase({ userId: u2.id, name: 'siteB' });
    const list = await listDatabases({ requestingUserId: u1.id, requestingRole: 'user' });
    expect(list.every(d => d.user_id === u1.id)).toBe(true);
    expect(list.some(d => d.db_name === 'u1own_siteA')).toBe(true);
  });
});

describe('getDatabaseById', () => {
  it('returns null for a non-existent id', async () => {
    const result = await getDatabaseById(999999);
    expect(result).toBeNull();
  });
});

describe('resetDatabasePassword', () => {
  it('returns a new plaintext password and updates the hash', async () => {
    const user = await createUser({ username: 'frank', email: 'frank@t.com' });
    const { database } = await createDatabase({ userId: user.id, name: 'testdb' });
    const before = await getDatabaseById(database.id);
    const { password: newPassword } = await resetDatabasePassword(database.id);
    const after = await getDatabaseById(database.id);
    expect(newPassword).toHaveLength(32);
    // size_mb is the only thing getDatabaseById returns here; we can't compare hash since DB_FIELDS excludes it
    // Verify the mock was called
    const mysql = require('../src/system/mysql');
    expect(mysql.changePassword).toHaveBeenCalledWith(database.db_user, newPassword);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
  });

  it('throws NOT_FOUND for a non-existent id', async () => {
    await expect(resetDatabasePassword(999999))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('dropDatabase', () => {
  it('removes the database record', async () => {
    const user = await createUser({ username: 'eve', email: 'eve@t.com' });
    const { database } = await createDatabase({ userId: user.id, name: 'todelete' });
    await dropDatabase(database.id);
    const result = await getDatabaseById(database.id);
    expect(result).toBeNull();
  });

  it('throws NOT_FOUND for a non-existent id', async () => {
    await expect(dropDatabase(999999))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run on the Linux server: `npm test -- tests/databases.service.test.js`
Expected: FAIL with "Cannot find module '../src/services/databases'"

- [ ] **Step 3: Create `src/services/databases.js`**

```js
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

function buildDbUser(username, name) {
  const full = `${username}_${name}`;
  return full.length <= 32 ? full : full.slice(0, 32);
}

async function refreshSize(row) {
  const sizeMb = await mysql.getDatabaseSizeMb(row.db_name);
  pool.query('UPDATE `databases` SET size_mb = ? WHERE id = ?', [sizeMb, row.id]).catch(() => {});
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
  const [result] = await pool.query(
    'INSERT INTO `databases` (user_id, db_name, db_user, db_password_hash) VALUES (?, ?, ?, ?)',
    [userId, dbName, dbUser, passwordHash]
  );
  const database = await getDatabaseById(result.insertId);
  return { database, password };
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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run on the Linux server: `npm test -- tests/databases.service.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/databases.js tests/databases.service.test.js
git commit -m "feat: add databases service with create/list/get/reset-password/drop"
```

---

### Task 3: `src/api/databases.js` + register route

**Files:**
- Create: `src/api/databases.js`
- Modify: `src/api/index.js`

**Context:**
- `src/middleware/auth.js` exports `requireAuth` — validates JWT, sets `req.user = { id, role }`.
- `src/middleware/rbac.js` exports `requireRole(...roles)` — returns 403 if `req.user.role` not in list.
- `src/services/audit.js` exports `audit.log({ userId, action, targetType, targetId, ip, details })` — always call with `.catch(e => console.error('audit failure:', e))`.
- Existing pattern: `parseId(param)` returns `null` for non-positive-integer strings.
- `db_password_hash` is already excluded from `DB_FIELDS` in the service — the `database` objects returned by the service are safe to send directly.
- POST and DELETE are restricted to `admin` and `user` roles. Clients can list and view but cannot create or delete.
- The `password` field in POST and PUT responses is the plaintext MySQL password shown exactly once.

- [ ] **Step 1: Create `src/api/databases.js`**

```js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const audit = require('../services/audit');
const dbService = require('../services/databases');

function parseId(param) {
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function canAccessDatabase(requester, db) {
  if (requester.role === 'admin') return true;
  return db.user_id === requester.id;
}

// GET /api/databases
router.get('/', requireAuth, async (req, res) => {
  try {
    const databases = await dbService.listDatabases({ requestingUserId: req.user.id, requestingRole: req.user.role });
    res.json({ databases });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/databases
router.post('/', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { database, password } = await dbService.createDatabase({ userId: req.user.id, name });
    await audit.log({ userId: req.user.id, action: 'create_database', targetType: 'database', targetId: database.id, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.status(201).json({ database, password });
  } catch (err) {
    if (err.code === 'INVALID_DB_NAME') return res.status(400).json({ error: 'Invalid database name' });
    if (err.code === 'DB_NAME_TOO_LONG') return res.status(400).json({ error: 'Database name too long' });
    if (err.code === 'ER_DB_CREATE_EXISTS') return res.status(409).json({ error: 'Database already exists' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/databases/:id
router.get('/:id', requireAuth, async (req, res) => {
  const dbId = parseId(req.params.id);
  if (dbId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const database = await dbService.getDatabaseById(dbId);
    if (!database) return res.status(404).json({ error: 'Database not found' });
    if (!canAccessDatabase(req.user, database)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ database });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/databases/:id/password
router.put('/:id/password', requireAuth, async (req, res) => {
  const dbId = parseId(req.params.id);
  if (dbId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const database = await dbService.getDatabaseById(dbId);
    if (!database) return res.status(404).json({ error: 'Database not found' });
    if (!canAccessDatabase(req.user, database)) return res.status(403).json({ error: 'Forbidden' });
    const { password } = await dbService.resetDatabasePassword(dbId);
    await audit.log({ userId: req.user.id, action: 'reset_db_password', targetType: 'database', targetId: dbId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true, password });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Database not found' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/databases/:id
router.delete('/:id', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const dbId = parseId(req.params.id);
  if (dbId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const database = await dbService.getDatabaseById(dbId);
    if (!database) return res.status(404).json({ error: 'Database not found' });
    if (!canAccessDatabase(req.user, database)) return res.status(403).json({ error: 'Forbidden' });
    await dbService.dropDatabase(dbId);
    await audit.log({ userId: req.user.id, action: 'delete_database', targetType: 'database', targetId: dbId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Register the route in `src/api/index.js`**

Current content of `src/api/index.js`:
```js
const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/domains', require('./domains'));
router.use('/files', require('./files'));
router.use('/ftp', require('./ftp'));
module.exports = router;
```

Add the databases route:
```js
const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/domains', require('./domains'));
router.use('/files', require('./files'));
router.use('/ftp', require('./ftp'));
router.use('/databases', require('./databases'));
module.exports = router;
```

- [ ] **Step 3: Run all tests**

Run on the Linux server: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/databases.js src/api/index.js
git commit -m "feat: add databases API with 5 endpoints (list/create/get/reset-password/delete)"
```
