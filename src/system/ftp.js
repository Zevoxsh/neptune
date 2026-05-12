const { execFile } = require('child_process');

// Lazy accessors — read env vars at call time so tests can override in beforeAll
function addUserScript() { return process.env.NEPTUNE_FTP_ADDUSER || '/usr/local/bin/neptune-ftp-adduser'; }
function delUserScript() { return process.env.NEPTUNE_FTP_DELUSER || '/usr/local/bin/neptune-ftp-deluser'; }
function passwdScript()  { return process.env.NEPTUNE_FTP_PASSWD  || '/usr/local/bin/neptune-ftp-passwd'; }

function runScript(args, stdinData) {
  return new Promise((resolve, reject) => {
    const proc = execFile('sudo', args);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`Script exited with code ${code}`), { code: 'SCRIPT_ERROR' }));
    });
    proc.on('error', reject);
    if (stdinData) proc.stdin?.write(stdinData);
    proc.stdin?.end();
  });
}

async function addFtpUser(ftpUsername, password, homeDir) {
  await runScript([addUserScript(), ftpUsername, homeDir], `${password}\n${password}\n`);
}

async function deleteFtpUser(ftpUsername) {
  await runScript([delUserScript(), ftpUsername]);
}

async function changeFtpPassword(ftpUsername, newPassword) {
  await runScript([passwdScript(), ftpUsername], `${newPassword}\n${newPassword}\n`);
}

module.exports = { addFtpUser, deleteFtpUser, changeFtpPassword };
