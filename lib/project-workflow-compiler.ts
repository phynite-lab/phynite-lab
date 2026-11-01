import { structureFormula } from './structure-formula.ts';
import { detectLatticeSystem, LATTICE_PATH_DATA, resolveReciprocalPathMode } from './reciprocal-path.ts';
import { createDefaultQeDraft } from './qe-defaults.ts';
import { generateQuantumEspressoInputFiles, qeSubmissionSettings } from './qe-workflow.ts';
import { cellVectorsFromLattice } from './crystal-cell.ts';
import type { ParsedStructure } from './structure-parsers.ts';
import type { JobDraft, CalculationType, MaterialContext } from '../components/JobComposer.tsx';
import type { ProjectWorkflow, WorkflowNode } from './project-workflow.ts';

export const workflowCalculationTypes: Partial<Record<WorkflowNode['kind'], CalculationType>> = { scf: 'Total energy', relax: 'Structural relaxation', bands: 'Band structure', dos: 'Density of states', phonon: 'Phonon dispersion', btp2: 'Thermoelectric properties' };
export function workflowStructure(graph: ProjectWorkflow, nodeId: string): WorkflowNode | undefined {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (node?.kind === 'structure' || node?.kind === 'extract-frame' && node.configuration.structure) return node;
  const input = graph.edges.find(edge => edge.target === nodeId);
  return input ? workflowStructure(graph, input.source) : undefined;
}
export function workflowMaterial(structure: WorkflowNode | undefined, projectName: string): MaterialContext {
  const raw = structure?.configuration.structure as ParsedStructure | undefined;
  if (!raw?.atoms?.length || !raw.lattice) return null;
  return { name: raw.name || structure!.name, formula: structureFormula(raw.atoms) ?? '', databaseName: projectName, projectName, atomCount: raw.atoms.length, species: Array.from(new Set(raw.atoms.map(atom => atom.species))), atoms: raw.atoms, cellVectors: cellVectorsFromLattice(raw.lattice), periodic: (raw as ParsedStructure & { periodic?: [boolean, boolean, boolean] }).periodic ?? raw.lattice.periodic ?? [true, true, true] };
}
export const workflowBranchFields: Array<keyof JobDraft> = ['kPoint', 'kPointY', 'kPointZ', 'kPointShift', 'kPath', 'kPathMode', 'kPathPoints', 'numberOfBands', 'bandSymmetry', 'bandOverlap', 'dosEnergyMin', 'dosEnergyMax', 'dosEnergyStep', 'projectedDos', 'projectedBands', 'dosSymmetrize', 'pawProjection', 'qPoint', 'qPointY', 'qPointZ', 'phononThreshold', 'phononIterations', 'phononMixing', 'phononMixingNdim', 'phononAsr', 'transportInterpolationMultiplier', 'transportEnergyBins', 'transportTemperatureMin', 'transportTemperatureMax', 'transportTemperatureStep', 'transportRelaxationTime', 'transportChemicalPotentialMin', 'transportChemicalPotentialMax', 'transportScatteringModel', 'transportSampling'];
export function workflowQeDraft(graph: ProjectWorkflow, node: WorkflowNode): JobDraft {
  const local = { ...createDefaultQeDraft(), ...(node.configuration.draft as Partial<JobDraft> | undefined) };
  const sourceId = graph.edges.find(edge => edge.target === node.id && edge.port === 'electronic')?.source;
  if (!sourceId) return local;
  const source = graph.nodes.find(item => item.id === sourceId)!;
  const shared = { ...createDefaultQeDraft(), ...(source.configuration.draft as Partial<JobDraft> | undefined) };
  return { ...shared, ...Object.fromEntries(workflowBranchFields.map(field => [field, local[field]])), rawInput: '' } as JobDraft;
}
export function compileWorkflowDft(graph: ProjectWorkflow, node: WorkflowNode, projectName: string): Record<string, unknown> {
  const calculation = workflowCalculationTypes[node.kind];
  if (!calculation) throw new Error('This node is not a DFT module.');
  const structure = workflowStructure(graph, node.id), material = workflowMaterial(structure, projectName);
  const structureId = structure?.resources.find(ref => ref.kind === 'structure' && !ref.deviceOnly)?.id;
  if (!material || !structureId) throw new Error('Save a crystal structure and connect it to this module.');
  if (graph.edges.some(edge => edge.target === node.id && edge.port === 'electronic') && String((node.configuration.draft as Partial<JobDraft> | undefined)?.rawInput ?? '').trim()) throw new Error('Manual branch input cannot alter shared SCF state. Create a separate SCF variant.');
  const draft = workflowQeDraft(graph, node);
  if (calculation === 'Band structure' && resolveReciprocalPathMode(draft) === 'custom') {
    const known = LATTICE_PATH_DATA[detectLatticeSystem(material.cellVectors)].points;
    const labels = draft.kPath.replace(/γ/gi, 'Γ').split(/\s*(?:->|[—–→\-,;|])\s*/).filter(Boolean);
    if (labels.length < 2 || labels.some(label => !['Γ', 'GAMMA'].includes(label.toUpperCase()) && !Object.keys(known).some(key => key.toUpperCase() === label.toUpperCase()))) throw new Error('This custom k-path includes labels not defined for the connected lattice. Use its available points or automatic SeeK-path.');
  }
  const files = generateQuantumEspressoInputFiles(draft, calculation, material);
  const sourceId = graph.edges.find(edge => edge.target === node.id && edge.port === 'electronic')?.source;
  if (sourceId) {
    const source = graph.nodes.find(item => item.id === sourceId)!;
    const scf = generateQuantumEspressoInputFiles(workflowQeDraft(graph, source), 'Total energy', material)[0];
    const old = files.find(file => file.name === 'scf.in');
    if (old) old.content = scf.content;
    if (workflowQeDraft(graph, source).diskIO === 'none') throw new Error('Enable saved QE state on the source SCF before running its branches.');
  }
  return { name: node.name, structureId, calculationType: calculation, qeInput: files.map(file => file.content).join('\n'), inputFiles: Object.fromEntries(files.map(file => [file.name, file.content])), settings: qeSubmissionSettings(draft, calculation, material), computeTarget: node.configuration.computeTarget || 'personal', vcpus: node.configuration.vcpus, memoryMiB: node.configuration.memoryMiB, cloudMode: node.configuration.cloudMode, computeProfileId: node.configuration.computeProfileId, pseudopotentials: (sourceId ? graph.nodes.find(item => item.id === sourceId)?.configuration.pseudopotentials : node.configuration.pseudopotentials) || {} };
}
