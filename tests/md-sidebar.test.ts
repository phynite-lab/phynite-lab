import assert from 'node:assert/strict';
import test from 'node:test';
import { MD_SIMULATION_INELIGIBLE_REASON, mdSimulationEligibility, resolveMdRouteTrajectory } from '../lib/md-sidebar.ts';
import type { MdCloudTrajectory } from '../lib/md-cloud-api.ts';

test('MD simulation eligibility requires an explicitly active trajectory', () => {
  assert.deepEqual(mdSimulationEligibility({ hasActiveProject: true, frameCount: 0, hasSourceFile: false }), {
    eligible: false,
    reason: MD_SIMULATION_INELIGIBLE_REASON,
  });
  assert.equal(mdSimulationEligibility({ hasActiveProject: true, frameCount: 1, hasSourceFile: false }).eligible, false);
  assert.equal(mdSimulationEligibility({ hasActiveProject: false, frameCount: 1, hasSourceFile: true }).eligible, false);
  assert.deepEqual(mdSimulationEligibility({ hasActiveProject: true, frameCount: 1, hasSourceFile: true }), {
    eligible: true,
    reason: '',
  });
});

test('MD route trajectory must explicitly belong to the selected project', () => {
  const trajectory = { id: 'trajectory-a', projectId: 'project-a' } as MdCloudTrajectory;
  assert.equal(resolveMdRouteTrajectory('project-a', 'trajectory-a', [trajectory]), trajectory);
  assert.equal(resolveMdRouteTrajectory('project-b', 'trajectory-a', [trajectory]), null);
  assert.equal(resolveMdRouteTrajectory('project-a', 'missing', [trajectory]), null);
  assert.equal(resolveMdRouteTrajectory('', 'trajectory-a', [trajectory]), null);
});
