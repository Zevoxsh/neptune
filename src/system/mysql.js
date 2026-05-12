const mysql2 = require('mysql2/promise');

let _pool = null;

function getMgmtPool() {
  if (!_pool) {
    _pool = mysql2.createPool({
      host: process.env.NEPTUNE_MYSQL_MGMT_HOST || '127.0.0.1',
      port: parseInt(process.env.NEPTUNE_MYSQL_MGMT_PORT || '3306', 10),
      user: process.env.NEPTUNE_MYSQL_MGMT_USER,
      password: process.env.NEPTUNE_MYSQL_MGMT_PASS,
      waitForConnections: true,
      connectionLimit: 5,
    });
  }
  return _pool;
}

async function createDatabase(dbName, dbUser, password) {
  const conn = await getMgmtPool().getConnection();
  try {
    await conn.query('CREATE DATABASE ??', [dbName]);
    try {
      await conn.query("CREATE USER ?@'localhost' IDENTIFIED BY ?", [dbUser, password]);
      await conn.query("GRANT ALL PRIVILEGES ON ??.* TO ?@'localhost'", [dbName, dbUser]);
      await conn.query('FLUSH PRIVILEGES');
    } catch (err) {
      await conn.query('DROP DATABASE IF EXISTS ??', [dbName]).catch(() => {});
      await conn.query("DROP USER IF EXISTS ?@'localhost'", [dbUser]).catch(() => {});
      throw err;
    }
  } finally {
    conn.release();
  }
}

async function dropDatabase(dbName, dbUser) {
  const conn = await getMgmtPool().getConnection();
  try {
    await conn.query('DROP DATABASE IF EXISTS ??', [dbName]);
    await conn.query("DROP USER IF EXISTS ?@'localhost'", [dbUser]);
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    conn.release();
  }
}

async function changePassword(dbUser, newPassword) {
  const conn = await getMgmtPool().getConnection();
  try {
    await conn.query("ALTER USER ?@'localhost' IDENTIFIED BY ?", [dbUser, newPassword]);
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    conn.release();
  }
}

async function getDatabaseSizeMb(dbName) {
  const [rows] = await getMgmtPool().query(
    'SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb FROM information_schema.TABLES WHERE table_schema = ?',
    [dbName]
  );
  return parseFloat(rows[0]?.size_mb) || 0;
}

module.exports = { createDatabase, dropDatabase, changePassword, getDatabaseSizeMb };
