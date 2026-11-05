/** Start the SQLite/filesystem desktop core, local AI bridge and Vite UI for source testing. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalAiServer } from '../packages/phynite-lab/lib/ai-server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const usage = 'Usage: npm run dev:local -- [--data-dir PATH] [--api-port PORT] [--port PORT]';
const options = { dataDir: join(homedir(), '.phynite-lab-dev'), apiPort: 8792, port: 3001 };

for (let index = 2; index < process.argv.length; index += 1) {
  const name = process.argv[index];
  if (name === '--help' || name === '-h') { console.log(usage); process.exit(0); }
  if (!['--data-dir', '--api-port', '--port'].includes(name)) throw new Error(usage);
  const value = process.argv[++index];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.\n${usage}`);
  if (name === '--data-dir') options.dataDir = resolve(value);
  else {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${name} must be a port from 1 to 65535.`);
    options[name === '--api-port' ? 'apiPort' : 'port'] = Number(value);
  }
}
if (options.apiPort === options.port) throw new Error('The API and UI ports must be different.');

async function available(command) {
  if (command.includes('/')) {
    try { await access(command); return command; } catch { return null; }
  }
  for (const directory of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const candidate = join(directory, command);
    try { await access(candidate); return candidate; } catch { /* Try the next PATH entry. */ }
  }
  return null;
}

async function pythonCommand() {
  const candidates = process.platform === 'win32'
    ? [join(root, '.local-backend', 'venv', 'Scripts', 'python.exe'), 'python']
    : [join(root, '.local-backend', 'venv', 'bin', 'python'), 'python3'];
  for (const candidate of candidates) {
    const found = await available(candidate);
    if (found) return found;
  }
  throw new Error('Python was not found. Create .local-backend/venv and install backend/local_api/requirements.txt first.');
}

async function portAvailable(port) {
  const server = createServer();
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
    return true;
  } catch (error) {
    if (error?.code === 'EADDRINUSE') return false;
    throw error;
  } finally {
    await new Promise(accept => server.close(() => accept()));
  }
}

async function waitFor(url, child, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null || child.spawnError) throw new Error(`${label} stopped during startup.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
    } catch { /* The service is still starting. */ }
    await delay(100);
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

async function readCloudConfig() {
  try {
    const value = JSON.parse(await readFile(join(root, 'config', 'phynite-cloud.public.json'), 'utf8'));
    if ([value.apiOrigin, value.region, value.clientId].every(item => typeof item === 'string' && item.length > 0)) return value;
  } catch { /* An offline-only source checkout may omit public cloud metadata. */ }
  return null;
}

function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_') && !key.startsWith('PHYNITE_') && !key.startsWith('NEXT_PUBLIC_PHYNITE_')));
}

function childProcess(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  child.on('error', error => { child.spawnError = error; });
  return child;
}

const children = [];
let aiServer;
let stopping = false;

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(accept => child.once('exit', accept)), delay(10_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled(children.slice().reverse().map(stopChild));
  await aiServer?.close();
  process.exitCode = code;
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

try {
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  if (!(await portAvailable(options.apiPort))) throw new Error(`API port ${options.apiPort} is already in use. Use --api-port with another port.`);
  if (!(await portAvailable(options.port))) throw new Error(`UI port ${options.port} is already in use. Use --port with another port.`);

  aiServer = await createLocalAiServer({ dataDir: options.dataDir });
  const apiOrigin = `http://127.0.0.1:${options.apiPort}`;
  const uiOrigin = `http://127.0.0.1:${options.port}`;
  const cloud = await readCloudConfig();
  const baseEnvironment = {
    ...cleanEnvironment(),
    PHYNITE_APP_MODE: 'local',
    PHYNITE_LOCAL_API_URL: apiOrigin,
    PHYNITE_LOCAL_UI_ORIGIN: uiOrigin,
    PHYNITE_LOCAL_AI_URL: aiServer.origin,
    PHYNITE_LOCAL_AI_TOKEN: aiServer.token,
    PHYNITE_DATA_DIR: options.dataDir,
    PHYNITE_PARENT_PID: String(process.pid),
    VINEXT_NO_DEV_LOCK: '1',
    ...(cloud ? {
      PHYNITE_CLOUD_API_URL: cloud.apiOrigin,
      PHYNITE_CLOUD_AWS_REGION: cloud.region,
      PHYNITE_CLOUD_COGNITO_CLIENT_ID: cloud.clientId,
    } : {}),
  };

  const python = await pythonCommand();
  const core = childProcess(python, ['backend/local_api/desktop_server.py', '--data-dir', options.dataDir, '--port', String(options.apiPort), '--ui-origin', uiOrigin], baseEnvironment);
  children.push(core);
  await waitFor(`${apiOrigin}/__local/health`, core, 'The local core');
  const service = JSON.parse(await readFile(join(options.dataDir, 'core-service.json'), 'utf8'));
  if (service.origin !== apiOrigin || service.uiOrigin !== uiOrigin || typeof service.token !== 'string' || service.token.length < 32) throw new Error('The local core did not publish a valid private service session.');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const web = childProcess(npm, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(options.port)], { ...baseEnvironment, PHYNITE_LOCAL_SERVICE_TOKEN: service.token });
  children.push(web);
  await waitFor(`${uiOrigin}/api/auth/session`, web, 'The local UI', 60_000);
  console.log(`\nPhynite local development workspace: ${uiOrigin}`);
  console.log(`Data: ${options.dataDir}`);
  console.log('Local AI bridge is active. Install and sign in with the official Codex, Claude Code or Antigravity CLI, then open Local settings → Your local AI.');
  console.log('Press Ctrl+C to stop the core, AI bridge and UI.');

  await new Promise(resolve => {
    for (const child of children) child.once('exit', () => { if (!stopping) { console.error('A local service stopped.'); void shutdown(1).finally(resolve); } });
  });
} catch (error) {
  console.error(`Local development startup failed: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}
