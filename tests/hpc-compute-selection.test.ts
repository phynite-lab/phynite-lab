import test from 'node:test';
import assert from 'node:assert/strict';
import { hpcProfileSelection, refreshHpcProfileSelection, resolveHpcProfileSelection } from '../lib/compute-selection.ts';
import { validateHpcProfile } from '../lib/hpc-profile.ts';
import { changeWorkflowCompute } from '../lib/workflow-compute.ts';

const profile = {
  ...validateHpcProfile({
    id: 'cluster-current', ownerId: 'local', name: 'Current cluster', scheduler: 'pbs',
    connection: { host: 'login.example', username: 'researcher', port: 22, authKind: 'agent' },
    storage: { scratchRoot: '/scratch/researcher', purgeWavefunctions: true },
    runtime: { environmentModules: [], mpiLauncher: ['mpiexec', '-np', '{ranks}'] },
    defaults: { nodes: 1, ranksPerNode: 8, wallSeconds: 3600, memoryMiBPerNode: 8192, queue: 'default-q', account: 'default-account' },
  }),
  profileSha256: 'b'.repeat(64),
};
const saved = { ...hpcProfileSelection(profile), profileSha256: 'a'.repeat(64), nodes: 3, ranksPerNode: 12,
  wallSeconds: 7200, memoryMiBPerNode: 16384, partition: 'custom-q', account: 'custom-account', autoRestartOnWalltime: true };

test('deleted HPC profile cannot supply an allocation or mix resource counts with the fallback scheduler', () => {
  const dead = { ...saved, clusterId: 'deleted-slurm-cluster' };
  const state = resolveHpcProfileSelection(dead, [profile], true);
  assert.equal(state.missingClusterProfile, true);
  assert.equal(state.selectedCluster?.scheduler, 'pbs');
  assert.equal(state.hpcSelection, undefined);
  assert.equal(state.matchedCluster, undefined);
  // ComputeDestination includes only hpcSelection in its resolved compute choice.
  assert.deepEqual({ computeTarget: 'hpc', ...(state.hpcSelection ? { hpc: state.hpcSelection } : {}) }, { computeTarget: 'hpc' });
  assert.equal(resolveHpcProfileSelection(dead, [], true).missingClusterProfile, true);
  assert.equal(resolveHpcProfileSelection(dead, [], false).hpcSelection, undefined);
  assert.equal(resolveHpcProfileSelection(dead, [], false).missingClusterProfile, false);
  assert.deepEqual(refreshHpcProfileSelection(profile, dead), hpcProfileSelection(profile));
});

test('refreshing a changed HPC checksum retains every valid user resource override', () => {
  const state = resolveHpcProfileSelection(saved, [profile], true);
  assert.equal(state.staleClusterProfile, true);
  assert.equal(state.hpcSelection, saved);
  const refreshed = refreshHpcProfileSelection(profile, saved);
  assert.deepEqual(refreshed, { ...saved, profileSha256: profile.profileSha256 });
  assert.equal(resolveHpcProfileSelection(refreshed, [profile], true).staleClusterProfile, false);
  assert.equal(saved.profileSha256, 'a'.repeat(64));
});

test('HPC refresh fills missing or invalid fields from the new defaults and resets only for a different cluster', () => {
  const legacy = { ...saved, memoryMiBPerNode: undefined, partition: '', account: undefined };
  const result = refreshHpcProfileSelection(profile, legacy);
  assert.equal(result.nodes, 3);
  assert.equal(result.memoryMiBPerNode, 8192);
  assert.equal(result.partition, 'default-q');
  assert.equal(result.account, 'default-account');
  assert.deepEqual(refreshHpcProfileSelection(profile, { ...saved, clusterId: 'other' }), hpcProfileSelection(profile));
  assert.equal(refreshHpcProfileSelection(profile, { ...saved, wallSeconds: 0 }).wallSeconds, 3600);
  assert.equal(refreshHpcProfileSelection(profile, { ...saved, nodes: 4096, ranksPerNode: 1024 }).nodes, 1);
  assert.deepEqual(resolveHpcProfileSelection(undefined, [profile], true).hpcSelection, hpcProfileSelection(profile));
  const second = { ...profile, id: 'preferred', isDefault: true };
  assert.deepEqual(resolveHpcProfileSelection(undefined, [profile, second], true).hpcSelection, hpcProfileSelection(second));
});

test('changing workflow compute targets drops old HPC and resolved snapshots while preserving scientific settings', () => {
  const configuration = { computeTarget: 'hpc', hpc: saved, resolvedHpcCompute: { executionAffinity: { scheduler: 'slurm' } },
    ecutwfc: 60, structureId: 'structure-1', cloudMode: 'paid', computeProfileId: 'old', vcpus: 36, memoryMiB: 8192 };
  for (const computeTarget of ['personal', 'shared'] as const) {
    const result = changeWorkflowCompute(configuration, { computeTarget, vcpus: 4, memoryMiB: 4096, hpc: saved });
    assert.deepEqual(result, { ecutwfc: 60, structureId: 'structure-1', computeTarget, vcpus: 4, memoryMiB: 4096 });
  }
  const refreshed = refreshHpcProfileSelection(profile, saved);
  assert.deepEqual(changeWorkflowCompute(configuration, { computeTarget: 'hpc', hpc: refreshed }), {
    ecutwfc: 60, structureId: 'structure-1', computeTarget: 'hpc', hpc: refreshed,
  });
  assert.equal(configuration.hpc, saved);
  assert.ok(configuration.resolvedHpcCompute);
});
