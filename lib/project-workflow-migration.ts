import type { StoredWorkspaceSnapshot } from './workspace-storage';
import { emptyProjectWorkflow, type ProjectWorkflow, type WorkflowNode } from './project-workflow.ts';
/** Preserve legacy configurations verbatim. Composite/manual inputs are never guessed apart. */
export function migrateWorkspaceProject(projectId: string, localProjectId: string, snapshot: StoredWorkspaceSnapshot): ProjectWorkflow {
  const graph = emptyProjectWorkflow(projectId);
  const materials = (snapshot.materials ?? []).filter(item => item.projectId === localProjectId);
  for (const [index, material] of materials.entries()) {
    const raw = material as typeof material & Record<string, unknown>;
    graph.nodes.push({ id: material.id, kind: 'structure', name: material.name, position: { x: 60, y: index * 220 + 60 }, configuration: { structure: { name: material.name, atoms: material.atoms ?? [], lattice: raw.lattice, formula: material.formula }, legacySource: raw }, resources: material.remoteId ? [{ kind: 'structure', id: material.remoteId }] : [{ kind: 'structure', id: material.id, deviceOnly: true }], legacy: { localId: localProjectId, editor: 'dft', materialId: material.id } });
    const components = (snapshot.calculationComponents ?? []).filter(component => component.materialId === material.id);
    for (const [column, component] of components.entries()) {
      const id = `legacy_${component.id}`;
      const legacy: WorkflowNode = { id, kind: 'legacy', name: component.name, position: { x: 360 + column * 280, y: index * 220 + 60 }, configuration: { preservedComponent: component, preservedConfigurations: (snapshot.calculationConfigurations ?? []).filter(config => config.materialId === material.id), preservedHistory: (snapshot.jobs ?? []).filter(job => job.componentId === component.id) }, resources: [], legacy: { localId: localProjectId, editor: 'dft', materialId: material.id, componentId: component.id } };
      graph.nodes.push(legacy);
    }
  }
  return graph;
}
