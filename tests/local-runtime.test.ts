import test from 'node:test';
import assert from 'node:assert/strict';
import { localAppMode, localArtifactUrl } from '../lib/local-runtime.ts';

test('hosted builds cannot select local auth through the runtime mode flag', () => {
  const previous = { ...process.env };
  try {
    process.env.PHYNITE_APP_MODE = 'local';
    process.env.PHYNITE_BUILD_TARGET = 'hosted';
    assert.equal(localAppMode(), false);
    process.env.PHYNITE_BUILD_TARGET = 'local';
    delete process.env.PHYNITE_LOCAL_SERVICE_TOKEN;
    assert.throws(() => localAppMode(), /launcher|phynite-lab/);
    process.env.PHYNITE_LOCAL_SERVICE_TOKEN = 'local-service-test';
    process.env.PHYNITE_LOCAL_API_URL = 'https://remote.example';
    assert.throws(() => localAppMode(), /loopback/);
    process.env.PHYNITE_LOCAL_API_URL = 'http://127.0.0.1:49112';
    assert.equal(localAppMode(), true);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('local artifact URLs are bound to the running core origin, path and ticket', () => {
  const ticket = `encoded.${'a'.repeat(64)}`;
  assert.ok(localArtifactUrl(`http://127.0.0.1:49112/__local/artifacts?ticket=${ticket}`, 'http://127.0.0.1:49112'));
  assert.equal(localArtifactUrl(`http://127.0.0.1:49113/__local/artifacts?ticket=${ticket}`, 'http://127.0.0.1:49112'), null);
  assert.equal(localArtifactUrl(`http://127.0.0.1:49112/private?ticket=${ticket}`, 'http://127.0.0.1:49112'), null);
});
