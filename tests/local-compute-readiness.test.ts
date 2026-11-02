import test from 'node:test';
import assert from 'node:assert/strict';
import { localComputeReadiness, type LocalRuntimeState } from '../lib/local-compute-readiness.ts';

const empty = (): LocalRuntimeState => ({ capabilities: { solver: [] }, runtime: { installed: {}, availableComponents: ['dft', 'md'], downloadAvailable: true } });

test('readiness requires worker validation for the requested workload', () => {
  const state = empty();
  assert.equal(localComputeReadiness(state, 'qe').status, 'missing');
  state.runtime.installed.dft = { version: '1' };
  assert.equal(localComputeReadiness(state, 'qe').status, 'starting');
  state.capabilities!.solver = ['qe'];
  assert.equal(localComputeReadiness(state, 'qe').status, 'ready');
  assert.equal(localComputeReadiness(state, 'md-simulation').status, 'missing');
  assert.equal(localComputeReadiness(state, 'md-analysis').component, 'md');
});

test('installer progress and exact errors belong only to their component', () => {
  const state = empty();
  state.runtime.progress = { state: 'downloading', component: 'md', downloadedBytes: 50, totalBytes: 100 };
  assert.deepEqual(localComputeReadiness(state, 'md-analysis'), { status: 'installing', component: 'md', phase: 'downloading', percent: 50 });
  assert.equal(localComputeReadiness(state, 'qe').status, 'missing');
  state.runtime.progress = { state: 'failed', component: 'md', error: 'Not enough disk space' };
  assert.equal(localComputeReadiness(state, 'md-simulation').error, 'Not enough disk space');
  state.capabilities!.solver = ['md-simulation'];
  assert.equal(localComputeReadiness(state, 'md-simulation').status, 'ready');
});

test('platform restrictions explain why installation is unavailable', () => {
  const state = empty();
  state.runtime.availableComponents = ['dft'];
  state.runtime.requirements = { md: { compatible: false, reason: 'glibc is too old' } };
  assert.deepEqual(localComputeReadiness(state, 'md-analysis'), { status: 'unavailable', component: 'md', error: 'glibc is too old' });
});

test('a legacy analysis-only install does not claim to contain LAMMPS', () => {
  const state = empty();
  state.runtime.installed.analysis = { version: '1' };
  assert.equal(localComputeReadiness(state, 'md-analysis').status, 'starting');
  assert.equal(localComputeReadiness(state, 'md-simulation').status, 'missing');
});
