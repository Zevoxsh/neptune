require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { getUserRoot, resolveSafe, listDir, deleteEntry, renameEntry, copyEntry, makeDir } = require('../src/services/files');

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-files-svc-'));
  process.env.NEPTUNE_SITES_ROOT = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getUserRoot', () => {
  it('returns sitesRoot for admin', () => {
    expect(getUserRoot({ role: 'admin', username: 'admin' })).toBe(tmpDir);
  });

  it('returns sitesRoot/username for user', () => {
    expect(getUserRoot({ role: 'user', username: 'alice' })).toBe(path.join(tmpDir, 'alice'));
  });

  it('returns sitesRoot/username for client', () => {
    expect(getUserRoot({ role: 'client', username: 'bob' })).toBe(path.join(tmpDir, 'bob'));
  });
});

describe('resolveSafe', () => {
  it('returns absolute path for valid subpath', async () => {
    const result = await resolveSafe(tmpDir, 'subdir');
    expect(result).toBe(path.join(tmpDir, 'subdir'));
  });

  it('resolves root itself (path = .)', async () => {
    const result = await resolveSafe(tmpDir, '.');
    expect(result).toBe(tmpDir);
  });

  it('throws PATH_TRAVERSAL for paths escaping root', async () => {
    await expect(resolveSafe(tmpDir, '../../etc/passwd')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
  });
});

describe('listDir', () => {
  it('lists files and directories with type, size, mtime', async () => {
    const dir = path.join(tmpDir, 'list-test');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'hello.txt'), 'hello');
    await fs.mkdir(path.join(dir, 'subdir'));
    const entries = await listDir(dir);
    const file = entries.find(e => e.name === 'hello.txt');
    const sub = entries.find(e => e.name === 'subdir');
    expect(file.type).toBe('file');
    expect(file.size).toBe(5);
    expect(file.mtime).toBeInstanceOf(Date);
    expect(sub.type).toBe('dir');
  });
});

describe('deleteEntry', () => {
  it('deletes a file', async () => {
    const file = path.join(tmpDir, 'del-me.txt');
    await fs.writeFile(file, 'x');
    await deleteEntry(file);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('deletes a directory recursively', async () => {
    const dir = path.join(tmpDir, 'del-dir');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'f.txt'), 'x');
    await deleteEntry(dir);
    await expect(fs.access(dir)).rejects.toThrow();
  });

  it('does not throw for non-existent path', async () => {
    await expect(deleteEntry(path.join(tmpDir, 'nope.txt'))).resolves.not.toThrow();
  });
});

describe('renameEntry', () => {
  it('renames a file', async () => {
    const src = path.join(tmpDir, 'rename-src.txt');
    const dest = path.join(tmpDir, 'rename-dest.txt');
    await fs.writeFile(src, 'data');
    await renameEntry(src, dest);
    await expect(fs.access(src)).rejects.toThrow();
    expect(await fs.readFile(dest, 'utf8')).toBe('data');
  });
});

describe('copyEntry', () => {
  it('copies a file', async () => {
    const src = path.join(tmpDir, 'copy-src.txt');
    const dest = path.join(tmpDir, 'copy-dest.txt');
    await fs.writeFile(src, 'copied');
    await copyEntry(src, dest);
    expect(await fs.readFile(dest, 'utf8')).toBe('copied');
  });

  it('copies a directory recursively', async () => {
    const src = path.join(tmpDir, 'copy-dir-src');
    const dest = path.join(tmpDir, 'copy-dir-dest');
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, 'inner.txt'), 'nested');
    await copyEntry(src, dest);
    expect(await fs.readFile(path.join(dest, 'inner.txt'), 'utf8')).toBe('nested');
  });
});

describe('makeDir', () => {
  it('creates a directory', async () => {
    const dir = path.join(tmpDir, 'new-dir');
    await makeDir(dir);
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
  });

  it('does not throw if directory already exists', async () => {
    const dir = path.join(tmpDir, 'existing-dir');
    await fs.mkdir(dir);
    await expect(makeDir(dir)).resolves.not.toThrow();
  });
});
