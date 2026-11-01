import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowDeviceTrajectories } from '../lib/workflow-md-migration.ts';
import { emptyProjectWorkflow } from '../lib/project-workflow.ts';
import { structureFormula } from '../lib/structure-formula.ts';
import { defaultMdSettings, type MdTrajectoryRecord } from '../lib/md-types.ts';
test('device migration preserves original MD configuration, isolates owners and matches IDs rather than names', () => {
  const record: MdTrajectoryRecord = { id: 'md_1', owner: 'a', projectId: 'p', name: 'Same project name', file: new Blob(['source']), createdAt: '2026-10-17', settings: defaultMdSettings() };
  const graph = emptyProjectWorkflow('p');
  const nodes = workflowDeviceTrajectories(graph, 'a', [record, { ...record, id: 'foreign', owner: 'b' }, { ...record, id: 'same-name', projectId: 'other' }], new Set());
  assert.equal(nodes.length, 1); assert.deepEqual(nodes[0].configuration.preservedSettings, record.settings);
  assert.equal(nodes[0].resources[0].deviceOnly, true);
  assert.deepEqual(workflowDeviceTrajectories(graph, 'a', [record], new Set(['md_1'])), []);
  assert.deepEqual(workflowDeviceTrajectories({ ...graph, nodes }, 'a', [record], new Set()), []);
});
test('composition reduces integer counts without rounding fractional occupancies', () => {
  assert.equal(structureFormula([{ species: 'Si' }, { species: 'O' }, { species: 'O' }]), 'SiO2');
  assert.equal(structureFormula([{ species: 'Si', occupancy: .25 }, { species: 'Ge', occupancy: .75 }]), 'Si0.25Ge0.75');
  assert.equal(structureFormula([{ species: 'Si', occupancy: NaN }]), null);
});
