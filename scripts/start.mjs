import { existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (!existsSync('node_modules')) {
  const install = spawnSync(npm, ['ci'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (install.status !== 0) process.exit(install.status || 1);
}
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { stdio: 'inherit' });
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', code => process.exit(code || 0));
