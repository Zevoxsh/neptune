require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', require('./api/index'));

app.use('/panel', express.static(path.join(__dirname, '../panel')));
app.get('/', (_req, res) => res.redirect('/panel/login.html'));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
