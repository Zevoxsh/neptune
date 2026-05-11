require('dotenv').config();
const pool = require('../src/db/index');

describe('database pool', () => {
  it('connects to MariaDB and returns a result', async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
  });

  it('has all required tables', async () => {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    );
    const tables = rows.map(r => r.TABLE_NAME);
    expect(tables).toEqual(expect.arrayContaining([
      'users', 'domains', 'ssl_certificates', 'databases',
      'ftp_accounts', 'audit_logs', 'client_permissions', 'refresh_tokens',
    ]));
  });
});
