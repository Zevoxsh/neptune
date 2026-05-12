const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const audit = require('../services/audit');
const ftpService = require('../services/ftp');

function parseId(param) {
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function canAccessFtpAccount(requester, account) {
  if (requester.role === 'admin') return true;
  return account.user_id === requester.id;
}

// GET /api/ftp
router.get('/', requireAuth, async (req, res) => {
  try {
    const accounts = await ftpService.listFtpAccounts({ requestingUserId: req.user.id, requestingRole: req.user.role });
    res.json({ accounts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ftp
router.post('/', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const { ftp_username, password, home_dir } = req.body;
  if (!ftp_username || !password || !home_dir) {
    return res.status(400).json({ error: 'ftp_username, password, and home_dir required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(ftp_username)) {
    return res.status(400).json({ error: 'Invalid ftp_username' });
  }
  try {
    const account = await ftpService.createFtpAccount({
      userId: req.user.id,
      ftpUsername: ftp_username,
      password,
      homeDir: home_dir,
    });
    await audit.log({ userId: req.user.id, action: 'create_ftp_account', targetType: 'ftp_account', targetId: account.id, ip: req.ip }).catch(e => console.error('audit failure:', e));
    const { ftp_password_hash: _, ...safeAccount } = account;
    res.status(201).json({ account: safeAccount });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'FTP username already exists' });
    if (err.code === 'PATH_TRAVERSAL') return res.status(400).json({ error: 'home_dir is outside your root' });
    if (err.code === 'INVALID_FTP_USERNAME') return res.status(400).json({ error: 'Invalid ftp_username' });
    if (err.code === 'WEAK_PASSWORD') return res.status(400).json({ error: 'Password must be at least 8 characters' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/ftp/:id/password
router.put('/:id/password', requireAuth, async (req, res) => {
  const accountId = parseId(req.params.id);
  if (accountId === null) return res.status(400).json({ error: 'Invalid id' });
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const account = await ftpService.getFtpAccountById(accountId);
    if (!account || !account.is_active) return res.status(404).json({ error: 'FTP account not found' });
    if (!canAccessFtpAccount(req.user, account)) return res.status(403).json({ error: 'Forbidden' });
    await ftpService.changeFtpPassword(accountId, password);
    await audit.log({ userId: req.user.id, action: 'change_ftp_password', targetType: 'ftp_account', targetId: accountId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'WEAK_PASSWORD') return res.status(400).json({ error: 'Password must be at least 8 characters' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/ftp/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const accountId = parseId(req.params.id);
  if (accountId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const account = await ftpService.getFtpAccountById(accountId);
    if (!account || !account.is_active) return res.status(404).json({ error: 'FTP account not found' });
    if (!canAccessFtpAccount(req.user, account)) return res.status(403).json({ error: 'Forbidden' });
    await ftpService.deactivateFtpAccount(accountId);
    await audit.log({ userId: req.user.id, action: 'delete_ftp_account', targetType: 'ftp_account', targetId: accountId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
