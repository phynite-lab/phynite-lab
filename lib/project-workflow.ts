/** Project-scoped scientific graph. Layout and editor state never identify a run. */
export const workflowKinds = ['structure', 'trajectory', 'scf', 'relax', 'bands', 'dos', 'phonon', 'btp2', 'md', 'md-analysis', 'extract-frame', 'figure', 'legacy'] as const;
export type WorkflowKind = typeof workflowKinds[number];
export type WorkflowPort = 'structure' | 'trajectory' | 'electronic' | 'dataset';
export type WorkflowResource = { kind: 'structure' | 'trajectory' | 'potential'; id: string; sha256?: string; deviceOnly?: boolean };
export type WorkflowNode = {
  id: string; kind: WorkflowKind; name: string; position: { x: number; y: number };
  configuration: Record<string, unknown>; resources: WorkflowResource[]; groupId?: string;
  legacy?: { localId: string; editor: 'dft' | 'md' | 'figures'; materialId?: string; componentId?: string };
};
export type WorkflowEdge = { id: string; source: string; target: string; port: WorkflowPort };
export type WorkflowGroup = { id: string; name: string; nodeIds: string[] };
export type ProjectWorkflow = { version: 1; projectId: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; groups: WorkflowGroup[] };
export type WorkflowEnvelope = { workflow: ProjectWorkflow; revision: number; migrated?: boolean };
export type WorkflowAttemptStatus = 'pending' | 'queued' | 'running' | 'completed' | 'ready' | 'reused' | 'failed' | 'blocked' | 'cancelled';
export type WorkflowAttempt = { nodeId: string; fingerprint: string; status: WorkflowAttemptStatus; jobId?: string; jobKind?: string; error?: string; outdated?: boolean; result?: Record<string, unknown>; sourceAttemptId?: string };
export type ProjectRun = { id: string; projectId: string; workflowRevision: number; status: string; createdAt: string; targets: string[]; attempts: WorkflowAttempt[] };
export type WorkflowPlan = { compilerSha256?: string | null; revision: number; targets: string[]; order: string[]; nodes: Array<{ nodeId: string; fingerprint: string; action: 'run' | 'reuse' | 'input' | 'prepare'; sourceScfNodeId?: string; force?: boolean; validationDeferred?: boolean; error?: string }>; errors: Array<{ nodeId: string; message: string }>; compute: { pricing: 'existing'; md: 'personal'; requiresConfirmation: true; estimatedQuanta?: number | null; hasSharedCompute?: boolean } };

export const workflowModules: Record<WorkflowKind, { en: string; id: string; input?: WorkflowPort; output: WorkflowPort; multiple?: boolean }> = {
  structure: { en: 'Crystal structure', id: 'Struktur kristal', output: 'structure' },
  trajectory: { en: 'Imported trajectory', id: 'Impor trajectory', output: 'trajectory' },
  relax: { en: 'Relaxation', id: 'Relaksasi', input: 'structure', output: 'structure' },
  scf: { en: 'SCF / Total energy', id: 'SCF / Energi total', input: 'structure', output: 'electronic' },
  bands: { en: 'Band structure', id: 'Struktur pita', input: 'electronic', output: 'dataset' },
  dos: { en: 'DOS / PDOS', id: 'DOS / PDOS', input: 'electronic', output: 'dataset' },
  phonon: { en: 'Phonon', id: 'Fonon', input: 'electronic', output: 'dataset' },
  btp2: { en: 'BTP2 transport', id: 'Transport BTP2', input: 'electronic', output: 'dataset' },
  md: { en: 'MD simulation', id: 'Simulasi MD', input: 'structure', output: 'trajectory' },
  'md-analysis': { en: 'MD analysis', id: 'Analisis MD', input: 'trajectory', output: 'dataset' },
  'extract-frame': { en: 'Extract MD frame', id: 'Ekstrak frame MD', input: 'trajectory', output: 'structure' },
  figure: { en: 'Figure', id: 'Figure', input: 'dataset', output: 'dataset', multiple: true },
  legacy: { en: 'Legacy configuration', id: 'Konfigurasi legacy', output: 'dataset' },
};
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const emptyProjectWorkflow = (projectId: string): ProjectWorkflow => ({ version: 1, projectId, nodes: [], edges: [], groups: [] });

/** Do not normalize scientific values. Reject malformed data rather than replacing it. */
export function parseProjectWorkflow(raw: unknown, projectId?: string): ProjectWorkflow {
  if (new TextEncoder().encode(JSON.stringify(raw) ?? '').byteLength > 4_000_000) throw new Error('Workflow exceeds 4 MB. Split this workflow or remove unused configurations.');
  const fail = (): never => { throw new Error('Invalid project workflow.'); };
  if (!record(raw) || raw.version !== 1 || !identifier(raw.projectId) || (projectId && raw.projectId !== projectId)
    || !Array.isArray(raw.nodes) || raw.nodes.length > 1000 || !Array.isArray(raw.edges) || raw.edges.length > 4000
    || !Array.isArray(raw.groups) || raw.groups.length > 200) return fail();
  const checkJson = (value: unknown): boolean => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(checkJson) || record(value) && Object.values(value).every(item => item === undefined || checkJson(item));
  if (!checkJson(raw)) return fail();
  const ids = new Set<string>();
  for (const node of raw.nodes) {
    if (!record(node) || !identifier(node.id) || ids.has(node.id) || !workflowKinds.includes(node.kind as WorkflowKind)
      || typeof node.name !== 'string' || !node.name.trim() || node.name.length > 200 || !record(node.position)
      || !['x', 'y'].every(axis => { const value = (node.position as Record<string, unknown>)[axis]; return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e7; })
      || !record(node.configuration) || !Array.isArray(node.resources) || node.resources.length > 100) return fail();
    ids.add(node.id);
    for (const resource of node.resources) if (!record(resource) || !['structure', 'trajectory', 'potential'].includes(String(resource.kind))
      || !identifier(resource.id) || (resource.sha256 !== undefined && (typeof resource.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256)))
      || (resource.deviceOnly !== undefined && typeof resource.deviceOnly !== 'boolean')) return fail();
    if (node.legacy !== undefined && (!record(node.legacy) || !identifier(node.legacy.localId) || !['dft', 'md', 'figures'].includes(String(node.legacy.editor)))) return fail();
  }
  const graph = structuredClone(raw) as ProjectWorkflow;
  const edgeIds = new Set<string>(), pairs = new Set<string>();
  for (const edge of graph.edges) {
    if (!record(edge) || !identifier(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)
      || pairs.has(`${edge.source}:${edge.target}`)) return fail();
    edgeIds.add(edge.id); pairs.add(`${edge.source}:${edge.target}`);
    const error = workflowConnectionError({ ...graph, edges: graph.edges.filter(item => item.id !== edge.id) }, edge);
    if (error) throw new Error(error);
  }
  const groupIds = new Set<string>(), grouped = new Set<string>();
  for (const group of graph.groups) {
    if (!record(group) || !identifier(group.id) || groupIds.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 200
      || !Array.isArray(group.nodeIds) || !group.nodeIds.length || new Set(group.nodeIds).size !== group.nodeIds.length || group.nodeIds.some(id => !ids.has(id) || grouped.has(id))) return fail();
    groupIds.add(group.id); group.nodeIds.forEach(id => grouped.add(id));
  }
  for (const node of graph.nodes) if (node.groupId && !graph.groups.some(group => group.id === node.groupId && group.nodeIds.includes(node.id))) return fail();
  workflowOrder(graph);
  return graph;
}

export function workflowConnectionError(graph: ProjectWorkflow, edge: Pick<WorkflowEdge, 'source' | 'target' | 'port'>): string | null {
  const source = graph.nodes.find(node => node.id === edge.source), target = graph.nodes.find(node => node.id === edge.target);
  if (!source || !target) return 'Connect nodes inside this project.';
  if (source.kind === 'figure') return 'Figure is an output. Connect a calculation or analysis dataset.';
  if (source.id === target.id) return 'A node cannot connect to itself.';
  const out = workflowModules[source.kind].output, input = workflowModules[target.kind].input;
  if (edge.port !== input || out !== input) return 'These module inputs and outputs are incompatible.';
  if (!workflowModules[target.kind].multiple && graph.edges.some(item => item.target === target.id)) return 'Disconnect the current input before selecting another source.';
  const pending = [target.id], seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === source.id) return 'Workflow connections cannot form a cycle.';
    if (!seen.has(id)) { seen.add(id); pending.push(...graph.edges.filter(item => item.source === id).map(item => item.target)); }
  }
  return null;
}

/** Stable topological order includes each prerequisite exactly once. */
export function workflowOrder(graph: ProjectWorkflow, targets = graph.nodes.map(node => node.id)): string[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node])), done = new Set<string>(), visiting = new Set<string>(), order: string[] = [];
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (!nodes.has(id)) throw new Error('Workflow target does not exist.');
    if (visiting.has(id)) throw new Error('Workflow connections cannot form a cycle.');
    visiting.add(id);
    graph.edges.filter(edge => edge.target === id).sort((a, b) => a.source.localeCompare(b.source)).forEach(edge => visit(edge.source));
    visiting.delete(id); done.add(id); order.push(id);
  };
  [...targets].sort().forEach(visit);
  return order;
}
export function stableWorkflowJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableWorkflowJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stableWorkflowJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function workflowFingerprints(graph: ProjectWorkflow): Promise<Record<string, string>> {
  const fingerprints: Record<string, string> = {};
  for (const id of workflowOrder(graph)) {
    const node = graph.nodes.find(item => item.id === id)!;
    const inputs = graph.edges.filter(edge => edge.target === id).map(edge => ({ port: edge.port, fingerprint: fingerprints[edge.source] })).sort((a, b) => stableWorkflowJson(a).localeCompare(stableWorkflowJson(b)));
    const bytes = new TextEncoder().encode(stableWorkflowJson({ kind: node.kind, configuration: scientificWorkflowConfiguration(node.configuration, node.kind), resources: node.resources, inputs }));
    fingerprints[id] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return fingerprints;
}
export function scientificWorkflowConfiguration(configuration: Record<string, unknown>, kind?: WorkflowKind): Record<string, unknown> {
  const result = structuredClone(configuration);
  if (configuration.compilerVersion === 1 || kind === 'md' && Array.isArray(configuration.components)) delete result.execution;
  for (const key of ['savedStructureSignature', 'configurationError', 'legacySource', 'preservedHistory', 'plotSettings', 'elementMapText', 'style', 'compilerVersion', 'estimatedComputeSeconds']) delete result[key];
  for (const key of ['structure', 'draft', 'execution']) {
    const value = result[key];
    if (!record(value)) continue;
    delete value.name;
    if (key === 'draft') delete value.calculations;
    if (key === 'execution') { delete value.idempotencyKey; if (record(value.settings)) delete value.settings.calculations; }
  }
  for (const stage of Array.isArray(result.components) ? result.components : []) if (record(stage)) {
    for (const key of ['id', 'name', 'materialId', 'materialName']) delete stage[key];
    if (record(stage.config)) delete stage.config.name;
  }
  if (record(result.component)) {
    for (const key of ['id', 'name', 'materialId', 'materialName', 'selected']) delete result.component[key];
    if (record(result.component.config)) delete result.component.config.name;
  }
  return result;
}
export function removeWorkflowNodes(graph: ProjectWorkflow, ids: string[]): ProjectWorkflow {
  const removed = new Set(ids);
  return { ...graph, nodes: graph.nodes.filter(node => !removed.has(node.id)), edges: graph.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)), groups: graph.groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !removed.has(id)) })).filter(group => group.nodeIds.length) };
}
export type WorkflowClipboardV1 = { version: 1; projectId: string; revision: number; synchronized?: boolean; nodes: WorkflowNode[]; edges: WorkflowEdge[] };
export type WorkflowClipboardV2 = Omit<WorkflowClipboardV1, 'version'> & { version: 2; groups: WorkflowGroup[]; edgeAnchors: Record<string, { source: 'right' | 'bottom'; target: 'left' | 'top' }> };
export type WorkflowClipboard = WorkflowClipboardV1 | WorkflowClipboardV2;
/** Copy configuration, never completed execution/result bindings. */
export function cleanWorkflowClipboardValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanWorkflowClipboardValue);
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['preservedHistory', 'preservedJobId', 'preservedJobKind', 'preservedFigureId', 'result', 'binding', 'sourceAttemptId', 'sharedScf'].includes(key)).map(([key, item]) => [key, cleanWorkflowClipboardValue(item)]));
}
export function copyWorkflowNodes(graph: ProjectWorkflow, ids: string[], revision: number, anchors: WorkflowClipboardV2['edgeAnchors'] = {}): WorkflowClipboardV2 {
  const selected = new Set(ids), groups = graph.groups.filter(group => group.nodeIds.every(id => selected.has(id))), keptGroups = new Set(groups.map(group => group.id));
  const nodes = structuredClone(graph.nodes.filter(node => selected.has(node.id))).map(node => ({ ...node, groupId: keptGroups.has(node.groupId ?? '') ? node.groupId : undefined, configuration: cleanWorkflowClipboardValue(node.configuration) as Record<string, unknown> }));
  const edges = structuredClone(graph.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)));
  return { version: 2, projectId: graph.projectId, revision, nodes, edges, groups: structuredClone(groups), edgeAnchors: Object.fromEntries(edges.filter(edge => anchors[edge.id]).map(edge => [edge.id, anchors[edge.id]])) };
}
export function parseWorkflowClipboard(raw: unknown): WorkflowClipboardV2 {
  const value = record(raw) && 'phyniteWorkflow' in raw ? raw.phyniteWorkflow : raw;
  if (!record(value) || (value.version !== 1 && value.version !== 2) || !identifier(value.projectId) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error('Clipboard does not contain valid Phynite modules.');
  const graph = parseProjectWorkflow({ version: 1, projectId: value.projectId, nodes: value.nodes.map(node => record(node) && value.version === 1 ? { ...node, groupId: undefined } : node), edges: value.edges, groups: value.version === 2 ? value.groups : [] });
  const anchors: WorkflowClipboardV2['edgeAnchors'] = {};
  if (value.version === 2 && record(value.edgeAnchors)) for (const edge of graph.edges) {
    const anchor = value.edgeAnchors[edge.id];
    if (record(anchor) && ['right', 'bottom'].includes(String(anchor.source)) && ['left', 'top'].includes(String(anchor.target))) anchors[edge.id] = anchor as WorkflowClipboardV2['edgeAnchors'][string];
  }
  return { ...copyWorkflowNodes(graph, graph.nodes.map(node => node.id), Number(value.revision), anchors), synchronized: value.synchronized === true };
}
export function pasteWorkflowSelection(graph: ProjectWorkflow, input: WorkflowClipboard, createId: () => string, point?: { x: number; y: number }) {
  const clipboard = parseWorkflowClipboard(input);
  if (clipboard.projectId !== graph.projectId) throw new Error('Import cross-project nodes through the project API.');
  const nodeIds = Object.fromEntries(clipboard.nodes.map(node => [node.id, createId()])), edgeIds = Object.fromEntries(clipboard.edges.map(edge => [edge.id, createId()])), groupIds = Object.fromEntries(clipboard.groups.map(group => [group.id, createId()]));
  const offset = point ? { x: point.x - Math.min(...clipboard.nodes.map(node => node.position.x)), y: point.y - Math.min(...clipboard.nodes.map(node => node.position.y)) } : { x: 40, y: 40 };
  const workflow = parseProjectWorkflow({ ...graph, nodes: [...graph.nodes, ...structuredClone(clipboard.nodes).map(node => ({ ...node, id: nodeIds[node.id], legacy: undefined, groupId: node.groupId ? groupIds[node.groupId] : undefined, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } }))], edges: [...graph.edges, ...clipboard.edges.map(edge => ({ ...edge, id: edgeIds[edge.id], source: nodeIds[edge.source], target: nodeIds[edge.target] }))], groups: [...graph.groups, ...clipboard.groups.map(group => ({ ...group, id: groupIds[group.id], nodeIds: group.nodeIds.map(id => nodeIds[id]) }))] });
  return { workflow, nodeIds, edgeIds, groupIds, edgeAnchors: Object.fromEntries(Object.entries(clipboard.edgeAnchors).map(([id, anchor]) => [edgeIds[id], anchor])) };
}
export function pasteWorkflowNodes(graph: ProjectWorkflow, clipboard: WorkflowClipboard, createId: () => string, offset = { x: 40, y: 40 }): ProjectWorkflow {
  const point = { x: Math.min(...clipboard.nodes.map(node => node.position.x)) + offset.x, y: Math.min(...clipboard.nodes.map(node => node.position.y)) + offset.y };
  return pasteWorkflowSelection(graph, clipboard, createId, point).workflow;
}
