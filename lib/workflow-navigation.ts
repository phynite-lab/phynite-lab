import type { ProjectWorkflow, WorkflowNode } from './project-workflow.ts';

export type WorkflowTreeEntry = {
  node: WorkflowNode;
  parentId?: string;
  depth: number;
  childIds: string[];
  additionalInputs: string[];
};

/** A DAG has multiple inputs; its navigation tree selects one stable visual parent only. */
export function workflowModuleTree(graph: Pick<ProjectWorkflow, 'nodes' | 'edges'>): WorkflowTreeEntry[] {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const inputs = new Map<string, string[]>(), parents = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    const sources = inputs.get(edge.target) ?? [];
    if (!sources.includes(edge.source)) sources.push(edge.source);
    inputs.set(edge.target, sources);
  }
  for (const node of graph.nodes) {
    const sources = (inputs.get(node.id) ?? []).sort((a, b) => order.get(a)! - order.get(b)!);
    for (const source of sources) {
      const seen = new Set([node.id]);
      let cursor: string | undefined = source;
      while (cursor && !seen.has(cursor)) { seen.add(cursor); cursor = parents.get(cursor); }
      if (!cursor) { parents.set(node.id, source); break; }
    }
  }
  const children = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const parent = parents.get(node.id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), node.id]);
  }
  const stack = graph.nodes.filter(node => !parents.has(node.id)).reverse().map(node => ({ id: node.id, depth: 0 }));
  const result: WorkflowTreeEntry[] = [];
  while (stack.length) {
    const { id, depth } = stack.pop()!, childIds = children.get(id) ?? [];
    result.push({ node: byId.get(id)!, parentId: parents.get(id), depth, childIds, additionalInputs: (inputs.get(id) ?? []).filter(source => source !== parents.get(id)) });
    stack.push(...[...childIds].reverse().map(id => ({ id, depth: depth + 1 })));
  }
  return result;
}

/** Only new nodes are numbered. Existing/custom names and scientific inputs remain untouched. */
export function nextWorkflowModuleName(nodes: Pick<WorkflowNode, 'name'>[], base: string): string {
  const used = new Set(nodes.map(node => node.name.trim().toLocaleLowerCase()));
  if (!used.has(base.trim().toLocaleLowerCase())) return base;
  let number = 2;
  while (used.has(`${base} (${number})`.toLocaleLowerCase())) number++;
  return `${base} (${number})`;
}
