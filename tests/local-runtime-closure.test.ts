/** Synthetic module graphs test packaging boundaries; real tarballs have a separate smoke gate. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { localRuntimeClosure } from '../scripts/local-runtime-closure.mjs';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'phynite-runtime-closure-')));
  const file = async (path: string, value: string) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), value); };
  const dependency = async (name: string, metadata = {}) => file(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', license: 'MIT', ...metadata }));
  await file('server.js', "import 'vinext/server/prod-server';\n");
  await dependency('vinext', { dependencies: { 'unused-development-image-engine': '1.0.0' } });
  await file('node_modules/vinext/dist/server/prod-server.js', "import './response.js';\n");
  await file('node_modules/vinext/dist/server/response.js', 'export const response = true;\n');
  await file('node_modules/vinext/dist/server/unused-dev.js', "import 'unused-development-image-engine';\n");
  await file('dist/server/vinext-externals.json', JSON.stringify(['react']));
  await dependency('react');
  await file('dist/server/main.js', "import 'react';\n");
  return { root, file, dependency };
}

test('runtime closure keeps every lazy server chunk and transitive runtime dependency without unused Vinext tooling', async () => {
  const { root, file, dependency } = await fixture();
  try {
    await file('dist/server/lazy/deep-route.js', "import 'route-runtime/subpath';\n");
    await file('dist/server/vinext-externals.json', JSON.stringify(['react', 'route-runtime']));
    await dependency('route-runtime', { dependencies: { 'route-transitive-runtime': '2.0.0' }, optionalDependencies: { 'missing-native-option': '1.0.0' } });
    await dependency('route-transitive-runtime', { version: '2.0.0' });
    const closure = await localRuntimeClosure(root);
    assert.deepEqual(closure.manifest.packages, ['react', 'route-runtime', 'route-transitive-runtime', 'vinext']);
    assert.ok(closure.manifest.files.some((item: { path: string }) => item.path === 'dist/server/lazy/deep-route.js'));
    assert.ok(closure.vinextFiles.has(join(root, 'node_modules/vinext/dist/server/response.js')));
    assert.ok(!closure.vinextFiles.has(join(root, 'node_modules/vinext/dist/server/unused-dev.js')));
    assert.ok(closure.manifest.files.every((item: { sha256: string }) => /^[0-9a-f]{64}$/.test(item.sha256)));
  } finally { await rm(root, { recursive: true }); }
});

test('unknown dynamic imports and dynamic require resolution fail packaging before any dependency is omitted', async () => {
  for (const code of ['import(globalThis.unreviewedModule);', "import { createRequire } from 'node:module'; const runtimeRequire=createRequire(import.meta.url); runtimeRequire.resolve(globalThis.unreviewedModule);"]) {
    const { root, file } = await fixture();
    try {
      await file('dist/server/lazy/unknown.js', code);
      await assert.rejects(localRuntimeClosure(root), /nonliteral module import/);
    } finally { await rm(root, { recursive: true }); }
  }
});

test('static createRequire resolution includes its complete installed runtime dependency', async () => {
  const { root, file, dependency } = await fixture();
  try {
    await file('dist/server/lazy/required.js', "import { createRequire } from 'node:module'; const runtimeRequire=createRequire(import.meta.url); runtimeRequire.resolve('native-runtime/package.json');");
    await dependency('native-runtime');
    await file('dist/server/vinext-externals.json', JSON.stringify(['react', 'native-runtime']));
    assert.ok((await localRuntimeClosure(root)).packages.has('native-runtime'));
  } finally { await rm(root, { recursive: true }); }
});

test('new Vinext versions require explicit review of the production server graph', async () => {
  const { root, dependency } = await fixture();
  try {
    await dependency('vinext', { version: '1.0.1' });
    await assert.rejects(localRuntimeClosure(root), /different Vinext version/);
  } finally { await rm(root, { recursive: true }); }
});

test('server imports missing from the generated externals manifest fail closed', async () => {
  const { root, file, dependency } = await fixture();
  try {
    await file('dist/server/lazy/new-route.js', "import 'unlisted-runtime';");
    await dependency('unlisted-runtime');
    await assert.rejects(localRuntimeClosure(root), /missing from its externals manifest/);
  } finally { await rm(root, { recursive: true }); }
});
