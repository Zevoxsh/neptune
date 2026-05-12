require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { clearTables, createUser } = require('./helpers/db');

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-files-api-'));
  process.env.NEPTUNE_SITES_ROOT = tmpDir;
  process.env.NEPTUNE_TMP_DIR = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => clearTables());

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

async function setupUserDir(username) {
  const dir = path.join(tmpDir, username);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('GET /api/files', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/files');
    expect(res.status).toBe(401);
  });

  it('lists files in user root directory', async () => {
    const user = await createUser({ username: 'uf1', email: 'uf1@t.com' });
    const userDir = await setupUserDir('uf1');
    await fs.writeFile(path.join(userDir, 'hello.txt'), 'hi');
    const res = await request(app).get('/api/files').set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.map(e => e.name)).toContain('hello.txt');
  });

  it('returns 400 for path traversal', async () => {
    const user = await createUser({ username: 'uf2', email: 'uf2@t.com' });
    await setupUserDir('uf2');
    const res = await request(app)
      .get('/api/files?path=../../etc')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(400);
  });

  it('admin lists from sites root', async () => {
    const admin = await createUser({ role: 'admin', username: 'adm', email: 'adm@t.com' });
    const res = await request(app).get('/api/files').set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });
});

describe('POST /api/files/mkdir', () => {
  it('creates a directory', async () => {
    const user = await createUser({ username: 'uf3', email: 'uf3@t.com' });
    const userDir = await setupUserDir('uf3');
    const res = await request(app).post('/api/files/mkdir')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ path: 'newsubdir' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((await fs.stat(path.join(userDir, 'newsubdir'))).isDirectory()).toBe(true);
  });

  it('returns 400 without path', async () => {
    const user = await createUser({ username: 'uf3b', email: 'uf3b@t.com' });
    await setupUserDir('uf3b');
    const res = await request(app).post('/api/files/mkdir')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/upload', () => {
  it('uploads a file to user root', async () => {
    const user = await createUser({ username: 'uf4', email: 'uf4@t.com' });
    const userDir = await setupUserDir('uf4');
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .attach('file', Buffer.from('file contents'), 'uploaded.txt');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('uploaded.txt');
    expect(await fs.readFile(path.join(userDir, 'uploaded.txt'), 'utf8')).toBe('file contents');
  });

  it('returns 400 without a file', async () => {
    const user = await createUser({ username: 'uf4b', email: 'uf4b@t.com' });
    await setupUserDir('uf4b');
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/files/download', () => {
  it('downloads a file', async () => {
    const user = await createUser({ username: 'uf5', email: 'uf5@t.com' });
    const userDir = await setupUserDir('uf5');
    await fs.writeFile(path.join(userDir, 'get-me.txt'), 'download content');
    const res = await request(app)
      .get('/api/files/download?path=get-me.txt')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('download content');
  });

  it('returns 404 for non-existent file', async () => {
    const user = await createUser({ username: 'uf5b', email: 'uf5b@t.com' });
    await setupUserDir('uf5b');
    const res = await request(app)
      .get('/api/files/download?path=nope.txt')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/files/rename', () => {
  it('renames a file', async () => {
    const user = await createUser({ username: 'uf6', email: 'uf6@t.com' });
    const userDir = await setupUserDir('uf6');
    await fs.writeFile(path.join(userDir, 'old.txt'), 'data');
    const res = await request(app).post('/api/files/rename')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ from: 'old.txt', to: 'new.txt' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    await expect(fs.access(path.join(userDir, 'new.txt'))).resolves.not.toThrow();
    await expect(fs.access(path.join(userDir, 'old.txt'))).rejects.toThrow();
  });

  it('returns 400 without from/to', async () => {
    const user = await createUser({ username: 'uf6b', email: 'uf6b@t.com' });
    await setupUserDir('uf6b');
    const res = await request(app).post('/api/files/rename')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ from: 'old.txt' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/copy', () => {
  it('copies a file', async () => {
    const user = await createUser({ username: 'uf7', email: 'uf7@t.com' });
    const userDir = await setupUserDir('uf7');
    await fs.writeFile(path.join(userDir, 'original.txt'), 'copy me');
    const res = await request(app).post('/api/files/copy')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ from: 'original.txt', to: 'copy.txt' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await fs.readFile(path.join(userDir, 'copy.txt'), 'utf8')).toBe('copy me');
    await expect(fs.access(path.join(userDir, 'original.txt'))).resolves.not.toThrow();
  });
});

describe('DELETE /api/files', () => {
  it('deletes a file', async () => {
    const user = await createUser({ username: 'uf8', email: 'uf8@t.com' });
    const userDir = await setupUserDir('uf8');
    await fs.writeFile(path.join(userDir, 'todelete.txt'), 'bye');
    const res = await request(app)
      .delete('/api/files?path=todelete.txt')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    await expect(fs.access(path.join(userDir, 'todelete.txt'))).rejects.toThrow();
  });

  it('returns 400 without path', async () => {
    const user = await createUser({ username: 'uf8b', email: 'uf8b@t.com' });
    await setupUserDir('uf8b');
    const res = await request(app).delete('/api/files').set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/archive', () => {
  it('creates a zip archive from files', async () => {
    const user = await createUser({ username: 'uf9', email: 'uf9@t.com' });
    const userDir = await setupUserDir('uf9');
    await fs.writeFile(path.join(userDir, 'tozip.txt'), 'zip me');
    const res = await request(app).post('/api/files/archive')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ paths: ['tozip.txt'], dest: 'output.zip' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((await fs.stat(path.join(userDir, 'output.zip'))).size).toBeGreaterThan(0);
  });

  it('returns 400 without paths array', async () => {
    const user = await createUser({ username: 'uf9b', email: 'uf9b@t.com' });
    await setupUserDir('uf9b');
    const res = await request(app).post('/api/files/archive')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ dest: 'output.zip' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/extract', () => {
  it('extracts a zip archive', async () => {
    const user = await createUser({ username: 'uf10', email: 'uf10@t.com' });
    const userDir = await setupUserDir('uf10');
    await fs.writeFile(path.join(userDir, 'toextract.txt'), 'extract me');
    await request(app).post('/api/files/archive')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ paths: ['toextract.txt'], dest: 'bundle.zip' });
    const res = await request(app).post('/api/files/extract')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ src: 'bundle.zip', dest: 'extracted' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((await fs.stat(path.join(userDir, 'extracted'))).isDirectory()).toBe(true);
  });

  it('returns 400 without src/dest', async () => {
    const user = await createUser({ username: 'uf10b', email: 'uf10b@t.com' });
    await setupUserDir('uf10b');
    const res = await request(app).post('/api/files/extract')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ src: 'bundle.zip' });
    expect(res.status).toBe(400);
  });
});
