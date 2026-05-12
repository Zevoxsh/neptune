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
  process.env.NEPTUNE_CERTBOT_EMAIL = 'admin@test.com';
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
    expect(runCertbot).toHaveBeenCalledWith('example.com', domain.document_root, expect.any(String));
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
