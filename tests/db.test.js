require('dotenv').config();
const pool = require('../src/db/index');

describe('database pool', () => {
  it('connects to MariaDB and returns a result', async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
  });
});
