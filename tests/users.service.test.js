require('dotenv').config();
const { createUser, getUserById, listUsers, updateUser, changePassword, getClientPermissions, setClientPermissions } = require('../src/services/users');
const pool = require('../src/db/index');
const { clearTables } = require('./helpers/db');

beforeEach(() => clearTables());

describe('users service', () => {
  it('createUser inserts and returns user without password_hash', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com', password: 'pass1234', role: 'user' });
    expect(user.id).toBeDefined();
    expect(user.username).toBe('alice');
    expect(user.role).toBe('user');
    expect(user.password_hash).toBeUndefined();
    expect(user.disk_quota_mb).toBe(5120);
  });

  it('getUserById returns null for unknown id', async () => {
    const result = await getUserById(99999);
    expect(result).toBeNull();
  });

  it('listUsers as admin returns all users', async () => {
    await createUser({ username: 'a', email: 'a@t.com', password: 'p', role: 'admin' });
    await createUser({ username: 'b', email: 'b@t.com', password: 'p', role: 'user' });
    const list = await listUsers({ requestingRole: 'admin', requestingUserId: 1 });
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('listUsers as user returns only their clients', async () => {
    const user = await createUser({ username: 'u', email: 'u@t.com', password: 'p', role: 'user' });
    const client = await createUser({ username: 'c', email: 'c@t.com', password: 'p', role: 'client', parentId: user.id });
    const other = await createUser({ username: 'o', email: 'o@t.com', password: 'p', role: 'user' });
    const list = await listUsers({ requestingRole: 'user', requestingUserId: user.id });
    const ids = list.map(u => u.id);
    expect(ids).toContain(client.id);
    expect(ids).not.toContain(other.id);
  });

  it('updateUser changes only provided fields', async () => {
    const user = await createUser({ username: 'u', email: 'u@t.com', password: 'p', role: 'user' });
    const updated = await updateUser(user.id, { username: 'renamed' });
    expect(updated.username).toBe('renamed');
    expect(updated.email).toBe('u@t.com');
  });

  it('changePassword updates the hash so new password works', async () => {
    const bcrypt = require('bcryptjs');
    const user = await createUser({ username: 'u', email: 'u@t.com', password: 'oldpass', role: 'user' });
    await changePassword(user.id, 'newpass123');
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    const matches = await bcrypt.compare('newpass123', rows[0].password_hash);
    expect(matches).toBe(true);
  });

  it('setClientPermissions stores and getClientPermissions retrieves', async () => {
    const client = await createUser({ username: 'c', email: 'c@t.com', password: 'p', role: 'client' });
    await setClientPermissions(client.id, { allow_subdomain: true, allow_php_version_choice: false });
    const perms = await getClientPermissions(client.id);
    expect(perms.allow_subdomain).toBe(true);
    expect(perms.allow_php_version_choice).toBe(false);
  });

  it('setClientPermissions is idempotent (upsert)', async () => {
    const client = await createUser({ username: 'c', email: 'c@t.com', password: 'p', role: 'client' });
    await setClientPermissions(client.id, { allow_subdomain: true });
    await setClientPermissions(client.id, { allow_subdomain: false });
    const perms = await getClientPermissions(client.id);
    expect(perms.allow_subdomain).toBe(false);
  });
});
