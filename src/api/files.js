const router = require('express').Router();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const audit = require('../services/audit');
const fileService = require('../services/files');
const archive = require('../system/archive');
const { getUserById } = require('../services/users');

function tmpDir() { return process.env.NEPTUNE_TMP_DIR || os.tmpdir(); }

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tmpDir()),
    filename: (req, file, cb) => cb(null, randomUUID()),
  }),
});

async function getUserAndRoot(req) {
  const user = await getUserById(req.user.id);
  const root = fileService.getUserRoot({ role: req.user.role, username: user.username });
  return { user, root };
}

// GET /api/files — list directory
router.get('/', requireAuth, async (req, res) => {
  try {
    const { root } = await getUserAndRoot(req);
    const userPath = req.query.path || '/';
    const absPath = await fileService.resolveSafe(root, userPath);
    const entries = await fileService.listDir(absPath);
    res.json({ entries });
  } catch (err) {
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'ENOTDIR') return res.status(400).json({ error: 'Not a directory' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/download — stream file download
router.get('/download', requireAuth, async (req, res) => {
  try {
    const { root } = await getUserAndRoot(req);
    const userPath = req.query.path;
    if (!userPath) return res.status(400).json({ error: 'path required' });
    const absPath = await fileService.resolveSafe(root, userPath);
    res.download(absPath);
  } catch (err) {
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/upload — multer streams to tmp, then moves to dest
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const tmpPath = req.file.path;
  try {
    const { root } = await getUserAndRoot(req);
    const userPath = req.query.path || '/';
    const dir = await fileService.resolveSafe(root, userPath);
    const destPath = path.join(dir, req.file.originalname);
    try {
      await fs.rename(tmpPath, destPath);
    } catch (renameErr) {
      if (renameErr.code === 'EXDEV') {
        await fs.copyFile(tmpPath, destPath);
        await fs.unlink(tmpPath);
      } else {
        throw renameErr;
      }
    }
    await audit.log({ userId: req.user.id, action: 'upload_file', targetType: 'file', targetId: null, ip: req.ip, details: { path: destPath } }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true, name: req.file.originalname, size: req.file.size });
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Directory not found' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/mkdir
router.post('/mkdir', requireAuth, async (req, res) => {
  const { path: userPath } = req.body;
  if (!userPath) return res.status(400).json({ error: 'path required' });
  try {
    const { root } = await getUserAndRoot(req);
    const absPath = await fileService.resolveSafe(root, userPath);
    await fileService.makeDir(absPath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/rename
router.post('/rename', requireAuth, async (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    const { root } = await getUserAndRoot(req);
    const absSrc = await fileService.resolveSafe(root, from);
    const absDest = await fileService.resolveSafe(root, to);
    await fileService.renameEntry(absSrc, absDest);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/copy
router.post('/copy', requireAuth, async (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    const { root } = await getUserAndRoot(req);
    const absSrc = await fileService.resolveSafe(root, from);
    const absDest = await fileService.resolveSafe(root, to);
    await fileService.copyEntry(absSrc, absDest);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/files
router.delete('/', requireAuth, async (req, res) => {
  const userPath = req.query.path;
  if (!userPath) return res.status(400).json({ error: 'path required' });
  try {
    const { root } = await getUserAndRoot(req);
    const absPath = await fileService.resolveSafe(root, userPath);
    await fileService.deleteEntry(absPath);
    await audit.log({ userId: req.user.id, action: 'delete_file', targetType: 'file', targetId: null, ip: req.ip, details: { path: absPath } }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/archive
router.post('/archive', requireAuth, async (req, res) => {
  const { paths, dest } = req.body;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths array required' });
  }
  if (!dest) return res.status(400).json({ error: 'dest required' });
  try {
    const { root } = await getUserAndRoot(req);
    const absPaths = await Promise.all(paths.map(p => fileService.resolveSafe(root, p)));
    const absDest = await fileService.resolveSafe(root, dest);
    await archive.createZip(absPaths, absDest);
    res.json({ ok: true, dest });
  } catch (err) {
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/extract
router.post('/extract', requireAuth, async (req, res) => {
  const { src, dest } = req.body;
  if (!src || !dest) return res.status(400).json({ error: 'src and dest required' });
  try {
    const { root } = await getUserAndRoot(req);
    const absSrc = await fileService.resolveSafe(root, src);
    const absDest = await fileService.resolveSafe(root, dest);
    await archive.extractZip(absSrc, absDest);
    res.json({ ok: true, dest });
  } catch (err) {
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'Path traversal detected' });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'ZIP_SLIP') return res.status(400).json({ error: 'Invalid archive entry' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
