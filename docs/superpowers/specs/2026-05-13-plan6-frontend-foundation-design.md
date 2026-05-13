# Neptune Plan 6 — Frontend Foundation

**Date:** 2026-05-13
**Statut:** Approuvé

---

## Goal

Mettre en place la fondation du panel web Neptune : Express sert les fichiers statiques du panel, la page de login gère l'authentification JWT, une sidebar commune est injectée via JS sur chaque page, et le dashboard affiche les 4 widgets principaux.

---

## Architecture

Navigation multi-page (un fichier HTML par section). Les éléments communs (sidebar, thème CSS, couche API) sont des fichiers JS/CSS partagés inclus dans chaque page. Aucun framework JS — vanilla uniquement.

```
panel/
├── login.html
├── dashboard.html
├── css/
│   └── main.css
└── js/
    ├── api.js
    ├── auth.js
    └── sidebar.js
```

`src/app.js` est modifié pour servir `panel/` comme répertoire de fichiers statiques et rediriger `/` vers la page de login.

---

## Fichiers

| Fichier | Action | Rôle |
|---------|--------|------|
| `panel/css/main.css` | Créer | Thème Dark Indigo complet |
| `panel/js/api.js` | Créer | Fetch wrapper avec auth + auto-refresh |
| `panel/js/auth.js` | Créer | Guard auth sur pages protégées |
| `panel/js/sidebar.js` | Créer | Render sidebar + highlight page active |
| `panel/login.html` | Créer | Page de login |
| `panel/dashboard.html` | Créer | Dashboard avec widgets |
| `src/app.js` | Modifier | Servir panel/, redirect `/` |

---

## `src/app.js` — modifications

Ajouter avant le handler 404 :

```js
const path = require('path');
app.use('/panel', express.static(path.join(__dirname, '../panel')));
app.get('/', (_req, res) => res.redirect('/panel/login.html'));
```

---

## `panel/css/main.css` — thème Dark Indigo

Variables CSS globales :

```css
:root {
  --bg:       #0f172a;
  --surface:  #1e293b;
  --border:   #334155;
  --accent:   #6366f1;
  --accent-hover: #4f46e5;
  --text:     #e2e8f0;
  --muted:    #94a3b8;
  --dim:      #475569;
  --success:  #10b981;
  --warning:  #f59e0b;
  --danger:   #ef4444;
}
```

Styles couverts :
- `body`, `*` — reset, box-sizing, font (system-ui)
- Layout : `.layout` (flex, 100vh), `#sidebar` (220px fixe), `#main` (flex:1, flex-direction:column)
- Sidebar : fond `--bg`, border-right `--border`, `.nav-section` (label uppercase muted), `.nav-item` (hover, active state avec `--accent` border-left)
- Topbar : `.topbar` (border-bottom, padding)
- Contenu : `.page-content` (padding 24px, overflow-y auto)
- Widgets : `.widget-grid` (4 colonnes), `.widget` (card surface, border, border-radius 8px)
- Tables : `.table` (width 100%, border-collapse), `th`/`td` styles
- Boutons : `.btn`, `.btn-primary` (accent), `.btn-danger` (red), `.btn-sm`
- Formulaires : `.form-group`, `label`, `input[type=text/password/email]`, `.form-error` (rouge)
- Utilitaires : `.badge` (pill), `.text-muted`, `.text-success`, `.text-warning`

---

## `panel/js/api.js` — fetch wrapper

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
  get:    (path)        => apiFetch('GET',    path),
  post:   (path, body)  => apiFetch('POST',   path, body),
  put:    (path, body)  => apiFetch('PUT',    path, body),
  delete: (path)        => apiFetch('DELETE', path),
  parseJwt,
};

window.api = api;
```

---

## `panel/js/auth.js` — guard pages protégées

Appelé dans chaque page protégée (pas login.html) :

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

---

## `panel/js/sidebar.js` — sidebar commune

Injecte le HTML de la sidebar dans `<div id="sidebar">`. Surligne le lien actif en comparant `location.pathname`.

Structure injectée :
- Logo/nom "⚡ NEPTUNE" + hostname du serveur (variable globale `window.NEPTUNE_HOST` ou fallback `location.hostname`)
- Sections de navigation (items avec href vers les pages HTML correspondantes)
- Footer utilisateur : avatar initiale, username, rôle, bouton déconnexion
- Items `⚙️ Serveur` et `👤 Comptes` cachés si `payload.role === 'client'` ; `⚙️ Serveur` caché si `payload.role !== 'admin'`

Navigation complète :

| Item | href | Roles |
|------|------|-------|
| 📊 Dashboard | /panel/dashboard.html | tous |
| 🌐 Domaines | /panel/domains.html | tous |
| 🗄️ Bases de données | /panel/databases.html | admin, user |
| 📂 Gestionnaire | /panel/files.html | tous |
| 🔑 Comptes FTP | /panel/ftp.html | admin, user |
| 🔒 SSL | /panel/ssl.html | admin, user |
| 👤 Comptes | /panel/accounts.html | admin, user |
| ⚙️ Serveur | /panel/server.html | admin seulement |

Déconnexion : bouton dans le footer → POST `/api/auth/logout` → clear localStorage → redirect login.

---

## `panel/login.html`

Structure :
- `<head>` : `main.css`
- `<body>` : div centré (flexbox plein écran), card 360px
- Card : logo "⚡ NEPTUNE", sous-titre, form (username + password), bouton "Se connecter", div `.form-error` (caché par défaut)
- `<script>` inline :
  - `submitLogin()` : POST `/api/auth/login` avec `{ username, password }`
  - Si 200 → stocker `data.token` dans localStorage → redirect `/panel/dashboard.html`
  - Si 401/429 → afficher message d'erreur dans `.form-error`
  - Enter key sur les champs déclenche `submitLogin()`

---

## `panel/dashboard.html`

Structure :
- `<head>` : `main.css`
- `<body>` : `<div class="layout">` → `<div id="sidebar">` + `<div id="main">` (topbar + page-content)
- `<script src="/panel/js/api.js">` → `<script src="/panel/js/auth.js">` → `<script src="/panel/js/sidebar.js">` → script inline
- Script inline appelle `loadDashboard()` au `DOMContentLoaded`

`loadDashboard()` :
1. Décode le JWT → récupère `userId`
2. `Promise.all` sur 4 appels parallèles :
   - `GET /api/domains` → count domains
   - `GET /api/databases` → count databases
   - `GET /api/ftp` → count FTP accounts
   - `GET /api/users/:userId` → `disk_used_mb`, `disk_quota_mb`
3. Remplit les 4 widgets :
   - Domaines actifs (count, couleur accent)
   - Bases de données (count, vert)
   - Comptes FTP (count, couleur muted)
   - Disque : barre de progression (`disk_used_mb / disk_quota_mb * 100`%), texte `X MB / Y MB`
4. Remplit le tableau "Domaines récents" : 5 premiers domaines, colonnes nom / PHP / SSL / statut

---

## Sécurité

- Le token JWT n'est pas httpOnly (stocké en localStorage) — compromis accepté pour une app de panel admin, pas une appli publique
- Le refresh token est httpOnly : non accessible en JS
- `api.js` envoie `credentials: 'include'` pour les cookies sur toutes les requêtes
- Aucun secret côté client — le JWT est signé côté serveur, décodé (pas vérifié) côté client uniquement pour affichage
- Les fichiers statiques sont publics (pas d'auth serveur) — `auth.js` protège client-side, la vraie protection est sur l'API

---

## Tests

Pas de tests automatisés pour le frontend dans ce plan — validation manuelle :
- Login avec identifiants corrects → redirect dashboard
- Login avec mauvais identifiants → message d'erreur affiché
- Dashboard charge et affiche les 4 widgets
- Sidebar highlight correct sur chaque page
- Déconnexion → redirect login
- Refresh automatique du token (à tester manuellement en expirant le token)
