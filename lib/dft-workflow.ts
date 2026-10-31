import type { CalculationComponentInstance } from '../components/CalculationPanel.tsx';
import type { CalculationType, JobDraft } from '../components/JobComposer.tsx';

export type WorkflowPoint = { x: number; y: number };
export type ScfReusePolicy = { mode: 'auto' | 'fresh' } | { mode: 'selected'; calculationId: string };
export type DftWorkflowCanvas = { version: 1; positions: Record<string, WorkflowPoint>; hiddenStructures: string[]; grid: boolean; guides: boolean };
export type WorkflowMaterial = { id: string; projectId: string; name: string };
export type WorkflowDocument = { components: CalculationComponentInstance[]; canvas: DftWorkflowCanvas };
export const ANALYSES: CalculationType[] = ['Band structure', 'Density of states', 'Phonon dispersion', 'Thermoelectric properties'];
export const structureNodeId = (id: string) => `structure:${id}`;
export const defaultWorkflowCanvas = (): DftWorkflowCanvas => ({ version: 1, positions: {}, hiddenStructures: [], grid: true, guides: true });

/** Analysis-specific sampling never changes the inherited ground state. */
const analysisFields: Array<keyof JobDraft> = ['kPoint', 'kPointY', 'kPointZ', 'kPointShift', 'numberOfBands', 'kPath', 'kPathMode', 'kPathPoints', 'bandSymmetry', 'bandOverlap', 'firstBand', 'lastBand', 'dosEnergyMin', 'dosEnergyMax', 'dosEnergyStep', 'projectedDos', 'projectedBands', 'dosBroadening', 'dosNgauss', 'dosSymmetrize', 'pawProjection', 'qPoint', 'qPointY', 'qPointZ', 'phononThreshold', 'phononIterations', 'phononMixing', 'phononMixingNdim', 'acousticSumRule', 'dielectricTensor', 'effectiveCharges', 'phononAsr', 'electronPhonon', 'transportInterpolationMultiplier', 'transportTemperatureMin', 'transportTemperatureMax', 'transportTemperatureStep', 'transportChemicalPotentialMin', 'transportChemicalPotentialMax', 'transportSampling', 'transportScatteringModel', 'transportRelaxationTime', 'transportEnergyBins', 'plotXMin', 'plotXMax', 'plotYMin', 'plotYMax', 'title', 'calculations'];
export function inheritedAnalysisDraft(analysis: JobDraft, scf: JobDraft): JobDraft {
  const next = { ...scf, rawInput: analysis.rawInput };
  for (const key of analysisFields) Object.assign(next, { [key]: analysis[key] });
  return next;
}

export function workflowEdges(components: CalculationComponentInstance[], materials: WorkflowMaterial[]) {
  const ids = new Set(components.map(c => c.id));
  const materialIds = new Set(materials.map(m => m.id));
  return components.flatMap(c => {
    const source = ANALYSES.includes(c.calculation) ? c.scfSourceId : c.structureSourceId === 'original' ? structureNodeId(c.materialId) : c.structureSourceId;
    return source && (ids.has(source) || (source.startsWith('structure:') && materialIds.has(source.slice(10))))
      ? [{ id: `${source}->${c.id}`, source, target: c.id, ...(c.neb ? {targetHandle:'initial'} : {}) }, ...(c.neb ? [c.neb.finalSourceId, c.neb.intermediateSourceId].flatMap((id,i) => id && (ids.has(id) || id.startsWith('structure:') && materialIds.has(id.slice(10))) ? [{ id:`${id}->${c.id}:${i}`,source:id,target:c.id,targetHandle:i===0?'final':'intermediate' }] : []) : [])] : [];
  });
}

/** Mark the incoming wire as well as every descendant carrying stale provenance. */
export function staleWorkflowNodes(edges: Array<{ source: string; target: string }>, outdated: string[]): Set<string> {
  const stale = new Set(outdated);
  const children = new Map<string, string[]>();
  for (const edge of edges) children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
  const queue = [...stale];
  for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]) ?? []) {
    if (!stale.has(child)) { stale.add(child); queue.push(child); }
  }
  return stale;
}

export function connectWorkflow(document: WorkflowDocument, materials: WorkflowMaterial[], source: string, target: string, port?: string | null): WorkflowDocument {
  const child = document.components.find(c => c.id === target);
  const parent = document.components.find(c => c.id === source);
  const material = source.startsWith('structure:') ? materials.find(m => structureNodeId(m.id) === source) : undefined;
  if (!child || source === target) throw new Error('Choose two different compatible nodes.');
  if (child.neb && (port === 'final' || port === 'intermediate')) {
    if (!material && !parent?.geometry) throw new Error('Connect a project structure or geometry output to an NEB endpoint.');
    if (parent?.materialId === undefined && !material) throw new Error('NEB source is missing.');
    const connected = { ...document, components: document.components.map(c => c.id === target ? { ...c, neb: { ...c.neb!, [port === 'final' ? 'finalSourceId' : 'intermediateSourceId']: source } } : c) };
    // Every endpoint participates in cycle detection, including geometry branches.
    const ancestors = (id: string, seen: Set<string>): void => { if (seen.has(id)) throw new Error('This connection would create a cycle.'); for (const edge of workflowEdges(connected.components, materials).filter(e => e.target === id)) ancestors(edge.source, new Set(seen).add(id)); };
    ancestors(target,new Set()); return connected;
  }
  if ((child.geometry || child.neb) && parent && !parent.geometry) throw new Error('Save a completed relaxed structure before transforming it.');
  if (ANALYSES.includes(child.calculation)) {
    if (parent?.calculation !== 'Total energy' || parent.geometry || parent.sweep || parent.neb) throw new Error('Connect an SCF output to this analysis.');
  } else if (!material && !parent?.geometry && parent?.calculation !== 'Structural relaxation') throw new Error('Connect a structure or relaxation output to this node.');
  if (parent && child.materialId !== parent.materialId || material && child.materialId !== material.id) throw new Error('Connect nodes belonging to the same structure.');
  const components = document.components.map(c => c.id !== target ? c : ANALYSES.includes(c.calculation) ? { ...c, scfSourceId: source } : { ...c, structureSourceId: material ? 'original' : source });
  const visit = (id: string, ancestors: Set<string>): void => {
    if (ancestors.has(id)) throw new Error('This connection would create a cycle.');
    const next = new Set(ancestors).add(id);
    for (const edge of workflowEdges(components, materials).filter(e => e.target === id)) visit(edge.source, next);
  };
  visit(target, new Set());
  return { ...document, components };
}

export function workflowOrder(components: CalculationComponentInstance[], materials: WorkflowMaterial[], targets = components.map(c => c.id)): CalculationComponentInstance[] {
  const result: CalculationComponentInstance[] = [], done = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error('Workflow contains a cycle.');
    const c = components.find(c => c.id === id);
    if (!c) throw new Error('A required workflow node is missing.');
    if (!materials.some(m => m.id === c.materialId)) throw new Error(`${c.name}: structure is unavailable.`);
    visiting.add(id);
    const parent = ANALYSES.includes(c.calculation) ? c.scfSourceId : c.structureSourceId;
    if (!parent || parent === 'unbound') throw new Error(`${c.name}: connect its ${ANALYSES.includes(c.calculation) ? 'SCF' : 'structure'} input first.`);
    if (parent !== 'original') {
      const p = components.find(c => c.id === parent);
      if (c.neb && p && !p.geometry) throw new Error('Save a completed relaxed structure before using it as an NEB endpoint.');
      if (!p || p.materialId !== c.materialId || (ANALYSES.includes(c.calculation) ? p.calculation !== 'Total energy' || p.geometry || p.sweep || p.neb : !p.geometry && p.calculation !== 'Structural relaxation')) throw new Error(`${c.name}: incompatible input source.`);
      visit(parent);
    }
    if (c.neb) for (const endpoint of [c.neb.finalSourceId, c.neb.intermediateSourceId]) {
      if (!endpoint) { if (endpoint === c.neb.finalSourceId) throw new Error(`${c.name}: connect the final structure.`); continue; }
      if (endpoint.startsWith('structure:')) { if (!materials.some(m=>structureNodeId(m.id)===endpoint)) throw new Error('NEB endpoint is outside this project.'); }
      else { const node=components.find(c=>c.id===endpoint); if (!node?.geometry) throw new Error('NEB endpoint must supply a structure.'); visit(endpoint); }
    }
    visiting.delete(id); done.add(id); result.push(c);
  };
  targets.forEach(visit);
  return result;
}

export function removeWorkflowNodes(document: WorkflowDocument, ids: string[]): WorkflowDocument {
  const removed = new Set(ids);
  return {
    components: document.components.filter(c => !removed.has(c.id)).map(c => ({ ...c,
      ...(c.neb ? {neb:{...c.neb, finalSourceId:removed.has(c.neb.finalSourceId)?'unbound':c.neb.finalSourceId,intermediateSourceId:c.neb.intermediateSourceId && removed.has(c.neb.intermediateSourceId)?undefined:c.neb.intermediateSourceId}} : {}),
      ...(c.scfSourceId && removed.has(c.scfSourceId) ? { scfSourceId: 'unbound' } : {}),
      ...(removed.has(c.structureSourceId) || removed.has(structureNodeId(c.materialId)) && c.structureSourceId === 'original' ? { structureSourceId: 'unbound' } : {}),
    })),
    canvas: { ...document.canvas, hiddenStructures: [...new Set([...document.canvas.hiddenStructures, ...ids.filter(id => id.startsWith('structure:')).map(id => id.slice(10))])], positions: Object.fromEntries(Object.entries(document.canvas.positions).filter(([id]) => !removed.has(id))) },
  };
}

export function autoArrange(components: CalculationComponentInstance[], materials: WorkflowMaterial[]): Record<string, WorkflowPoint> {
  const positions: Record<string, WorkflowPoint> = {};
  let row = 0;
  for (const material of materials) {
    const own = components.filter(c => c.materialId === material.id);
    const depth = (id: string, seen = new Set<string>()): number => {
      if (seen.has(id)) return 1;
      const c = own.find(c => c.id === id); if (!c) return 0;
      const parent = ANALYSES.includes(c.calculation) ? c.scfSourceId : c.structureSourceId;
      return parent && parent !== 'original' && parent !== 'unbound' ? 1 + depth(parent, new Set(seen).add(id)) : 1;
    };
    positions[structureNodeId(material.id)] = { x: 32, y: row * 264 + 32 };
    const rows = new Map<number, number>();
    for (const c of own) { const d = depth(c.id), r = rows.get(d) ?? 0; positions[c.id] = { x: 32 + d * 304, y: (row + r) * 264 + 32 }; rows.set(d, r + 1); }
    row += Math.max(1, ...rows.values()) + 1;
  }
  return positions;
}

/** Every member of a dragged selection receives the same world-space delta. */
export function snapWorkflowPoint(point: WorkflowPoint, size: { width: number; height: number }, other: Array<WorkflowPoint & { width: number; height: number }>, zoom: number, grid: boolean, guides: boolean) {
  const result = { x: grid ? Math.round(point.x / 16) * 16 : point.x, y: grid ? Math.round(point.y / 16) * 16 : point.y };
  const lines: { x?: number; y?: number }[] = [];
  if (guides) for (const axis of ['x', 'y'] as const) {
    const dimension = axis === 'x' ? 'width' : 'height'; let best = 6 / Math.max(.1, zoom), found = false;
    for (const node of other) for (const a of [0, size[dimension] / 2, size[dimension]]) for (const b of [0, node[dimension] / 2, node[dimension]]) {
      const delta = node[axis] + b - (point[axis] + a);
      if (Math.abs(delta) < best) { best = Math.abs(delta); result[axis] = point[axis] + delta; lines[axis === 'x' ? 0 : 1] = { [axis]: node[axis] + b }; found = true; }
    }
    if (!found) lines[axis === 'x' ? 0 : 1] = {};
  }
  return { point: result, lines };
}

export type WorkflowHistory<T> = { past: T[]; present: T; future: T[] };
export function editWorkflow<T>(history: WorkflowHistory<T>, next: T): WorkflowHistory<T> {
  return JSON.stringify(history.present) === JSON.stringify(next) ? history : { past: [...history.past, history.present].slice(-50), present: next, future: [] };
}
export function undoWorkflow<T>(history: WorkflowHistory<T>): WorkflowHistory<T> {
  return !history.past.length ? history : { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] };
}
export function redoWorkflow<T>(history: WorkflowHistory<T>): WorkflowHistory<T> {
  return !history.future.length ? history : { past: [...history.past, history.present].slice(-50), present: history.future[0], future: history.future.slice(1) };
}

export type WorkflowClipboard<M> = { format: 'phynite-dft-workflow'; version: 1; sourceProjectId: string; components: CalculationComponentInstance[]; materials: M[]; positions: Record<string, WorkflowPoint>; selected: string[] };
export function copyWorkflow<M extends WorkflowMaterial>(document: WorkflowDocument, materials: M[], selected: string[], projectId: string): string {
  const components = document.components.filter(c => selected.includes(c.id)).map(c => ({ ...c,
    structureSourceId: c.structureSourceId === 'original' ? selected.includes(structureNodeId(c.materialId)) ? 'original' : 'unbound' : selected.includes(c.structureSourceId) ? c.structureSourceId : 'unbound',
    scfSourceId: selected.includes(c.scfSourceId ?? '') ? c.scfSourceId : 'unbound', scfReuse: { mode: 'auto' as const }, ...(c.neb ? {neb:{...c.neb,finalSourceId:selected.includes(c.neb.finalSourceId)?c.neb.finalSourceId:'unbound',intermediateSourceId:selected.includes(c.neb.intermediateSourceId??'')?c.neb.intermediateSourceId:undefined}} : {}),
  }));
  const materialIds = new Set([...components.map(c => c.materialId), ...selected.filter(id => id.startsWith('structure:')).map(id => id.slice(10)), ...components.flatMap(c=>c.neb ? [c.neb.finalSourceId,c.neb.intermediateSourceId].filter((id): id is string => !!id && id.startsWith('structure:')).map(id=>id.slice(10)) : [])]);
  // Whitelist scientific structure fields; remote identities and private URLs never enter clipboard.
  const fields = ['id', 'name', 'formula', 'spaceGroup', 'kind', 'atoms', 'lattice', 'sourceFileName', 'viewSettings', 'geometryProvenance'];
  const snapshots = materials.filter(m => materialIds.has(m.id)).map(m => Object.fromEntries(fields.filter(k => k in m).map(k => [k, (m as Record<string, unknown>)[k]])));
  return JSON.stringify({ format: 'phynite-dft-workflow', version: 1, sourceProjectId: projectId, components, materials: snapshots, positions: Object.fromEntries(Object.entries(document.canvas.positions).filter(([id]) => selected.includes(id))), selected });
}
export function parseWorkflowClipboard(text: string): WorkflowClipboard<WorkflowMaterial> {
  if (text.length > 4_000_000) throw new Error('Clipboard workflow exceeds 4 MB.');
  const p = JSON.parse(text) as WorkflowClipboard<WorkflowMaterial>;
  if (p.format !== 'phynite-dft-workflow' || p.version !== 1 || typeof p.sourceProjectId !== 'string' || !Array.isArray(p.components) || !Array.isArray(p.materials) || !Array.isArray(p.selected) || !p.positions || p.components.length > 256 || p.materials.length > 256) throw new Error('Clipboard does not contain a supported DFT workflow.');
  if (p.materials.some(m => !m || typeof m.id !== 'string' || typeof m.name !== 'string') || p.components.some(c => !c || typeof c.id !== 'string' || typeof c.materialId !== 'string' || typeof c.name !== 'string' || !['Total energy', 'Structural relaxation', ...ANALYSES,'Nudged elastic band'].includes(c.calculation) || !c.draft || typeof c.draft !== 'object') || Object.values(p.positions).some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Clipboard contains invalid workflow nodes.');
  for (const c of p.components) {
    if ([c.geometry,c.sweep,c.neb].filter(Boolean).length > 1) throw new Error('A workflow node may contain only one operation.');
    if (c.geometry) {
      const g=c.geometry;
      if (g.kind==='supercell') { if (!Array.isArray(g.matrix) || g.matrix.length!==3 || g.matrix.some(row=>!Array.isArray(row)||row.length!==3||row.some(v=>!Number.isSafeInteger(v)||Math.abs(v)>512))) throw new Error('Copied supercell matrix is invalid.'); }
      else if (g.kind==='surface_slab') { if (!Array.isArray(g.miller)||g.miller.length!==3||g.miller.every(v=>v===0)||g.miller.some(v=>!Number.isInteger(v)||Math.abs(v)>12)||!Number.isInteger(g.layers)||g.layers<1||g.layers>256||!Number.isFinite(g.vacuumAngstrom)||g.vacuumAngstrom<=0||g.vacuumAngstrom>1000||!Number.isInteger(g.termination)||g.termination<0) throw new Error('Copied slab parameters are invalid.'); }
      else throw new Error('Unknown copied geometry operation.');
    }
    if (c.sweep && (!['cutoff','k-grid'].includes(c.sweep.parameter)||!Array.isArray(c.sweep.values)||c.sweep.values.length<2||c.sweep.values.length>32||c.sweep.values.some(v=>!Number.isFinite(v)||v<=0))) throw new Error('Copied sweep values are invalid.');
    if (c.neb && (typeof c.neb.finalSourceId!=='string'||c.neb.intermediateSourceId!==undefined&&typeof c.neb.intermediateSourceId!=='string'||!Array.isArray(c.neb.mapping)||c.neb.mapping.some(i=>!Number.isSafeInteger(i)||i<0)||!Number.isInteger(c.neb.images)||c.neb.images<3||c.neb.images>32||!Number.isInteger(c.neb.steps)||c.neb.steps<1||c.neb.steps>10000||!Number.isFinite(c.neb.thresholdEvAngstrom)||c.neb.thresholdEvAngstrom<=0||typeof c.neb.climbing!=='boolean')) throw new Error('Copied NEB settings are invalid.');
  }
  if (new Set(p.components.map(c => c.id)).size !== p.components.length || new Set(p.materials.map(m => m.id)).size !== p.materials.length) throw new Error('Clipboard contains duplicate identities.');
  return p;
}

/** Used by both project duplication and clipboard import. Never copy run bindings. */
export function remapWorkflowComponents(components: CalculationComponentInstance[], materials: Map<string, string>, id: () => string): { components: CalculationComponentInstance[]; ids: Map<string, string> } {
  const ids = new Map(components.map(c => [c.id, id()]));
  const remapSource = (id: string) => id.startsWith('structure:') ? materials.has(id.slice(10)) ? structureNodeId(materials.get(id.slice(10))!) : 'unbound' : ids.get(id) ?? 'unbound';
  return { ids, components: components.map(c => ({ ...c, id: ids.get(c.id)!, materialId: materials.get(c.materialId) ?? c.materialId,
    structureSourceId: c.structureSourceId === 'original' || c.structureSourceId === 'unbound' ? c.structureSourceId : ids.get(c.structureSourceId) ?? 'unbound',
    scfSourceId: c.scfSourceId ? ids.get(c.scfSourceId) ?? 'unbound' : undefined, scfReuse: { mode: 'auto' }, ...(c.neb ? {neb:{...c.neb,finalSourceId:remapSource(c.neb.finalSourceId),intermediateSourceId:c.neb.intermediateSourceId?remapSource(c.neb.intermediateSourceId):undefined}} : {}),
  })) };
}

export function scfMigrationKey(input: string): string {
  // Generated labels and paths do not change the Hamiltonian. Expert inputs
  // stay conservatively exact; unknown variables are never removed.
  return input.replace(/^[ \t]*(?:title|prefix|outdir|pseudo_dir)\s*=\s*['"][^'"\n]*['"][ \t]*,?[ \t]*$/gim, '').replace(/![^\n]*/g, '').replace(/\s+/g, ' ').trim();
}

export function migrateWorkflow(components: CalculationComponentInstance[], scfInput: (c: CalculationComponentInstance) => string): CalculationComponentInstance[] {
  const result = [...components];
  const groups = new Map<string, string>();
  const key = (c: CalculationComponentInstance) => `${c.materialId}:${c.structureSourceId}:${scfMigrationKey(scfInput(c))}`;
  for (const c of components.filter(c => c.calculation === 'Total energy' && !c.geometry && !c.sweep && !c.neb)) { try { groups.set(key(c), c.id); } catch {} }
  for (const c of components) {
    if (!ANALYSES.includes(c.calculation) || c.scfSourceId !== undefined) continue;
    try {
      const input = scfInput(c), group = key(c);
      let source = groups.get(group);
      if (!source) {
        source = `scf-${c.id}`;
        if (result.some(c => c.id === source)) source = `scf-${crypto.randomUUID()}`;
        result.push({ ...c, id: source, calculation: 'Total energy', name: 'SCF', scfSourceId: undefined, scfReuse: { mode: 'auto' }, draft: { ...c.draft, calculations: ['Total energy'], rawInput: input } });
        groups.set(group, source);
      }
      result[result.findIndex(item => item.id === c.id)] = { ...c, scfSourceId: source };
    } catch { result[result.findIndex(item => item.id === c.id)] = { ...c, scfSourceId: 'unbound' }; }
  }
  return result;
}
