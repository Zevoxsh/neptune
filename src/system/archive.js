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
    output.on('error', reject);
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
  const safeDest = path.resolve(absDestDir);
  await fs.mkdir(safeDest, { recursive: true });
  const directory = await unzipper.Open.file(absSrcZip);
  for (const file of directory.files) {
    // Reject symlink entries — Unix mode bits 0xA000 encode a symlink
    const unixMode = (file.externalFileAttributes >> 16) & 0xFFFF;
    if ((unixMode & 0xF000) === 0xA000) {
      throw Object.assign(new Error(`Symlink entry rejected: ${file.path}`), { code: 'ZIP_SLIP' });
    }
    const destPath = path.resolve(safeDest, file.path);
    if (destPath !== safeDest && !destPath.startsWith(safeDest + path.sep)) {
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
