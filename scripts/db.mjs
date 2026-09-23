import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const command = process.argv[2];
if (!['export', 'import'].includes(command)) throw new Error('Use npm run db:export or npm run db:import');
const win = process.platform === 'win32';
const bundled = resolve('.tools/go/bin', win ? 'go.exe' : 'go');
const go = existsSync(bundled) ? bundled : 'go';
process.env.GOCACHE ||= resolve('.tools/go-cache');
process.env.GOMODCACHE ||= resolve('.tools/go-mod');
mkdirSync(resolve('.tools'), { recursive: true });
const binary = resolve('.tools', win ? 'careerquest-db.exe' : 'careerquest-db');
const build = spawnSync(go, ['build', '-o', binary, '.'], { cwd: resolve('backend'), stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const result = spawnSync(binary, [`--${command}-sql`, resolve(process.env.DATA_DIR || 'data', 'supabase-migration.sql'), ...process.argv.slice(3)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
