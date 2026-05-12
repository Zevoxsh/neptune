require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { clearTables, createUser } = require('./helpers/db');
const {
  createFtpAccount, listFtpAccounts, getFtpAccountById, changeFtpPassword, deactivateFtpAccount,
} = require('../src/services/ftp');

jest.mock('../src/system/ftp', () => ({
  addFtpUser: jest.fn().mockResolvedValue(undefined),
  deleteFtpUser: jest.fn().mockResolvedValue(undefined),
  changeFtpPassword: jest.fn().mockResolvedValue(undefined),
}));

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-ftp-svc-'));
  process.env.NEPTUNE_SITES_ROOT = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => clearTables());

describe('createFtpAccount', () => {
  it('inserts an FTP account in DB and returns it', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    await fs.mkdir(path.join(tmpDir, 'alice'), { recursive: true });
    const account = await createFtpAccount({
      userId: user.id, ftpUsername: 'alice_ftp', password: 'password123', homeDir: '.',
    });
    expect(account.id).toBeDefined();
    expect(account.ftp_username).toBe('alice_ftp');
    expect(account.user_id).toBe(user.id);
    expect(account.is_active).toBe(1);
  });

  it('throws WEAK_PASSWORD for passwords shorter than 8 characters', async () => {
    const user = await createUser({ username: 'bob', email: 'bob@t.com' });
    await expect(createFtpAccount({
      userId: user.id, ftpUsername: 'bob_ftp', password: 'short', homeDir: '.',
    })).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  });

  it('throws INVALID_FTP_USERNAME for usernames with invalid characters', async () => {
    const user = await createUser({ username: 'carol', email: 'carol@t.com' });
    await expect(createFtpAccount({
      userId: user.id, ftpUsername: 'bad user!', password: 'password123', homeDir: '.',
    })).rejects.toMatchObject({ code: 'INVALID_FTP_USERNAME' });
  });

  it('throws PATH_TRAVERSAL for homeDir escaping user root', async () => {
    const user = await createUser({ username: 'dave', email: 'dave@t.com' });
    await expect(createFtpAccount({
      userId: user.id, ftpUsername: 'dave_ftp', password: 'password123', homeDir: '../../etc',
    })).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
  });
});

describe('listFtpAccounts', () => {
  it('admin sees all active accounts', async () => {
    const admin = await createUser({ role: 'admin', username: 'adm', email: 'adm@t.com' });
    const u1 = await createUser({ username: 'u1lst', email: 'u1lst@t.com' });
    await fs.mkdir(path.join(tmpDir, 'u1lst'), { recursive: true });
    await createFtpAccount({ userId: u1.id, ftpUsername: 'u1lst_ftp', password: 'password123', homeDir: '.' });
    const accounts = await listFtpAccounts({ requestingUserId: admin.id, requestingRole: 'admin' });
    expect(accounts.length).toBeGreaterThanOrEqual(1);
  });

  it('user sees only their own accounts', async () => {
    const u1 = await createUser({ username: 'u1own', email: 'u1own@t.com' });
    const u2 = await createUser({ username: 'u2own', email: 'u2own@t.com' });
    for (const u of [u1, u2]) {
      await fs.mkdir(path.join(tmpDir, u.username), { recursive: true });
    }
    await createFtpAccount({ userId: u1.id, ftpUsername: 'u1own_ftp', password: 'password123', homeDir: '.' });
    await createFtpAccount({ userId: u2.id, ftpUsername: 'u2own_ftp', password: 'password123', homeDir: '.' });
    const accounts = await listFtpAccounts({ requestingUserId: u1.id, requestingRole: 'user' });
    expect(accounts.every(a => a.user_id === u1.id)).toBe(true);
    expect(accounts.some(a => a.ftp_username === 'u1own_ftp')).toBe(true);
  });
});

describe('deactivateFtpAccount', () => {
  it('sets is_active to 0', async () => {
    const user = await createUser({ username: 'eve', email: 'eve@t.com' });
    await fs.mkdir(path.join(tmpDir, 'eve'), { recursive: true });
    const account = await createFtpAccount({
      userId: user.id, ftpUsername: 'eve_ftp', password: 'password123', homeDir: '.',
    });
    await deactivateFtpAccount(account.id);
    const fetched = await getFtpAccountById(account.id);
    expect(fetched.is_active).toBe(0);
  });
});

describe('changeFtpPassword', () => {
  it('updates ftp_password_hash in DB', async () => {
    const user = await createUser({ username: 'frank', email: 'frank@t.com' });
    await fs.mkdir(path.join(tmpDir, 'frank'), { recursive: true });
    const account = await createFtpAccount({
      userId: user.id, ftpUsername: 'frank_ftp', password: 'password123', homeDir: '.',
    });
    const before = await getFtpAccountById(account.id);
    await changeFtpPassword(account.id, 'newpassword');
    const after = await getFtpAccountById(account.id);
    expect(after.ftp_password_hash).not.toBe(before.ftp_password_hash);
  });

  it('throws WEAK_PASSWORD for short passwords', async () => {
    const user = await createUser({ username: 'grace', email: 'grace@t.com' });
    await fs.mkdir(path.join(tmpDir, 'grace'), { recursive: true });
    const account = await createFtpAccount({
      userId: user.id, ftpUsername: 'grace_ftp', password: 'password123', homeDir: '.',
    });
    await expect(changeFtpPassword(account.id, 'weak')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  });
});
