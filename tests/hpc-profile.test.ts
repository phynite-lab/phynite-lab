import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateHpcProfile,
  validateMpiLauncher,
  defaultMpiLauncher,
  allowedMpiLaunchers,
  validateHpcRuntime,
  HpcProfileError,
} from '../lib/hpc-profile.ts';
import { searchSettingsControls } from '../app/account-navigation.ts';
import { isHpcComputeSelection, prepareComputeRequest, type ComputeSelection } from '../lib/compute-selection.ts';

const validProfileInput = {
  id: 'cl-brin-mahameru',
  ownerId: 'usr-user-123',
  name: 'BRIN Mahameru - DFT Cluster',
  scheduler: 'slurm',
  isDefault: true,
  connection: {
    host: 'login2.hpc.brin.go.id',
    port: 22,
    username: 'user',
    authKind: 'key',
    privateKeyPath: '/home/user/.ssh/id_ed25519',
    bastionHost: 'bastion.brin.go.id',
    bastionPort: 2222,
    bastionUser: 'jump-user',
  },
  storage: {
    scratchRoot: '/scratch/users/user/phynite-work',
    pseudoRoot: '/shared/apps/pseudopotentials',
    purgeWavefunctions: true,
  },
  runtime: {
    environmentModules: ['module purge', 'module load openmpi/4.1.4', 'module load qe/7.2'],
    mpiLauncher: ['srun', '--mpi=pmix', '--ntasks={ranks}'],
  },
  defaults: {
    nodes: 2,
    ranksPerNode: 32,
    wallSeconds: 14400,
    memoryMiBPerNode: 65536,
    queue: 'cpu',
    account: 'brin_mat_2026',
  },
};

test('valid Slurm cluster profile passes validation and sets defaults', () => {
  const profile = validateHpcProfile(validProfileInput);
  assert.equal(profile.id, 'cl-brin-mahameru');
  assert.equal(profile.scheduler, 'slurm');
  assert.equal(profile.connection.port, 22);
  assert.equal(profile.defaults.nodes, 2);
  assert.equal(profile.defaults.ranksPerNode, 32);
  assert.equal(profile.storage.purgeWavefunctions, true);
  assert.ok(profile.createdAt);
  assert.ok(profile.updatedAt);
});

test('valid PBS cluster profile uses default MPI launcher if omitted', () => {
  const pbsInput = {
    ...validProfileInput,
    id: 'cl-campus-pbs',
    scheduler: 'pbs',
    runtime: {
      environmentModules: ['module load intel/2024'],
    },
    defaults: {
      nodes: 1,
      ranksPerNode: 16,
      wallSeconds: 3600,
      memoryMiBPerNode: 32768,
      queue: 'workq',
    },
  };
  const profile = validateHpcProfile(pbsInput);
  assert.equal(profile.scheduler, 'pbs');
  assert.deepEqual(profile.runtime.mpiLauncher, ['mpiexec', '-n', '{ranks}']);
});

test('environment module names accept one-per-line HPC site modules and stay canonical', () => {
  const profile = validateHpcProfile({
    ...validProfileInput,
    runtime: {
      environmentModules: ['intel/2024.0', 'impi/2021.11.0', 'mkl', 'materials/qe/7.2-impi'],
      mpiLauncher: ['srun', '--mpi=pmix', '--ntasks={ranks}'],
    },
  });
  assert.deepEqual(profile.runtime.environmentModules, ['intel/2024.0', 'impi/2021.11.0', 'mkl', 'materials/qe/7.2-impi']);
});

test('MPI launcher validation enforces exactly one {ranks} placeholder', () => {
  assert.deepEqual(validateMpiLauncher(['srun', '--ntasks={ranks}']), ['srun', '--ntasks={ranks}']);
  assert.deepEqual(defaultMpiLauncher('slurm'), ['srun', '--mpi=pmix', '--ntasks={ranks}']);
  assert.deepEqual(defaultMpiLauncher('pbs'), ['mpiexec', '-n', '{ranks}']);

  // Missing placeholder
  assert.throws(() => validateMpiLauncher(['srun', 'pw.x']), HpcProfileError);
  // Multiple placeholders
  assert.throws(() => validateMpiLauncher(['srun', '-n', '{ranks}', '-N', '{ranks}']), HpcProfileError);
  // Empty or non-array
  assert.throws(() => validateMpiLauncher([]), HpcProfileError);
  assert.throws(() => validateMpiLauncher('srun -n {ranks}'), HpcProfileError);
  // Control characters
  assert.throws(() => validateMpiLauncher(['srun', '--ranks={ranks}\n']), HpcProfileError);
});

test('profile validation rejects path traversal and relative paths', () => {
  // Relative scratch path
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, storage: { ...validProfileInput.storage, scratchRoot: 'scratch/work' } }),
    HpcProfileError,
  );
  // Path traversal
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, storage: { ...validProfileInput.storage, scratchRoot: '/scratch/../root' } }),
    HpcProfileError,
  );
  // Relative private key path
  assert.throws(
    () => validateHpcProfile({
      ...validProfileInput,
      connection: { ...validProfileInput.connection, privateKeyPath: '~/.ssh/key' },
    }),
    HpcProfileError,
  );
});

test('profile validation enforces allocation boundary limits', () => {
  // Nodes too small
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, defaults: { ...validProfileInput.defaults, nodes: 0 } }),
    HpcProfileError,
  );
  // Nodes too large
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, defaults: { ...validProfileInput.defaults, nodes: 5000 } }),
    HpcProfileError,
  );
  // Walltime < 300 seconds
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, defaults: { ...validProfileInput.defaults, wallSeconds: 200 } }),
    HpcProfileError,
  );
  // Memory < 1024 MiB
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, defaults: { ...validProfileInput.defaults, memoryMiBPerNode: 512 } }),
    HpcProfileError,
  );
  // Total ranks > 65536 (e.g. 100 nodes * 1000 ranks = 100000)
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, defaults: { ...validProfileInput.defaults, nodes: 100, ranksPerNode: 1000 } }),
    HpcProfileError,
  );
});

test('profile validation rejects control characters in strings', () => {
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, name: 'Cluster\nMalicious' }),
    HpcProfileError,
  );
  assert.throws(
    () => validateHpcProfile({ ...validProfileInput, connection: { ...validProfileInput.connection, username: 'user\x00root' } }),
    HpcProfileError,
  );
});

test('searchSettingsControls finds hpc-clusters anchor under compute section', () => {
  const matches = searchSettingsControls('hpc');
  assert.ok(matches.length > 0);
  assert.equal(matches.some(m => m.href === '/account/compute#hpc-clusters'), true);

  const clusterMatches = searchSettingsControls('cluster');
  assert.equal(clusterMatches.some(m => m.href === '/account/compute#hpc-clusters'), true);
});

test('prepareComputeRequest validates HPC target and requires clusterId', async () => {
  const mockQuote = async () => ({ quote: { id: 'mock-quote-1' } });

  // When run === false, returns wireInput without network call
  const draftSelection: ComputeSelection & { run: boolean } = {
    computeTarget: 'hpc',
    run: false,
    hpc: {
      clusterId: 'cl-brin-mahameru',
      nodes: 1,
      ranksPerNode: 32,
      wallSeconds: 7200,
    },
  };
  const result = await prepareComputeRequest(draftSelection, mockQuote);
  assert.equal(result.computeTarget, 'hpc');
  assert.equal(result.hpc?.clusterId, 'cl-brin-mahameru');
  assert.equal(result.hpc?.nodes, 1);
});

test('HPC run allocations enforce profile bounds before dispatch', () => {
  assert.equal(isHpcComputeSelection({ clusterId: 'cl-1', nodes: 1, ranksPerNode: 32, wallSeconds: 300 }), true);
  assert.equal(isHpcComputeSelection({ clusterId: 'cl-1', nodes: 100, ranksPerNode: 1000, wallSeconds: 300 }), false);
  assert.equal(isHpcComputeSelection({ clusterId: 'cl-1', nodes: 1, ranksPerNode: 32, wallSeconds: 299 }), false);
});

test('HPC submission freezes the local profile checksum and maps resources to personal affinity', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window?: unknown }).window = {};
  let quoteCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/api/phynite/v1/account')) {
      return new Response(JSON.stringify({ account: { computeTarget: 'personal', computer: { status: 'connected' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path.includes('/api/local/hpc/clusters/cl-1')) {
      return new Response(JSON.stringify({ cluster: { id: 'cl-1', scheduler: 'pbs', profileSha256: 'a'.repeat(64), defaults: { nodes: 2, ranksPerNode: 8, memoryMiBPerNode: 4096 } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${path}`);
  }) as typeof fetch;
  try {
    const result = await prepareComputeRequest({ computeTarget: 'hpc', run: true, hpc: { clusterId: 'cl-1', nodes: 3, ranksPerNode: 4, wallSeconds: 900 } }, async () => { quoteCalls += 1; return { quote: { id: 'unused' } }; });
    assert.equal(result.computeTarget, 'personal');
    assert.equal(result.vcpus, 12);
    assert.equal(result.memoryMiB, 12288);
    assert.deepEqual((result as unknown as { settings: unknown }).settings, { hpcAllocation: { nodes: 3, ranksPerNode: 4, wallSeconds: 900, memoryMiBPerNode: 4096 } });
    assert.deepEqual(result.executionAffinity, { scheduler: 'pbs', profileSha256: 'a'.repeat(64) });
    assert.equal('hpc' in result, false);
    assert.equal(quoteCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test('hosted HPC submission is rejected with a local-workspace instruction', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window?: unknown }).window = {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/api/phynite/v1/account')) return new Response(JSON.stringify({ account: { computeTarget: 'personal', computer: { status: 'connected' } } }), { status: 200 });
    return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    await assert.rejects(
      prepareComputeRequest({ computeTarget: 'hpc', run: true, hpc: { clusterId: 'cl-1', nodes: 1, ranksPerNode: 4, wallSeconds: 900 } }, async () => ({ quote: { id: 'unused' } })),
      /local Phynite workspace/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test('Slurm runtime accepts mpirun/mpiexec and validates optional pythonExecutable paths', () => {
  assert.deepEqual([...allowedMpiLaunchers('slurm')], ['srun', 'mpiexec', 'mpirun']);
  assert.deepEqual([...allowedMpiLaunchers('pbs')], ['mpiexec', 'mpirun']);

  const slurmMpirun = validateHpcRuntime(
    {
      environmentModules: ['intel/2024.0', 'materials/qe/7.2-impi'],
      mpiLauncher: ['mpirun', '-np', '{ranks}'],
      pythonExecutable: '  /opt/conda/envs/science/bin/python3  ',
    },
    'slurm',
  );
  assert.deepEqual(slurmMpirun.mpiLauncher, ['mpirun', '-np', '{ranks}']);
  assert.equal(slurmMpirun.pythonExecutable, '/opt/conda/envs/science/bin/python3');

  const slurmMpiexec = validateHpcRuntime(
    {
      environmentModules: [],
      mpiLauncher: ['mpiexec', '-n', '{ranks}'],
    },
    'slurm',
  );
  assert.deepEqual(slurmMpiexec.mpiLauncher, ['mpiexec', '-n', '{ranks}']);
  assert.equal(slurmMpiexec.pythonExecutable, undefined);

  assert.throws(
    () => validateHpcRuntime({ environmentModules: [], mpiLauncher: ['bash', '-c', '{ranks}'] }, 'slurm'),
    HpcProfileError,
  );
  assert.throws(
    () => validateHpcRuntime({ environmentModules: [], mpiLauncher: ['mpirun', '-np', '{ranks}'], pythonExecutable: 'envs/science/bin/python3' }, 'slurm'),
    HpcProfileError,
  );
  assert.throws(
    () => validateHpcRuntime({ environmentModules: [], mpiLauncher: ['mpirun', '-np', '{ranks}'], pythonExecutable: '/opt/my python/bin/python3' }, 'slurm'),
    HpcProfileError,
  );
  assert.throws(
    () => validateHpcRuntime({ environmentModules: [], mpiLauncher: ['mpirun', '-np', '{ranks}'], pythonExecutable: '/opt/conda/envs/"bad"/python3' }, 'slurm'),
    HpcProfileError,
  );
});
