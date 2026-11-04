/** Keep the standalone web process tied to the foreground launcher. */
import { isAbsolute } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const parent = Number(process.env.PHYNITE_PARENT_PID);
if (!Number.isInteger(parent) || parent < 1 || process.ppid !== parent) {
  throw new Error('Start the packaged web server through phynite-lab.');
}
const watcher = setInterval(() => {
  if (process.ppid !== parent) process.exit(1);
  try { process.kill(parent, 0); }
  catch (error) { if (error.code === 'ESRCH') process.exit(1); }
  const heartbeatPath = process.env.PHYNITE_PARENT_HEARTBEAT;
  if (heartbeatPath) {
    try {
      const timeout = Number(process.env.PHYNITE_PARENT_HEARTBEAT_TIMEOUT || 15);
      const heartbeat = JSON.parse(readFileSync(heartbeatPath, 'utf8'));
      const age = Date.now() - statSync(heartbeatPath).mtimeMs;
      if (age > timeout * 1000 || heartbeat.pid !== parent || heartbeat.instanceId !== process.env.PHYNITE_PARENT_INSTANCE_ID) process.exit(1);
    } catch { process.exit(1); }
  }
}, 1000);
watcher.unref();
const entry = process.env.PHYNITE_PACKAGED_WEB_ENTRY;
if (!entry || !isAbsolute(entry)) throw new Error('The launcher must select a verified packaged web entrypoint.');
await import(pathToFileURL(entry).href);
