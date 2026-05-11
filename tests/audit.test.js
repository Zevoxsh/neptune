require('dotenv').config();
const { log } = require('../src/services/audit');
const pool = require('../src/db/index');
const { clearTables, createUser } = require('./helpers/db');

beforeEach(() => clearTables());

describe('audit.log', () => {
  it('inserts an audit log entry with required fields', async () => {
    const user = await createUser();
    await log({ userId: user.id, action: 'test_action', ip: '127.0.0.1' });
    const [rows] = await pool.query('SELECT * FROM audit_logs WHERE user_id = ?', [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('test_action');
    expect(rows[0].ip_address).toBe('127.0.0.1');
    expect(rows[0].target_type).toBeNull();
    expect(rows[0].details).toBeNull();
  });

  it('stores target and details when provided', async () => {
    const user = await createUser();
    await log({
      userId: user.id,
      action: 'create_domain',
      targetType: 'domain',
      targetId: 42,
      ip: '10.0.0.1',
      details: { name: 'test.com' },
    });
    const [rows] = await pool.query('SELECT * FROM audit_logs WHERE user_id = ?', [user.id]);
    expect(rows[0].target_type).toBe('domain');
    expect(rows[0].target_id).toBe(42);
    expect(JSON.parse(rows[0].details)).toEqual({ name: 'test.com' });
  });

  it('logs an event with null userId (unauthenticated action)', async () => {
    await log({ userId: null, action: 'failed_login', ip: '1.2.3.4' });
    const [rows] = await pool.query('SELECT * FROM audit_logs WHERE user_id IS NULL');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('failed_login');
  });
});
