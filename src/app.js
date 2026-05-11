require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', require('./api/index'));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
