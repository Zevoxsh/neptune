const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const audit = require('../services/audit');
const users = require('../services/users');

const VALID_PERMISSION_KEYS = ['allow_subdomain', 'allow_php_version_choice'];
const VALID_ROLES = ['admin', 'user', 'client'];

function canAccessUser(requester, target) {
  if (requester.role === 'admin') return true;
  if (requester.id === target.id) return true;
  if (requester.role === 'user' && target.parent_id === requester.id) return true;
  return false;
}

function parseId(param) {
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/users
router.get('/', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  try {
    const list = await users.listUsers({ requestingUserId: req.user.id, requestingRole: req.user.role });
    res.json({ users: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id
router.get('/:id', requireAuth, async (req, res) => {
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAccessUser(req.user, target)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ user: target });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users
router.post('/', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const { username, email, password, role, disk_quota_mb } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'username, email, password, role required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (req.user.role === 'user' && role !== 'client') {
    return res.status(403).json({ error: 'Users can only create client accounts' });
  }
  const parentId = req.user.role === 'user' ? req.user.id
    : (role === 'client' ? (req.body.parent_id || null) : null);
  try {
    // Validate admin-provided parent_id references an active user-role account
    if (parentId !== null && req.user.role === 'admin') {
      const parent = await users.getUserById(parentId);
      if (!parent || parent.role !== 'user' || !parent.is_active) {
        return res.status(400).json({ error: 'parent_id must reference an active user account' });
      }
    }
    const user = await users.createUser({ username, email, password, role, parentId, diskQuotaMb: disk_quota_mb });
    await audit.log({ userId: req.user.id, action: 'create_user', targetType: 'user', targetId: user.id, ip: req.ip });
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username or email already taken' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id
router.put('/:id', requireAuth, async (req, res) => {
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAccessUser(req.user, target)) return res.status(403).json({ error: 'Forbidden' });
    const { username, email } = req.body;
    const diskQuotaMb = req.user.role === 'admin' ? req.body.disk_quota_mb : undefined;
    if (diskQuotaMb !== undefined && (!Number.isInteger(diskQuotaMb) || diskQuotaMb <= 0)) {
      return res.status(400).json({ error: 'disk_quota_mb must be a positive integer' });
    }
    const isActive = req.user.role === 'admin' ? req.body.is_active : undefined;
    const updated = await users.updateUser(targetId, { username, email, diskQuotaMb, isActive });
    await audit.log({ userId: req.user.id, action: 'update_user', targetType: 'user', targetId, ip: req.ip });
    res.json({ user: updated });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username or email already taken' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id — soft delete (deactivate)
router.delete('/:id', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Invalid id' });
  if (req.user.id === targetId) return res.status(400).json({ error: 'Cannot deactivate yourself' });
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAccessUser(req.user, target)) return res.status(403).json({ error: 'Forbidden' });
    await users.updateUser(targetId, { isActive: false });
    await audit.log({ userId: req.user.id, action: 'deactivate_user', targetType: 'user', targetId, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/:id/password
router.post('/:id/password', requireAuth, async (req, res) => {
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Invalid id' });
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'new_password must be at least 8 characters' });
  }
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAccessUser(req.user, target)) return res.status(403).json({ error: 'Forbidden' });
    await users.changePassword(targetId, new_password);
    await audit.log({ userId: req.user.id, action: 'change_password', targetType: 'user', targetId, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id/permissions
router.get('/:id/permissions', requireAuth, async (req, res) => {
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role !== 'client') return res.status(400).json({ error: 'Permissions only apply to client accounts' });
    // canAccessUser not used: clients must not read their own permissions (only admin/parent-user may)
    if (req.user.role !== 'admin' && !(req.user.role === 'user' && target.parent_id === req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const perms = await users.getClientPermissions(targetId);
    res.json({ permissions: perms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/permissions
router.put('/:id/permissions', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Invalid id' });
  const { permissions } = req.body;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return res.status(400).json({ error: 'permissions object required' });
  }
  const invalid = Object.keys(permissions).filter(k => !VALID_PERMISSION_KEYS.includes(k));
  if (invalid.length) return res.status(400).json({ error: `Unknown permission keys: ${invalid.join(', ')}` });
  try {
    const target = await users.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role !== 'client') return res.status(400).json({ error: 'Permissions only apply to client accounts' });
    // canAccessUser not used: clients must not write their own permissions (only admin/parent-user may)
    if (req.user.role === 'user' && target.parent_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const updated = await users.setClientPermissions(targetId, permissions);
    await audit.log({ userId: req.user.id, action: 'set_client_permissions', targetType: 'user', targetId, ip: req.ip });
    res.json({ permissions: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
