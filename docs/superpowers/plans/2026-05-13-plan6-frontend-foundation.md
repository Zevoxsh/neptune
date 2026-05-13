# Plan 6 — Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a multi-page HTML panel from Express with Dark Indigo theme, shared JS/CSS, login page, and dashboard with 4 widgets.

**Architecture:** Express serves `panel/` as static files at `/panel`; redirect `/` to login. Each HTML page includes shared `api.js`, `auth.js`, `sidebar.js`. No JS framework — vanilla only. No automated tests (frontend-only, manual validation).

**Tech Stack:** Node.js/Express 4, vanilla JS, CSS custom properties, JWT via localStorage, httpOnly refresh cookie.

---

## File Map

| File | Action |
|------|--------|
| `src/app.js` | Modify — add static serving + redirect |
| `panel/css/main.css` | Create — Dark Indigo theme |
| `panel/js/api.js` | Create — fetch wrapper with auto-refresh |
| `panel/js/auth.js` | Create — auth guard IIFE |
| `panel/js/sidebar.js` | Create — inject sidebar, highlight active, role visibility |
| `panel/login.html` | Create — login page |
| `panel/dashboard.html` | Create — dashboard with 4 widgets |

---

### Task 1: Express — serve panel/ and redirect /

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Edit `src/app.js`**

Replace the entire file with:

```js
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', require('./api/index'));

app.use('/panel', express.static(path.join(__dirname, '../panel')));
app.get('/', (_req, res) => res.redirect('/panel/login.html'));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
```

- [ ] **Step 2: Verify syntax**

Run: `node -e "require('./src/app.js'); console.log('ok')"`
Expected: prints `ok` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: serve panel/ static files and redirect / to login"
```

---

### Task 2: CSS — Dark Indigo theme

**Files:**
- Create: `panel/css/main.css`

- [ ] **Step 1: Create directories**

```bash
mkdir -p panel/css panel/js
```

- [ ] **Step 2: Create `panel/css/main.css`**

```css
:root {
  --bg:           #0f172a;
  --surface:      #1e293b;
  --border:       #334155;
  --accent:       #6366f1;
  --accent-hover: #4f46e5;
  --text:         #e2e8f0;
  --muted:        #94a3b8;
  --dim:          #475569;
  --success:      #10b981;
  --warning:      #f59e0b;
  --danger:       #ef4444;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

/* ── Layout ─────────────────────────────────────────── */

.layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

#sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

#main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Sidebar ─────────────────────────────────────────── */

.sidebar-logo {
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
}

.sidebar-logo-title {
  color: var(--accent);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
}

.sidebar-logo-host {
  color: var(--dim);
  font-size: 11px;
  margin-top: 2px;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
}

.nav-section {
  padding: 8px 16px 4px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-top: 8px;
}

.nav-item {
  display: block;
  padding: 7px 16px;
  color: var(--text);
  text-decoration: none;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.15s;
}

.nav-item:hover {
  background: var(--surface);
}

.nav-item.active {
  color: var(--accent);
  background: rgba(99, 102, 241, 0.1);
  border-left-color: var(--accent);
  font-weight: 600;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar-avatar {
  width: 28px;
  height: 28px;
  background: var(--accent);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.sidebar-user-name {
  color: var(--text);
  font-size: 12px;
}

.sidebar-user-role {
  color: var(--dim);
  font-size: 11px;
}

.sidebar-logout {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--dim);
  cursor: pointer;
  font-size: 16px;
  padding: 0 2px;
  line-height: 1;
}

.sidebar-logout:hover {
  color: var(--danger);
}

/* ── Topbar ─────────────────────────────────────────── */

.topbar {
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.topbar-title {
  font-size: 16px;
  font-weight: 600;
}

.topbar-sub {
  color: var(--dim);
  font-size: 12px;
}

/* ── Page content ────────────────────────────────────── */

.page-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

/* ── Widgets ─────────────────────────────────────────── */

.widget-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.widget {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}

.widget-value {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 4px;
}

.widget-label {
  color: var(--muted);
  font-size: 12px;
}

.widget-progress-bar {
  background: var(--border);
  border-radius: 4px;
  height: 6px;
  margin-top: 8px;
}

.widget-progress-fill {
  background: var(--accent);
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

/* ── Tables ─────────────────────────────────────────── */

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.card-title {
  font-weight: 600;
  margin-bottom: 12px;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.table th {
  color: var(--dim);
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.table td {
  padding: 8px;
  border-bottom: 1px solid var(--bg);
  color: var(--text);
}

.table tbody tr:last-child td {
  border-bottom: none;
}

/* ── Buttons ─────────────────────────────────────────── */

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s;
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-danger {
  background: var(--danger);
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

/* ── Forms ─────────────────────────────────────────── */

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 6px;
}

input[type="text"],
input[type="password"],
input[type="email"] {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}

input[type="text"]:focus,
input[type="password"]:focus,
input[type="email"]:focus {
  border-color: var(--accent);
}

.form-error {
  background: #450a0a;
  border: 1px solid #7f1d1d;
  border-radius: 6px;
  padding: 10px 12px;
  color: #fca5a5;
  font-size: 13px;
  margin-bottom: 16px;
  display: none;
}

.form-error.visible {
  display: block;
}

/* ── Utilities ─────────────────────────────────────── */

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
}

.text-muted    { color: var(--muted); }
.text-success  { color: var(--success); }
.text-warning  { color: var(--warning); }
.text-accent   { color: var(--accent); }
.text-danger   { color: var(--danger); }
```

- [ ] **Step 3: Commit**

```bash
git add panel/css/main.css
git commit -m "feat: add Dark Indigo CSS theme"
```

---

### Task 3: `panel/js/api.js` — fetch wrapper

**Files:**
- Create: `panel/js/api.js`

- [ ] **Step 1: Create `panel/js/api.js`**

```js
const API_BASE = '/api';
let _refreshing = false;

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

async function apiFetch(method, path, body) {
  const token = localStorage.getItem('neptune_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !_refreshing) {
    _refreshing = true;
    try {
      const r = await fetch(API_BASE + '/auth/refresh', { method: 'POST', credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        localStorage.setItem('neptune_token', data.token);
        _refreshing = false;
        return apiFetch(method, path, body);
      }
    } catch {}
    _refreshing = false;
    localStorage.removeItem('neptune_token');
    window.location.href = '/panel/login.html';
    return null;
  }

  return res;
}

const api = {
  get:    (path)       => apiFetch('GET',    path),
  post:   (path, body) => apiFetch('POST',   path, body),
  put:    (path, body) => apiFetch('PUT',    path, body),
  delete: (path)       => apiFetch('DELETE', path),
  parseJwt,
};

window.api = api;
```

- [ ] **Step 2: Commit**

```bash
git add panel/js/api.js
git commit -m "feat: add api.js fetch wrapper with auto-refresh"
```

---

### Task 4: `panel/js/auth.js` — auth guard

**Files:**
- Create: `panel/js/auth.js`

- [ ] **Step 1: Create `panel/js/auth.js`**

```js
(function () {
  const token = localStorage.getItem('neptune_token');
  if (!token) {
    window.location.href = '/panel/login.html';
    return;
  }
  const payload = api.parseJwt(token);
  if (!payload || !payload.id) {
    localStorage.removeItem('neptune_token');
    window.location.href = '/panel/login.html';
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add panel/js/auth.js
git commit -m "feat: add auth.js guard for protected pages"
```

---

### Task 5: `panel/js/sidebar.js` — sidebar injection

**Files:**
- Create: `panel/js/sidebar.js`

- [ ] **Step 1: Create `panel/js/sidebar.js`**

```js
(function () {
  const token = localStorage.getItem('neptune_token');
  const payload = api.parseJwt(token) || {};
  const role = payload.role || '';
  const username = payload.username || payload.sub || '?';
  const host = window.NEPTUNE_HOST || location.hostname;

  const isAdmin  = role === 'admin';
  const isUser   = role === 'admin' || role === 'user';

  const nav = [
    { label: '📊 Dashboard',        href: '/panel/dashboard.html',  show: true },
    { section: 'Hébergement' },
    { label: '🌐 Domaines',          href: '/panel/domains.html',    show: true },
    { label: '🗄️ Bases de données',  href: '/panel/databases.html',  show: isUser },
    { section: 'Fichiers' },
    { label: '📂 Gestionnaire',      href: '/panel/files.html',      show: true },
    { label: '🔑 Comptes FTP',       href: '/panel/ftp.html',        show: isUser },
    { section: 'Sécurité' },
    { label: '🔒 SSL',               href: '/panel/ssl.html',        show: isUser },
    { section: 'Administration' },
    { label: '👤 Comptes',           href: '/panel/accounts.html',   show: isUser },
    { label: '⚙️ Serveur',           href: '/panel/server.html',     show: isAdmin },
  ];

  const current = location.pathname;

  function navHTML() {
    return nav.map(item => {
      if (item.section) {
        return `<div class="nav-section">${item.section}</div>`;
      }
      if (!item.show) return '';
      const active = current === item.href ? ' active' : '';
      return `<a class="nav-item${active}" href="${item.href}">${item.label}</a>`;
    }).join('');
  }

  async function logout() {
    await api.post('/auth/logout');
    localStorage.removeItem('neptune_token');
    window.location.href = '/panel/login.html';
  }

  const initial = username.charAt(0).toUpperCase();

  const html = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-title">⚡ NEPTUNE</div>
      <div class="sidebar-logo-host">${host}</div>
    </div>
    <nav class="sidebar-nav">
      ${navHTML()}
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-avatar">${initial}</div>
      <div>
        <div class="sidebar-user-name">${username}</div>
        <div class="sidebar-user-role">${role}</div>
      </div>
      <button class="sidebar-logout" id="btn-logout" title="Déconnexion">⏻</button>
    </div>
  `;

  const el = document.getElementById('sidebar');
  if (el) {
    el.innerHTML = html;
    document.getElementById('btn-logout').addEventListener('click', logout);
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add panel/js/sidebar.js
git commit -m "feat: add sidebar.js with role-based nav and active highlight"
```

---

### Task 6: `panel/login.html` — login page

**Files:**
- Create: `panel/login.html`

- [ ] **Step 1: Create `panel/login.html`**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neptune — Connexion</title>
  <link rel="stylesheet" href="/panel/css/main.css">
  <style>
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .login-card {
      width: 360px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 40px;
    }
    .login-logo {
      text-align: center;
      margin-bottom: 32px;
    }
    .login-logo-title {
      color: var(--accent);
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 1px;
    }
    .login-logo-sub {
      color: var(--dim);
      font-size: 13px;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="login-logo">
      <div class="login-logo-title">⚡ NEPTUNE</div>
      <div class="login-logo-sub">Panneau d'hébergement</div>
    </div>

    <div class="form-group">
      <label for="username">Identifiant</label>
      <input type="text" id="username" placeholder="alice" autocomplete="username">
    </div>

    <div class="form-group">
      <label for="password">Mot de passe</label>
      <input type="password" id="password" autocomplete="current-password">
    </div>

    <div class="form-error" id="login-error"></div>

    <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="submitLogin()">
      Se connecter
    </button>
  </div>

  <script>
    document.getElementById('username').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
    document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });

    async function submitLogin() {
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const errEl = document.getElementById('login-error');
      errEl.classList.remove('visible');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password }),
        });

        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('neptune_token', data.token);
          window.location.href = '/panel/dashboard.html';
          return;
        }

        if (res.status === 401) {
          errEl.textContent = 'Identifiant ou mot de passe incorrect.';
        } else if (res.status === 429) {
          errEl.textContent = 'Trop de tentatives. Réessayez dans quelques secondes.';
        } else {
          errEl.textContent = 'Erreur serveur. Réessayez.';
        }
        errEl.classList.add('visible');
      } catch {
        errEl.textContent = 'Impossible de contacter le serveur.';
        errEl.classList.add('visible');
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the page loads**

Start the server: `node src/server.js` (or however the project starts — check `package.json` scripts).
Open `http://localhost:<PORT>/panel/login.html` in a browser.
Expected: Dark background, centered card, "⚡ NEPTUNE" logo, two fields, "Se connecter" button.

- [ ] **Step 3: Commit**

```bash
git add panel/login.html
git commit -m "feat: add login page"
```

---

### Task 7: `panel/dashboard.html` — dashboard

**Files:**
- Create: `panel/dashboard.html`

- [ ] **Step 1: Create `panel/dashboard.html`**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neptune — Dashboard</title>
  <link rel="stylesheet" href="/panel/css/main.css">
</head>
<body>
  <div class="layout">
    <div id="sidebar"></div>
    <div id="main">
      <div class="topbar">
        <div class="topbar-title">Dashboard</div>
        <div class="topbar-sub" id="topbar-version">neptune v1.0</div>
      </div>
      <div class="page-content">
        <div class="widget-grid">
          <div class="widget">
            <div class="widget-value text-accent" id="w-domains">—</div>
            <div class="widget-label">Domaines actifs</div>
          </div>
          <div class="widget">
            <div class="widget-value text-success" id="w-dbs">—</div>
            <div class="widget-label">Bases de données</div>
          </div>
          <div class="widget">
            <div class="widget-value text-muted" id="w-ftp">—</div>
            <div class="widget-label">Comptes FTP</div>
          </div>
          <div class="widget">
            <div class="widget-value" id="w-disk-text">— / —</div>
            <div class="widget-label">
              <div class="widget-progress-bar">
                <div class="widget-progress-fill" id="w-disk-bar" style="width:0%"></div>
              </div>
              <div style="margin-top:4px;">Disque utilisé</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Domaines récents</div>
          <table class="table">
            <thead>
              <tr>
                <th>Domaine</th>
                <th>PHP</th>
                <th>SSL</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody id="domains-table-body">
              <tr><td colspan="4" class="text-muted">Chargement…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <script src="/panel/js/api.js"></script>
  <script src="/panel/js/auth.js"></script>
  <script src="/panel/js/sidebar.js"></script>
  <script>
    async function loadDashboard() {
      const token = localStorage.getItem('neptune_token');
      const payload = api.parseJwt(token);
      const userId = payload && payload.id;

      const [domainsRes, dbsRes, ftpRes, userRes] = await Promise.all([
        api.get('/domains'),
        api.get('/databases'),
        api.get('/ftp'),
        userId ? api.get(`/users/${userId}`) : Promise.resolve(null),
      ]);

      if (domainsRes && domainsRes.ok) {
        const domains = await domainsRes.json();
        document.getElementById('w-domains').textContent = domains.length;
        renderDomainsTable(domains.slice(0, 5));
      }

      if (dbsRes && dbsRes.ok) {
        const dbs = await dbsRes.json();
        document.getElementById('w-dbs').textContent = dbs.length;
      }

      if (ftpRes && ftpRes.ok) {
        const ftp = await ftpRes.json();
        document.getElementById('w-ftp').textContent = ftp.length;
      }

      if (userRes && userRes.ok) {
        const user = await userRes.json();
        const used  = user.disk_used_mb  || 0;
        const quota = user.disk_quota_mb || 0;
        document.getElementById('w-disk-text').textContent = `${used} MB / ${quota} MB`;
        const pct = quota > 0 ? Math.min(100, Math.round(used / quota * 100)) : 0;
        document.getElementById('w-disk-bar').style.width = `${pct}%`;
      }
    }

    function renderDomainsTable(domains) {
      const tbody = document.getElementById('domains-table-body');
      if (!domains.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Aucun domaine</td></tr>';
        return;
      }
      tbody.innerHTML = domains.map(d => `
        <tr>
          <td>${d.name}</td>
          <td class="text-accent">${d.php_version || '—'}</td>
          <td class="${d.ssl_enabled ? 'text-success' : 'text-muted'}">${d.ssl_enabled ? '✓ SSL' : '—'}</td>
          <td class="${d.active ? 'text-success' : 'text-muted'}">${d.active ? 'Actif' : 'Inactif'}</td>
        </tr>
      `).join('');
    }

    document.addEventListener('DOMContentLoaded', loadDashboard);
  </script>
</body>
</html>
```

- [ ] **Step 2: Manual validation**

Log in via `http://localhost:<PORT>/panel/login.html` with valid credentials.
Expected after login:
- Redirected to `/panel/dashboard.html`
- Sidebar renders with correct username, role, and active link on Dashboard
- 4 widgets show numbers (or 0 if no data yet)
- Disk widget shows progress bar
- Domains table shows "Aucun domaine" or up to 5 rows

- [ ] **Step 3: Test logout**

Click the ⏻ button in the sidebar footer.
Expected: redirected to `/panel/login.html`, localStorage cleared.

- [ ] **Step 4: Test auth guard**

Clear localStorage manually (`localStorage.removeItem('neptune_token')` in devtools), then navigate to `/panel/dashboard.html`.
Expected: immediately redirected to `/panel/login.html`.

- [ ] **Step 5: Commit**

```bash
git add panel/dashboard.html
git commit -m "feat: add dashboard with 4 widgets and domains table"
```
