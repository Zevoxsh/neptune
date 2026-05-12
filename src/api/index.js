const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/domains', require('./domains'));
router.use('/files', require('./files'));
router.use('/ftp', require('./ftp'));
router.use('/databases', require('./databases'));
module.exports = router;
