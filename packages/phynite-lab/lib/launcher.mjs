import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { arch, homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalAiServer } from './ai-server.mjs';
import { resolveDistribution } from './distribution.mjs';
import { openBrowser } from './browser-opener.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS = new Set(['start', 'status', 'stop', 'doctor']);
const HOST = '127.0.0.1';
const INSTANCE_NAME = 'instance.json';
const LOCK_NAME = 'launcher.lock';
const STARTUP_LOG_LIMIT = 6000;
const STARTUP_LOG_LINES = 40;

export function parseArguments(args, home = homedir()) {
  const options = { command: 'start', port: 3000, dataDir: join(home, '.phynite-lab'), open: true };
  let commandSeen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { ...options, help: true };
    if (arg === '--version' || arg === '-v') return { ...options, version: true };
    if (arg === '--no-open') { options.open = false; continue; }
    if (arg === '--port' || arg === '--data-dir') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--data-dir') options.dataDir = resolve(value);
      else {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('Port must be an integer from 1 to 65535.');
        options.port = Number(value);
      }
      continue;
    }
    if (!commandSeen && COMMANDS.has(arg)) { options.command = arg; commandSeen = true; continue; }
    throw new Error(`Unknown argument: ${arg}. Use --help.`);
  }
  return options;
}

export function distributionPlatform(os = platform(), cpu = arch()) {
  if (!['darwin', 'linux'].includes(os) || !['arm64', 'x64'].includes(cpu)) {
    throw new Error('Supported local runtimes are macOS and Linux (arm64/x64). On Windows, run Phynite Lab inside WSL2.');
  }
  return `${os}-${cpu}`;
}

export function requireRuntimeHost(os = platform(), glibcVersion = os === 'linux' ? process.report?.getReport().header.glibcVersionRuntime : undefined) {
  if (os !== 'linux') return;
  const version = /^(\d+)\.(\d+)(?:\D|$)/.exec(glibcVersion ?? '');
  if (!version || Number(version[1]) < 2 || Number(version[1]) === 2 && Number(version[2]) < 39) {
    throw new Error('Phynite Lab requires glibc 2.39 or later on Linux, including current Omarchy/Arch Linux and Ubuntu 24.04. Upgrade an older distribution before starting the native core.');
  }
}

function equalToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`Cannot read ${path}. Preserve this file and use doctor to inspect the installation.`); }
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
    const { rename } = await import('node:fs/promises');
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => undefined); }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function control(instance, action) {
  if (!instance || !Number.isInteger(instance.controlPort) || instance.controlPort < 1 || instance.controlPort > 65535 || !/^[a-f0-9]{64}$/.test(instance.token ?? '')) return null;
  try {
    const response = await fetch(`http://${HOST}:${instance.controlPort}/${action}`, {
      method: action === 'stop' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${instance.token}`, 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(1500),
    });
    const result = await response.json();
    return response.ok && result.instanceId === instance.instanceId ? result : null;
  } catch { return null; }
}

function localOrigin(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' || parsed.hostname !== HOST || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch { return null; }
}

// A source checkout may already have a local core/UI pair using this workspace.
// Reuse only a healthy loopback pair; never infer liveness from a lock file or
// signal a process we did not start.
async function healthyExistingWorkspace(dataDir) {
  const service = await readJson(join(dataDir, 'core-service.json'));
  const apiOrigin = localOrigin(service?.origin), uiOrigin = localOrigin(service?.uiOrigin);
  if (!apiOrigin || !uiOrigin || typeof service?.token !== 'string' || service.token.length < 32) return null;
  try {
    const headers = { Authorization: `Bearer ${service.token}` };
    const healthReply = await fetch(`${apiOrigin}/__local/health`, { headers, redirect: 'error', signal: AbortSignal.timeout(1200) });
    if (!healthReply.ok) return null;
    const health = await healthReply.json();
    if (health.ready !== true || (health.environment !== 'local' && health.mode !== 'local')) return null;
    const sessionReply = await fetch(`${apiOrigin}/__local/session`, { headers, redirect: 'error', signal: AbortSignal.timeout(1200) });
    const session = await sessionReply.json();
    if (!sessionReply.ok || session.mode !== 'local' || typeof session.user?.id !== 'string' || !session.user.id) return null;
    const uiReply = await fetch(`${uiOrigin}/api/auth/session`, { redirect: 'error', signal: AbortSignal.timeout(1200) });
    const uiSession = await uiReply.json();
    if (!uiReply.ok || uiSession.mode !== 'local' || uiSession.user?.id !== session.user.id) return null;
    return { url: uiOrigin };
  } catch { return null; }
}

async function freePort(preferred = 0) {
  const server = createNetServer();
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(preferred, HOST, accept); });
    const port = server.address().port;
    await new Promise(accept => server.close(accept));
    return port;
  } catch (error) {
    if (preferred && error.code === 'EADDRINUSE') return freePort();
    throw error;
  }
}

async function readStartupLog(logPath) {
  if (!logPath) return '';
  try {
    const text = await readFile(logPath, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-STARTUP_LOG_LINES).join('\n').slice(-STARTUP_LOG_LIMIT);
    // Logs are useful diagnostics, but credentials must never be echoed to a terminal.
    return tail.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,}]+/gi, '$1[redacted]')
      .replace(/((?:token|secret|password|api[-_]?key)\s*[:=]\s*)[^\s,}]+/gi, '$1[redacted]');
  } catch { return ''; }
}

export async function startupFailure(name, child, logPath, reason = 'stopped during startup') {
  const details = [];
  if (child?.spawnError) details.push(`could not start: ${child.spawnError.message}`);
  else if (child?.signalCode) details.push(`was terminated by ${child.signalCode}`);
  else if (child?.exitCode !== null && child?.exitCode !== undefined) details.push(`exited with code ${child.exitCode}`);
  const tail = await readStartupLog(logPath);
  const schedulerConflict = /Another scheduler already owns this local workspace/i.test(tail);
  let message = `The ${name} service ${reason}${details.length ? ` (${details.join(', ')})` : ''}.`;
  if (schedulerConflict) {
    message += ' Another Phynite Lab process already owns this workspace. Use `phynite-lab status` or `phynite-lab stop` for the same data directory, or start with `--data-dir` for a separate workspace.';
  }
  if (tail) message += `\nRecent ${name} log:\n${tail}`;
  message += ' Local files were retained.';
  return new Error(message);
}

async function waitReady(url, child, validate, timeout = 30000, name = 'local service', logPath) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child.exitCode !== null || child.signalCode !== null || child.spawnError) throw await startupFailure(name, child, logPath);
    try {
      const reply = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) });
      if ((reply.ok || [301, 302, 303, 307, 308].includes(reply.status)) && await validate(reply)) return;
    } catch { /* A starting service is not ready yet. */ }
    await delay(100);
  }
  throw await startupFailure(name, child, logPath, `did not become ready at ${url} before the startup timeout`);
}

export async function verifyDistribution(root = PACKAGE_ROOT, target = distributionPlatform()) {
  requireRuntimeHost();
  return resolveDistribution(root, target);
}

function safeChildEnvironment(dataDir, apiOrigin, uiOrigin, cloud) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_') && !key.startsWith('PHYNITE_') && !key.startsWith('NEXT_PUBLIC_PHYNITE_')));
  return { ...env, NODE_ENV: 'production', HOST,
    PHYNITE_APP_MODE: 'local', PHYNITE_DATA_DIR: dataDir,
    PHYNITE_LOCAL_API_URL: apiOrigin, PHYNITE_API_URL: apiOrigin,
    PHYNITE_LOCAL_UI_ORIGIN: uiOrigin, PHYNITE_PUBLIC_APP_URL: uiOrigin,
    PHYNITE_LOCAL_API: 'false', PHYNITE_DEV_SANDBOX: 'false',
    PHYNITE_ANALYTICS_ENABLED: 'false', PHYNITE_AI_BACKGROUND_ENABLED: 'false',
    PHYNITE_PARENT_PID: String(process.pid),
    ...(cloud ? {
      PHYNITE_CLOUD_API_URL: cloud.apiOrigin,
      PHYNITE_CLOUD_AWS_REGION: cloud.region,
      PHYNITE_CLOUD_COGNITO_CLIENT_ID: cloud.clientId,
    } : {}),
  };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const signal = value => {
    try { process.kill(-child.pid, value); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  signal('SIGTERM');
  const timeout = new AbortController();
  try {
    await Promise.race([
      new Promise(accept => child.once('exit', accept)),
      delay(10000, undefined, { signal: timeout.signal }).catch(() => undefined),
    ]);
  } finally { timeout.abort(); }
  if (child.exitCode === null && child.signalCode === null) signal('SIGKILL');
}

export async function runCli(args = process.argv.slice(2), { packageRoot = PACKAGE_ROOT } = {}) {
  const options = parseArguments(args);
  if (options.help) {
    console.log('Usage: phynite-lab [start|status|stop|doctor] [--no-open] [--port 3000] [--data-dir PATH]\nStart a private local workspace. Windows users run this command inside WSL2.');
    return;
  }
  if (options.version) { console.log((await readJson(join(packageRoot, 'package.json'))).version); return; }
  if (options.command === 'doctor') {
    let valid = true;
    try { await verifyDistribution(packageRoot); console.log('Packaged application and core: verified'); }
    catch (error) { valid = false; console.error(error.message); }
    console.log(`Data directory: ${resolve(options.dataDir)}`);
    const instance = await readJson(join(options.dataDir, 'runtime', INSTANCE_NAME));
    console.log(await control(instance, 'status') ? 'Local application: running' : 'Local application: stopped');
    if (!valid) process.exitCode = 1;
    return;
  }
  if (options.command === 'status' || options.command === 'stop') {
    const instance = await readJson(join(options.dataDir, 'runtime', INSTANCE_NAME));
    const current = await control(instance, options.command);
    console.log(current ? (options.command === 'stop' ? 'Phynite Lab is stopping.' : `Phynite Lab is running at ${current.url}`) : 'Phynite Lab is stopped.');
    return;
  }

  const target = distributionPlatform();
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const dataDir = await realpath(options.dataDir);
  await chmod(dataDir, 0o700);
  const runtimeDir = join(dataDir, 'runtime');
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await chmod(runtimeDir, 0o700);
  const instanceFile = join(runtimeDir, INSTANCE_NAME), lockFile = join(runtimeDir, LOCK_NAME);
  const existing = await control(await readJson(instanceFile), 'status');
  if (existing) { console.log(`Phynite Lab is running at ${existing.url}`); if (options.open) await openBrowser(existing.url); return; }
  const adopted = await healthyExistingWorkspace(dataDir);
  if (adopted) {
    console.log(`Phynite Lab is already running at ${adopted.url}`);
    console.log(`Using the healthy local service for ${dataDir}; its owner remains responsible for stopping it.`);
    if (options.open) await openBrowser(adopted.url);
    return;
  }
  const distribution = await verifyDistribution(packageRoot, target);
  const instanceId = randomBytes(16).toString('hex');
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await readJson(lockFile);
    const started = await control(await readJson(instanceFile), 'status');
    if (started) { console.log(`Phynite Lab is running at ${started.url}`); if (options.open) await openBrowser(started.url); return; }
    if (!owner || processExists(owner.pid)) throw new Error('Another launcher is starting or stopping this workspace. Retry after it finishes.');
    // A dead launcher cannot own processes through this lock. Never signal its saved PID.
    if ((await readJson(lockFile))?.instanceId !== owner.instanceId) throw new Error('Workspace launcher ownership changed. Retry the command.');
    await unlink(lockFile);
    lock = await open(lockFile, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, instanceId }));
  await lock.close();
  const children = new Set();
  let controlServer, aiServer, closing, ready = false;
  const shutdown = () => closing ??= (async () => {
    ready = false;
    await aiServer?.close();
    await Promise.allSettled([...children].reverse().map(stopChild));
    if (controlServer) await new Promise(accept => controlServer.close(accept));
    if ((await readJson(instanceFile))?.instanceId === instanceId) await unlink(instanceFile);
    if ((await readJson(lockFile))?.instanceId === instanceId) await unlink(lockFile);
  })();
  const onSignal = () => { void shutdown(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    const logsDir = join(dataDir, 'logs'); await mkdir(logsDir, { recursive: true, mode: 0o700 });
    aiServer = await createLocalAiServer({ dataDir });
    let url;
    for (let attempt = 0; attempt < 3; attempt++) {
      const attemptedChildren = [];
      try {
        const webPort = await freePort(attempt === 0 ? options.port : 0);
        let corePort = await freePort();
        while (corePort === webPort) corePort = await freePort();
        url = `http://${HOST}:${webPort}`;
        const apiOrigin = `http://${HOST}:${corePort}`;
        const env = safeChildEnvironment(dataDir, apiOrigin, url, distribution.cloud);
        if (distribution.source) Object.assign(env, {
          PHYNITE_RELEASE_SOURCE_COMMIT: distribution.source.commit,
          PHYNITE_RELEASE_VERSION: distribution.manifest.version,
        });
        if (distribution.bootstrap) env.PHYNITE_NATIVE_TOOLS_DIR = distribution.bootstrap;
        Object.assign(env, { PHYNITE_LOCAL_AI_URL: aiServer.origin, PHYNITE_LOCAL_AI_TOKEN: aiServer.token });
        const launch = async (name, command, argv, cwd, extraEnv = {}) => {
          if (closing) throw new Error('Local startup was interrupted.');
          const log = await open(join(logsDir, `${name}.log`), 'a', 0o600);
          let child;
          try { child = spawn(command, argv, { cwd, env: { ...env, ...extraEnv }, stdio: ['ignore', log.fd, log.fd], detached: true }); }
          finally { await log.close(); }
          child.on('error', error => { child.spawnError = error; });
          children.add(child); attemptedChildren.push(child);
          child.once('exit', () => { if (children.has(child) && ready && !closing) { process.exitCode = 1; console.error(`${name} stopped. Local files are retained; check ${logsDir}.`); void shutdown(); } });
          return child;
        };
        const core = await launch('core', distribution.executable, ['--data-dir', dataDir, '--port', String(corePort), '--ui-origin', url], dirname(distribution.executable));
        await waitReady(`${apiOrigin}/__local/health`, core, async response => { const value = await response.json(); return value.ready === true && (value.environment === 'local' || value.mode === 'local'); }, 30000, 'core', join(logsDir, 'core.log'));
        const service = await readJson(join(dataDir, 'core-service.json'));
        if (!service || service.origin !== apiOrigin || service.uiOrigin !== url || typeof service.token !== 'string' || service.token.length < 32) {
          throw new Error('The local core did not provide a valid private service session.');
        }
        const sessionMode = (await stat(join(dataDir, 'core-service.json'))).mode & 0o777;
        if (sessionMode & 0o077) throw new Error('The private core service file has unsafe permissions.');
        const coreSessionReply = await fetch(`${apiOrigin}/__local/session`, { headers: { Authorization: `Bearer ${service.token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
        const coreSession = await coreSessionReply.json();
        if (!coreSessionReply.ok || coreSession.mode !== 'local' || typeof coreSession.user?.id !== 'string' || !coreSession.user.id) throw new Error('The native core session did not identify this local workspace.');
        const web = await launch('web', process.execPath, [join(packageRoot, 'lib', 'web-server.mjs')], dirname(distribution.server), {
          PORT: String(webPort), PHYNITE_LOCAL_SERVICE_TOKEN: service.token,
          PHYNITE_PACKAGED_WEB_ENTRY: distribution.server,
        });
        await waitReady(`${url}/api/auth/session`, web, async response => {
          const session = await response.json();
          return session.mode === 'local' && session.user?.id === coreSession.user.id;
        }, 30000, 'web', join(logsDir, 'web.log'));
        break;
      } catch (error) {
        for (const child of attemptedChildren) children.delete(child);
        await Promise.allSettled(attemptedChildren.reverse().map(stopChild));
        if (closing || attempt === 2) throw error;
      }
    }
    if (closing) throw new Error('Local startup was interrupted.');
    const token = randomBytes(32).toString('hex');
    controlServer = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
      if (request.headers.origin || !equalToken(request.headers.authorization, `Bearer ${token}`)) { response.writeHead(403); response.end('{}'); return; }
      if (request.url === '/status' && request.method === 'GET') { response.end(JSON.stringify({ instanceId, url, ready })); return; }
      if (request.url === '/stop' && request.method === 'POST') { response.end(JSON.stringify({ instanceId, stopping: true })); setImmediate(() => { void shutdown(); }); return; }
      response.writeHead(404); response.end('{}');
    });
    await new Promise((accept, reject) => { controlServer.once('error', reject); controlServer.listen(0, HOST, accept); });
    await atomicJson(instanceFile, { instanceId, pid: process.pid, token, url, controlPort: controlServer.address().port });
    ready = true;
    console.log(`Phynite Lab is running at ${url}\nData: ${dataDir}\nPress Ctrl+C to stop.`);
    if (options.open) await openBrowser(url);
    await new Promise(accept => controlServer.once('close', accept));
  } finally {
    await shutdown();
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  }
}
