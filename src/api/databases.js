const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const audit = require('../services/audit');
const dbService = require('../services/databases');

function parseId(param) {
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function canAccessDatabase(requester, db) {
  if (requester.role === 'admin') return true;
  return db.user_id === requester.id;
}

// GET /api/databases
router.get('/', requireAuth, async (req, res) => {
  try {
    const databases = await dbService.listDatabases({ requestingUserId: req.user.id, requestingRole: req.user.role });
    res.json({ databases });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/databases
router.post('/', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { database, password } = await dbService.createDatabase({ userId: req.user.id, name });
    await audit.log({ userId: req.user.id, action: 'create_database', targetType: 'database', targetId: database.id, ip: req.ip }).catch(e => console.error('audit failure:', e));
    // database is safe: DB_FIELDS excludes db_password_hash
    res.status(201).json({ database, password });
  } catch (err) {
    if (err.code === 'INVALID_DB_NAME') return res.status(400).json({ error: 'Invalid database name' });
    if (err.code === 'DB_NAME_TOO_LONG') return res.status(400).json({ error: 'Database name too long' });
    if (err.code === 'ER_DB_CREATE_EXISTS') return res.status(409).json({ error: 'Database already exists' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/databases/:id
router.get('/:id', requireAuth, async (req, res) => {
  const dbId = parseId(req.params.id);
  if (dbId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const database = await dbService.getDatabaseById(dbId);
    if (!database) return res.status(404).json({ error: 'Database not found' });
    if (!canAccessDatabase(req.user, database)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ database });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/databases/:id/password
router.put('/:id/password', requireAuth, async (req, res) => {
  const dbId = parseId(req.params.id);
  if (dbId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const database = await dbService.getDatabaseById(dbId);
    if (!database) return res.status(404).json({ error: 'Database not found' });
    if (!canAccessDatabase(req.user, database)) return res.status(403).json({ error: 'Forbidden' });
    const { password } = await dbService.resetDatabasePassword(dbId);
    await audit.log({ userId: req.user.id, action: 'reset_db_password', targetType: 'database', targetId: dbId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true, password });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/databases/:id
router.delete('/:id', requireAuth, requireRole('admin', 'user'), async (req, res) => {
  const dbId = parseId(req.params.id);
  if (dbId === null) return res.status(400).json({ error: 'Invalid id' });
  try {
    const database = await dbService.getDatabaseById(dbId);
    if (!database) return res.status(404).json({ error: 'Database not found' });
    if (!canAccessDatabase(req.user, database)) return res.status(403).json({ error: 'Forbidden' });
    await dbService.dropDatabase(dbId);
    await audit.log({ userId: req.user.id, action: 'delete_database', targetType: 'database', targetId: dbId, ip: req.ip }).catch(e => console.error('audit failure:', e));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
