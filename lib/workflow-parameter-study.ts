import { cellVectorsFromLattice, cellVolume, latticeFromCellVectors, type CellVectors } from './crystal-cell.ts';
import { cleanWorkflowClipboardValue, parseProjectWorkflow, stableWorkflowJson, type ProjectWorkflow, type WorkflowNode } from './project-workflow.ts';
import { workflowMaterial, workflowQeDraft } from './project-workflow-compiler.ts';
import { resolveCutoff } from './qe-adaptive.ts';
import { qeMethodIssue } from './qe-input.ts';
import type { ParsedStructure } from './structure-parsers.ts';

export const studyParameters = [
  { id: 'strain-a', en: 'Lattice-vector strain · a', idLabel: 'Strain vektor kisi · a', unit: '%', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'strain-b', en: 'Lattice-vector strain · b', idLabel: 'Strain vektor kisi · b', unit: '%', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'strain-c', en: 'Lattice-vector strain · c', idLabel: 'Strain vektor kisi · c', unit: '%', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'biaxial-ab', en: 'Biaxial strain · a, b', idLabel: 'Strain biaksial · a, b', unit: '%', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'isotropic', en: 'Isotropic linear strain · a, b, c', idLabel: 'Strain linear isotropik · a, b, c', unit: '%', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'volume', en: 'Volume change', idLabel: 'Perubahan volume', unit: '%', geometry: true, values: '-4, -2, 0, 2, 4' },
  { id: 'ca-ratio', en: 'c/a change · fixed volume', idLabel: 'Perubahan c/a · volume tetap', unit: '%', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'shear-xy', en: 'Simple Cartesian shear · xy', idLabel: 'Shear Kartesian sederhana · xy', unit: '% γ', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'shear-xz', en: 'Simple Cartesian shear · xz', idLabel: 'Shear Kartesian sederhana · xz', unit: '% γ', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'shear-yz', en: 'Simple Cartesian shear · yz', idLabel: 'Shear Kartesian sederhana · yz', unit: '% γ', geometry: true, values: '-2, -1, 0, 1, 2' },
  { id: 'cutoff', en: 'Wavefunction cutoff', idLabel: 'Cutoff fungsi gelombang', unit: 'Ry', geometry: false, values: '60, 70, 80' },
  { id: 'density-cutoff', en: 'Charge-density cutoff', idLabel: 'Cutoff densitas muatan', unit: 'Ry', geometry: false, values: '480, 560, 640' },
  { id: 'k-grid', en: 'Uniform mesh · periodic axes', idLabel: 'Mesh seragam · sumbu periodik', unit: 'n', geometry: false, values: '6, 8, 10' },
  { id: 'charge', en: 'Cell charge · positive removes electrons', idLabel: 'Muatan sel · positif mengurangi elektron', unit: 'e/cell', geometry: false, values: '-0.1, 0, 0.1' },
  { id: 'smearing', en: 'Electronic smearing width', idLabel: 'Lebar smearing elektronik', unit: 'Ry', geometry: false, values: '0.01, 0.02, 0.03' },
] as const;
export type StudyParameter = typeof studyParameters[number]['id'];
export type ParameterStudy = { name: string; templateId: string; parameter: StudyParameter; values: number[] };
export type StudyCase = { value: number; structure: ParsedStructure; draft: ReturnType<typeof workflowQeDraft>; volume: number; transforms: { latticeScale?: number[]; cartesianDeformation?: CellVectors } };
export type StudyProvenance = { version: 1; studyId: string; name: string; parameter: StudyParameter; value: number; unit: string; caseIndex: number; sourceNodeId: string; sourceSha256: string; templateNodeId: string; templateSha256: string; createdAt: string; transforms: StudyCase['transforms'] };
const analysisKinds = new Set(['bands', 'dos', 'phonon', 'btp2']);
export const parameterDefinition = (id: StudyParameter) => {
  const definition = studyParameters.find(parameter => parameter.id === id);
  if (!definition) throw new Error('Choose a supported study parameter.');
  return definition;
};
export function studyTemplates(graph: ProjectWorkflow) {
  return graph.nodes.filter(node => node.kind === 'scf' && graph.edges.some(edge => edge.target === node.id && graph.nodes.some(source => source.id === edge.source && (source.kind === 'structure' || source.kind === 'extract-frame'))));
}
export function studyValues(text: string): number[] {
  if (!text.trim() || text.split(',').some(value => !value.trim())) throw new Error('Enter comma-separated numerical values.');
  const values = text.split(',').map(value => Number(value.trim()));
  if (values.length < 2 || values.length > 32 || values.some(value => !Number.isFinite(value)) || new Set(values).size !== values.length) throw new Error('Use 2–32 distinct finite values.');
  return values;
}
export function studyRange(start: number, stop: number, step: number): number[] {
  if (![start, stop, step].every(Number.isFinite) || step <= 0 || stop <= start) throw new Error('Use a finite increasing range and a positive step.');
  const count = Math.floor((stop - start) / step + 1e-10) + 1;
  if (count < 2 || count > 32) throw new Error('A range must contain 2–32 cases.');
  return studyValues(Array.from({ length: count }, (_, index) => Number((start + index * step).toPrecision(14))).join(','));
}
function template(graph: ProjectWorkflow, study: ParameterStudy) {
  if (!study.name.trim() || study.name.length > 100) throw new Error('Give the study a name up to 100 characters.');
  const scf = studyTemplates(graph).find(node => node.id === study.templateId);
  if (!scf) throw new Error('Connect a Crystal structure directly to an SCF, then choose that SCF as the template.');
  const source = graph.nodes.find(node => node.id === graph.edges.find(edge => edge.target === scf.id)!.source)!;
  const structure = source.configuration.structure as ParsedStructure | undefined;
  if (!structure?.atoms?.length || !structure.lattice) throw new Error('Open the source crystal and load its saved geometry before creating a study.');
  const draft = workflowQeDraft(graph, scf);
  if (draft.rawInput.trim() || draft.cellParameters || draft.atomicPositions) throw new Error('Remove manual input/structure overrides from the template; they would override the selected study values.');
  const analyses = graph.nodes.filter(node => analysisKinds.has(node.kind) && graph.edges.some(edge => edge.source === scf.id && edge.target === node.id));
  if (analyses.some(node => String((node.configuration.draft as { rawInput?: string } | undefined)?.rawInput ?? '').trim())) throw new Error('Remove manual input overrides from the template analyses first.');
  return { scf, source, structure, draft, analyses };
}
export function previewParameterStudy(graph: ProjectWorkflow, study: ParameterStudy): StudyCase[] {
  const definition = parameterDefinition(study.parameter), { source, structure, draft } = template(graph, study);
  const values = studyValues(study.values.join(','));
  if (structure.atoms.length * values.length > 100000) throw new Error('Use fewer cases: a study preview supports at most 100,000 atom copies.');
  const sourceVectors = cellVectorsFromLattice(structure.lattice);
  if (cellVolume(sourceVectors) <= 0) throw new Error('Use a right-handed reference cell.');
  const periodic = (structure as ParsedStructure & { periodic?: [boolean, boolean, boolean] }).periodic ?? structure.lattice.periodic ?? [true, true, true];
  if (periodic.length !== 3 || periodic.some(value => typeof value !== 'boolean')) throw new Error('Confirm the reference crystal periodicity before creating a study.');
  const cutoff = resolveCutoff(draft, workflowMaterial(source, graph.projectId));
  return values.map(value => {
    const next = structuredClone(structure), effective = structuredClone(draft);
    const transforms: StudyCase['transforms'] = {};
    if (definition.geometry) {
      const axes = study.parameter === 'strain-a' ? [0] : study.parameter === 'strain-b' ? [1] : study.parameter === 'strain-c' ? [2] : study.parameter === 'biaxial-ab' ? [0, 1] : [0, 1, 2];
      if (study.parameter.startsWith('shear-') ? !periodic.every(Boolean) : axes.some(axis => !periodic[axis])) throw new Error('This deformation would change a nonperiodic/vacuum axis. Choose only periodic lattice axes; Cartesian shear requires a fully periodic reference.');
      let vectors: CellVectors;
      if (study.parameter.startsWith('shear-')) {
        if (Math.abs(value) > 100) throw new Error('Use simple shear γ between −100% and 100%.');
        const gamma = value / 100;
        if (study.parameter === 'shear-xy') {
          transforms.cartesianDeformation = [[1, gamma, 0], [0, 1, 0], [0, 0, 1]];
          vectors = sourceVectors.map(([x, y, z]) => [x + gamma * y, y, z]) as CellVectors;
        } else if (study.parameter === 'shear-xz') {
          transforms.cartesianDeformation = [[1, 0, gamma], [0, 1, 0], [0, 0, 1]];
          vectors = sourceVectors.map(([x, y, z]) => [x + gamma * z, y, z]) as CellVectors;
        } else {
          transforms.cartesianDeformation = [[1, 0, 0], [0, 1, gamma], [0, 0, 1]];
          vectors = sourceVectors.map(([x, y, z]) => [x, y + gamma * z, z]) as CellVectors;
        }
      } else {
        if (value <= -100 || value > 100) throw new Error('Use a deformation above −100% and at most 100%; the cell must stay nonsingular.');
        const factor = 1 + value / 100;
        const scale = study.parameter === 'volume' ? [Math.cbrt(factor), Math.cbrt(factor), Math.cbrt(factor)] : study.parameter === 'ca-ratio' ? [factor ** (-1 / 3), factor ** (-1 / 3), factor ** (2 / 3)] : [0, 1, 2].map(axis => axes.includes(axis) ? factor : 1);
        transforms.latticeScale = scale;
        vectors = sourceVectors.map((vector, axis) => vector.map(component => component * scale[axis])) as CellVectors;
      }
      next.lattice = { ...latticeFromCellVectors(vectors), periodic: [...periodic] };
    } else {
      if (study.parameter === 'cutoff' || study.parameter === 'density-cutoff') {
        if (value <= 0 || value > (study.parameter === 'cutoff' ? 2000 : 16000)) throw new Error('Use positive wavefunction cutoffs up to 2000 Ry or density cutoffs up to 16000 Ry.');
        effective.cutoffPolicy = 'manual';
        effective.cutoff = cutoff.ecutwfc;
        effective.chargeDensityCutoff = cutoff.ecutrho;
        if (study.parameter === 'cutoff') effective.cutoff = value; else effective.chargeDensityCutoff = value;
        if (effective.chargeDensityCutoff < effective.cutoff) throw new Error('The fixed charge-density cutoff must support every selected wavefunction cutoff. Change the source SCF explicitly first.');
      } else if (study.parameter === 'k-grid') {
        if (!Number.isInteger(value) || value < 1 || value > 128) throw new Error('Mesh values must be integers from 1 to 128.');
        [effective.kPoint, effective.kPointY, effective.kPointZ] = periodic.map(enabled => enabled ? value : 1);
      } else if (study.parameter === 'charge') {
        if (!periodic.every(Boolean)) throw new Error('Charged slabs need an explicit electrostatic correction protocol. This charge study supports fully periodic bulk cells only.');
        if (Math.abs(value) > 100) throw new Error('Use a cell charge between −100 and 100 e/cell.');
        effective.totalCharge = value;
      } else if (study.parameter === 'smearing') {
        if (value <= 0 || value > 1) throw new Error('Use positive electronic smearing widths up to 1 Ry.');
        if (draft.occupationPolicy !== 'manual' || draft.occupations !== 'smearing') throw new Error('Choose manual smearing occupations on the source SCF first. Electronic smearing is not transport temperature.');
        effective.smearing = value;
      }
      const issue = qeMethodIssue(effective, 'Total energy');
      if (issue) throw new Error(issue);
    }
    return { value, structure: next, draft: effective, volume: cellVolume(cellVectorsFromLattice(next.lattice)), transforms };
  });
}
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableWorkflowJson(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
/** Materialize ordinary graph nodes. Existing upload/compiler/approval/scheduler own execution. */
export async function createParameterStudy(graph: ProjectWorkflow, study: ParameterStudy, point: { x: number; y: number }, createId = () => `study_${crypto.randomUUID()}`) {
  const cases = previewParameterStudy(graph, study), definition = parameterDefinition(study.parameter);
  const { scf, source, structure, analyses } = template(graph, study);
  const baseSignature = stableWorkflowJson(graph), studyId = createId(), createdAt = new Date().toISOString();
  const [sourceSha256, templateSha256] = await Promise.all([hash({ structure, resources: source.resources }), hash({ scf, analyses })]);
  const nodes: WorkflowNode[] = [], edges: ProjectWorkflow['edges'] = [], groups: ProjectWorkflow['groups'] = [];
  const templateNodes = [scf, ...analyses];
  const referenceId = definition.geometry ? '' : createId();
  if (referenceId) nodes.push({ id: referenceId, kind: 'structure', name: `${study.name.trim()} · reference`, position: { ...point }, resources: [], configuration: { structure: structuredClone(structure), studyReference: { version: 1, studyId, sourceNodeId: source.id, sourceSha256 } } });
  cases.forEach((variant, caseIndex) => {
    const groupId = createId(), sourceId = definition.geometry ? createId() : referenceId;
    const suffix = `${variant.value} ${definition.unit}`;
    const provenance: StudyProvenance = { version: 1, studyId, name: study.name.trim(), parameter: study.parameter, value: variant.value, unit: definition.unit, caseIndex, sourceNodeId: source.id, sourceSha256, templateNodeId: scf.id, templateSha256, createdAt, transforms: variant.transforms };
    const row = point.y + caseIndex * Math.max(280, analyses.length * 150 + 70);
    const memberIds: string[] = [];
    if (definition.geometry) {
      const structureNode: WorkflowNode = { id: sourceId, kind: 'structure', name: `${source.name} · ${suffix}`, position: { x: point.x, y: row }, groupId, resources: [], configuration: { structure: { ...variant.structure, name: `${source.name} · ${suffix}` }, parameterStudy: provenance } };
      nodes.push(structureNode); memberIds.push(sourceId);
    }
    const ids = Object.fromEntries(templateNodes.map(node => [node.id, createId()]));
    templateNodes.forEach((original, index) => {
      const configuration = cleanWorkflowClipboardValue(original.configuration) as Record<string, unknown>;
      for (const key of ['execution', 'configurationError', 'savedStructureSignature', 'legacySource', 'missingInputs']) delete configuration[key];
      if (!index) configuration.draft = variant.draft;
      configuration.parameterStudy = provenance;
      const node: WorkflowNode = { id: ids[original.id], kind: original.kind, name: `${original.name} · ${suffix}`, position: { x: point.x + (index ? 640 : 320), y: row + Math.max(0, index - 1) * 150 }, groupId, resources: structuredClone(original.resources), configuration };
      nodes.push(node); memberIds.push(node.id);
      edges.push({ id: createId(), source: index ? ids[scf.id] : sourceId, target: node.id, port: index ? 'electronic' : 'structure' });
    });
    groups.push({ id: groupId, name: `${study.name.trim()} · ${suffix}`, nodeIds: memberIds });
  });
  const workflow = parseProjectWorkflow({ ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges], groups: [...graph.groups, ...groups] });
  return { workflow, baseSignature, studyId, nodeIds: nodes.map(node => node.id), targets: nodes.filter(node => node.kind !== 'structure').map(node => node.id) };
}
