import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crystalDatabaseInput, replaceWorkflowCrystalInput } from '../lib/crystal-database-input.ts';
import { searchCrystalDatabase, type CrystalDatabaseMaterial } from '../lib/crystal-database.ts';
import { emptyProjectWorkflow, parseProjectWorkflow, type WorkflowNode } from '../lib/project-workflow.ts';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/crystal-database-imports.json', import.meta.url), 'utf8'));

test('database editor inputs retain exact tilted cells, occupancies and source evidence', async () => {
  const document = JSON.parse(fixtures.materialsProject.sourceData.content);
  document.structure.sites[0].species = [{ element: 'Si', occu: .6 }, { element: 'C', occu: .4 }];
  const { materials: [material] } = await searchCrystalDatabase('mp-149', { source: 'materials-project', apiKey: 'fixture-only', fetcher: async () => Response.json({ data: [document] }) });
  const before = structuredClone(material), input = crystalDatabaseInput(material);
  assert.equal(input.name, 'Si · mp-149');
  assert.strictEqual(input.atoms, material.atoms);
  assert.strictEqual(input.lattice, material.lattice);
  assert.deepEqual(input.lattice.vectors, document.structure.lattice.matrix);
  assert.deepEqual(input.atoms[0].siteSpecies?.map(site => site.occupancy), [.6, .4]);
  assert.strictEqual(input.sourceData, material.sourceData);
  assert.strictEqual(input.provenance, material.provenance);
  assert.equal(input.sourceData.content, JSON.stringify(document));
  assert.equal(input.externalId, material.materialId);
  assert.deepEqual(input.geometryProvenance, [{ kind: 'database-import', ...material.provenance }]);
  assert.equal('bandGap' in input, false);
  assert.deepEqual(material, before);
});

test('replacing a connected Crystal module keeps its identity, configuration and connections', () => {
  const material = fixtures.cod as CrystalDatabaseMaterial;
  const input = crystalDatabaseInput(material);
  const node: WorkflowNode = { id: 'crystal', kind: 'structure', name: 'My named model', groupId: 'study', position: { x: 12, y: 34 }, configuration: { structure: { name: 'Previous', atoms: [{ species: 'C', x: .5, y: .5, z: .5 }], lattice: material.lattice }, preservedConfigurations: [{ exactInput: 'unaltered research settings' }], savedStructureSignature: 'previous-signature', legacySource: { externalId: 'previous-source', bandGap: 123 } }, resources: [{ kind: 'structure', id: 'old-input', sha256: '1'.repeat(64) }, { kind: 'potential', id: 'saved-potential', sha256: '2'.repeat(64) }] };
  const original = structuredClone(node), next = replaceWorkflowCrystalInput(node, input);
  assert.equal(next.id, node.id); assert.equal(next.kind, node.kind); assert.equal(next.name, node.name);
  assert.deepEqual(next.position, node.position); assert.equal(next.groupId, node.groupId);
  assert.strictEqual(next.configuration.structure, input);
  assert.equal(next.configuration.formula, 'Si');
  assert.deepEqual(next.configuration.preservedConfigurations, node.configuration.preservedConfigurations);
  assert.deepEqual(next.configuration.legacySource, { externalId: material.materialId, sourceUrl: material.sourceUrl });
  assert.equal('savedStructureSignature' in next.configuration, false);
  assert.deepEqual(next.resources, [node.resources[1]]);
  const target: WorkflowNode = { id: 'scf', kind: 'scf', name: 'SCF', position: { x: 200, y: 34 }, resources: [], configuration: {} };
  const graph = { ...emptyProjectWorkflow('project'), nodes: [next, target], groups: [{ id: 'study', name: 'Study', nodeIds: ['crystal'] }], edges: [{ id: 'crystal-to-scf', source: 'crystal', target: 'scf', port: 'structure' as const }] };
  assert.deepEqual(parseProjectWorkflow(graph).edges, graph.edges);
  assert.equal(parseProjectWorkflow(graph).nodes.length, 2);
  assert.deepEqual(node, original);
});

test('file replacement clears obsolete database identity without mutating the previous input', () => {
  const input = crystalDatabaseInput({ ...fixtures.cod, bandGap: 0 } as CrystalDatabaseMaterial);
  const node: WorkflowNode = { id: 'crystal', kind: 'structure', name: 'Crystal', position: { x: 0, y: 0 }, resources: [], configuration: { structure: input, legacySource: { externalId: input.externalId, bandGap: 0 }, savedStructureSignature: 'saved-source' } };
  const file = { name: 'Imported file', atoms: [{ id: 'file-carbon', species: 'C', x: 0, y: 0, z: 0 }], lattice: input.lattice };
  const next = replaceWorkflowCrystalInput(node, file);
  assert.equal(input.bandGap, 0);
  assert.equal('legacySource' in next.configuration, false);
  assert.equal(next.configuration.formula, 'C');
  assert.strictEqual(node.configuration.structure, input);
  assert.deepEqual(node.configuration.legacySource, { externalId: input.externalId, bandGap: 0 });
  assert.throws(() => replaceWorkflowCrystalInput({ ...node, kind: 'scf' }, input), /Crystal structure module/);
});
