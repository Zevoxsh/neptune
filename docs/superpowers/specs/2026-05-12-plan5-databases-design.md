# Neptune Plan 5 — MySQL Database Management

**Date:** 2026-05-12
**Statut:** Approuvé

---

## Goal

Permettre aux utilisateurs (admin et user) de créer, lister, réinitialiser le mot de passe et supprimer des bases de données MySQL depuis l'API Neptune. Chaque base de données possède un user MySQL dédié avec un mot de passe généré aléatoirement, affiché une seule fois à la création.

---

## Architecture

Les opérations MySQL (CREATE DATABASE, CREATE USER, GRANT, DROP, ALTER USER) passent par une connexion `mysql2` dédiée utilisant un user MariaDB `neptune_admin` avec les privilèges nécessaires — pas de scripts sudo, ce sont des requêtes SQL pures qui ne nécessitent pas de privilèges OS.

La table `databases` existe déjà dans la migration `001_initial.sql`. Elle utilise une suppression physique (hard-delete) — pas de champ `is_active`.

```
POST /api/databases
  → src/api/databases.js
  → src/services/databases.js   (nommage, validation, bcrypt)
  → src/system/mysql.js         (pool neptune_admin, opérations brutes)
  → MariaDB (databases table)   (enregistrement)
```

---

## Fichiers

| Fichier | Action | Rôle |
|---------|--------|------|
| `src/system/mysql.js` | Créer | Pool dédié neptune_admin, opérations brutes MySQL |
| `src/services/databases.js` | Créer | Logique métier, nommage, bcrypt |
| `src/api/databases.js` | Créer | 5 endpoints REST |
| `src/api/index.js` | Modifier | Enregistrer `/databases` |
| `tests/databases.service.test.js` | Créer | Tests service |

---

## `src/system/mysql.js`

Singleton pool lazy — lit les variables d'environnement à l'appel (pas au chargement du module) :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `NEPTUNE_MYSQL_MGMT_HOST` | `127.0.0.1` | Hôte MariaDB |
| `NEPTUNE_MYSQL_MGMT_PORT` | `3306` | Port |
| `NEPTUNE_MYSQL_MGMT_USER` | — | User neptune_admin |
| `NEPTUNE_MYSQL_MGMT_PASS` | — | Mot de passe neptune_admin |

**Fonctions exportées :**

```js
createDatabase(dbName, dbUser, password)
// CREATE DATABASE `dbName`
// CREATE USER 'dbUser'@'localhost' IDENTIFIED BY password
// GRANT ALL PRIVILEGES ON `dbName`.* TO 'dbUser'@'localhost'
// FLUSH PRIVILEGES

dropDatabase(dbName, dbUser)
// DROP DATABASE IF EXISTS `dbName`
// DROP USER IF EXISTS 'dbUser'@'localhost'
// FLUSH PRIVILEGES

changePassword(dbUser, newPassword)
// ALTER USER 'dbUser'@'localhost' IDENTIFIED BY newPassword
// FLUSH PRIVILEGES

getDatabaseSizeMb(dbName)
// SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
// FROM information_schema.TABLES WHERE table_schema = dbName
// Retourne 0 si DB vide ou inexistante
```

Les identifiants (`dbName`, `dbUser`) sont injectés via `??` (escape natif mysql2). Les mots de passe sont passés comme valeurs paramétrées `?`.

En cas d'erreur MySQL, la fonction laisse remonter l'erreur brute — le service gère les codes (`ER_DB_CREATE_EXISTS`, etc.).

---

## `src/services/databases.js`

### Nommage

L'utilisateur fournit un `name` validé par `/^[a-zA-Z0-9_]{1,32}$/`.

Neptune génère :
- `db_name = username + '_' + name` — doit tenir en 64 chars (erreur `DB_NAME_TOO_LONG` sinon)
- `db_user = username + '_' + name` tronqué à 32 chars si nécessaire

### Constantes

```js
const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 1 : 12;
const DB_NAME_RE = /^[a-zA-Z0-9_]{1,32}$/;
const DB_FIELDS = 'id, user_id, db_name, db_user, size_mb, created_at';
```

`db_password_hash` est exclu de `DB_FIELDS` — jamais retourné dans les réponses.

### Fonctions exportées

**`createDatabase({ userId, name })`**
1. Valide `name` contre `DB_NAME_RE` → `INVALID_DB_NAME`
2. Récupère l'utilisateur via `getUserById` → `NOT_FOUND`
3. Construit `db_name` et `db_user`, vérifie longueurs → `DB_NAME_TOO_LONG`
4. Génère password : `crypto.randomBytes(16).toString('hex')` (32 chars)
5. Hash bcrypt
6. Appelle `mysql.createDatabase(db_name, db_user, password)`
7. INSERT dans `databases`
8. Retourne le row DB + `{ password }` (plaintext, une seule fois)

Codes d'erreur levés : `INVALID_DB_NAME`, `NOT_FOUND`, `DB_NAME_TOO_LONG`, `ER_DB_CREATE_EXISTS` (propagé depuis mysql2 → mappé 409 dans l'API)

**`listDatabases({ requestingUserId, requestingRole })`**
- admin : SELECT all, rafraîchit `size_mb` pour chaque ligne (via `getDatabaseSizeMb`, en parallèle)
- sinon : SELECT WHERE user_id = requestingUserId, même refresh
- Met à jour `size_mb` dans la table en parallèle (fire-and-forget `.catch`)
- Retourne les rows

**`getDatabaseById(id)`**
- SELECT par id
- Rafraîchit `size_mb` depuis information_schema, met à jour la table
- Retourne le row ou `null`

**`resetDatabasePassword(id)`**
1. Récupère le record → `NOT_FOUND`
2. Génère nouveau password (même format)
3. Hash bcrypt
4. Appelle `mysql.changePassword(db_user, newPassword)`
5. UPDATE `db_password_hash` dans la table
6. Retourne `{ password }` (plaintext, une seule fois)

**`dropDatabase(id)`**
1. Récupère le record → `NOT_FOUND`
2. Appelle `mysql.dropDatabase(db_name, db_user)` best-effort (`.catch` logge l'erreur, n'interrompt pas)
3. DELETE FROM databases WHERE id = ?

---

## `src/api/databases.js`

### Middleware commun

```js
function canAccessDatabase(requester, db) {
  if (requester.role === 'admin') return true;
  return db.user_id === requester.id;
}
```

### Endpoints

**`GET /api/databases`** — `requireAuth`
- Appelle `listDatabases({ requestingUserId: req.user.id, requestingRole: req.user.role })`
- Retourne `{ databases: [...] }`

**`POST /api/databases`** — `requireAuth`, `requireRole('admin', 'user')`
- Body : `{ name }`
- Valide présence de `name`
- Appelle `createDatabase({ userId: req.user.id, name })`
- Retourne 201 `{ database, password }` — password affiché une seule fois
- Codes : 400 `INVALID_DB_NAME`, 400 `DB_NAME_TOO_LONG`, 409 `ER_DB_CREATE_EXISTS`

**`GET /api/databases/:id`** — `requireAuth`
- Appelle `getDatabaseById(id)`
- 404 si non trouvé, 403 si `!canAccessDatabase`
- Retourne `{ database }`

**`PUT /api/databases/:id/password`** — `requireAuth`
- Appelle `getDatabaseById(id)` → 404/403
- Appelle `resetDatabasePassword(id)`
- Retourne `{ ok: true, password }` — nouveau password affiché une seule fois
- Code : 502 si `SCRIPT_ERROR` (inutilisé ici mais cohérent avec le pattern)

**`DELETE /api/databases/:id`** — `requireAuth`, `requireRole('admin', 'user')`
- Appelle `getDatabaseById(id)` → 404/403
- Appelle `dropDatabase(id)`
- Audit log
- Retourne `{ ok: true }`

### Audit

`create_database` et `delete_database` sont loggés via `audit.log(...)`.

---

## Tests — `tests/databases.service.test.js`

Mock de `src/system/mysql` :
```js
jest.mock('../src/system/mysql', () => ({
  createDatabase: jest.fn().mockResolvedValue(undefined),
  dropDatabase: jest.fn().mockResolvedValue(undefined),
  changePassword: jest.fn().mockResolvedValue(undefined),
  getDatabaseSizeMb: jest.fn().mockResolvedValue(0),
}));
```

Cas couverts :
- `createDatabase` — insère en DB, retourne password plaintext, hash différent du password
- `createDatabase` — `INVALID_DB_NAME` pour nom invalide
- `createDatabase` — `NOT_FOUND` pour userId inexistant
- `createDatabase` — `DB_NAME_TOO_LONG` si username + name dépasse 64
- `listDatabases` — admin voit tout, user voit seulement les siennes
- `getDatabaseById` — retourne null pour id inexistant
- `resetDatabasePassword` — nouveau hash différent de l'ancien
- `dropDatabase` — DELETE le record, best-effort sur l'erreur MySQL

---

## Sécurité

- `db_password_hash` exclu de tous les champs SELECT exposés à l'API
- Password en clair uniquement dans la réponse de création et de reset — jamais en DB
- Identifiants MySQL escapés via `??` — pas d'injection SQL possible
- `requireRole('admin', 'user')` sur POST et DELETE — les clients ne peuvent pas créer ni supprimer
- `canAccessDatabase` vérifié sur tous les endpoints à accès restreint

---

## Variables d'environnement

| Variable | Usage |
|----------|-------|
| `NEPTUNE_MYSQL_MGMT_HOST` | Hôte du serveur MariaDB (défaut: `127.0.0.1`) |
| `NEPTUNE_MYSQL_MGMT_PORT` | Port MariaDB (défaut: `3306`) |
| `NEPTUNE_MYSQL_MGMT_USER` | User `neptune_admin` |
| `NEPTUNE_MYSQL_MGMT_PASS` | Mot de passe de `neptune_admin` |
