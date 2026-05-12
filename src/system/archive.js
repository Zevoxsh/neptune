const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const archiver = require('archiver');
const unzipper = require('unzipper');

async function createZip(absPaths, absDestZip) {
  await fs.mkdir(path.dirname(absDestZip), { recursive: true });
  const entries = await Promise.all(
    absPaths.map(async (p) => ({ p, isDir: (await fs.stat(p)).isDirectory() }))
  );
  await new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(absDestZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const { p, isDir } of entries) {
      if (isDir) {
        archive.directory(p, path.basename(p));
      } else {
        archive.file(p, { name: path.basename(p) });
      }
    }
    archive.finalize();
  });
}

async function extractZip(absSrcZip, absDestDir) {
  await fs.mkdir(absDestDir, { recursive: true });
  const directory = await unzipper.Open.file(absSrcZip);
  for (const file of directory.files) {
    const destPath = path.resolve(absDestDir, file.path);
    if (destPath !== absDestDir && !destPath.startsWith(absDestDir + path.sep)) {
      throw Object.assign(new Error(`Zip-slip detected: ${file.path}`), { code: 'ZIP_SLIP' });
    }
    if (file.type === 'Directory') {
      await fs.mkdir(destPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await new Promise((resolve, reject) => {
        file.stream()
          .pipe(fsSync.createWriteStream(destPath))
          .on('finish', resolve)
          .on('error', reject);
      });
    }
  }
}

module.exports = { createZip, extractZip };
