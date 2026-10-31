import { createSimulationComponentInstance } from './md-simulation-types.ts';
import { workflowModules, type ProjectWorkflow, type WorkflowKind, type WorkflowNode } from './project-workflow.ts';
import { vacantWorkflowPosition } from './workflow-editor-state.ts';

/** A draft is allowed to be incomplete. Execution is validated by the scientific compiler. */
export function createWorkflowModule(graph: ProjectWorkflow, kind: WorkflowKind, options: { id?: string; name?: string; position?: { x: number; y: number } } = {}): WorkflowNode {
  if (!(kind in workflowModules) || kind === 'legacy') throw new Error('Choose a supported module from the module catalogue.');
  return { id: options.id ?? `node_${crypto.randomUUID()}`, kind, name: options.name?.trim() || workflowModules[kind].en,
    position: vacantWorkflowPosition(graph.nodes, options.position ?? { x: 80, y: 80 }), resources: [],
    configuration: kind === 'md' ? { components: [createSimulationComponentInstance('equilibration')] } : ['scf', 'relax', 'bands', 'dos', 'phonon', 'btp2'].includes(kind) ? { compilerVersion: 1 } : {} };
}
