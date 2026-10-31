import { spawn } from 'node:child_process';
import { platform, release } from 'node:os';

export function browserOpenCommands(value, system = platform(), kernel = release()) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The browser opener requires the launcher loopback origin.');
  }
  const origin = url.origin;
  if (system === 'darwin') return [['/usr/bin/open', origin]];
  if (system === 'linux' && /microsoft.*wsl2/i.test(kernel)) {
    // Windows interop opens the user's Windows browser when no Linux desktop
    // browser exists. The only command text is a validated loopback origin.
    return [['wslview', origin], ['cmd.exe', '/d', '/c', 'start', '""', origin], ['explorer.exe', origin], ['xdg-open', origin]];
  }
  return [['xdg-open', origin]];
}

export async function openBrowser(value, { system = platform(), kernel = release(), start = spawn, warn = console.warn, timeoutMs = 3000 } = {}) {
  const commands = browserOpenCommands(value, system, kernel);
  for (const [command, ...args] of commands) {
    const accepted = await new Promise(resolve => {
      let child;
      try { child = start(command, args, { stdio: 'ignore', detached: true }); }
      catch { resolve(false); return; }
      let settled = false;
      const finish = result => {
        if (settled) { if (!result) warn(`Open ${value} in your browser.`); return; }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      // Some desktop openers remain alive with their browser. Do not terminate
      // that process; let the foreground workspace continue normally.
      const timer = setTimeout(() => finish(true), timeoutMs);
      child.once('error', () => finish(false));
      child.once('exit', code => finish(code === 0));
      child.unref();
    });
    if (accepted) return;
  }
  warn(`Open ${value} in your browser.`);
}
