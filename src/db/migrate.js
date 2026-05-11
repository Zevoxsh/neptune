require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./index');

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied() {
  const [rows] = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map(r => r.filename));
}

async function migrate() {
  await ensureTrackingTable();
  const applied = await getApplied();

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort().filter(f => f.endsWith('.sql'));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping (already applied): ${file}`);
      continue;
    }
    console.log(`Running: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
    await pool.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
    console.log(`Done: ${file}`);
  }

  await pool.end();
  console.log('All migrations complete.');
}

migrate().catch(async err => {
  console.error('Migration failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
