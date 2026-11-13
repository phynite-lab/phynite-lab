import assert from 'node:assert/strict';
import test from 'node:test';
import { getComputeResourceAdvice } from '../lib/compute-advisor.ts';

test('Smart Resource Advisor: Small unit cell (<= 10 atoms) recommends local CPU', () => {
  const siliconAdvice = getComputeResourceAdvice({
    atomCount: 2,
    kPoints: [4, 4, 4],
    calculationType: 'Total energy',
    isHpcConfigured: true,
  });

  assert.ok(siliconAdvice);
  assert.equal(siliconAdvice.recommendation, 'personal');
  assert.equal(siliconAdvice.confidence, 'medium');
  assert.equal(siliconAdvice.metrics.complexity, 'light');
  assert.equal(siliconAdvice.metrics.atomCount, 2);
  assert.match(siliconAdvice.badge.en, /local CPU/);
  assert.match(siliconAdvice.reason.en, /workload heuristic/);

  // Boundary: exactly 10 atoms
  const boundaryAdvice = getComputeResourceAdvice({
    atomCount: 10,
    kPoints: [4, 4, 4],
    calculationType: 'Total energy',
    isHpcConfigured: true,
  });
  assert.ok(boundaryAdvice);
  assert.equal(boundaryAdvice.recommendation, 'personal');
  assert.equal(boundaryAdvice.metrics.complexity, 'light');
});

test('Smart Resource Advisor: Complex unit cell (> 10 atoms) recommends HPC when configured', () => {
  const supercellAdvice = getComputeResourceAdvice({
    atomCount: 64,
    kPoints: [2, 2, 2],
    calculationType: 'Structural relaxation',
    isHpcConfigured: true,
  });

  assert.ok(supercellAdvice);
  assert.equal(supercellAdvice.recommendation, 'hpc');
  assert.equal(supercellAdvice.confidence, 'medium');
  assert.equal(supercellAdvice.metrics.complexity, 'heavy');
  assert.match(supercellAdvice.badge.en, /HPC/);
  assert.match(supercellAdvice.reason.en, /CPU time and memory/);

  // When HPC is not configured, advises personal CPU with high workload warning
  const noHpcAdvice = getComputeResourceAdvice({
    atomCount: 64,
    kPoints: [2, 2, 2],
    calculationType: 'Structural relaxation',
    isHpcConfigured: false,
  });

  assert.ok(noHpcAdvice);
  assert.equal(noHpcAdvice.recommendation, 'personal');
  assert.match(noHpcAdvice.badge.en, /Compute intensive/);
});

test('Smart Resource Advisor: Phonon dispersion recommends HPC even for small cells', () => {
  const phononAdvice = getComputeResourceAdvice({
    atomCount: 2,
    kPoints: [4, 4, 4],
    calculationType: 'Phonon dispersion',
    isHpcConfigured: true,
  });

  assert.ok(phononAdvice);
  assert.equal(phononAdvice.recommendation, 'hpc');
  assert.equal(phononAdvice.metrics.complexity, 'heavy');
  assert.match(phononAdvice.reason.en, /Phonon dispersion can require many DFPT/);
});

test('Smart Resource Advisor: Dense k-points trigger heavy complexity and HPC recommendation', () => {
  const denseKAdvice = getComputeResourceAdvice({
    atomCount: 4,
    kPoints: [12, 12, 12], // 1728 > 512
    calculationType: 'Total energy',
    isHpcConfigured: true,
  });

  assert.ok(denseKAdvice);
  assert.equal(denseKAdvice.recommendation, 'hpc');
  assert.equal(denseKAdvice.metrics.complexity, 'heavy');
});

test('Smart Resource Advisor: Invalid or missing inputs return null', () => {
  assert.equal(getComputeResourceAdvice({}), null);
  assert.equal(getComputeResourceAdvice({ atomCount: 0 }), null);
  assert.equal(getComputeResourceAdvice({ atomCount: -5 }), null);
  assert.equal(getComputeResourceAdvice({ atomCount: NaN }), null);
  assert.equal(getComputeResourceAdvice({ atomCount: Infinity }), null);
});

test('advisor rejects invalid scientific counts instead of silently changing them', () => {
  for (const atomCount of [0, -5, NaN, Infinity, 2.4]) assert.equal(getComputeResourceAdvice({ atomCount }), null);
  for (const kPoints of [[-4, 4, 4], [4.2, 4, 4], [4, 4], [4, Infinity, 4], [4, NaN, 4], 0, Infinity]) {
    assert.equal(getComputeResourceAdvice({ atomCount: 2, kPoints }), null);
  }
  const unknown = getComputeResourceAdvice({ atomCount: 2 });
  assert.equal(unknown?.metrics.kPointProduct, null);
  assert.equal(unknown?.metrics.complexity, 'moderate');
  assert.doesNotMatch(unknown!.reason.en, /in seconds|speedup|instant/i);
});
