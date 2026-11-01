import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import test from 'node:test';
import { browserOpenCommands, openBrowser } from '../packages/phynite-lab/lib/browser-opener.mjs';

test('WSL2 uses Windows browser interop without treating ordinary Linux as Windows', () => {
  const url = 'http://127.0.0.1:3000';
  assert.deepEqual(browserOpenCommands(url, 'darwin', ''), [['/usr/bin/open', url]]);
  assert.deepEqual(browserOpenCommands(url, 'linux', '6.8.0-generic'), [['xdg-open', url]]);
  assert.deepEqual(browserOpenCommands(url, 'linux', '6.6.87.2-microsoft-standard-WSL2').map(([command]: string[]) => command), ['wslview', 'cmd.exe', 'explorer.exe', 'xdg-open']);
  for (const unsafe of ['https://example.test', 'http://user:secret@127.0.0.1:3000', 'http://127.0.0.1:3000/?next=&calc.exe', 'http://127.0.0.1:3000/other', 'http://127.0.0.1:3000/#command']) assert.throws(() => browserOpenCommands(unsafe));
});

test('a missing or failing WSL opener advances to Windows interop, then succeeds', async () => {
  const calls: { command: string; args: string[] }[] = [], warnings: string[] = [];
  await openBrowser('http://127.0.0.1:3000', {
    system: 'linux', kernel: '6.6-microsoft-standard-WSL2', warn: (message: string) => warnings.push(message),
    start: ((command: string, args: string[]) => {
      calls.push({ command, args });
      const child = Object.assign(new EventEmitter(), { unref() {} });
      queueMicrotask(() => command === 'wslview' ? child.emit('error', new Error('ENOENT')) : command === 'cmd.exe' ? child.emit('exit', 1) : child.emit('exit', 0));
      return child;
    }) as unknown as typeof spawn,
  });
  assert.deepEqual(calls.map(call => call.command), ['wslview', 'cmd.exe', 'explorer.exe']);
  assert.deepEqual(calls[1].args, ['/d', '/c', 'start', '""', 'http://127.0.0.1:3000']);
  assert.deepEqual(warnings, []);
});

test('failed desktop opening leaves an actionable URL and never terminates a browser', async () => {
  const warnings: string[] = [];
  await openBrowser('http://127.0.0.1:3000', {
    system: 'linux', kernel: '6.8-generic', warn: (message: string) => warnings.push(message),
    start: (() => {
      const child = Object.assign(new EventEmitter(), { unref() {} });
      queueMicrotask(() => child.emit('exit', 7));
      return child;
    }) as unknown as typeof spawn,
  });
  assert.deepEqual(warnings, ['Open http://127.0.0.1:3000 in your browser.']);
});
