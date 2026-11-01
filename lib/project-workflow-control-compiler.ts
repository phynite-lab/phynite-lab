import { compileWorkflowDft, workflowQeDraft, workflowCalculationTypes } from './project-workflow-compiler.ts';
import type { MdSimulationComponentInstance } from './md-simulation-types.ts';
import { compileMdSimulationWorkflow } from './md-workflow-compiler.ts';
import type { WorkflowNode } from './project-workflow.ts';
import { qeMethodIssue } from './qe-input.ts';
import type { ProjectWorkflow } from './project-workflow.ts';
import type { ParsedStructure } from './structure-parsers.ts';

/** Same compiler and defaults in the browser and the Python control plane. */
export function validateDraft(graph: ProjectWorkflow, nodeId: string): string | null {
  const node = graph.nodes.find(node => node.id === nodeId);
  if (!node || !workflowCalculationTypes[node.kind]) throw new Error('Select a DFT module.');
  if (String((node.configuration.draft as { rawInput?: string } | undefined)?.rawInput ?? '').trim() && graph.edges.some(edge => edge.target === node.id && ['extract-frame', 'relax'].includes(graph.nodes.find(item => item.id === edge.source)?.kind ?? ''))) return 'Manual structure cards cannot override a connected frame or relaxation. Use an explicit structure variant.';
  return qeMethodIssue(workflowQeDraft(graph, node), workflowCalculationTypes[node.kind]!);
}
export function compileBoundDft(graph: ProjectWorkflow, nodeId: string, structure: ParsedStructure, structureId: string) {
  const node = graph.nodes.find(node => node.id === nodeId);
  if (!node || !structure?.atoms?.length || !structure.lattice || !structureId) throw new Error('A verified input geometry is required.');
  const issue = validateDraft(graph, nodeId); if (issue) throw new Error(issue);
  const sourceId = graph.edges.find(edge => edge.target === nodeId && edge.port === 'electronic')?.source;
  const target = sourceId || nodeId;
  const boundId = '__verified_workflow_input';
  const bound: ProjectWorkflow = { ...graph, nodes: [...graph.nodes.filter(item => item.id !== boundId), { id: boundId, kind: 'structure', name: structure.name || 'Verified workflow input', position: { x: 0, y: 0 }, configuration: { structure }, resources: [{ kind: 'structure', id: structureId }] }], edges: [...graph.edges.filter(edge => edge.target !== target), { id: '__verified_workflow_edge', source: boundId, target, port: 'structure' }] };
  return compileWorkflowDft(bound, node, 'Project workflow');
}

/** MD uses exactly the same Guided/manual conversion as its editor. */
export function compileMd(node: WorkflowNode) {
  const components = node.configuration.components;
  if (node.kind !== 'md' || !Array.isArray(components) || !components.length) throw new Error('Configure at least one MD stage.');
  return compileMdSimulationWorkflow(components as MdSimulationComponentInstance[]);
}
export function prepareNodes(graph: ProjectWorkflow, nodeIds: string[]): Record<string, { issue?: string; mdWorkflow?: ReturnType<typeof compileMd> }> {
  const selected = new Set(nodeIds), result: Record<string, { issue?: string; mdWorkflow?: ReturnType<typeof compileMd> }> = {};
  for (const node of graph.nodes) if (selected.has(node.id)) {
    try {
      if (node.kind === 'md' && Array.isArray(node.configuration.components)) result[node.id] = { mdWorkflow: compileMd(node) };
      else if (workflowCalculationTypes[node.kind] && node.configuration.compilerVersion === 1) result[node.id] = { issue: validateDraft(graph, node.id) ?? undefined };
    } catch (error) { result[node.id] = { issue: (error as Error).message }; }
  }
  return result;
}
