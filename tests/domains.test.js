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
