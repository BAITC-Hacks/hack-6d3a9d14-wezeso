import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The production build's /api rewrite targets this fixed, private port.
const env = { ...process.env, NODE_ENV: 'production', PORT: '8080', API_PORT: '8080', NEXT_DIST_DIR: '.next' };
const children = new Set();
let stopping = false;
let shutdownTimer;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  // Go has a three-second shutdown window; allow it to release the CSV lock.
  if (children.size) {
    shutdownTimer = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
    }, 8000);
    shutdownTimer.unref();
  }
}

function launch(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
  children.add(child);
  child.on('error', error => {
    console.error(`${name} failed to start: ${error.message}`);
    stop(1);
  });
  child.on('close', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} stopped unexpectedly (${signal || code}).`);
      stop(code || 1);
    }
    if (!children.size) clearTimeout(shutdownTimer);
  });
  return child;
}

process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());

launch('API', resolve(root, 'backend/careerquest'), [], root);
let ready = false;
for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:8080/api/health', { signal: AbortSignal.timeout(1000) });
    await response.body?.cancel();
    if (response.ok) { ready = true; break; }
  } catch { /* Wait for the API and its database connection. */ }
  await new Promise(resolve => setTimeout(resolve, 250));
}

if (!stopping) {
  if (!ready) {
    console.error('API readiness timed out. Check the storage configuration and logs above.');
    stop(1);
  } else {
    launch('Frontend', process.execPath, [
      resolve(root, 'frontend/node_modules/next/dist/bin/next'),
      'start', '--hostname', '0.0.0.0', '--port', '3000',
    ], resolve(root, 'frontend'));
    console.log('Career Quest: serving on port 3000; /api is proxied to the private Go API.');
  }
}
