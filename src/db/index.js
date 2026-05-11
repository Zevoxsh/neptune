require('dotenv').config();
const mysql = require('mysql2/promise');

const isTest = process.env.NODE_ENV === 'test';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: isTest ? process.env.DB_TEST_NAME : process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
