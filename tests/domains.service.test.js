require('dotenv').config();
const {
  createDomain, getDomainById, getHostname, listDomains, updateDomain, deactivateDomain,
} = require('../src/services/domains');
const { clearTables, createUser } = require('./helpers/db');

beforeEach(() => clearTables());

describe('domains service', () => {
  it('createDomain inserts domain with auto-calculated document_root', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    expect(domain.id).toBeDefined();
    expect(domain.name).toBe('example.com');
    expect(domain.type).toBe('domain');
    expect(domain.php_version).toBe('8.2');
    expect(domain.ssl_enabled).toBe(0);
    expect(domain.document_root).toMatch(/alice.*example\.com/);
  });

  it('createDomain for subdomain stores label and builds hostname document_root', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const parent = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    const sub = await createDomain({ userId: user.id, username: 'alice', name: 'blog', type: 'subdomain', parentDomainId: parent.id });
    expect(sub.name).toBe('blog');
    expect(sub.parent_domain_id).toBe(parent.id);
    expect(sub.document_root).toMatch(/blog\.example\.com/);
  });

  it('getDomainById returns null for unknown id', async () => {
    expect(await getDomainById(99999)).toBeNull();
  });

  it('getHostname returns name for domain, full hostname for subdomain', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const parent = await createDomain({ userId: user.id, username: 'alice', name: 'example.com', type: 'domain' });
    const sub = await createDomain({ userId: user.id, username: 'alice', name: 'blog', type: 'subdomain', parentDomainId: parent.id });
    expect(await getHostname(parent)).toBe('example.com');
    expect(await getHostname(sub)).toBe('blog.example.com');
  });

  it('listDomains as admin returns all active domains', async () => {
    const u1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const u2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    await createDomain({ userId: u1.id, username: 'u1', name: 'a.com', type: 'domain' });
    await createDomain({ userId: u2.id, username: 'u2', name: 'b.com', type: 'domain' });
    const list = await listDomains({ requestingUserId: u1.id, requestingRole: 'admin' });
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('listDomains as user returns only their domains', async () => {
    const u1 = await createUser({ username: 'u1', email: 'u1@t.com' });
    const u2 = await createUser({ username: 'u2', email: 'u2@t.com' });
    await createDomain({ userId: u1.id, username: 'u1', name: 'a.com', type: 'domain' });
    await createDomain({ userId: u2.id, username: 'u2', name: 'b.com', type: 'domain' });
    const list = await listDomains({ requestingUserId: u1.id, requestingRole: 'user' });
    expect(list.every(d => d.user_id === u1.id)).toBe(true);
    expect(list.some(d => d.name === 'a.com')).toBe(true);
  });

  it('updateDomain changes php_version only', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'x.com', type: 'domain' });
    const updated = await updateDomain(domain.id, { phpVersion: '8.3' });
    expect(updated.php_version).toBe('8.3');
    expect(updated.name).toBe('x.com');
  });

  it('deactivateDomain sets is_active to 0 and returns true', async () => {
    const user = await createUser({ username: 'alice', email: 'alice@t.com' });
    const domain = await createDomain({ userId: user.id, username: 'alice', name: 'x.com', type: 'domain' });
    expect(await deactivateDomain(domain.id)).toBe(true);
    const fetched = await getDomainById(domain.id);
    expect(fetched.is_active).toBe(0);
  });

  it('deactivateDomain returns false for unknown id', async () => {
    expect(await deactivateDomain(99999)).toBe(false);
  });
});
