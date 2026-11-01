import assert from 'node:assert/strict';
import test from 'node:test';
import { publicSiteOrigin } from '../lib/site-metadata.ts';

test('only a local build running in local mode accepts loopback HTTP metadata origins', t => {
  const env = process.env as Record<string, string | undefined>;
  const previous = { build: env.PHYNITE_BUILD_TARGET, mode: env.PHYNITE_APP_MODE };
  t.after(() => {
    if (previous.build === undefined) delete env.PHYNITE_BUILD_TARGET; else env.PHYNITE_BUILD_TARGET = previous.build;
    if (previous.mode === undefined) delete env.PHYNITE_APP_MODE; else env.PHYNITE_APP_MODE = previous.mode;
  });
  for (const [build, mode] of [['hosted', 'local'], ['local', 'hosted'], ['hosted', 'hosted']]) {
    env.PHYNITE_BUILD_TARGET = build; env.PHYNITE_APP_MODE = mode;
    assert.throws(() => publicSiteOrigin('http://127.0.0.1:3000'));
    assert.equal(publicSiteOrigin('https://phynite.example'), 'https://phynite.example');
  }
  env.PHYNITE_BUILD_TARGET = 'local'; env.PHYNITE_APP_MODE = 'local';
  for (const origin of ['http://127.0.0.1:3000', 'http://localhost:4389', 'http://[::1]:3010']) assert.equal(publicSiteOrigin(origin), origin);
  for (const origin of ['http://127.0.0.1', 'http://192.168.1.2:3000', 'http://phynite.example:3000', 'http://user@127.0.0.1:3000', 'http://127.0.0.1:3000/path', 'http://127.0.0.1:3000?token=value', 'http://127.0.0.1:3000#fragment']) assert.throws(() => publicSiteOrigin(origin));
});
