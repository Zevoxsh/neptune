require('dotenv').config();
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { requireAuth } = require('../src/middleware/auth');
const { requireRole } = require('../src/middleware/rbac');
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
