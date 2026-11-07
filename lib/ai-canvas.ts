import { parseProjectWorkflow, cleanWorkflowClipboardValue, workflowConnectionError, workflowModules, type ProjectWorkflow, type WorkflowKind } from './project-workflow.ts';
import { createWorkflowModule } from './workflow-module-factory.ts';
import { createDefaultQeDraft } from './qe-defaults.ts';
import { workflowQeDraft, workflowBranchFields, workflowMaterial } from './project-workflow-compiler.ts';
import { resolveQeStructure } from './qe-structure.ts';
import { cellVectorsFromLattice, type LatticeParameters } from './crystal-cell.ts';
import { qeMethodIssue } from './qe-input.ts';
import { compileMdSimulationWorkflow } from './md-workflow-compiler.ts';
import { createSimulationComponentInstance, MD_SIMULATION_RECIPES, validateMdSimulationConfig, type MdSimulationComponentInstance } from './md-simulation-types.ts';
import { createParameterStudy, studyParameters, type ParameterStudy } from './workflow-parameter-study.ts';
import { workflowFigureStyleTemplate, workflowFigureStyle } from './workflow-figure-style.ts';

export type AiCanvasOperation = { type: 'add' | 'duplicate' | 'remove' | 'connect' | 'disconnect' | 'rename' | 'move' | 'group' | 'ungroup' | 'configure' | 'parameter_study'; nodeId?: string; kind?: WorkflowKind; name?: string; ref?: string; source?: string; target?: string; nodeIds?: string[]; position?: { x: number; y: number }; patch?: Record<string, unknown>; study?: ParameterStudy };
const fields: Record<string, string[]> = {
  structure: ['structure'], trajectory: ['trajectoryId', 'workflow'],
  scf: ['draft', 'pseudopotentials'], relax: ['draft', 'pseudopotentials'], bands: ['draft'], dos: ['draft'], phonon: ['draft'], btp2: ['draft'],
  md: ['components'], 'md-analysis': ['pipeline'], 'extract-frame': ['frame', 'coordinateUnit', 'elementMap', 'elementMapText', 'periodic'], figure: ['style'],
};
export class AiCanvasError extends Error {
  readonly code = 'AI_CANVAS_INVALID';
  readonly issues: Array<{ nodeId?: string; path: string; message: string }>;
  constructor(message: string, issues: AiCanvasError['issues']) { super(message); this.issues = issues; }
}
function fail(message: string, path: string, nodeId?: string): never { throw new AiCanvasError(message, [{ path, nodeId, message }]); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function safePatch(base: Record<string, unknown>, patch: Record<string, unknown>, path: string): Record<string, unknown> {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype', 'ownerId', 'computeTarget', 'cloudMode', 'execution', 'result', 'results'].includes(key)) fail(`The field ${key} is managed by Phynite.`, `${path}.${key}`);
    next[key] = object(value) ? safePatch(object(base[key]) ? base[key] : {}, value, `${path}.${key}`) : structuredClone(value);
  }
  return next;
}
export function aiCanvasCatalogue() {
  return { modules: Object.entries(workflowModules).filter(([kind]) => kind !== 'legacy').map(([kind, definition]) => ({ kind, ...definition, editableFields: fields[kind] ?? [] })),
    mdAnalysisExample: { version: 1, modifiers: [{ id: 'analysis_rdf', type: 'rdf', enabled: true, params: { cutoff: 5, bins: 200 } }], typeMap: {}, periodic: [true, true, true], frameRange: { start: 0, stop: null, stride: 1 } },
    dftSettings: createDefaultQeDraft(), mdStageExample: createSimulationComponentInstance('equilibration'), mdRecipes: MD_SIMULATION_RECIPES.map(recipe => ({ id: recipe.id, name: recipe.name })), studyParameters, figureStyle: workflowFigureStyle(workflowFigureStyleTemplate()),
    instructions: 'Read exact existing configuration before patching. Use existing node IDs, or an add operation ref for later operations in the same batch. Ports/IDs/resources/defaults are managed by Phynite. Configure patches merge into existing values; arrays replace explicitly. New modules may be incomplete drafts. No job starts when editing. DFT branch physical settings are inherited from SCF. Explicit cutoffs require cutoffPolicy manual. MD stage example is an application default, not a recommendation for the material. Figure style cannot change dataset/source identities.' };
}
/** Only requested operations are applied to the original, unredacted server snapshot. */
export async function editAiCanvas(original: ProjectWorkflow, operations: AiCanvasOperation[]) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 40) fail('Use 1–40 explicit Canvas operations.', 'operations');
  let graph = structuredClone(original);
  const aliases = new Map<string, string>(), touched = new Set<string>();
  const resolve = (id?: string) => aliases.get(id ?? '') ?? id ?? '';
  const node = (id?: string) => { const found = graph.nodes.find(n => n.id === resolve(id)); if (!found) fail('Read an existing project module before editing it.', 'nodeId', id); return found; };
  const ids = (raw?: string[]) => { if (!Array.isArray(raw) || !raw.length) fail('Select existing modules.', 'nodeIds'); return [...new Set(raw.map(id => node(id).id))]; };
  for (const [index, op] of operations.entries()) {
    const path = `operations[${index}]`;
    if (!object(op) || typeof op.type !== 'string') fail('Choose a supported Canvas operation.', path);
    if (op.type === 'add') {
      if (!op.kind) fail('Choose a module kind from the catalogue.', `${path}.kind`);
      const added = createWorkflowModule(graph, op.kind, { name: op.name, position: op.position });
      if (op.ref) { if (aliases.has(op.ref) || graph.nodes.some(n => n.id === op.ref)) fail('Use a unique temporary reference.', `${path}.ref`); aliases.set(op.ref, added.id); }
      graph.nodes.push(added); touched.add(added.id);
      if (op.source) {
        const source = node(op.source), port = workflowModules[added.kind].input;
        if (!port) fail('This module has no input.', `${path}.source`, added.id);
        const edge = { id: `edge_${crypto.randomUUID()}`, source: source.id, target: added.id, port };
        const issue = workflowConnectionError(graph, edge); if (issue) fail(issue, `${path}.source`, added.id);
        graph.edges.push(edge);
      }
    } else if (op.type === 'duplicate') {
      const source = node(op.nodeId), clone = createWorkflowModule(graph, source.kind, { name: op.name || `${source.name} copy`, position: op.position ?? { x: source.position.x + 280, y: source.position.y } });
      clone.configuration = cleanWorkflowClipboardValue(source.configuration) as Record<string, unknown>;
      for (const key of ['execution', 'configurationError', 'parameterStudy']) delete clone.configuration[key];
      if (source.kind !== 'structure' || !source.resources.some(ref => ref.kind === 'structure' && !ref.deviceOnly)) delete clone.configuration.savedStructureSignature;
      clone.resources = structuredClone(source.resources);
      graph.nodes.push(clone); touched.add(clone.id); if (op.ref) aliases.set(op.ref, clone.id);
    } else if (op.type === 'connect') {
      const source = node(op.source), target = node(op.target), port = workflowModules[target.kind].input;
      if (!port) fail('This module has no input.', `${path}.target`, target.id);
      const edge = { id: `edge_${crypto.randomUUID()}`, source: source.id, target: target.id, port };
      const issue = workflowConnectionError(graph, edge); if (issue) fail(issue, path, target.id);
      graph.edges.push(edge); touched.add(target.id);
    } else if (op.type === 'disconnect') {
      const source = node(op.source), target = node(op.target);
      if (!graph.edges.some(e => e.source === source.id && e.target === target.id)) fail('That connection no longer exists.', path, target.id);
      graph.edges = graph.edges.filter(e => e.source !== source.id || e.target !== target.id); touched.add(target.id);
    } else if (op.type === 'remove') {
      const selected = ids(op.nodeIds ?? (op.nodeId ? [op.nodeId] : undefined));
      graph.nodes = graph.nodes.filter(n => !selected.includes(n.id)); graph.edges = graph.edges.filter(e => !selected.includes(e.source) && !selected.includes(e.target));
      graph.groups = graph.groups.map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !selected.includes(id)) })).filter(g => g.nodeIds.length);
      selected.forEach(id => touched.add(id));
    } else if (op.type === 'group' || op.type === 'ungroup') {
      const selected = ids(op.nodeIds);
      graph.groups = graph.groups.map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !selected.includes(id)) })).filter(g => g.nodeIds.length);
      selected.forEach(id => { delete node(id).groupId; touched.add(id); });
      if (op.type === 'group') { const id = `group_${crypto.randomUUID()}`; graph.groups.push({ id, name: op.name?.trim() || 'Research group', nodeIds: selected }); selected.forEach(nodeId => { node(nodeId).groupId = id; }); }
    } else if (op.type === 'parameter_study') {
      if (!op.study) fail('Provide the study template, parameter and explicit values.', `${path}.study`);
      const result = await createParameterStudy(graph, { ...op.study, templateId: resolve(op.study.templateId) }, op.position ?? { x: Math.max(0, ...graph.nodes.map(n => n.position.x)) + 360, y: 80 });
      graph = result.workflow; result.nodeIds.forEach(id => touched.add(id));
    } else {
      const target = node(op.nodeId); touched.add(target.id);
      if (op.type === 'rename') { if (!op.name?.trim()) fail('Give this module a name.', `${path}.name`, target.id); target.name = op.name.trim(); }
      else if (op.type === 'move') { if (!op.position) fail('Provide finite x/y coordinates.', `${path}.position`, target.id); target.position = op.position; }
      else if (op.type === 'configure') {
        if (!object(op.patch)) fail('Provide a configuration patch.', `${path}.patch`, target.id);
        for (const key of Object.keys(op.patch)) if (!fields[target.kind]?.includes(key)) fail(`Cannot edit ${key} on ${target.kind}. Read the module catalogue.`, `${path}.patch.${key}`, target.id);
        if (object(op.patch.draft)) {
          const defaults = createDefaultQeDraft();
          for (const key of Object.keys(op.patch.draft)) if (!(key in defaults)) fail(`Unknown DFT setting: ${key}.`, `${path}.patch.draft.${key}`, target.id);
          const bounds: Record<string, [number, number, boolean?]> = { cutoff: [Number.MIN_VALUE, 2000], chargeDensityCutoff: [Number.MIN_VALUE, 16000], kPoint: [1, 128, true], kPointY: [1, 128, true], kPointZ: [1, 128, true], numberOfBands: [0, 32768, true], smearing: [Number.MIN_VALUE, 1], totalCharge: [-100, 100] };
          for (const [key, value] of Object.entries(op.patch.draft)) {
            const original = (defaults as unknown as Record<string, unknown>)[key];
            if (['number', 'string', 'boolean'].includes(typeof original) && typeof value !== typeof original) fail(`Use a ${typeof original} for ${key}.`, `${path}.patch.draft.${key}`, target.id);
            const range = bounds[key];
            if (range && (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1] || range[2] && !Number.isInteger(value))) fail(`${key} must be ${range[2] ? 'an integer' : 'a finite number'} between ${range[0]} and ${range[1]}.`, `${path}.patch.draft.${key}`, target.id);
          }
          if (['bands', 'dos', 'phonon', 'btp2'].includes(target.kind) && Object.keys(op.patch.draft).some(key => !workflowBranchFields.includes(key as keyof typeof defaults))) fail('Shared physical settings belong to the source SCF. Configure that SCF; the connected analysis inherits them.', `${path}.patch.draft`, target.id);
          if (('cutoff' in op.patch.draft || 'chargeDensityCutoff' in op.patch.draft) && op.patch.draft.cutoffPolicy !== 'manual' && workflowQeDraft(graph, target).cutoffPolicy !== 'manual') fail('To set explicit cutoffs, include cutoffPolicy: manual in this patch. Automatic cutoffs otherwise override these values.', `${path}.patch.draft.cutoffPolicy`, target.id);
        }
        if (target.kind === 'md-analysis' && op.patch.pipeline) {
          const existing = object(target.configuration.execution) ? target.configuration.execution : {};
          const base = object(existing.pipeline) ? existing.pipeline : { version: 1, modifiers: [], typeMap: {}, periodic: [true, true, true], frameRange: { start: 0, stop: null, stride: 1 } };
          if (!object(op.patch.pipeline)) fail('Read the analysis pipeline schema before editing.', `${path}.patch.pipeline`, target.id);
          target.configuration.execution = { ...existing, name: target.name, computeTarget: 'personal', pipeline: safePatch(base, op.patch.pipeline, `${path}.patch.pipeline`) };
        } else target.configuration = safePatch(target.configuration, op.patch, `${path}.patch`);
        if (target.kind === 'structure' && op.patch.structure) {
          const structure = target.configuration.structure;
          if (!object(structure) || !object(structure.lattice) || !Array.isArray(structure.atoms)) fail('Keep an explicit lattice and atom list in the crystal draft.', `${path}.patch.structure`, target.id);
          try {
            cellVectorsFromLattice(structure.lattice as LatticeParameters);
            const periodic = structure.periodic ?? structure.lattice.periodic;
            if (periodic !== undefined && (!Array.isArray(periodic) || periodic.length !== 3 || periodic.some(axis => typeof axis !== 'boolean'))) throw new Error('Confirm all three periodic boundary axes.');
            if (structure.atoms.length) resolveQeStructure(createDefaultQeDraft(), workflowMaterial(target, graph.projectId));
          } catch (error) { fail(error instanceof Error ? error.message : 'The crystal draft is invalid.', `${path}.patch.structure`, target.id); }
          delete target.configuration.savedStructureSignature;
        }
        if (op.patch.draft) {
          target.configuration.compilerVersion = 1;
          const draft = workflowQeDraft(graph, target);
          const issue = qeMethodIssue(draft, ({ scf: 'Total energy', relax: 'Structural relaxation', bands: 'Band structure', dos: 'Density of states', phonon: 'Phonon dispersion', btp2: 'Thermoelectric properties' } as const)[target.kind as 'scf']);
          if (issue) fail(issue, `${path}.patch.draft`, target.id);
        }
        if (target.kind === 'md' && op.patch.components) {
          const components = target.configuration.components as MdSimulationComponentInstance[];
          if (!Array.isArray(components) || !components.length) fail('Keep at least one valid MD stage.', `${path}.patch.components`, target.id);
          for (const stage of components) { const issue = stage.config ? validateMdSimulationConfig(stage.config) : 'Read the existing MD stage schema first.'; if (issue) fail(issue, `${path}.patch.components`, target.id); }
          if (components.some(stage => stage.config.computeTarget !== 'personal')) fail('AI MD stages use personal compute only.', `${path}.patch.components`, target.id);
          compileMdSimulationWorkflow(components);
        }
        if (target.kind === 'figure' && op.patch.style) {
          if (!object(op.patch.style)) fail('Figure style must be an object.', `${path}.patch.style`, target.id);
          const reference = workflowFigureStyleTemplate();
          for (const key of Object.keys(op.patch.style)) if (!(key in workflowFigureStyle(reference))) fail(`Unknown Figure style: ${key}.`, `${path}.patch.style.${key}`, target.id);
          workflowFigureStyleTemplate(target.configuration.style);
        }
        if (target.kind !== 'md-analysis') delete target.configuration.execution; delete target.configuration.configurationError;
      } else fail('Choose a supported Canvas operation.', `${path}.type`);
    }
  }
  return { workflow: parseProjectWorkflow(graph, original.projectId), nodeIds: [...touched], changes: [...touched].map(id => ({ nodeId: id, before: original.nodes.find(n => n.id === id) ?? null, after: graph.nodes.find(n => n.id === id) ?? null })) };
}
