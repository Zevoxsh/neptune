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
