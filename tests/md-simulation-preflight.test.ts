import assert from 'node:assert/strict';
import test from 'node:test';
import { mdBerendsenCellIssue } from '../lib/md-simulation-preflight.ts';
import type { MdSimulationWorkflowV2, MdWorkflowStep } from '../lib/md-simulation-types.ts';
import type { CellVectors } from '../lib/crystal-cell.ts';

const cell: CellVectors = [[10, 0, 0], [0, 10, 0], [0, 0, 10]];
const pressure: MdWorkflowStep = { id: 'pressure', kind: 'press-berendsen', name: 'Pressure', enabled: true, params: { timestepFs: 1, totalSteps: 20, pressureBar: 0, pressureEndBar: 0, pressureDampingPs: 1 } };
const shear: MdWorkflowStep = { id: 'shear', kind: 'shear', name: 'Shear', enabled: true, params: { timestepFs: 1, totalSteps: 20, tempStartK: 30, tempEndK: 30, tempDampingPs: .1, shearPlane: 'xy', strainRatePerSecond: 1e8, maxStrain: .01 } };
const workflow = (steps: MdWorkflowStep[] = [pressure]): MdSimulationWorkflowV2 => ({ version: 2, mode: 'guided', units: 'metal', boundaryType: 'p p p', potential: { kind: 'builtin', id: 'lj-generic' }, steps, output: { thermoFrequency: 5, dumpFrequency: 5 } });

test('Berendsen preflight permits axis-aligned cells and rejects real skew, rotations and shear', () => {
  assert.equal(mdBerendsenCellIssue(workflow(), cell), '');
  for (const vectors of [[[10, 1, 0], [0, 10, 0], [0, 0, 10]], [[10, 1e-15, 0], [0, 10, 0], [0, 0, 10]], [[0, 10, 0], [-10, 0, 0], [0, 0, 10]]] as CellVectors[]) assert.match(mdBerendsenCellIssue(workflow(), vectors), /axis-aligned orthogonal/);
  assert.match(mdBerendsenCellIssue(workflow([pressure, shear]), cell), /cannot be combined with shear/);
  assert.equal(mdBerendsenCellIssue(workflow([pressure, { ...shear, enabled: false }]), cell), '');
  assert.equal(mdBerendsenCellIssue(workflow([{ ...pressure, enabled: false }, shear]), cell), '');
});

test('manual Berendsen preflight follows executable blocks or raw body instead of saved Guided state', () => {
  const blocks: MdWorkflowStep = { ...shear, directives: [{ id: 'bar', kind: 'barostat', enabled: true, params: { style: 'press-berendsen', timestepFs: 1, totalSteps: 20, tempStartK: 30, tempEndK: 30, tempDampingPs: .1, pressureStartBar: 0, pressureEndBar: 0, pressureDampingPs: 1 } }] };
  assert.equal(mdBerendsenCellIssue({ ...workflow([blocks]), mode: 'manual' }, cell), '');
  assert.match(mdBerendsenCellIssue({ ...workflow([blocks]), mode: 'manual' }, [[10, 1, 0], [0, 10, 0], [0, 0, 10]]), /axis-aligned/);
  const raw = { ...workflow([pressure, shear]), mode: 'manual' as const, manualBody: 'fix integrator all nve\nrun 20\n# fix ignored all press/berendsen iso 0 0 1\n' };
  assert.equal(mdBerendsenCellIssue(raw, cell), '');
  const body = 'fix bar all press/berendsen &\n iso 0 0 1\nrun 20';
  assert.equal(mdBerendsenCellIssue({ ...raw, manualBody: body }, cell), '');
  assert.match(mdBerendsenCellIssue({ ...raw, manualBody: `change_box all triclinic\n${body}` }, cell), /cannot be combined/);
  assert.match(mdBerendsenCellIssue({ ...raw, manualBody: `${body}\nfix deform all deform 1 xy erate 0.1` }, cell), /cannot be combined/);
});
