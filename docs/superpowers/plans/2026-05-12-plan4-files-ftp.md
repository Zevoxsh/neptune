# File Manager + FTP Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file manager REST API (list/upload/download/delete/rename/copy/mkdir/archive/extract) and FTP account management via pure-ftpd virtual users to Neptune.

**Architecture:** Two independent subsystems sharing path-safety logic (`resolveSafe`/`getUserRoot` in `src/services/files.js`). File ops use fs/promises + multer disk storage + archiver/unzipper. FTP accounts persist in DB via `ftp_accounts` table; sudo shell scripts wrap `pure-pw` commands with passwords via stdin.

**Tech Stack:** Node.js, Express 4, fs/promises, multer, archiver, unzipper, child_process (sudo scripts), bcryptjs (already installed), mysql2 (already installed)

**Important — MariaDB not installed on Windows dev machine:** All test run steps in this plan are marked as **SKIP ON WINDOWS DEV**. Write the code and commit, but do not execute `npm test`. Tests must be run on the Linux server.

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/services/files.js` | `getUserRoot`, `resolveSafe`, `listDir`, `deleteEntry`, `renameEntry`, `copyEntry`, `makeDir` |
| `src/system/archive.js` | `createZip` (archiver), `extractZip` (unzipper + zip-slip prevention) |
| `src/system/ftp.js` | Sudo wrappers: `addFtpUser`, `deleteFtpUser`, `changeFtpPassword` — lazy env accessors, passwords via stdin |
| `src/services/ftp.js` | DB CRUD for `ftp_accounts`: `createFtpAccount`, `listFtpAccounts`, `getFtpAccountById`, `changeFtpPassword`, `deactivateFtpAccount` |
| `src/api/files.js` | 9 HTTP endpoints for file manager, multer upload handling |
| `src/api/ftp.js` | 4 HTTP endpoints for FTP account management |
| `src/api/index.js` | Mount `/files` and `/ftp` routers (modify existing) |
| `scripts/neptune-ftp-adduser.sh` | Validate args, `pure-pw useradd`, `pure-pw mkdb` |
| `scripts/neptune-ftp-deluser.sh` | Validate args, `pure-pw userdel`, `pure-pw mkdb` |
| `scripts/neptune-ftp-passwd.sh` | Validate args, `pure-pw passwd`, `pure-pw mkdb` |
| `tests/files.service.test.js` | Unit tests for file service — os.tmpdir() temp dir, no DB |
| `tests/archive.test.js` | Unit tests for archive system — real zip/extract in temp dir |
| `tests/ftp.service.test.js` | Service tests — real DB, mocked `src/system/ftp` |
| `tests/files.test.js` | API integration tests — real DB + real temp filesystem |
| `tests/ftp.test.js` | API integration tests — real DB, mocked `src/system/ftp` |

---

### Task 1: Install packages and create file service

**Files:**
- Modify: `package.json`
- Create: `src/services/files.js`
- Create: `tests/files.service.test.js`

- [ ] **Step 1: Install new npm packages**

```bash
npm install multer archiver unzipper
```

Expected: `multer`, `archiver`, `unzipper` appear under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing tests**

Create `tests/files.service.test.js`:

```js
require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { getUserRoot, resolveSafe, listDir, deleteEntry, renameEntry, copyEntry, makeDir } = require('../src/services/files');

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-files-svc-'));
  process.env.NEPTUNE_SITES_ROOT = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getUserRoot', () => {
  it('returns sitesRoot for admin', () => {
    expect(getUserRoot({ role: 'admin', username: 'admin' })).toBe(tmpDir);
  });

  it('returns sitesRoot/username for user', () => {
    expect(getUserRoot({ role: 'user', username: 'alice' })).toBe(path.join(tmpDir, 'alice'));
  });

  it('returns sitesRoot/username for client', () => {
    expect(getUserRoot({ role: 'client', username: 'bob' })).toBe(path.join(tmpDir, 'bob'));
  });
});

describe('resolveSafe', () => {
  it('returns absolute path for valid subpath', async () => {
    const result = await resolveSafe(tmpDir, 'subdir');
    expect(result).toBe(path.join(tmpDir, 'subdir'));
  });

  it('resolves root itself (path = .)', async () => {
    const result = await resolveSafe(tmpDir, '.');
    expect(result).toBe(tmpDir);
  });

  it('throws PATH_TRAVERSAL for paths escaping root', async () => {
    await expect(resolveSafe(tmpDir, '../../etc/passwd')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
  });
});

describe('listDir', () => {
  it('lists files and directories with type, size, mtime', async () => {
    const dir = path.join(tmpDir, 'list-test');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'hello.txt'), 'hello');
    await fs.mkdir(path.join(dir, 'subdir'));
    const entries = await listDir(dir);
    const file = entries.find(e => e.name === 'hello.txt');
    const sub = entries.find(e => e.name === 'subdir');
    expect(file.type).toBe('file');
    expect(file.size).toBe(5);
    expect(file.mtime).toBeInstanceOf(Date);
    expect(sub.type).toBe('dir');
  });
});

describe('deleteEntry', () => {
  it('deletes a file', async () => {
    const file = path.join(tmpDir, 'del-me.txt');
    await fs.writeFile(file, 'x');
    await deleteEntry(file);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('deletes a directory recursively', async () => {
    const dir = path.join(tmpDir, 'del-dir');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'f.txt'), 'x');
    await deleteEntry(dir);
    await expect(fs.access(dir)).rejects.toThrow();
  });

  it('does not throw for non-existent path', async () => {
    await expect(deleteEntry(path.join(tmpDir, 'nope.txt'))).resolves.not.toThrow();
  });
});

describe('renameEntry', () => {
  it('renames a file', async () => {
    const src = path.join(tmpDir, 'rename-src.txt');
    const dest = path.join(tmpDir, 'rename-dest.txt');
    await fs.writeFile(src, 'data');
    await renameEntry(src, dest);
    await expect(fs.access(src)).rejects.toThrow();
    expect(await fs.readFile(dest, 'utf8')).toBe('data');
  });
});

describe('copyEntry', () => {
  it('copies a file', async () => {
    const src = path.join(tmpDir, 'copy-src.txt');
    const dest = path.join(tmpDir, 'copy-dest.txt');
    await fs.writeFile(src, 'copied');
    await copyEntry(src, dest);
    expect(await fs.readFile(dest, 'utf8')).toBe('copied');
  });

  it('copies a directory recursively', async () => {
    const src = path.join(tmpDir, 'copy-dir-src');
    const dest = path.join(tmpDir, 'copy-dir-dest');
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, 'inner.txt'), 'nested');
    await copyEntry(src, dest);
    expect(await fs.readFile(path.join(dest, 'inner.txt'), 'utf8')).toBe('nested');
  });
});

describe('makeDir', () => {
  it('creates a directory', async () => {
    const dir = path.join(tmpDir, 'new-dir');
    await makeDir(dir);
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
  });

  it('does not throw if directory already exists', async () => {
    const dir = path.join(tmpDir, 'existing-dir');
    await fs.mkdir(dir);
    await expect(makeDir(dir)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 3: SKIP ON WINDOWS DEV — run tests to confirm they fail**

On Linux: `npx jest tests/files.service.test.js --runInBand`
Expected: FAIL with "Cannot find module '../src/services/files'"

- [ ] **Step 4: Write the implementation**

Create `src/services/files.js`:

```js
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
```

- [ ] **Step 5: SKIP ON WINDOWS DEV — run tests to confirm they pass**

On Linux: `npx jest tests/files.service.test.js --runInBand`
Expected: PASS (all 14 tests)

- [ ] **Step 6: Commit**

```bash
git add src/services/files.js tests/files.service.test.js package.json package-lock.json
git commit -m "feat: add file service with path-safety and fs operations"
```

---

### Task 2: Archive system

**Files:**
- Create: `src/system/archive.js`
- Create: `tests/archive.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/archive.test.js`:

```js
require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { createZip, extractZip } = require('../src/system/archive');

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-archive-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('createZip', () => {
  it('creates a zip file containing a single file', async () => {
    const srcFile = path.join(tmpDir, 'single.txt');
    await fs.writeFile(srcFile, 'hello zip');
    const dest = path.join(tmpDir, 'single.zip');
    await createZip([srcFile], dest);
    const stat = await fs.stat(dest);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('creates a zip from a directory', async () => {
    const srcDir = path.join(tmpDir, 'zip-dir');
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, 'a.txt'), 'a');
    await fs.writeFile(path.join(srcDir, 'b.txt'), 'b');
    const dest = path.join(tmpDir, 'dir.zip');
    await createZip([srcDir], dest);
    const stat = await fs.stat(dest);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('creates a zip from multiple files', async () => {
    const f1 = path.join(tmpDir, 'multi1.txt');
    const f2 = path.join(tmpDir, 'multi2.txt');
    await fs.writeFile(f1, 'first');
    await fs.writeFile(f2, 'second');
    const dest = path.join(tmpDir, 'multi.zip');
    await createZip([f1, f2], dest);
    const stat = await fs.stat(dest);
    expect(stat.size).toBeGreaterThan(0);
  });
});

describe('extractZip', () => {
  it('extracts a zip file and restores file content', async () => {
    const srcFile = path.join(tmpDir, 'extract-src.txt');
    await fs.writeFile(srcFile, 'extract me');
    const zipPath = path.join(tmpDir, 'extract-test.zip');
    await createZip([srcFile], zipPath);

    const destDir = path.join(tmpDir, 'extract-dest');
    await extractZip(zipPath, destDir);

    const extractedFile = path.join(destDir, 'extract-src.txt');
    const content = await fs.readFile(extractedFile, 'utf8');
    expect(content).toBe('extract me');
  });

  it('creates destDir if it does not exist', async () => {
    const srcFile = path.join(tmpDir, 'mkdir-src.txt');
    await fs.writeFile(srcFile, 'ok');
    const zipPath = path.join(tmpDir, 'mkdir-test.zip');
    await createZip([srcFile], zipPath);

    const destDir = path.join(tmpDir, 'extract-mkdir-dest');
    await extractZip(zipPath, destDir);
    expect((await fs.stat(destDir)).isDirectory()).toBe(true);
  });
});
```

- [ ] **Step 2: SKIP ON WINDOWS DEV — run tests to confirm they fail**

On Linux: `npx jest tests/archive.test.js --runInBand`
Expected: FAIL with "Cannot find module '../src/system/archive'"

- [ ] **Step 3: Write the implementation**

Create `src/system/archive.js`:

```js
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
```

- [ ] **Step 4: SKIP ON WINDOWS DEV — run tests to confirm they pass**

On Linux: `npx jest tests/archive.test.js --runInBand`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/system/archive.js tests/archive.test.js
git commit -m "feat: add archive system with zip creation and extraction"
```

---

### Task 3: FTP shell scripts and system module

**Files:**
- Create: `scripts/neptune-ftp-adduser.sh`
- Create: `scripts/neptune-ftp-deluser.sh`
- Create: `scripts/neptune-ftp-passwd.sh`
- Create: `src/system/ftp.js`

No tests for this task — shell scripts call real `sudo`/`pure-pw`; the system module is always mocked in tests.

- [ ] **Step 1: Create neptune-ftp-adduser.sh**

Create `scripts/neptune-ftp-adduser.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

USERNAME="$1"
HOME_DIR="$2"

if ! [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]{1,32}$ ]]; then
  echo "Invalid username: $USERNAME" >&2
  exit 1
fi

if [[ ! "$HOME_DIR" =~ ^/ ]]; then
  echo "home_dir must be absolute: $HOME_DIR" >&2
  exit 1
fi

if [ ! -d "$HOME_DIR" ]; then
  echo "home_dir does not exist: $HOME_DIR" >&2
  exit 1
fi

pure-pw useradd "$USERNAME" -f /etc/pure-ftpd/pureftpd.passwd -d "$HOME_DIR" -m
pure-pw mkdb
```

- [ ] **Step 2: Create neptune-ftp-deluser.sh**

Create `scripts/neptune-ftp-deluser.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

USERNAME="$1"

if ! [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]{1,32}$ ]]; then
  echo "Invalid username: $USERNAME" >&2
  exit 1
fi

pure-pw userdel "$USERNAME" -f /etc/pure-ftpd/pureftpd.passwd -m
pure-pw mkdb
```

- [ ] **Step 3: Create neptune-ftp-passwd.sh**

Create `scripts/neptune-ftp-passwd.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

USERNAME="$1"

if ! [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]{1,32}$ ]]; then
  echo "Invalid username: $USERNAME" >&2
  exit 1
fi

pure-pw passwd "$USERNAME" -f /etc/pure-ftpd/pureftpd.passwd -m
pure-pw mkdb
```

- [ ] **Step 4: Make scripts executable**

```bash
chmod +x scripts/neptune-ftp-adduser.sh scripts/neptune-ftp-deluser.sh scripts/neptune-ftp-passwd.sh
```

(On Linux — skip chmod on Windows dev, git will track the executable bit.)

- [ ] **Step 5: Create src/system/ftp.js**

```js
const { execFile } = require('child_process');

// Lazy accessors — read env vars at call time so tests can override in beforeAll
function addUserScript() { return process.env.NEPTUNE_FTP_ADDUSER || '/usr/local/bin/neptune-ftp-adduser'; }
function delUserScript() { return process.env.NEPTUNE_FTP_DELUSER || '/usr/local/bin/neptune-ftp-deluser'; }
function passwdScript()  { return process.env.NEPTUNE_FTP_PASSWD  || '/usr/local/bin/neptune-ftp-passwd'; }

function runScript(args, stdinData) {
  return new Promise((resolve, reject) => {
    const proc = execFile('sudo', args);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`Script exited with code ${code}`), { code: 'SCRIPT_ERROR' }));
    });
    proc.on('error', reject);
    if (stdinData) proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

async function addFtpUser(ftpUsername, password, homeDir) {
  await runScript([addUserScript(), ftpUsername, homeDir], `${password}\n${password}\n`);
}

async function deleteFtpUser(ftpUsername) {
  await runScript([delUserScript(), ftpUsername]);
}

async function changeFtpPassword(ftpUsername, newPassword) {
  await runScript([passwdScript(), ftpUsername], `${newPassword}\n${newPassword}\n`);
}

module.exports = { addFtpUser, deleteFtpUser, changeFtpPassword };
```

- [ ] **Step 6: Commit**

```bash
git add scripts/neptune-ftp-adduser.sh scripts/neptune-ftp-deluser.sh scripts/neptune-ftp-passwd.sh src/system/ftp.js
git commit -m "feat: add FTP shell scripts and system module with sudo wrappers"
```

---

### Task 4: FTP service and service tests

**Files:**
- Create: `src/services/ftp.js`
- Create: `tests/ftp.service.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/ftp.service.test.js`:

```js
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
```

- [ ] **Step 2: SKIP ON WINDOWS DEV — run tests to confirm they fail**

On Linux: `npx jest tests/ftp.service.test.js --runInBand`
Expected: FAIL with "Cannot find module '../src/services/ftp'"

- [ ] **Step 3: Write the implementation**

Create `src/services/ftp.js`:

```js
const pool = require('../db/index');
const bcrypt = require('bcryptjs');
const ftp = require('../system/ftp');
const { getUserRoot, resolveSafe } = require('./files');
const { getUserById } = require('./users');

const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 1 : 12;
const FTP_ACCOUNTS_FIELDS = 'id, user_id, ftp_username, ftp_password_hash, home_dir, is_active, created_at';
const FTP_USERNAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

async function createFtpAccount({ userId, ftpUsername, password, homeDir }) {
  if (!FTP_USERNAME_RE.test(ftpUsername)) {
    throw Object.assign(new Error('Invalid ftp_username'), { code: 'INVALID_FTP_USERNAME' });
  }
  if (!password || password.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters'), { code: 'WEAK_PASSWORD' });
  }
  const user = await getUserById(userId);
  const root = getUserRoot({ role: user.role, username: user.username });
  const resolved = await resolveSafe(root, homeDir);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await ftp.addFtpUser(ftpUsername, password, resolved);
  const [result] = await pool.query(
    'INSERT INTO ftp_accounts (user_id, ftp_username, ftp_password_hash, home_dir, is_active) VALUES (?, ?, ?, ?, 1)',
    [userId, ftpUsername, passwordHash, resolved]
  );
  return getFtpAccountById(result.insertId);
}

async function listFtpAccounts({ requestingUserId, requestingRole }) {
  if (requestingRole === 'admin') {
    const [rows] = await pool.query(
      `SELECT ${FTP_ACCOUNTS_FIELDS} FROM ftp_accounts WHERE is_active = 1 ORDER BY created_at DESC`
    );
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT ${FTP_ACCOUNTS_FIELDS} FROM ftp_accounts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC`,
    [requestingUserId]
  );
  return rows;
}

async function getFtpAccountById(id) {
  const [rows] = await pool.query(`SELECT ${FTP_ACCOUNTS_FIELDS} FROM ftp_accounts WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function changeFtpPassword(id, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters'), { code: 'WEAK_PASSWORD' });
  }
  const account = await getFtpAccountById(id);
  if (!account) throw Object.assign(new Error('FTP account not found'), { code: 'NOT_FOUND' });
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await ftp.changeFtpPassword(account.ftp_username, newPassword);
  await pool.query('UPDATE ftp_accounts SET ftp_password_hash = ? WHERE id = ?', [passwordHash, id]);
}

async function deactivateFtpAccount(id) {
  const account = await getFtpAccountById(id);
  if (!account) throw Object.assign(new Error('FTP account not found'), { code: 'NOT_FOUND' });
  await ftp.deleteFtpUser(account.ftp_username);
  await pool.query('UPDATE ftp_accounts SET is_active = 0 WHERE id = ?', [id]);
}

module.exports = { createFtpAccount, listFtpAccounts, getFtpAccountById, changeFtpPassword, deactivateFtpAccount };
```

- [ ] **Step 4: SKIP ON WINDOWS DEV — run tests to confirm they pass**

On Linux: `npx jest tests/ftp.service.test.js --runInBand`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ftp.js tests/ftp.service.test.js
git commit -m "feat: add FTP service with DB CRUD and bcrypt password hashing"
```

---

### Task 5: Files API and integration tests

**Files:**
- Create: `src/api/files.js`
- Create: `tests/files.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/files.test.js`:

```js
require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { clearTables, createUser } = require('./helpers/db');

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-files-api-'));
  process.env.NEPTUNE_SITES_ROOT = tmpDir;
  process.env.NEPTUNE_TMP_DIR = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => clearTables());

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

async function setupUserDir(username) {
  const dir = path.join(tmpDir, username);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('GET /api/files', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/files');
    expect(res.status).toBe(401);
  });

  it('lists files in user root directory', async () => {
    const user = await createUser({ username: 'uf1', email: 'uf1@t.com' });
    const userDir = await setupUserDir('uf1');
    await fs.writeFile(path.join(userDir, 'hello.txt'), 'hi');
    const res = await request(app).get('/api/files').set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.map(e => e.name)).toContain('hello.txt');
  });

  it('returns 400 for path traversal', async () => {
    const user = await createUser({ username: 'uf2', email: 'uf2@t.com' });
    await setupUserDir('uf2');
    const res = await request(app)
      .get('/api/files?path=../../etc')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(400);
  });

  it('admin lists from sites root', async () => {
    const admin = await createUser({ role: 'admin', username: 'adm', email: 'adm@t.com' });
    const res = await request(app).get('/api/files').set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });
});

describe('POST /api/files/mkdir', () => {
  it('creates a directory', async () => {
    const user = await createUser({ username: 'uf3', email: 'uf3@t.com' });
    const userDir = await setupUserDir('uf3');
    const res = await request(app).post('/api/files/mkdir')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ path: 'newsubdir' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((await fs.stat(path.join(userDir, 'newsubdir'))).isDirectory()).toBe(true);
  });

  it('returns 400 without path', async () => {
    const user = await createUser({ username: 'uf3b', email: 'uf3b@t.com' });
    await setupUserDir('uf3b');
    const res = await request(app).post('/api/files/mkdir')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/upload', () => {
  it('uploads a file to user root', async () => {
    const user = await createUser({ username: 'uf4', email: 'uf4@t.com' });
    const userDir = await setupUserDir('uf4');
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .attach('file', Buffer.from('file contents'), 'uploaded.txt');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('uploaded.txt');
    expect(await fs.readFile(path.join(userDir, 'uploaded.txt'), 'utf8')).toBe('file contents');
  });

  it('returns 400 without a file', async () => {
    const user = await createUser({ username: 'uf4b', email: 'uf4b@t.com' });
    await setupUserDir('uf4b');
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/files/download', () => {
  it('downloads a file', async () => {
    const user = await createUser({ username: 'uf5', email: 'uf5@t.com' });
    const userDir = await setupUserDir('uf5');
    await fs.writeFile(path.join(userDir, 'get-me.txt'), 'download content');
    const res = await request(app)
      .get('/api/files/download?path=get-me.txt')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('download content');
  });

  it('returns 404 for non-existent file', async () => {
    const user = await createUser({ username: 'uf5b', email: 'uf5b@t.com' });
    await setupUserDir('uf5b');
    const res = await request(app)
      .get('/api/files/download?path=nope.txt')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/files/rename', () => {
  it('renames a file', async () => {
    const user = await createUser({ username: 'uf6', email: 'uf6@t.com' });
    const userDir = await setupUserDir('uf6');
    await fs.writeFile(path.join(userDir, 'old.txt'), 'data');
    const res = await request(app).post('/api/files/rename')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ from: 'old.txt', to: 'new.txt' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    await expect(fs.access(path.join(userDir, 'new.txt'))).resolves.not.toThrow();
    await expect(fs.access(path.join(userDir, 'old.txt'))).rejects.toThrow();
  });

  it('returns 400 without from/to', async () => {
    const user = await createUser({ username: 'uf6b', email: 'uf6b@t.com' });
    await setupUserDir('uf6b');
    const res = await request(app).post('/api/files/rename')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ from: 'old.txt' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/copy', () => {
  it('copies a file', async () => {
    const user = await createUser({ username: 'uf7', email: 'uf7@t.com' });
    const userDir = await setupUserDir('uf7');
    await fs.writeFile(path.join(userDir, 'original.txt'), 'copy me');
    const res = await request(app).post('/api/files/copy')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ from: 'original.txt', to: 'copy.txt' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await fs.readFile(path.join(userDir, 'copy.txt'), 'utf8')).toBe('copy me');
    await expect(fs.access(path.join(userDir, 'original.txt'))).resolves.not.toThrow();
  });
});

describe('DELETE /api/files', () => {
  it('deletes a file', async () => {
    const user = await createUser({ username: 'uf8', email: 'uf8@t.com' });
    const userDir = await setupUserDir('uf8');
    await fs.writeFile(path.join(userDir, 'todelete.txt'), 'bye');
    const res = await request(app)
      .delete('/api/files?path=todelete.txt')
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    await expect(fs.access(path.join(userDir, 'todelete.txt'))).rejects.toThrow();
  });

  it('returns 400 without path', async () => {
    const user = await createUser({ username: 'uf8b', email: 'uf8b@t.com' });
    await setupUserDir('uf8b');
    const res = await request(app).delete('/api/files').set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/archive', () => {
  it('creates a zip archive from files', async () => {
    const user = await createUser({ username: 'uf9', email: 'uf9@t.com' });
    const userDir = await setupUserDir('uf9');
    await fs.writeFile(path.join(userDir, 'tozip.txt'), 'zip me');
    const res = await request(app).post('/api/files/archive')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ paths: ['tozip.txt'], dest: 'output.zip' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((await fs.stat(path.join(userDir, 'output.zip'))).size).toBeGreaterThan(0);
  });

  it('returns 400 without paths array', async () => {
    const user = await createUser({ username: 'uf9b', email: 'uf9b@t.com' });
    await setupUserDir('uf9b');
    const res = await request(app).post('/api/files/archive')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ dest: 'output.zip' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/extract', () => {
  it('extracts a zip archive', async () => {
    const user = await createUser({ username: 'uf10', email: 'uf10@t.com' });
    const userDir = await setupUserDir('uf10');
    await fs.writeFile(path.join(userDir, 'toextract.txt'), 'extract me');
    await request(app).post('/api/files/archive')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ paths: ['toextract.txt'], dest: 'bundle.zip' });
    const res = await request(app).post('/api/files/extract')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ src: 'bundle.zip', dest: 'extracted' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((await fs.stat(path.join(userDir, 'extracted'))).isDirectory()).toBe(true);
  });

  it('returns 400 without src/dest', async () => {
    const user = await createUser({ username: 'uf10b', email: 'uf10b@t.com' });
    await setupUserDir('uf10b');
    const res = await request(app).post('/api/files/extract')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ src: 'bundle.zip' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: SKIP ON WINDOWS DEV — run tests to confirm they fail**

On Linux: `npx jest tests/files.test.js --runInBand`
Expected: FAIL with 404 on all routes (router not yet mounted)

- [ ] **Step 3: Write the implementation**

Create `src/api/files.js`:

```js
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
```

- [ ] **Step 4: Mount the router in src/api/index.js**

Edit `src/api/index.js` — add the files router:

```js
const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/domains', require('./domains'));
router.use('/files', require('./files'));
module.exports = router;
```

- [ ] **Step 5: SKIP ON WINDOWS DEV — run tests to confirm they pass**

On Linux: `npx jest tests/files.test.js --runInBand`
Expected: PASS (all 18 tests)

- [ ] **Step 6: Commit**

```bash
git add src/api/files.js src/api/index.js tests/files.test.js
git commit -m "feat: add file manager API with 9 endpoints (list/upload/download/delete/rename/copy/mkdir/archive/extract)"
```

---

### Task 6: FTP API, integration tests, and final wiring

**Files:**
- Create: `src/api/ftp.js`
- Create: `tests/ftp.test.js`
- Modify: `src/api/index.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/ftp.test.js`:

```js
require('dotenv').config();
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { clearTables, createUser } = require('./helpers/db');

jest.mock('../src/system/ftp', () => ({
  addFtpUser: jest.fn().mockResolvedValue(undefined),
  deleteFtpUser: jest.fn().mockResolvedValue(undefined),
  changeFtpPassword: jest.fn().mockResolvedValue(undefined),
}));

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neptune-ftp-api-'));
  process.env.NEPTUNE_SITES_ROOT = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => clearTables());

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

describe('GET /api/ftp', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/ftp');
    expect(res.status).toBe(401);
  });

  it('user sees their own FTP accounts', async () => {
    const user = await createUser({ username: 'ftpapi1', email: 'ftpapi1@t.com' });
    const pool = require('../src/db/index');
    await pool.query(
      'INSERT INTO ftp_accounts (user_id, ftp_username, ftp_password_hash, home_dir, is_active) VALUES (?, ?, ?, ?, 1)',
      [user.id, 'ftpapi1_ftp', '$2a$hash', path.join(tmpDir, 'ftpapi1')]
    );
    const res = await request(app).get('/api/ftp').set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.accounts.every(a => a.user_id === user.id)).toBe(true);
  });

  it('admin sees all accounts', async () => {
    const admin = await createUser({ role: 'admin', username: 'ftpadm', email: 'ftpadm@t.com' });
    const user = await createUser({ username: 'ftpapi2', email: 'ftpapi2@t.com' });
    const pool = require('../src/db/index');
    await pool.query(
      'INSERT INTO ftp_accounts (user_id, ftp_username, ftp_password_hash, home_dir, is_active) VALUES (?, ?, ?, ?, 1)',
      [user.id, 'ftpapi2_ftp', '$2a$hash', path.join(tmpDir, 'ftpapi2')]
    );
    const res = await request(app).get('/api/ftp').set('Authorization', `Bearer ${makeToken(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/ftp', () => {
  it('returns 400 without required fields', async () => {
    const user = await createUser({ username: 'ftpapi3', email: 'ftpapi3@t.com' });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'only_username' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for weak password', async () => {
    const user = await createUser({ username: 'ftpapi4', email: 'ftpapi4@t.com' });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp4', password: 'weak', home_dir: '.' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid ftp_username', async () => {
    const user = await createUser({ username: 'ftpapi5', email: 'ftpapi5@t.com' });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'bad name!', password: 'securepass', home_dir: '.' });
    expect(res.status).toBe(400);
  });

  it('creates an FTP account', async () => {
    const user = await createUser({ username: 'ftpapi6', email: 'ftpapi6@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi6'), { recursive: true });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp6', password: 'securepass', home_dir: '.' });
    expect(res.status).toBe(201);
    expect(res.body.account.ftp_username).toBe('ftp6');
    expect(res.body.account.user_id).toBe(user.id);
  });

  it('returns 409 for duplicate ftp_username', async () => {
    const user = await createUser({ username: 'ftpapi7', email: 'ftpapi7@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi7'), { recursive: true });
    await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp7dup', password: 'securepass', home_dir: '.' });
    const res2 = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp7dup', password: 'securepass', home_dir: '.' });
    expect(res2.status).toBe(409);
  });

  it('returns 400 for home_dir path traversal', async () => {
    const user = await createUser({ username: 'ftpapi8', email: 'ftpapi8@t.com' });
    const res = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp8', password: 'securepass', home_dir: '../../etc' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/ftp/:id/password', () => {
  it('changes password successfully', async () => {
    const user = await createUser({ username: 'ftpapi9', email: 'ftpapi9@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi9'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp9', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    const res = await request(app).put(`/api/ftp/${id}/password`)
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ password: 'newpassword' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 403 when accessing another user account', async () => {
    const u1 = await createUser({ username: 'ftpapi10', email: 'ftpapi10@t.com' });
    const u2 = await createUser({ username: 'ftpapi11', email: 'ftpapi11@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi10'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(u1)}`)
      .send({ ftp_username: 'ftp10', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    const res = await request(app).put(`/api/ftp/${id}/password`)
      .set('Authorization', `Bearer ${makeToken(u2)}`)
      .send({ password: 'newpassword' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for weak new password', async () => {
    const user = await createUser({ username: 'ftpapi12', email: 'ftpapi12@t.com' });
    const res = await request(app).put('/api/ftp/1/password')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent account', async () => {
    const user = await createUser({ username: 'ftpapi13', email: 'ftpapi13@t.com' });
    const res = await request(app).put('/api/ftp/99999/password')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ password: 'newpassword' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/ftp/:id', () => {
  it('deactivates an FTP account', async () => {
    const user = await createUser({ username: 'ftpapi14', email: 'ftpapi14@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi14'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp14', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    const res = await request(app).delete(`/api/ftp/${id}`)
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 403 when deleting another user account', async () => {
    const u1 = await createUser({ username: 'ftpapi15', email: 'ftpapi15@t.com' });
    const u2 = await createUser({ username: 'ftpapi16', email: 'ftpapi16@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi15'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(u1)}`)
      .send({ ftp_username: 'ftp15', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    const res = await request(app).delete(`/api/ftp/${id}`)
      .set('Authorization', `Bearer ${makeToken(u2)}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for already deactivated account', async () => {
    const user = await createUser({ username: 'ftpapi17', email: 'ftpapi17@t.com' });
    await fs.mkdir(path.join(tmpDir, 'ftpapi17'), { recursive: true });
    const createRes = await request(app).post('/api/ftp')
      .set('Authorization', `Bearer ${makeToken(user)}`)
      .send({ ftp_username: 'ftp17', password: 'securepass', home_dir: '.' });
    const id = createRes.body.account.id;
    await request(app).delete(`/api/ftp/${id}`).set('Authorization', `Bearer ${makeToken(user)}`);
    const res2 = await request(app).delete(`/api/ftp/${id}`)
      .set('Authorization', `Bearer ${makeToken(user)}`);
    expect(res2.status).toBe(404);
  });
});
```

- [ ] **Step 2: SKIP ON WINDOWS DEV — run tests to confirm they fail**

On Linux: `npx jest tests/ftp.test.js --runInBand`
Expected: FAIL with 404 on all routes (router not yet mounted)

- [ ] **Step 3: Write the FTP API**

Create `src/api/ftp.js`:

```js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
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
router.post('/', requireAuth, async (req, res) => {
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
    res.status(201).json({ account });
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
```

- [ ] **Step 4: Mount /ftp router in src/api/index.js**

Edit `src/api/index.js`:

```js
const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/domains', require('./domains'));
router.use('/files', require('./files'));
router.use('/ftp', require('./ftp'));
module.exports = router;
```

- [ ] **Step 5: SKIP ON WINDOWS DEV — run full test suite**

On Linux: `npm test`
Expected: All tests pass including new files and ftp tests

- [ ] **Step 6: Commit**

```bash
git add src/api/ftp.js src/api/index.js tests/ftp.test.js
git commit -m "feat: add FTP account API with 4 endpoints (list/create/password/delete)"
```
