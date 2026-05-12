# Neptune — Plan 4: File Manager + FTP Accounts Design

**Date:** 2026-05-12

**Goal:** Add a full-featured file manager API and FTP account management to Neptune, allowing users to manage their hosting files via REST endpoints and virtual FTP accounts via pure-ftpd.

---

## Architecture

Two independent subsystems sharing the same role-based path-safety model, following the established service → system → api layering from Plans 1–3.

**Tech stack:** Node.js, Express 4, fs/promises, multer (disk storage), archiver, unzipper, child_process (sudo scripts)

**New npm packages:** `multer`, `archiver`, `unzipper`

### File Map

| File | Responsibility |
|------|----------------|
| `src/services/files.js` | Filesystem ops: list, stat, delete, rename, mkdir, copy. Houses `resolveSafe()` and `getUserRoot()`. |
| `src/system/archive.js` | Zip creation (`archiver`) + extraction (`unzipper`). |
| `src/api/files.js` | 9 HTTP endpoints for the file manager. Multer upload handling. |
| `src/services/ftp.js` | DB CRUD for `ftp_accounts`: create, list, changePassword, deactivate. |
| `src/system/ftp.js` | Sudo wrappers: addFtpUser, deleteFtpUser, changeFtpPassword. |
| `src/api/ftp.js` | 4 HTTP endpoints for FTP account management. |
| `src/api/index.js` | Mount `/files` and `/ftp` routers. |
| `scripts/neptune-ftp-adduser.sh` | Validate inputs, run `pure-pw useradd` + `pure-pw mkdb`. |
| `scripts/neptune-ftp-deluser.sh` | Validate inputs, run `pure-pw userdel` + `pure-pw mkdb`. |
| `scripts/neptune-ftp-passwd.sh` | Validate inputs, run `pure-pw passwd` + `pure-pw mkdb`. |

---

## Access Control & Path Safety

### Role Roots

Every role has a filesystem root outside which no operation is permitted:

| Role | Root |
|------|------|
| admin | `process.env.NEPTUNE_SITES_ROOT` (e.g. `/var/www/neptune`) |
| user | `${NEPTUNE_SITES_ROOT}/${username}` |
| client | `${NEPTUNE_SITES_ROOT}/${username}` |

`getUserRoot(user)` in `src/services/files.js` returns the root for a given user object. The username comes from `users.getUserById(req.user.id).username`.

### Path Safety

`resolveSafe(root, userPath)` prevents path traversal:

```js
async function resolveSafe(root, userPath) {
  const joined = path.join(root, userPath);
  // Resolve symlinks to catch symlink-based traversal
  const resolved = await fs.realpath(joined).catch(() => path.resolve(joined));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw Object.assign(new Error('Path traversal detected'), { code: 'PATH_TRAVERSAL' });
  }
  return resolved;
}
```

All endpoints pass user-supplied paths through `resolveSafe` before any filesystem operation. FTP `home_dir` values are validated the same way.

---

## File Manager API

Base path: `/api/files` — all endpoints require `requireAuth`.

Access is determined solely by the caller's root — no additional role restrictions.

### Endpoints

| Method | Path | Body / Query | Response |
|--------|------|-------------|----------|
| `GET` | `/api/files` | `?path=` (default `/`) | `{ entries: [{ name, type, size, mtime }] }` |
| `GET` | `/api/files/download` | `?path=` | File stream (`Content-Disposition: attachment`) |
| `POST` | `/api/files/upload` | `?path=` + `multipart/form-data` field `file` | `{ ok: true, name, size }` |
| `POST` | `/api/files/mkdir` | `{ path }` | `{ ok: true }` |
| `POST` | `/api/files/rename` | `{ from, to }` | `{ ok: true }` |
| `POST` | `/api/files/copy` | `{ from, to }` | `{ ok: true }` |
| `DELETE` | `/api/files` | `?path=` | `{ ok: true }` |
| `POST` | `/api/files/archive` | `{ paths: [str], dest }` | `{ ok: true, dest }` |
| `POST` | `/api/files/extract` | `{ src, dest }` | `{ ok: true, dest }` |

### Upload Flow

Multer configured with `diskStorage`:
- `destination`: `process.env.NEPTUNE_TMP_DIR || os.tmpdir()`
- `filename`: random UUID to avoid collisions

After multer writes the temp file, the handler:
1. Resolves the destination path via `resolveSafe`
2. Calls `fs.rename(tmpPath, destPath)` to move atomically
3. If rename fails (cross-device), falls back to copy + unlink

### File Service Operations

`src/services/files.js` exports:
- `getUserRoot(user)` — returns root path for a user
- `resolveSafe(root, userPath)` — validates and resolves path
- `listDir(absPath)` — returns array of `{ name, type, size, mtime }`
- `deleteEntry(absPath)` — `fs.rm` with `{ recursive: true, force: true }`
- `renameEntry(absSrc, absDest)` — `fs.rename`
- `copyEntry(absSrc, absDest)` — `fs.cp` with `{ recursive: true }`
- `makeDir(absPath)` — `fs.mkdir` with `{ recursive: true }`

### Archive System

`src/system/archive.js` exports:
- `createZip(absPaths, absDestZip)` — uses `archiver('zip')`, streams to dest file
- `extractZip(absSrcZip, absDestDir)` — uses `unzipper.Open.file()`, extracts with path safety (each entry validated against destDir)

Extraction validates every entry path to prevent zip-slip attacks (zip entries containing `../`).

---

## FTP Account API

Base path: `/api/ftp` — all endpoints require `requireAuth`.

The `ftp_accounts` table already exists in the DB schema:
```sql
ftp_accounts (id, user_id, ftp_username, ftp_password_hash, home_dir, is_active, created_at)
```

### Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/ftp` | — | `{ accounts: [...] }` — admin sees all, others see own |
| `POST` | `/api/ftp` | `{ ftp_username, password, home_dir }` | `{ account }` |
| `PUT` | `/api/ftp/:id/password` | `{ password }` | `{ ok: true }` |
| `DELETE` | `/api/ftp/:id` | — | `{ ok: true }` |

### FTP Service (`src/services/ftp.js`)

- `createFtpAccount({ userId, ftpUsername, password, homeDir })` — validates `home_dir` via `resolveSafe` against user root, bcrypt-hashes password for DB, calls `ftp.addFtpUser()`, inserts DB row
- `listFtpAccounts({ requestingUserId, requestingRole })` — admin sees all, others see own
- `getFtpAccountById(id)` — returns row or null
- `changeFtpPassword(id, newPassword)` — updates `ftp_password_hash`, calls `ftp.changeFtpPassword()`
- `deactivateFtpAccount(id)` — sets `is_active = 0`, calls `ftp.deleteFtpUser()`

### FTP System (`src/system/ftp.js`)

Lazy accessor pattern (same as vhost.js):
```js
function addUserScript() { return process.env.NEPTUNE_FTP_ADDUSER || '/usr/local/bin/neptune-ftp-adduser'; }
function delUserScript() { return process.env.NEPTUNE_FTP_DELUSER || '/usr/local/bin/neptune-ftp-deluser'; }
function passwdScript()  { return process.env.NEPTUNE_FTP_PASSWD  || '/usr/local/bin/neptune-ftp-passwd'; }
```

Password passed via **stdin** to scripts (not as CLI arg) to avoid it appearing in `ps aux`.

```js
async function addFtpUser(ftpUsername, password, homeDir) {
  const proc = execFile('sudo', [addUserScript(), ftpUsername, homeDir]);
  proc.stdin.write(password + '\n' + password + '\n');
  proc.stdin.end();
  await new Promise((resolve, reject) => { proc.on('close', code => code === 0 ? resolve() : reject(...)); });
}
```

### Shell Scripts

**`neptune-ftp-adduser.sh`** — args: `<username> <home_dir>`; password via stdin
- Validate username: `^[a-zA-Z0-9_-]{1,32}$`
- Validate home_dir: absolute, exists
- `pure-pw useradd "$USERNAME" -f /etc/pure-ftpd/pureftpd.passwd -d "$HOME_DIR" -m`
- `pure-pw mkdb`

**`neptune-ftp-deluser.sh`** — args: `<username>`
- Validate username
- `pure-pw userdel "$USERNAME" -f /etc/pure-ftpd/pureftpd.passwd -m`
- `pure-pw mkdb`

**`neptune-ftp-passwd.sh`** — args: `<username>`; new password via stdin
- Validate username
- `pure-pw passwd "$USERNAME" -f /etc/pure-ftpd/pureftpd.passwd -m`
- `pure-pw mkdb`

---

## Validation Rules

- `ftp_username`: `^[a-zA-Z0-9_-]{1,32}$`, must be unique in DB
- `password` (FTP): minimum 8 characters
- `home_dir`: must resolve safely within user's root, directory must exist
- All file paths: validated through `resolveSafe` before any operation
- Archive entries on extraction: each entry path validated to stay within `destDir` (zip-slip prevention)

---

## Error Handling

| Code | HTTP | Meaning |
|------|------|---------|
| `PATH_TRAVERSAL` | 400 | Path resolves outside user root |
| `ER_DUP_ENTRY` | 409 | FTP username already exists |
| `ENOENT` | 404 | File/dir not found |
| `ENOTDIR` | 400 | Expected directory, got file |
| `EISDIR` | 400 | Expected file, got directory |

---

## Testing

- `tests/files.service.test.js` — uses `os.tmpdir()` temp dir, no DB
- `tests/archive.test.js` — creates real zip + extracts in temp dir
- `tests/ftp.service.test.js` — real DB, mocks `src/system/ftp`
- `tests/files.test.js` — API integration tests, real DB + real temp filesystem, mocks `src/system/ftp`
- `tests/ftp.test.js` — API integration tests, real DB, mocks `src/system/ftp`

No sudo scripts are executed in tests — `src/system/ftp` is always mocked.
