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
