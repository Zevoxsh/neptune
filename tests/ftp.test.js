require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { clearTables, createUser } = require('./helpers/db');

jest.mock('../src/system/ftp', () => ({
  addFtpUser: jest.fn().mockResolvedValue(undefined),
  deleteFtpUser: jest.fn().mockResolvedValue(undefined),
  changeFtpPassword: jest.fn().mockResolvedValue(undefined),
}));

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-ftp-api-'));
  process.env.NEPTUNE_SITES_ROOT = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => clearTables());

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

describe('GET /api/ftp', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/ftp');
    expect(res.status).toBe(401);
  });

  it('user sees their own FTP accounts', async () => {
    const user = await createUser({ username: 'ftpapi1', email: 'ftpapi1@t.com' });
    const pool = require('../src/db/index');
    await pool.query(
      'INSERT INTO ftp_accounts (user_id, ftp_username, ftp_password_hash, home_dir, is_active) VALUES (?, ?, ?, ?, 1)',
      [user.id, 'ftpapi1_ftp', '$2a$hash', path.join(tmpDir, 'ftpapi1')]
    );
    const res = await request(app).get('/api/ftp').set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.accounts.every(a => a.user_id === user.id)).toBe(true);
  });

  it('admin sees all accounts', async () => {
    const admin = await createUser({ role: 'admin', username: 'ftpadm', email: 'ftpadm@t.com' });
    const user = await createUser({ username: 'ftpapi2', email: 'ftpapi2@t.com' });
    const pool = require('../src/db/index');
    await pool.query(
      'INSERT INTO ftp_accounts (user_id, ftp_username, ftp_password_hash, home_dir, is_active) VALUES (?, ?, ?, ?, 1)',
      [user.id, 'ftpapi2_ftp', '$2a$hash', path.join(tmpDir, 'ftpapi2')]
    );
    const res = await request(app).get('/api/ftp').set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/ftp', () => {
  it('returns 400 without required fields', async () => {
    const user = await createUser({ username: 'ftpapi3', email: 'ftpapi3@t.com' });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'only_username' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for weak password', async () => {
    const user = await createUser({ username: 'ftpapi4', email: 'ftpapi4@t.com' });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp4', password: 'weak', home_dir: '.' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid ftp_username', async () => {
    const user = await createUser({ username: 'ftpapi5', email: 'ftpapi5@t.com' });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'bad name!', password: 'securepass', home_dir: '.' });
    expect(res.status).toBe(400);
  });

  it('creates an FTP account', async () => {
    const user = await createUser({ username: 'ftpapi6', email: 'ftpapi6@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi6'), { recursive: true });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp6', password: 'securepass', home_dir: '.' });
    expect(res.status).toBe(201);
    expect(res.body.account.ftp_username).toBe('ftp6');
    expect(res.body.account.user_id).toBe(user.id);
  });

  it('returns 409 for duplicate ftp_username', async () => {
    const user = await createUser({ username: 'ftpapi7', email: 'ftpapi7@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi7'), { recursive: true });
    await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp7dup', password: 'securepass', home_dir: '.' });
    const res2 = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp7dup', password: 'securepass', home_dir: '.' });
    expect(res2.status).toBe(409);
  });

  it('returns 400 for home_dir path traversal', async () => {
    const user = await createUser({ username: 'ftpapi8', email: 'ftpapi8@t.com' });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp8', password: 'securepass', home_dir: '../../etc' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/ftp/:id/password', () => {
  it('changes password successfully', async () => {
    const user = await createUser({ username: 'ftpapi9', email: 'ftpapi9@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi9'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp9', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    const res = await request(app).put(`/api/ftp/${id}/password`)
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ password: 'newpassword' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 403 when accessing another user account', async () => {
    const u1 = await createUser({ username: 'ftpapi10', email: 'ftpapi10@t.com' });
    const u2 = await createUser({ username: 'ftpapi11', email: 'ftpapi11@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi10'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(u1)}`)
      .send({ ftp_username: 'ftp10', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    const res = await request(app).put(`/api/ftp/${id}/password`)
      .set('Authorization', `Bearer ${makeToken(u2)}`)
      .send({ password: 'newpassword' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for weak new password', async () => {
    const user = await createUser({ username: 'ftpapi12', email: 'ftpapi12@t.com' });
    const res = await request(app).put('/api/ftp/1/password')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent account', async () => {
    const user = await createUser({ username: 'ftpapi13', email: 'ftpapi13@t.com' });
    const res = await request(app).put('/api/ftp/99999/password')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ password: 'newpassword' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/ftp/:id', () => {
  it('deactivates an FTP account', async () => {
    const user = await createUser({ username: 'ftpapi14', email: 'ftpapi14@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi14'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp14', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    const res = await request(app).delete(`/api/ftp/${id}`)
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 403 when deleting another user account', async () => {
    const u1 = await createUser({ username: 'ftpapi15', email: 'ftpapi15@t.com' });
    const u2 = await createUser({ username: 'ftpapi16', email: 'ftpapi16@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi15'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(u1)}`)
      .send({ ftp_username: 'ftp15', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    const res = await request(app).delete(`/api/ftp/${id}`)
      .set('Authorization', `Bearer ${makeToken(u2)}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for already deactivated account', async () => {
    const user = await createUser({ username: 'ftpapi17', email: 'ftpapi17@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi17'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp17', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    await request(app).delete(`/api/ftp/${id}`).set('Authorization', `Bearer ${makeToken(user)}`);
    const res2 = await request(app).delete(`/api/ftp/${id}`)
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res2.status).toBe(404);
  });
});
