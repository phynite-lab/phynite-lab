import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, realpath, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { arch, homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
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
const execFile = promisify(execFileCallback);
const PARENT_HEARTBEAT_INTERVAL = 2000;
const PARENT_HEARTBEAT_TIMEOUT = 15000;

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

async function processCommand(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    const psOptions = { timeout: 1500, maxBuffer: 32 * 1024, env: { ...process.env, LC_ALL: 'C' } };
    const [{ stdout: identity }, { stdout: commandOutput }] = await Promise.all([
      execFile('ps', ['-p', String(pid), '-o', 'pid=,ppid=,lstart='], psOptions),
      execFile('ps', ['-p', String(pid), '-o', 'command='], psOptions),
    ]);
    const line = identity.trim().split(/\r?\n/).find(Boolean), command = commandOutput.trim().split(/\r?\n/).find(Boolean);
    const match = line?.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    const created = match ? Date.parse(match[3]) / 1000 : NaN;
    return match && command ? { pid: Number(match[1]), ppid: Number(match[2]), created, command } : null;
  } catch { return null; }
}

function isPhyniteCoreProcess(info, dataDir) {
  if (!info || !dataDir) return false;
  // The command line is checked before any signal is sent. This protects a
  // reused scheduler PID from being treated as a stale Phynite process.
  return /(?:^|[\\/])phynite-core(?:\s|$)/.test(info.command) && info.command.includes(`--data-dir ${dataDir}`);
}

async function waitForProcessExit(pid, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (processExists(pid) && Date.now() < deadline) await delay(100);
  return !processExists(pid);
}

/**
 * Recover only a verified, unhealthy native core for this exact workspace.
 * The scheduler flock remains authoritative; the lock file is never removed.
 */
async function stopOrphanCore(dataDir) {
  const owner = await readJson(join(dataDir, '.scheduler.lock'));
  if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1) return false;
  const core = await processCommand(owner.pid);
  if (!isPhyniteCoreProcess(core, dataDir) || !Number.isFinite(core.created) || typeof owner.created !== 'number' || Math.abs(core.created - owner.created) > 5) return false;
  const parent = core.ppid > 1 ? await processCommand(core.ppid) : null;
  const root = isPhyniteCoreProcess(parent, dataDir) ? parent.pid : core.pid;
  try {
    // Detached launcher children share a process group. Signal that group so
    // the wrapper and Python core both get a chance to close the scheduler.
    process.kill(-root, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      try { process.kill(root, 'SIGTERM'); } catch (fallback) { if (fallback.code !== 'ESRCH') return false; }
    }
  }
  await waitForProcessExit(core.pid);
  if (processExists(core.pid)) {
    try { process.kill(-root, 'SIGKILL'); } catch (error) {
      if (error.code !== 'ESRCH') { try { process.kill(root, 'SIGKILL'); } catch { /* already gone */ } }
    }
    await waitForProcessExit(core.pid, 1500);
  }
  return !processExists(core.pid);
}

// Use Node's small HTTP client for loopback control traffic.  The global
// fetch implementation in newer Node releases can attempt to apply socket
// options that are rejected on some macOS/Linux combinations (`EINVAL` from
// setTypeOfService).  A launcher command such as `status` or `stop` must still
// work when the installed runtime is newer than the version used to build it.
// Keep this helper restricted to our authenticated loopback endpoints; it
// deliberately does not follow redirects or make arbitrary network requests.
export function requestJson(url, { method = 'GET', headers = {}, timeout = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); }
    catch { reject(new Error('Invalid local service URL.')); return; }
    if (parsed.protocol !== 'http:' || parsed.hostname !== HOST) {
      reject(new Error('Local service URL must use the loopback HTTP origin.'));
      return;
    }
    const request = httpRequest({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: { Accept: 'application/json', ...headers },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.once('end', () => {
        let value;
        try { value = body ? JSON.parse(body) : null; }
        catch (error) { reject(error); return; }
        const status = response.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, json: async () => value });
      });
    });
    request.setTimeout(timeout, () => request.destroy(new Error('Local service request timed out.')));
    request.once('error', reject);
    request.end();
  });
}

async function control(instance, action) {
  if (!instance || !Number.isInteger(instance.controlPort) || instance.controlPort < 1 || instance.controlPort > 65535 || !/^[a-f0-9]{64}$/.test(instance.token ?? '')) return null;
  try {
    const response = await requestJson(`http://${HOST}:${instance.controlPort}/${action}`, {
      method: action === 'stop' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${instance.token}`, 'Content-Type': 'application/json' },
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
    const healthReply = await requestJson(`${apiOrigin}/__local/health`, { headers, timeout: 1200 });
    if (!healthReply.ok) return null;
    const health = await healthReply.json();
    if (health.ready !== true || (health.environment !== 'local' && health.mode !== 'local')) return null;
    const sessionReply = await requestJson(`${apiOrigin}/__local/session`, { headers, timeout: 1200 });
    const session = await sessionReply.json();
    if (!sessionReply.ok || session.mode !== 'local' || typeof session.user?.id !== 'string' || !session.user.id) return null;
    const uiReply = await requestJson(`${uiOrigin}/api/auth/session`, { timeout: 1200 });
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
      const reply = await requestJson(url, { timeout: 1000 });
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

function safeChildEnvironment(dataDir, apiOrigin, uiOrigin, cloud, heartbeatPath, parentInstanceId) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_') && !key.startsWith('PHYNITE_') && !key.startsWith('NEXT_PUBLIC_PHYNITE_')));
  return { ...env, NODE_ENV: 'production', HOST,
    PHYNITE_APP_MODE: 'local', PHYNITE_DATA_DIR: dataDir,
    PHYNITE_LOCAL_API_URL: apiOrigin, PHYNITE_API_URL: apiOrigin,
    PHYNITE_LOCAL_UI_ORIGIN: uiOrigin, PHYNITE_PUBLIC_APP_URL: uiOrigin,
    PHYNITE_LOCAL_API: 'false', PHYNITE_DEV_SANDBOX: 'false',
    PHYNITE_ANALYTICS_ENABLED: 'false', PHYNITE_AI_BACKGROUND_ENABLED: 'false',
    PHYNITE_PARENT_PID: String(process.pid),
    PHYNITE_PARENT_HEARTBEAT: heartbeatPath,
    PHYNITE_PARENT_HEARTBEAT_TIMEOUT: String(PARENT_HEARTBEAT_TIMEOUT),
    PHYNITE_PARENT_INSTANCE_ID: parentInstanceId,
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
    const managed = await control(instance, 'status');
    if (managed) console.log('Local application: running');
    else {
      const adopted = await healthyExistingWorkspace(resolve(options.dataDir));
      console.log(adopted ? `Local application: running at ${adopted.url} (managed by another process)` : 'Local application: stopped');
    }
    if (!valid) process.exitCode = 1;
    return;
  }
  if (options.command === 'status' || options.command === 'stop') {
    const dataDir = resolve(options.dataDir);
    const instance = await readJson(join(dataDir, 'runtime', INSTANCE_NAME));
    const current = await control(instance, options.command);
    if (current) {
      console.log(options.command === 'stop' ? 'Phynite Lab is stopping.' : `Phynite Lab is running at ${current.url}`);
      return;
    }
    const adopted = await healthyExistingWorkspace(dataDir);
    if (adopted) {
      console.log(options.command === 'stop'
        ? `Phynite Lab is running at ${adopted.url}, but it is managed by another process. Stop it from that process; no service was stopped.`
        : `Phynite Lab is running at ${adopted.url} (managed by another process).`);
      return;
    }
    if (options.command === 'stop' && await stopOrphanCore(dataDir)) {
      console.log('Phynite Lab stopped an orphaned local core and released the workspace lock.');
      return;
    }
    console.log('Phynite Lab is stopped.');
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
  // A previous launcher can die while its detached native core remains alive.
  // Recover only when the scheduler owner is an identified Phynite core for
  // this exact data directory; never unlink the lock as a shortcut.
  await stopOrphanCore(dataDir);
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
  // Give every launcher instance its own heartbeat path.  A previous core
  // therefore cannot mistake a new launcher heartbeat for its owner after a
  // crash and restart.
  const heartbeatFile = join(runtimeDir, `launcher-heartbeat-${instanceId}.json`);
  let heartbeatTimer;
  const writeHeartbeat = async () => {
    try { await utimes(heartbeatFile, new Date(), new Date()); }
    catch { /* startup/shutdown races must not mask the service error */ }
  };
  await writeFile(heartbeatFile, JSON.stringify({ pid: process.pid, instanceId, startedAt: Date.now() }) + '\n', { mode: 0o600 });
  await writeHeartbeat();
  heartbeatTimer = setInterval(() => { void writeHeartbeat(); }, PARENT_HEARTBEAT_INTERVAL);
  heartbeatTimer.unref?.();
  const shutdown = () => closing ??= (async () => {
    ready = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await aiServer?.close();
    await Promise.allSettled([...children].reverse().map(stopChild));
    if (controlServer) await new Promise(accept => controlServer.close(accept));
    if ((await readJson(instanceFile))?.instanceId === instanceId) await unlink(instanceFile);
    if ((await readJson(lockFile))?.instanceId === instanceId) await unlink(lockFile);
    const heartbeat = await readJson(heartbeatFile);
    if (heartbeat?.instanceId === instanceId) await unlink(heartbeatFile);
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
        const env = safeChildEnvironment(dataDir, apiOrigin, url, distribution.cloud, heartbeatFile, instanceId);
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
        const coreSessionReply = await requestJson(`${apiOrigin}/__local/session`, { headers: { Authorization: `Bearer ${service.token}` }, timeout: 5000 });
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
