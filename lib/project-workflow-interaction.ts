import { workflowConnectionError, workflowKinds, workflowModules, type ProjectWorkflow, type WorkflowEdge, type WorkflowKind, type WorkflowNode } from './project-workflow.ts';

export type WorkflowEdgeAnchors = { source: 'right' | 'bottom'; target: 'left' | 'top' };
export type WorkflowConnectionAnchor = { nodeId: string; type: 'source' | 'target'; side?: 'left' | 'right' | 'top' | 'bottom' };
type CanvasConnection = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };

/** Endpoint placement is device UI state, independent of the scientific input port. */
export function workflowConnectionAnchors(connection: Pick<CanvasConnection, 'sourceHandle' | 'targetHandle'>): WorkflowEdgeAnchors {
  return { source: connection.sourceHandle?.endsWith(':bottom') ? 'bottom' : 'right', target: connection.targetHandle?.endsWith(':top') ? 'top' : 'left' };
}

/** Used while dragging as well as at commit, so invalid drops never create a graph edit. */
export function workflowCanvasConnection(graph: ProjectWorkflow, connection: CanvasConnection): Omit<WorkflowEdge, 'id'> | null {
  const source = graph.nodes.find(node => node.id === connection.source), target = graph.nodes.find(node => node.id === connection.target);
  if (!source || !target) return null;
  const port = workflowModules[target.kind].input;
  const output = workflowModules[source.kind].output;
  if (!port || ![output, `${output}:bottom`].includes(connection.sourceHandle ?? '') || ![port, `${port}:top`].includes(connection.targetHandle ?? '')
    || graph.edges.some(edge => edge.source === source.id && edge.target === target.id)) return null;
  const edge = { source: source.id, target: target.id, port };
  return workflowConnectionError(graph, edge) ? null : edge;
}

export function workflowNewNodeConnection(graph: ProjectWorkflow, node: WorkflowNode, anchor: WorkflowConnectionAnchor): Omit<WorkflowEdge, 'id'> | null {
  const source = anchor.type === 'source' ? graph.nodes.find(item => item.id === anchor.nodeId) : node;
  const target = anchor.type === 'target' ? graph.nodes.find(item => item.id === anchor.nodeId) : node;
  if (!source || !target) return null;
  return workflowCanvasConnection({ ...graph, nodes: [...graph.nodes, node] }, {
    source: source.id, target: target.id, sourceHandle: workflowModules[source.kind].output, targetHandle: workflowModules[target.kind].input,
  });
}

/** Dragging from an input adds a prerequisite; dragging from an output adds a downstream module. */
export function workflowModuleChoices(graph: ProjectWorkflow, anchor?: WorkflowConnectionAnchor): WorkflowKind[] {
  let candidateId = '__new_workflow_module__';
  while (graph.nodes.some(node => node.id === candidateId)) candidateId += '_';
  return workflowKinds.filter(kind => kind !== 'legacy' && (!anchor || workflowNewNodeConnection(graph, {
    id: candidateId, kind, name: kind, position: { x: 0, y: 0 }, configuration: {}, resources: [],
  }, anchor) !== null));
}
