import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyAccountDestination, searchSettingsSections, searchSettingsControls, settingsSections } from '../app/account-navigation.ts';
import { displayDuration, displayQuanta, measuredComputeSeconds, recordedCpuSeconds, recordedRunSeconds } from '../lib/usage-display.ts';

test('settings search finds researcher tasks in either language and requires each term', () => {
  assert.deepEqual(searchSettingsSections('vram').map(item => item.id), ['compute']);
  assert.deepEqual(searchSettingsSections('kuota').map(item => item.id), ['storage']);
  assert.deepEqual(searchSettingsSections('email hasil').map(item => item.id), ['notifications']);
  assert.deepEqual(searchSettingsSections('compute storage'), []);
});

test('legacy settings links preserve intended destination and fragments', () => {
  assert.deepEqual(legacyAccountDestination('computer'), { pathname: '/account/compute', hash: '#your-computer' });
  assert.deepEqual(legacyAccountDestination('computer', '#worker'), { pathname: '/account/compute', hash: '#worker' });
  assert.deepEqual(legacyAccountDestination('preferences', '#notifications'), { pathname: '/account/notifications', hash: '#notifications' });
  assert.deepEqual(legacyAccountDestination('preferences'), { pathname: '/account/appearance', hash: '' });
});

test('local settings search targets local controls and Account follows AI providers', () => {
  assert.equal(searchSettingsControls('quota', 'local').some(item => item.href === '/account/storage#local-storage'), true);
  assert.equal(searchSettingsControls('quota').some(item => item.href === '/account/storage#cloud-storage'), true);
  assert.equal(searchSettingsControls('md simulation', 'local').some(item => item.href.includes('?workload')), false);
  const ai = settingsSections.findIndex(item => item.id === 'ai-providers');
  assert.equal(settingsSections[ai + 1].id, 'account');
});

test('run and solver time remain distinct and incomplete history is unavailable', () => {
  const run = { startedAt: '2026-10-28T00:00:00Z', completedAt: '2026-10-28T02:00:00Z', computeSeconds: 3600 };
  assert.equal(recordedRunSeconds(run), 7200);
  assert.equal(measuredComputeSeconds(run), 3600);
  assert.equal(recordedRunSeconds({ startedAt: run.startedAt }), null);
  assert.equal(recordedRunSeconds({ startedAt: run.completedAt, completedAt: run.startedAt }), null);
  assert.equal(recordedRunSeconds({ startedAt: 'invalid', completedAt: run.completedAt }), null);
  assert.equal(measuredComputeSeconds({}), null);
  assert.equal(measuredComputeSeconds({ computeSeconds: 0 }), 0);
  assert.equal(displayQuanta(undefined), '—');
  assert.equal(displayQuanta(0), '0 Q');
});

test('short recorded durations remain visible and missing values stay unavailable', () => {
  assert.equal(displayDuration(12, 'en'), '12 sec');
  assert.equal(displayDuration(90, 'en'), '1.5 min');
  assert.equal(displayDuration(5400, 'en'), '1.5 hr');
  assert.equal(displayDuration(null), '—');
  assert.equal(displayDuration(NaN), '—');
});

test('draft and unfinished jobs never turn missing CPU allocation into zero hours', () => {
  assert.equal(recordedCpuSeconds({ totalRuns: 2, measuredRuns: 0, unmeasuredRuns: 1, unmeasuredCpuRuns: 1, allocatedCpuSeconds: 0 }), null);
  assert.equal(recordedCpuSeconds({ totalRuns: 1, measuredRuns: 0, unmeasuredRuns: 0, unmeasuredCpuRuns: 0, allocatedCpuSeconds: 0 }), null);
  assert.equal(recordedCpuSeconds({ totalRuns: 2, measuredRuns: 1, unmeasuredRuns: 1, unmeasuredCpuRuns: 1, allocatedCpuSeconds: 3600 }), 3600);
  assert.equal(recordedCpuSeconds({ totalRuns: 0, measuredRuns: 0, unmeasuredRuns: 0, unmeasuredCpuRuns: 0, allocatedCpuSeconds: 0 }), 0);
});
