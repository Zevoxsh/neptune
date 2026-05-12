require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const archiver = require('archiver');
const { createZip, extractZip } = require('../src/system/archive');

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-archive-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('createZip', () => {
  it('creates a zip file containing a single file', async () => {
    const srcFile = path.join(tmpDir, 'single.txt');
    await fs.writeFile(srcFile, 'hello zip');
    const dest = path.join(tmpDir, 'single.zip');
    await createZip([srcFile], dest);
    const stat = await fs.stat(dest);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('creates a zip from a directory', async () => {
    const srcDir = path.join(tmpDir, 'zip-dir');
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, 'a.txt'), 'a');
    await fs.writeFile(path.join(srcDir, 'b.txt'), 'b');
    const dest = path.join(tmpDir, 'dir.zip');
    await createZip([srcDir], dest);
    const stat = await fs.stat(dest);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('creates a zip from multiple files', async () => {
    const f1 = path.join(tmpDir, 'multi1.txt');
    const f2 = path.join(tmpDir, 'multi2.txt');
    await fs.writeFile(f1, 'first');
    await fs.writeFile(f2, 'second');
    const dest = path.join(tmpDir, 'multi.zip');
    await createZip([f1, f2], dest);
    const stat = await fs.stat(dest);
    expect(stat.size).toBeGreaterThan(0);
  });
});

describe('extractZip', () => {
  it('extracts a zip file and restores file content', async () => {
    const srcFile = path.join(tmpDir, 'extract-src.txt');
    await fs.writeFile(srcFile, 'extract me');
    const zipPath = path.join(tmpDir, 'extract-test.zip');
    await createZip([srcFile], zipPath);

    const destDir = path.join(tmpDir, 'extract-dest');
    await extractZip(zipPath, destDir);

    const extractedFile = path.join(destDir, 'extract-src.txt');
    const content = await fs.readFile(extractedFile, 'utf8');
    expect(content).toBe('extract me');
  });

  it('creates destDir if it does not exist', async () => {
    const srcFile = path.join(tmpDir, 'mkdir-src.txt');
    await fs.writeFile(srcFile, 'ok');
    const zipPath = path.join(tmpDir, 'mkdir-test.zip');
    await createZip([srcFile], zipPath);

    const destDir = path.join(tmpDir, 'extract-mkdir-dest');
    await extractZip(zipPath, destDir);
    expect((await fs.stat(destDir)).isDirectory()).toBe(true);
  });
});

describe('extractZip security', () => {
  it('throws ZIP_SLIP for entries with path traversal', async () => {
    // Create a zip with a traversal entry name (../evil.txt)
    const maliciousZip = path.join(tmpDir, 'malicious.zip');
    const srcFile = path.join(tmpDir, 'payload.txt');
    await fs.writeFile(srcFile, 'bad');
    await new Promise((resolve, reject) => {
      const output = fsSync.createWriteStream(maliciousZip);
      const arc = archiver('zip');
      output.on('close', resolve);
      output.on('error', reject);
      arc.on('error', reject);
      arc.pipe(output);
      arc.file(srcFile, { name: '../evil.txt' });
      arc.finalize();
    });
    const destDir = path.join(tmpDir, 'safe-dest');
    await fs.mkdir(destDir, { recursive: true });
    await expect(extractZip(maliciousZip, destDir)).rejects.toMatchObject({ code: 'ZIP_SLIP' });
  });
});
