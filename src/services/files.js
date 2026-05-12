const fs = require('fs/promises');
const path = require('path');

function sitesRoot() { return process.env.NEPTUNE_SITES_ROOT || '/var/www/neptune'; }

function getUserRoot(user) {
  if (user.role === 'admin') return sitesRoot();
  return path.join(sitesRoot(), user.username);
}

async function resolveSafe(root, userPath) {
  const joined = path.join(root, userPath);
  const resolved = await fs.realpath(joined).catch(() => path.resolve(joined));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw Object.assign(new Error('Path traversal detected'), { code: 'PATH_TRAVERSAL' });
  }
  return resolved;
}

async function listDir(absPath) {
  const entries = await fs.readdir(absPath, { withFileTypes: true });
  return Promise.all(entries.map(async (ent) => {
    const stat = await fs.stat(path.join(absPath, ent.name));
    return {
      name: ent.name,
      type: ent.isDirectory() ? 'dir' : 'file',
      size: stat.size,
      mtime: stat.mtime,
    };
  }));
}

async function deleteEntry(absPath) {
  await fs.rm(absPath, { recursive: true, force: true });
}

async function renameEntry(absSrc, absDest) {
  await fs.rename(absSrc, absDest);
}

async function copyEntry(absSrc, absDest) {
  await fs.cp(absSrc, absDest, { recursive: true });
}

async function makeDir(absPath) {
  await fs.mkdir(absPath, { recursive: true });
}

module.exports = { getUserRoot, resolveSafe, listDir, deleteEntry, renameEntry, copyEntry, makeDir };
