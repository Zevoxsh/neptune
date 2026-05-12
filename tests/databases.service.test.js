require('dotenv').config();
const { clearTables, createUser } = require('./helpers/db');
const {
  createDatabase, listDatabases, getDatabaseById, resetDatabasePassword, dropDatabase,
} = require('../src/services/databases');

jest.mock('../src/system/mysql', () => ({
  createDatabase: jest.fn().mockResolvedValue(undefined),
  dropDatabase: jest.fn().mockResolvedValue(undefined),
  changePassword: jest.fn().mockResolvedValue(undefined),
  getDatabaseSizeMb: jest.fn().mockResolvedValue(0),
}));

beforeEach(() => clearTables());

describe('createDatabase', () => {
  it('inserts a database record and returns it with a 32-char plaintext password', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const { database, password } = await createDatabase({ userId: user.id, name: 'mydb' });
    expect(database.id).toBeDefined();
    expect(database.db_name).toBe('alice_mydb');
    expect(database.db_user).toBe('alice_mydb');
    expect(database.user_id).toBe(user.id);
    expect(password).toHaveLength(32);
    expect(database.db_password_hash).toBeUndefined();
  });

  it('throws INVALID_DB_NAME for names with spaces or special chars', async () => {
    const user = await createUser({ username: 'bob', email: 'bob@t.com' });
    await expect(createDatabase({ userId: user.id, name: 'bad name!' }))
      .rejects.toMatchObject({ code: 'INVALID_DB_NAME' });
  });

  it('throws NOT_FOUND for a non-existent userId', async () => {
    await expect(createDatabase({ userId: 999999, name: 'mydb' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws DB_NAME_TOO_LONG when username + name exceeds 64 chars', async () => {
    const user = await createUser({ username: 'a'.repeat(33), email: 'long@t.com' });
    await expect(createDatabase({ userId: user.id, name: 'b'.repeat(32) }))
      .rejects.toMatchObject({ code: 'DB_NAME_TOO_LONG' });
  });
});

describe('listDatabases', () => {
  it('admin sees all databases', async () => {
    const admin = await createUser({ role: 'admin', username: 'adm', email: 'adm@t.com' });
    const u1 = await createUser({ username: 'u1lst', email: 'u1lst@t.com' });
    await createDatabase({ userId: u1.id, name: 'site1' });
    const list = await listDatabases({ requestingUserId: admin.id, requestingRole: 'admin' });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('user sees only their own databases', async () => {
    const u1 = await createUser({ username: 'u1own', email: 'u1own@t.com' });
    const u2 = await createUser({ username: 'u2own', email: 'u2own@t.com' });
    await createDatabase({ userId: u1.id, name: 'siteA' });
    await createDatabase({ userId: u2.id, name: 'siteB' });
    const list = await listDatabases({ requestingUserId: u1.id, requestingRole: 'user' });
    expect(list.every(d => d.user_id === u1.id)).toBe(true);
    expect(list.some(d => d.db_name === 'u1own_siteA')).toBe(true);
  });
});

describe('getDatabaseById', () => {
  it('returns null for a non-existent id', async () => {
    const result = await getDatabaseById(999999);
    expect(result).toBeNull();
  });
});

describe('resetDatabasePassword', () => {
  it('returns a new plaintext password and calls changePassword', async () => {
    const user = await createUser({ username: 'frank', email: 'frank@t.com' });
    const { database } = await createDatabase({ userId: user.id, name: 'testdb' });
    const { password: newPassword } = await resetDatabasePassword(database.id);
    expect(newPassword).toHaveLength(32);
    const mysql = require('../src/system/mysql');
    expect(mysql.changePassword).toHaveBeenCalledWith(database.db_user, newPassword);
  });

  it('throws NOT_FOUND for a non-existent id', async () => {
    await expect(resetDatabasePassword(999999))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('dropDatabase', () => {
  it('removes the database record', async () => {
    const user = await createUser({ username: 'eve', email: 'eve@t.com' });
    const { database } = await createDatabase({ userId: user.id, name: 'todelete' });
    await dropDatabase(database.id);
    const result = await getDatabaseById(database.id);
    expect(result).toBeNull();
  });

  it('throws NOT_FOUND for a non-existent id', async () => {
    await expect(dropDatabase(999999))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
