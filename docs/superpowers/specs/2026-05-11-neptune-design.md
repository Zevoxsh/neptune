# Neptune — Panel d'hébergement web

**Date:** 2026-05-11
**Statut:** Approuvé

---

## Vue d'ensemble

Neptune est un panel d'hébergement web custom, développé from scratch, qui tourne sur un seul serveur Linux (VPS ou dédié). Il permet de gérer des sites web (HTML, PHP, JS, CSS), des domaines et sous-domaines, des comptes utilisateurs à trois niveaux, des certificats SSL, des bases de données MySQL et des accès FTP/SFTP. Aucun framework tiers d'hébergement (Plesk, cPanel, WordPress) n'est utilisé — tout est développé maison.

---

## Architecture

### Vue d'ensemble

```
[Navigateur admin/user]  [Sites hébergés]  [FTP/SFTP]
        |                       |               |
        | HTTPS :443            | HTTP/HTTPS     | :21/:22
        v                       v               v
┌─────────────────────────────────────────────────────┐
│              Nginx — Reverse Proxy                  │
│  panel.domain.com → Node.js :3000                   │
│  *.domain.com / domaines users → Apache :8080       │
│  Terminaison SSL (Let's Encrypt + manuel)            │
└─────────────────────────────────────────────────────┘
          |                        |
          v                        v
┌──────────────────┐    ┌─────────────────────────┐
│ Neptune (Node.js)│    │  Apache :8080            │
│   Express API    │    │  Sites des utilisateurs  │
│   Auth JWT       │    │  PHP via PHP-FPM         │
│   File manager   │    │  .htaccess natif         │
│   SSL (Certbot)  │    │  Vhosts auto-générés     │
│   PHP-FPM mgmt   │    └─────────────────────────┘
│   FTP (ProFTPD)  │
│   Cmds système   │
└──────────────────┘
          |
          v
┌──────────────────────────────────────┐
│  MariaDB  │  PHP-FPM pools  │ ProFTPD│
└──────────────────────────────────────┘
```

### Stack technique

| Composant | Technologie |
|-----------|-------------|
| Backend panel | Node.js (Express) |
| Base de données | MariaDB |
| Reverse proxy | Nginx |
| Serveur sites | Apache :8080 |
| PHP | PHP-FPM multi-version (7.4, 8.0, 8.1, 8.2, 8.3) |
| FTP | ProFTPD |
| SSL | Certbot (Let's Encrypt) + upload manuel |
| Auth | JWT (access token + refresh token) |
| Frontend panel | HTML / CSS / JS vanilla (pas de framework) |

### Principe de fonctionnement système

Neptune tourne en tant qu'utilisateur `neptune` (non-root). Pour les opérations système nécessitant des privilèges (reload Nginx/Apache, Certbot, gestion PHP-FPM, création users Linux/FTP), il invoque des scripts via `sudo` avec une liste blanche stricte dans `/etc/sudoers.d/neptune`. Chaque script système est minimal, auditable, et n'accepte que des arguments validés.

---

## Base de données

### Table `users`

```sql
id            INT PRIMARY KEY AUTO_INCREMENT
username      VARCHAR(64) UNIQUE NOT NULL
email         VARCHAR(255) UNIQUE NOT NULL
password_hash VARCHAR(255) NOT NULL
role          ENUM('admin', 'user', 'client') NOT NULL
parent_id     INT NULL REFERENCES users(id)   -- client → user parent
disk_quota_mb INT NOT NULL DEFAULT 5120
disk_used_mb  INT NOT NULL DEFAULT 0
is_active     BOOLEAN NOT NULL DEFAULT TRUE
created_at    DATETIME NOT NULL DEFAULT NOW()
```

### Table `domains`

```sql
id               INT PRIMARY KEY AUTO_INCREMENT
user_id          INT NOT NULL REFERENCES users(id)
name             VARCHAR(253) NOT NULL             -- ex: monsite.com
type             ENUM('domain', 'subdomain') NOT NULL
parent_domain_id INT NULL REFERENCES domains(id)  -- pour sous-domaines
document_root    VARCHAR(500) NOT NULL             -- chemin absolu
php_version      VARCHAR(10) NOT NULL DEFAULT '8.2'
ssl_enabled      BOOLEAN NOT NULL DEFAULT FALSE
ssl_type         ENUM('letsencrypt', 'manual') NULL
is_active        BOOLEAN NOT NULL DEFAULT TRUE
created_at       DATETIME NOT NULL DEFAULT NOW()
```

### Table `ssl_certificates`

```sql
id          INT PRIMARY KEY AUTO_INCREMENT
domain_id   INT NOT NULL REFERENCES domains(id)
type        ENUM('letsencrypt', 'manual') NOT NULL
cert_path   VARCHAR(500) NOT NULL
key_path    VARCHAR(500) NOT NULL
expires_at  DATETIME NOT NULL
auto_renew  BOOLEAN NOT NULL DEFAULT TRUE
created_at  DATETIME NOT NULL DEFAULT NOW()
```

### Table `databases`

```sql
id              INT PRIMARY KEY AUTO_INCREMENT
user_id         INT NOT NULL REFERENCES users(id)
db_name         VARCHAR(64) NOT NULL UNIQUE
db_user         VARCHAR(32) NOT NULL UNIQUE
db_password_hash VARCHAR(255) NOT NULL
size_mb         INT NOT NULL DEFAULT 0
created_at      DATETIME NOT NULL DEFAULT NOW()
```

### Table `ftp_accounts`

```sql
id               INT PRIMARY KEY AUTO_INCREMENT
user_id          INT NOT NULL REFERENCES users(id)
ftp_username     VARCHAR(64) NOT NULL UNIQUE
ftp_password_hash VARCHAR(255) NOT NULL
home_dir         VARCHAR(500) NOT NULL
is_active        BOOLEAN NOT NULL DEFAULT TRUE
created_at       DATETIME NOT NULL DEFAULT NOW()
```

### Table `audit_logs`

```sql
id          INT PRIMARY KEY AUTO_INCREMENT
user_id     INT NOT NULL REFERENCES users(id)
action      VARCHAR(100) NOT NULL     -- ex: create_domain, delete_user
target_type VARCHAR(50) NULL          -- ex: domain, user, database
target_id   INT NULL
ip_address  VARCHAR(45) NOT NULL
details     JSON NULL
created_at  DATETIME NOT NULL DEFAULT NOW()
```

---

## Interface utilisateur

### Layout général

Sidebar complète à gauche (style Plesk) avec texte et sous-menus, contenu principal à droite. Thème **Dark Indigo** : fond `#0f172a`, accents `#6366f1`, texte `#e2e8f0`.

### Structure de navigation

```
Neptune
├── Dashboard               (stats : sites, BDD, disque, SSL expirant)
├── 🌐 Domaines
│   ├── Mes domaines        (liste + statut SSL + version PHP)
│   └── Sous-domaines       (liste par domaine parent)
├── 🗄️ Bases de données     (liste, créer, supprimer, phpMyAdmin link)
├── 📂 Fichiers
│   ├── Gestionnaire web    (drag & drop, upload, édition code)
│   └── Comptes FTP         (liste, créer, modifier mdp)
├── 🔒 SSL                  (état par domaine, Let's Encrypt, upload)
├── 👤 Comptes              (admin: tous | user: ses clients)
└── ⚙️ Serveur              (admin seulement: Nginx, Apache, PHP pools)
```

### Pages clés

**Dashboard** — widgets : nombre de domaines actifs, SSL expirant dans 30j, utilisation disque (barre de progression), bases de données.

**Domaines** — tableau avec colonnes : nom, type, PHP version, SSL, statut, actions. Bouton "Ajouter domaine" ouvre un formulaire : nom + document root auto-calculé + choix PHP version.

**Gestionnaire de fichiers** — arborescence navigable, actions : upload (drag & drop), créer dossier/fichier, renommer, supprimer, éditer (éditeur de code intégré avec coloration syntaxique via CodeMirror).

**SSL** — par domaine : bouton "Activer Let's Encrypt" (lance Certbot), ou section upload cert/clé manuel. Affiche date d'expiration et statut renouvellement auto.

**Bases de données** — liste des BDD avec taille, bouton phpMyAdmin (SSO token), créer nouvelle BDD (génère user MySQL dédié avec mot de passe aléatoire).

---

## Système de comptes & permissions

### Hiérarchie

```
Admin
└── User (hébergeur / agence)
    └── Client (client final de l'agence)
```

### Matrice de permissions

| Action | Admin | User | Client |
|--------|-------|------|--------|
| Ajouter domaine | ✅ tous | ✅ les siens | ❌ |
| Ajouter sous-domaine | ✅ tous | ✅ les siens | ✅ si autorisé |
| Choisir version PHP | ✅ | ✅ | ⚠️ si autorisé |
| SSL Let's Encrypt | ✅ | ✅ | ❌ |
| Upload cert SSL manuel | ✅ | ✅ | ❌ |
| Gestionnaire fichiers | ✅ tous | ✅ les siens | ✅ son dossier |
| Créer compte FTP | ✅ | ✅ | ❌ |
| Créer base MySQL | ✅ | ✅ | ❌ |
| phpMyAdmin | ✅ | ✅ | ❌ |
| Créer comptes | ✅ tous | ✅ clients seulement | ❌ |
| Gérer serveur (Nginx/Apache) | ✅ | ❌ | ❌ |
| Voir audit logs | ✅ tout | ✅ les siens | ❌ |
| Définir quotas disque | ✅ | ⚠️ voit les siens | ❌ |

### Autorisations granulaires des clients

Quand un User crée un Client, il peut cocher des permissions optionnelles :
- Autoriser la création de sous-domaines (oui/non)
- Autoriser le choix de la version PHP (oui/non)

Ces flags sont stockés dans une table `client_permissions (user_id, permission_key, allowed)`. Les routes API vérifient ces flags pour les requêtes faites par des comptes de rôle `client`.

### Authentification

- JWT avec access token (15 min) + refresh token (7 jours, stocké en cookie httpOnly)
- Hashage des mots de passe : bcrypt (cost factor 12)
- Rate limiting sur `/api/auth/login` : 5 tentatives / 15 min par IP

---

## Modules système

### Gestion des vhosts

Quand un domaine est créé/modifié/supprimé, Neptune génère automatiquement :
1. Un fichier de config Apache dans `/etc/apache2/sites-available/neptune-{domain}.conf`
2. Un fichier de config Nginx dans `/etc/nginx/sites-available/neptune-{domain}.conf`
3. Reload Nginx et Apache via `sudo /usr/local/bin/neptune-reload-web`

### Gestion PHP-FPM

Un pool PHP-FPM par version disponible. Chaque site est assigné à un pool via la config Apache (`ProxyPassMatch` vers le socket FPM de la version choisie). Neptune peut activer/désactiver les extensions par version via `php{version}-cli --ini` et redémarrage du pool concerné.

### SSL — Let's Encrypt

Neptune exécute `sudo certbot certonly --webroot` pour chaque domaine. Le renouvellement automatique est géré par un cron système. Neptune stocke le chemin des certs dans `ssl_certificates` et met à jour la config Nginx/Apache en conséquence.

### Gestionnaire de fichiers

- API REST pour lister/lire/écrire/supprimer des fichiers
- Chroot strict : chaque user ne peut accéder qu'à son `document_root` et sous-dossiers
- Upload multipart avec limite configurable (défaut : 100 MB)
- Éditeur : CodeMirror intégré (coloration HTML, PHP, JS, CSS, JSON)

### FTP — ProFTPD

Neptune gère ProFTPD via sa base SQL (module `mod_sql`). Créer un compte FTP = insérer dans `ftp_accounts` + `neptune-reload-ftp` sudo. Pas de compte système Linux créé — ProFTPD lit directement depuis la BDD.

### Bases de données MySQL

Créer une BDD = `CREATE DATABASE`, `CREATE USER`, `GRANT`. Tout via un user MySQL dédié `neptune_admin` avec permissions limitées. Le mot de passe MySQL de l'utilisateur est généré aléatoirement (32 chars), affiché une seule fois, stocké hashé.

---

## Structure des fichiers du projet

```
neptune/
├── src/
│   ├── api/              # Routes Express (auth, domains, files, ssl, db, ftp)
│   ├── middleware/       # Auth JWT, RBAC, rate limiter, chroot checker
│   ├── services/         # Logique métier (domain, ssl, php, ftp, mysql)
│   ├── system/           # Wrappers pour commandes système (sudo scripts)
│   ├── db/               # Migrations SQL, pool MariaDB
│   └── app.js            # Point d'entrée Express
├── panel/                # Frontend HTML/CSS/JS vanilla
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── pages/
├── scripts/              # Scripts système exécutés via sudo
│   ├── neptune-reload-web.sh
│   ├── neptune-reload-ftp.sh
│   ├── neptune-certbot.sh
│   └── neptune-php-reload.sh
├── templates/            # Templates de config Nginx/Apache
├── docs/
└── package.json
```

---

## Contraintes & sécurité

- Aucune exécution de commande système directe depuis l'API — tout passe par les scripts `sudo` de la liste blanche
- Validation stricte de tous les noms de domaine (regex RFC), chemins de fichiers (chroot), noms de BDD
- Pas d'injection SQL possible : requêtes paramétrées uniquement
- Frontend servi depuis le même process Node.js (fichiers statiques `panel/`)
- HTTPS obligatoire pour le panel (cert auto ou manuel)
- Headers de sécurité : `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`
