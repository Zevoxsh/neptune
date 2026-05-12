const path = require('path');
const os = require('os');
const fs = require('fs/promises');

const TMP = path.join(os.tmpdir(), `neptune-vhost-test-${Date.now()}`);

beforeAll(async () => {
  process.env.APACHE_VHOST_DIR = path.join(TMP, 'apache2', 'sites-available');
  process.env.NGINX_VHOST_DIR = path.join(TMP, 'nginx', 'sites-available');
  await fs.mkdir(process.env.APACHE_VHOST_DIR, { recursive: true });
  await fs.mkdir(process.env.NGINX_VHOST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

const { generateApacheConfig, generateNginxConfig, writeVhostFiles, removeVhostFiles } = require('../src/system/vhost');

describe('vhost config generation', () => {
  it('generateApacheConfig contains ServerName, DocumentRoot and PHP-FPM socket', () => {
    const config = generateApacheConfig({ hostname: 'example.com', documentRoot: '/var/www/alice/example.com', phpVersion: '8.2' });
    expect(config).toContain('ServerName example.com');
    expect(config).toContain('DocumentRoot /var/www/alice/example.com');
    expect(config).toContain('php8.2-fpm.sock');
    expect(config).toContain('VirtualHost *:8080');
  });

  it('generateNginxConfig HTTP-only has server_name, proxy_pass, no 443 block', () => {
    const config = generateNginxConfig({ hostname: 'example.com', documentRoot: '/var/www/alice/example.com' });
    expect(config).toContain('server_name example.com');
    expect(config).toContain('proxy_pass http://127.0.0.1:8080');
    expect(config).not.toContain('listen 443');
  });

  it('generateNginxConfig with SSL adds listen 443 block and cert paths', () => {
    const config = generateNginxConfig({
      hostname: 'example.com',
      documentRoot: '/var/www/alice/example.com',
      sslEnabled: true,
      certPath: '/etc/letsencrypt/live/example.com/fullchain.pem',
      keyPath: '/etc/letsencrypt/live/example.com/privkey.pem',
    });
    expect(config).toContain('listen 443 ssl http2');
    expect(config).toContain('ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem');
    expect(config).toContain('ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem');
  });
});

describe('vhost file operations', () => {
  it('writeVhostFiles creates apache and nginx config files with correct content', async () => {
    await writeVhostFiles({ hostname: 'test.com', documentRoot: '/var/www/alice/test.com', phpVersion: '8.1' });
    const apacheContent = await fs.readFile(path.join(process.env.APACHE_VHOST_DIR, 'neptune-test.com.conf'), 'utf8');
    const nginxContent = await fs.readFile(path.join(process.env.NGINX_VHOST_DIR, 'neptune-test.com.conf'), 'utf8');
    expect(apacheContent).toContain('ServerName test.com');
    expect(apacheContent).toContain('php8.1-fpm.sock');
    expect(nginxContent).toContain('server_name test.com');
  });

  it('removeVhostFiles deletes both config files', async () => {
    await writeVhostFiles({ hostname: 'del.com', documentRoot: '/tmp/del', phpVersion: '8.2' });
    await removeVhostFiles('del.com');
    await expect(fs.access(path.join(process.env.APACHE_VHOST_DIR, 'neptune-del.com.conf'))).rejects.toThrow();
    await expect(fs.access(path.join(process.env.NGINX_VHOST_DIR, 'neptune-del.com.conf'))).rejects.toThrow();
  });

  it('removeVhostFiles does not throw if files do not exist', async () => {
    await expect(removeVhostFiles('nonexistent.com')).resolves.not.toThrow();
  });
});
