const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/domains', require('./domains'));
router.use('/files', require('./files'));
router.use('/ftp', require('./ftp'));
module.exports = router;
