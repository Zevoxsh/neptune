const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// Lazy accessors — read env vars at call time so tests can override in beforeAll
function apacheDir() { return process.env.APACHE_VHOST_DIR || '/etc/apache2/sites-available'; }
function nginxDir() { return process.env.NGINX_VHOST_DIR || '/etc/nginx/sites-available'; }
function reloadScript() { return process.env.NEPTUNE_RELOAD_WEB || '/usr/local/bin/neptune-reload-web'; }
function certbotScript() { return process.env.NEPTUNE_CERTBOT || '/usr/local/bin/neptune-certbot'; }

function generateApacheConfig({ hostname, documentRoot, phpVersion }) {
  return `<VirtualHost *:8080>
    ServerName ${hostname}
    DocumentRoot ${documentRoot}

    <Directory "${documentRoot}">
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch "\\.php$">
        SetHandler "proxy:unix:/run/php/php${phpVersion}-fpm.sock|fcgi://localhost"
    </FilesMatch>
</VirtualHost>
`;
}

function generateNginxConfig({ hostname, documentRoot, sslEnabled = false, certPath = null, keyPath = null }) {
  const sslBlock = sslEnabled && certPath && keyPath ? `
server {
    listen 443 ssl http2;
    server_name ${hostname};
    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}` : '';

  return `server {
    listen 80;
    server_name ${hostname};

    location /.well-known/acme-challenge/ {
        root ${documentRoot};
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
${sslBlock}`;
}

async function writeVhostFiles({ hostname, documentRoot, phpVersion, sslEnabled = false, certPath = null, keyPath = null }) {
  await fs.mkdir(apacheDir(), { recursive: true });
  await fs.mkdir(nginxDir(), { recursive: true });
  await fs.writeFile(
    path.join(apacheDir(), `neptune-${hostname}.conf`),
    generateApacheConfig({ hostname, documentRoot, phpVersion }),
    'utf8'
  );
  await fs.writeFile(
    path.join(nginxDir(), `neptune-${hostname}.conf`),
    generateNginxConfig({ hostname, documentRoot, sslEnabled, certPath, keyPath }),
    'utf8'
  );
}

async function removeVhostFiles(hostname) {
  await Promise.all([
    fs.unlink(path.join(apacheDir(), `neptune-${hostname}.conf`)).catch(() => {}),
    fs.unlink(path.join(nginxDir(), `neptune-${hostname}.conf`)).catch(() => {}),
  ]);
}

async function reloadWeb() {
  await execFileAsync('sudo', [reloadScript()]);
}

async function runCertbot(domain, webroot) {
  await execFileAsync('sudo', [certbotScript(), domain, webroot]);
}

module.exports = { generateApacheConfig, generateNginxConfig, writeVhostFiles, removeVhostFiles, reloadWeb, runCertbot };
