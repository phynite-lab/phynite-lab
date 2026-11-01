import { type ProjectWorkflow, type WorkflowNode } from './project-workflow.ts';
import { structureFormula } from './structure-formula.ts';

/** Follow upstream and downstream independently, so selecting Bands does not light up sibling DOS. */
export function workflowPathFocus(graph: ProjectWorkflow, selected: string[], selectedEdges: string[] = []) {
  const nodes = new Set(selected.filter(id => graph.nodes.some(node => node.id === id)));
  const edges = new Set(selectedEdges.filter(id => graph.edges.some(edge => edge.id === id)));
  for (const direction of ['source', 'target'] as const) {
    const seen = new Set(nodes), pending = [...nodes];
    while (pending.length) {
      const id = pending.pop()!;
      for (const edge of graph.edges) {
        if (edge[direction === 'source' ? 'target' : 'source'] !== id) continue;
        edges.add(edge.id);
        const next = edge[direction];
        if (!seen.has(next)) { seen.add(next); pending.push(next); }
      }
    }
  }
  for (const edge of graph.edges) if (edges.has(edge.id)) { nodes.add(edge.source); nodes.add(edge.target); }
  return { nodes, edges, active: nodes.size > 0 || edges.size > 0 };
}

/** Summaries use saved input only. Missing or malformed structure data is left undisplayed. */
export function workflowNodeSummary(graph: ProjectWorkflow, node: WorkflowNode) {
  let composition: { formula: string; atoms: number } | undefined;
  const raw = node.configuration.structure;
  if (raw && typeof raw === 'object' && 'atoms' in raw && Array.isArray(raw.atoms) && raw.atoms.length && raw.atoms.every(atom => atom && typeof atom.species === 'string')) {
    try {
      const formula = structureFormula(raw.atoms);
      if (formula) composition = { formula, atoms: raw.atoms.length };
    } catch { /* Invalid imported data must not break canvas rendering or become a placeholder formula. */ }
  }
  return {
    composition,
    sources: graph.edges.filter(edge => edge.target === node.id).flatMap(edge => graph.nodes.find(source => source.id === edge.source)?.name ?? []),
    outputs: graph.edges.filter(edge => edge.source === node.id).length,
  };
}
