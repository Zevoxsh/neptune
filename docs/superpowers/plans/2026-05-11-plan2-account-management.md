# Neptune — Plan 2: Account Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement user CRUD (Admin/User/Client hierarchy), client permission management, password change, and disk quota tracking via a `/api/users` REST API.

**Architecture:** A `src/services/users.js` service owns all DB logic (create, read, list, update, deactivate, changePassword, getClientPermissions, setClientPermissions). A `src/api/users.js` router handles HTTP concerns: auth, RBAC, ownership checks, validation, and audit logging. The router is mounted at `/api/users` in `src/api/index.js`. All tests are in `tests/users.test.js` and run against the real `neptune_test` database.

**Tech Stack:** Node.js, Express 4, mysql2, bcryptjs, jsonwebtoken (already installed from Plan 1)

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/services/users.js` | DB operations: createUser, getUserById, listUsers, updateUser, changePassword, getClientPermissions, setClientPermissions |
| `src/api/users.js` | HTTP router: auth/RBAC/ownership guards, validation, delegates to service, logs audit |
| `src/api/index.js` | Mount `/users` router (modify existing) |
| `tests/users.test.js` | Integration tests for all user endpoints |

---

### Task 1: User service

**Files:**
- Create: `src/services/users.js`
- Create: `tests/users.service.test.js`

- [ ] **Step 1: Write the failing service test**

Create `tests/users.service.test.js`:

```js
require('dotenv').config();
const { createUser, getUserById, listUsers, updateUser, changePassword, getClientPermissions, setClientPermissions } = require('../src/services/users');
const pool = require('../src/db/index');
const { clearTables } = require('./helpers/db');

beforeEach(() => clearTables());

describe('users service', () => {
  it('createUser inserts and returns user without password_hash', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com', password: 'pass1234', role: 'user' });
    expect(user.id).toBeDefined();
    expect(user.username).toBe('alice');
    expect(user.role).toBe('user');
    expect(user.password_hash).toBeUndefined();
    expect(user.disk_quota_mb).toBe(5120);
  });

  it('getUserById returns null for unknown id', async () => {
    const result = await getUserById(99999);
    expect(result).toBeNull();
  });

  it('listUsers as admin returns all users', async () => {
    await createUser({ username: 'a', email: 'a@t.com', password: 'p', role: 'admin' });
    await createUser({ username: 'b', email: 'b@t.com', password: 'p', role: 'user' });
    const list = await listUsers({ requestingRole: 'admin', requestingUserId: 1 });
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('listUsers as user returns only their clients', async () => {
    const user = await createUser({ username: 'u', email: 'u@t.com', password: 'p', role: 'user' });
    const client = await createUser({ username: 'c', email: 'c@t.com', password: 'p', role: 'client', parentId: user.id });
    const other = await createUser({ username: 'o', email: 'o@t.com', password: 'p', role: 'user' });
    const list = await listUsers({ requestingRole: 'user', requestingUserId: user.id });
    const ids = list.map(u => u.id);
    expect(ids).toContain(client.id);
    expect(ids).not.toContain(other.id);
  });

  it('updateUser changes only provided fields', async () => {
    const user = await createUser({ username: 'u', email: 'u@t.com', password: 'p', role: 'user' });
    const updated = await updateUser(user.id, { username: 'renamed' });
    expect(updated.username).toBe('renamed');
    expect(updated.email).toBe('u@t.com');
  });

  it('changePassword updates the hash so new password works', async () => {
    const bcrypt = require('bcryptjs');
    const user = await createUser({ username: 'u', email: 'u@t.com', password: 'oldpass', role: 'user' });
    await changePassword(user.id, 'newpass123');
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    const matches = await bcrypt.compare('newpass123', rows[0].password_hash);
    expect(matches).toBe(true);
  });

  it('setClientPermissions stores and getClientPermissions retrieves', async () => {
    const client = await createUser({ username: 'c', email: 'c@t.com', password: 'p', role: 'client' });
    await setClientPermissions(client.id, { allow_subdomain: true, allow_php_version_choice: false });
    const perms = await getClientPermissions(client.id);
    expect(perms.allow_subdomain).toBe(true);
    expect(perms.allow_php_version_choice).toBe(false);
  });

  it('setClientPermissions is idempotent (upsert)', async () => {
    const client = await createUser({ username: 'c', email: 'c@t.com', password: 'p', role: 'client' });
    await setClientPermissions(client.id, { allow_subdomain: true });
    await setClientPermissions(client.id, { allow_subdomain: false });
    const perms = await getClientPermissions(client.id);
    expect(perms.allow_subdomain).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/users.service.test.js
```

Expected: FAIL — "Cannot find module '../src/services/users'"

- [ ] **Step 3: Create `src/services/users.js`**

```js
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
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
}

async function getClientPermissions(clientId) {
  const [rows] = await pool.query(
    'SELECT permission_key, allowed FROM client_permissions WHERE user_id = ?',
    [clientId]
  );
  return rows.reduce((acc, r) => ({ ...acc, [r.permission_key]: Boolean(r.allowed) }), {});
}

async function setClientPermissions(clientId, permissions) {
  for (const [key, allowed] of Object.entries(permissions)) {
    await pool.query(
      `INSERT INTO client_permissions (user_id, permission_key, allowed) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)`,
      [clientId, key, allowed ? 1 : 0]
    );
  }
  return getClientPermissions(clientId);
}

module.exports = { createUser, getUserById, listUsers, updateUser, changePassword, getClientPermissions, setClientPermissions };
```

- [ ] **Step 4: Run tests**

```bash
NODE_ENV=test npm test -- tests/users.service.test.js
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/users.js tests/users.service.test.js
git commit -m "feat: add user service (CRUD, permissions, password)"
```

---

### Task 2: User API routes

**Files:**
- Create: `src/api/users.js`
- Create: `tests/users.test.js`

- [ ] **Step 1: Write the failing API tests**

Create `tests/users.test.js`:

```js
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const pool = require('../src/db/index');
const { clearTables, createUser } = require('./helpers/db');

beforeEach(() => clearTables());

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

// ── GET /api/users ──────────────────────────────────────────────────────────

describe('GET /api/users', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns 403 for client role', async () => {
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com' });
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${makeToken(client)}`);
    expect(res.status).toBe(403);
  });

  it('admin gets all users', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(2);
    expect(res.body.users[0].password_hash).toBeUndefined();
  });

  it('user sees only their clients', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: user.id });
    const other = await createUser({ username: 'u2', email: 'u2@t.com' });
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    const ids = res.body.users.map(u => u.id);
    expect(ids).toContain(client.id);
    expect(ids).not.toContain(other.id);
  });
});

// ── GET /api/users/:id ──────────────────────────────────────────────────────

describe('GET /api/users/:id', () => {
  it('returns 404 for nonexistent user', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const res = await request(app)
      .get('/api/users/99999')
      .set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(404);
  });

  it('admin can view any user', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .get(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
  });

  it('user can view their own client', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: user.id });
    const res = await request(app)
      .get(`/api/users/${client.id}`)
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
  });

  it('user cannot view another user', async () => {
    const user1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const user2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const res = await request(app)
      .get(`/api/users/${user2.id}`)
      .set('Authorization', `Bearer ${makeToken(user1)}`);
    expect(res.status).toBe(403);
  });

  it('client cannot view another user', async () => {
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .get(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${makeToken(client)}`);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/users ─────────────────────────────────────────────────────────

describe('POST /api/users', () => {
  it('returns 400 with missing fields', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ username: 'x' });
    expect(res.status).toBe(400);
  });

  it('admin creates a user', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ username: 'newuser', email: 'new@t.com', password: 'pass1234', role: 'user' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('user creates a client (auto-assigned as their child)', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ username: 'myclient', email: 'cli@t.com', password: 'pass1234', role: 'client' });
    expect(res.status).toBe(201);
    expect(res.body.user.parent_id).toBe(user.id);
  });

  it('user cannot create a non-client account', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ username: 'newuser', email: 'new@t.com', password: 'pass1234', role: 'user' });
    expect(res.status).toBe(403);
  });

  it('returns 409 for duplicate email', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    await createUser({ username: 'existing', email: 'dup@t.com' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ username: 'newname', email: 'dup@t.com', password: 'pass1234', role: 'user' });
    expect(res.status).toBe(409);
  });
});

// ── PUT /api/users/:id ──────────────────────────────────────────────────────

describe('PUT /api/users/:id', () => {
  it('admin updates any user', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .put(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ username: 'updated' });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('updated');
  });

  it('admin can update quota', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .put(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ disk_quota_mb: 10240 });
    expect(res.status).toBe(200);
    expect(res.body.user.disk_quota_mb).toBe(10240);
  });

  it('user can update their own client', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: user.id });
    const res = await request(app)
      .put(`/api/users/${client.id}`)
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ username: 'updated_client' });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('updated_client');
  });

  it('user cannot update another user', async () => {
    const user1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const user2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const res = await request(app)
      .put(`/api/users/${user2.id}`)
      .set('Authorization', `Bearer ${makeToken(user1)}`)
      .send({ username: 'hack' });
    expect(res.status).toBe(403);
  });

  it('non-admin cannot set quota', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .put(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ disk_quota_mb: 99999 });
    expect(res.status).toBe(200);
    expect(res.body.user.disk_quota_mb).toBe(5120); // unchanged
  });
});

// ── DELETE /api/users/:id ───────────────────────────────────────────────────

describe('DELETE /api/users/:id', () => {
  it('admin deactivates a user', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .delete(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    const [rows] = await pool.query('SELECT is_active FROM users WHERE id = ?', [user.id]);
    expect(rows[0].is_active).toBe(0);
  });

  it('admin cannot deactivate themselves', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const res = await request(app)
      .delete(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(400);
  });

  it('user can deactivate their own client', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: user.id });
    const res = await request(app)
      .delete(`/api/users/${client.id}`)
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
  });

  it('user cannot deactivate another user', async () => {
    const user1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const user2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const res = await request(app)
      .delete(`/api/users/${user2.id}`)
      .set('Authorization', `Bearer ${makeToken(user1)}`);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/users/:id/password ────────────────────────────────────────────

describe('POST /api/users/:id/password', () => {
  it('returns 400 for password shorter than 8 chars', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .post(`/api/users/${user.id}/password`)
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ new_password: 'short' });
    expect(res.status).toBe(400);
  });

  it('admin can change any password', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .post(`/api/users/${user.id}/password`)
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ new_password: 'newpassword123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('user can change their own password', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .post(`/api/users/${user.id}/password`)
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ new_password: 'newpassword123' });
    expect(res.status).toBe(200);
  });

  it('user cannot change another user password', async () => {
    const user1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const user2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const res = await request(app)
      .post(`/api/users/${user2.id}/password`)
      .set('Authorization', `Bearer ${makeToken(user1)}`)
      .send({ new_password: 'newpassword123' });
    expect(res.status).toBe(403);
  });
});

// ── GET /api/users/:id/permissions ──────────────────────────────────────────

describe('GET /api/users/:id/permissions', () => {
  it('returns empty permissions object for a new client', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: user.id });
    const res = await request(app)
      .get(`/api/users/${client.id}/permissions`)
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.permissions).toBe('object');
  });

  it('returns 400 for non-client user', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .get(`/api/users/${user.id}/permissions`)
      .set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(400);
  });

  it('user cannot view permissions of another user client', async () => {
    const user1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const user2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    const client2 = await createUser({ role: 'client', username: 'c2', email: 'c2@t.com', parentId: user2.id });
    const res = await request(app)
      .get(`/api/users/${client2.id}/permissions`)
      .set('Authorization', `Bearer ${makeToken(user1)}`);
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/users/:id/permissions ──────────────────────────────────────────

describe('PUT /api/users/:id/permissions', () => {
  it('user sets permissions for their client', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: user.id });
    const res = await request(app)
      .put(`/api/users/${client.id}/permissions`)
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ permissions: { allow_subdomain: true, allow_php_version_choice: false } });
    expect(res.status).toBe(200);
    expect(res.body.permissions.allow_subdomain).toBe(true);
    expect(res.body.permissions.allow_php_version_choice).toBe(false);
  });

  it('returns 400 for unknown permission key', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com' });
    const res = await request(app)
      .put(`/api/users/${client.id}/permissions`)
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ permissions: { unknown_key: true } });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-client target', async () => {
    const admin = await createUser({ role: 'admin', username: 'a', email: 'a@t.com' });
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const res = await request(app)
      .put(`/api/users/${user.id}/permissions`)
      .set('Authorization', `Bearer ${makeToken(admin)}`)
      .send({ permissions: { allow_subdomain: true } });
    expect(res.status).toBe(400);
  });

  it('permissions are updated idempotently', async () => {
    const user = await createUser({ username: 'u1', email: 'u1@t.com' });
    const client = await createUser({ role: 'client', username: 'c1', email: 'c1@t.com', parentId: user.id });
    await request(app)
      .put(`/api/users/${client.id}/permissions`)
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ permissions: { allow_subdomain: true } });
    const res = await request(app)
      .put(`/api/users/${client.id}/permissions`)
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ permissions: { allow_subdomain: false } });
    expect(res.status).toBe(200);
    expect(res.body.permissions.allow_subdomain).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_ENV=test npm test -- tests/users.test.js
```

Expected: FAIL — routes not defined yet

- [ ] **Step 3: Create `src/api/users.js`**

```js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const audit = require('../services/audit');
const users = require('../services/users');

const VALID_PERMISSION_KEYS = ['allow_subdomain', 'allow_php_version_choice'];

function canAccessUser(requester, target) {
  if (requester.role === 'admin') return true;
  if (requester.id === target.id) return true;
  if (requester.role === 'user' && target.parent_id === requester.id) return true;
  return false;
}

// GET /api/users
router.get('/', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  try {
    const list = await users.listUsers({ requestingUserId: req.user.id, requestingRole: req.user.role });
    res.json({ users: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id
router.get('/:id', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAccessUser(req.user, target)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ user: target });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users
router.post('/', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const { username, email, password, role, disk_quota_mb } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'username, email, password, role required' });
  }
  if (req.user.role === 'user' && role !== 'client') {
    return res.status(403).json({ error: 'Users can only create client accounts' });
  }
  const parentId = req.user.role === 'user' ? req.user.id
    : (role === 'client' ? (req.body.parent_id || null) : null);
  try {
    const user = await users.createUser({ username, email, password, role, parentId, diskQuotaMb: disk_quota_mb });
    await audit.log({ userId: req.user.id, action: 'create_user', targetType: 'user', targetId: user.id, ip: req.ip });
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username or email already taken' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id
router.put('/:id', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAccessUser(req.user, target)) return res.status(403).json({ error: 'Forbidden' });
    const { username, email } = req.body;
    const diskQuotaMb = req.user.role === 'admin' ? req.body.disk_quota_mb : undefined;
    const isActive = req.user.role === 'admin' ? req.body.is_active : undefined;
    const updated = await users.updateUser(targetId, { username, email, diskQuotaMb, isActive });
    await audit.log({ userId: req.user.id, action: 'update_user', targetType: 'user', targetId, ip: req.ip });
    res.json({ user: updated });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username or email already taken' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id — soft delete (deactivate)
router.delete('/:id', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id === targetId) return res.status(400).json({ error: 'Cannot deactivate yourself' });
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (req.user.role === 'user' && target.parent_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await users.updateUser(targetId, { isActive: false });
    await audit.log({ userId: req.user.id, action: 'deactivate_user', targetType: 'user', targetId, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/:id/password
router.post('/:id/password', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'new_password must be at least 8 characters' });
  }
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAccessUser(req.user, target)) return res.status(403).json({ error: 'Forbidden' });
    await users.changePassword(targetId, new_password);
    await audit.log({ userId: req.user.id, action: 'change_password', targetType: 'user', targetId, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id/permissions
router.get('/:id/permissions', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role !== 'client') return res.status(400).json({ error: 'Permissions only apply to client accounts' });
    if (req.user.role !== 'admin' && !(req.user.role === 'user' && target.parent_id === req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const perms = await users.getClientPermissions(targetId);
    res.json({ permissions: perms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/permissions
router.put('/:id/permissions', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const targetId = Number(req.params.id);
  const { permissions } = req.body;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return res.status(400).json({ error: 'permissions object required' });
  }
  const invalid = Object.keys(permissions).filter(k => !VALID_PERMISSION_KEYS.includes(k));
  if (invalid.length) return res.status(400).json({ error: `Unknown permission keys: ${invalid.join(', ')}` });
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role !== 'client') return res.status(400).json({ error: 'Permissions only apply to client accounts' });
    if (req.user.role === 'user' && target.parent_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const updated = await users.setClientPermissions(targetId, permissions);
    await audit.log({ userId: req.user.id, action: 'set_client_permissions', targetType: 'user', targetId, ip: req.ip });
    res.json({ permissions: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests**

```bash
NODE_ENV=test npm test -- tests/users.test.js
```

Expected: PASS (22 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/users.js tests/users.test.js
git commit -m "feat: add user management API routes"
```

---

### Task 3: Wire routes and final verification

**Files:**
- Modify: `src/api/index.js`

- [ ] **Step 1: Mount users router in `src/api/index.js`**

Replace the full content of `src/api/index.js`:

```js
const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
module.exports = router;
```

- [ ] **Step 2: Syntax check all new files**

```bash
node --check src/services/users.js
node --check src/api/users.js
node --check src/api/index.js
```

Expected: no output (no errors)

- [ ] **Step 3: Run full test suite**

```bash
NODE_ENV=test npm test
```

Expected:
```
PASS  tests/db.test.js
PASS  tests/app.test.js
PASS  tests/middleware.test.js
PASS  tests/auth.test.js
PASS  tests/audit.test.js
PASS  tests/users.service.test.js
PASS  tests/users.test.js

Test Suites: 7 passed, 7 total
Tests:       ~52 passed
```

- [ ] **Step 4: Commit**

```bash
git add src/api/index.js
git commit -m "feat: mount users API — Plan 2 complete"
```

---

## What's next

- **Plan 3** — Domains + Vhosts + SSL
- **Plan 4** — File manager + FTP
- **Plan 5** — MySQL database management + PHP-FPM
- **Plan 6** — Frontend panel (HTML/CSS/JS vanilla, Dark Indigo)
