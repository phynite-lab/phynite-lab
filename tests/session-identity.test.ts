import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUserProfile, type PhyniteSession } from '../app/auth-client.ts';

const localSession = (authenticated: boolean): PhyniteSession => ({
  mode: 'local',
  user: { id: 'local-stable-owner', email: '', name: 'Local Researcher', groups: [], isDeveloper: false },
  cloud: { authenticated },
});

test('local workspace identity does not expose a user profile before cloud login', () => {
  assert.equal(hasUserProfile(localSession(false)), false);
  assert.equal(hasUserProfile(localSession(true)), true);
});

test('hosted sessions retain profile controls', () => {
  assert.equal(hasUserProfile({ user: { id: 'cloud-owner', email: 'researcher@example.test', name: 'Researcher', groups: [], isDeveloper: false } }), true);
});
