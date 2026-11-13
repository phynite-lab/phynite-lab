import { parseProjectWorkflow, stableWorkflowJson, workflowModules, type ProjectWorkflow } from './project-workflow.ts';
import type { CanvasMeasurements } from './workflow-canvas.ts';
import type { ElkNode } from 'elkjs/lib/elk-api';

export const layoutNodeSize = { width: 230, height: 120 };
export type WorkflowLayoutMode = 'touched' | 'all';
const compareId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Freeze these coordinates in the reviewed action; approval must never run ELK again. */
export async function layoutWorkflow(original: ProjectWorkflow, touched: readonly string[], mode: WorkflowLayoutMode = 'touched', sizes: CanvasMeasurements = {}): Promise<ProjectWorkflow> {
  const graph = parseProjectWorkflow(original);
  const selected = new Set(mode === 'all' ? graph.nodes.map(node => node.id) : touched);
  for (const group of graph.groups) if (selected.has(group.id) || group.nodeIds.some(id => selected.has(id))) group.nodeIds.forEach(id => selected.add(id));
  const nodes = graph.nodes.filter(node => selected.has(node.id)).sort(compareId);
  if (!nodes.length) return graph;
  const size = (id: string) => {
    const dimensions = sizes[id] ?? layoutNodeSize;
    if (![dimensions.width, dimensions.height].every(value => Number.isFinite(value) && value >= 1 && value <= 10000)) throw new Error('Invalid layout node dimensions.');
    return dimensions;
  };
  const elkNode = (node: typeof nodes[number]): ElkNode => ({
    id: node.id, ...size(node.id), layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
    ports: [...(workflowModules[node.kind].input ? [{ id: `${node.id}:in`, width: 8, height: 8, layoutOptions: { 'elk.port.side': 'WEST' } }] : []),
      { id: `${node.id}:out`, width: 8, height: 8, layoutOptions: { 'elk.port.side': 'EAST' } }],
  });
  const grouped = new Set(graph.groups.flatMap(group => group.nodeIds));
  const children: ElkNode[] = nodes.filter(node => !grouped.has(node.id)).map(elkNode);
  for (const group of [...graph.groups].sort(compareId)) {
    const members = nodes.filter(node => group.nodeIds.includes(node.id));
    if (members.length) children.push({ id: `group:${group.id}`, children: members.map(elkNode), layoutOptions: { 'elk.padding': '[top=48,left=24,bottom=24,right=24]' } });
  }
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const result = await new ELK().layout({
    id: 'layout', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.randomSeed': '1',
      'elk.spacing.nodeNode': '64', 'elk.layered.spacing.nodeNodeBetweenLayers': '100', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' },
    children, edges: graph.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)).sort(compareId)
      .map(edge => ({ id: edge.id, sources: [`${edge.source}:out`], targets: [`${edge.target}:in`] })),
  });
  const positions = new Map<string, { x: number; y: number }>();
  const visit = (parent: ElkNode, x = 0, y = 0) => {
    for (const child of parent.children ?? []) {
      if (!Number.isFinite(child.x) || !Number.isFinite(child.y)) throw new Error('Layout did not produce finite coordinates.');
      const point = { x: x + child.x!, y: y + child.y! };
      if (child.children) visit(child, point.x, point.y); else positions.set(child.id, point);
    }
  };
  visit(result);
  if (positions.size !== nodes.length) throw new Error('Layout did not return every selected module.');
  const fixed = graph.nodes.filter(node => !selected.has(node.id));
  const anchor = mode === 'all' ? { x: 0, y: 0 } : { x: Math.min(...nodes.map(node => node.position.x)), y: Math.min(...nodes.map(node => node.position.y)) };
  // Move the selected subgraph as one unit below any fixed obstacles. Unselected coordinates stay exact.
  const minY = Math.min(...[...positions.values()].map(point => point.y));
  let shift = 0;
  for (let pass = 0; pass <= fixed.length; pass++) {
    let nextShift = shift;
    for (const node of nodes) for (const obstacle of fixed) {
      const point = positions.get(node.id)!, own = size(node.id), other = size(obstacle.id);
      if (point.x + anchor.x < obstacle.position.x + other.width + 32 && point.x + anchor.x + own.width + 32 > obstacle.position.x
        && point.y + anchor.y + shift < obstacle.position.y + other.height + 32 && point.y + anchor.y + shift + own.height + 32 > obstacle.position.y) {
        nextShift = Math.max(nextShift, obstacle.position.y + other.height + 32 - minY - anchor.y);
      }
    }
    if (nextShift === shift) break;
    shift = nextShift;
    if (pass === fixed.length) throw new Error('No bounded layout space is available.');
  }
  graph.nodes = graph.nodes.map(node => {
    const point = positions.get(node.id);
    return point ? { ...node, position: { x: point.x + anchor.x, y: point.y + anchor.y + shift } } : node;
  });
  return parseProjectWorkflow(graph);
}

export type AiCanvasPreview = { conversationId: string; actionId: string; payloadHash: string; expiresAt: number; baseRevision: number; baseSignature: string; workflow: ProjectWorkflow };
export type AiCanvasPreviewInput = Omit<AiCanvasPreview, 'baseSignature'>;
export type AiCanvasPreviewHandler = (preview: AiCanvasPreviewInput | null, actionId?: string) => void;
export function frozenCanvasPreview(original: ProjectWorkflow, input: AiCanvasPreviewInput): AiCanvasPreview {
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 || !Number.isFinite(input.expiresAt) || !/^[a-f0-9]{64}$/.test(input.payloadHash)) throw new Error('Invalid Canvas preview binding.');
  return { ...input, baseSignature: stableWorkflowJson(original), workflow: parseProjectWorkflow(input.workflow, original.projectId) };
}
export function canvasPreviewCurrent(preview: AiCanvasPreview, graph: ProjectWorkflow, revision: number, now = Date.now()) {
  return preview.expiresAt * 1000 > now && preview.baseRevision === revision && preview.baseSignature === stableWorkflowJson(graph);
}

/** Includes edge-only edits and removed edges, even when neither endpoint changes. */
export function canvasPreviewChanges(before: ProjectWorkflow, after: ProjectWorkflow) {
  const changed = <T extends { id: string }>(left: T[], right: T[]) => new Set([...left, ...right]
    .filter(item => stableWorkflowJson(left.find(old => old.id === item.id) ?? null) !== stableWorkflowJson(right.find(next => next.id === item.id) ?? null)).map(item => item.id));
  const nodes = changed(before.nodes, after.nodes), edges = changed(before.edges, after.edges), groups = changed(before.groups, after.groups);
  for (const edge of [...before.edges, ...after.edges]) if (nodes.has(edge.source) || nodes.has(edge.target)) edges.add(edge.id);
  for (const group of [...before.groups, ...after.groups]) if (group.nodeIds.some(id => nodes.has(id))) groups.add(group.id);
  return { nodes, edges, groups };
}
