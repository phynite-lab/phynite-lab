import type { JobDraft, MaterialContext } from '../components/JobComposer.tsx';
import { getGuideSections, searchGuide } from './guide-library.ts';
import { guidePath } from './guide-routing.ts';
import { resolveQeWorkflowParameters } from './qe-adaptive.ts';
import { qeMethodIssue } from './qe-input.ts';
import { qeConvergenceDescription, qeRelaxationConverged, qeResultAccepted, qeScfAccuracyAccepted } from './qe-convergence.ts';
import { figureIssues, validateFigure, type ResearchDataset } from './research-figures.ts';
import { AiError } from './ai-provider.ts';
import efficiency from '../data/sssp/SSSP_1.3.0_PBE_efficiency.json' with { type: 'json' };
import precision from '../data/sssp/SSSP_1.3.0_PBE_precision.json' with { type: 'json' };

export function readAiGuide(input: Record<string, unknown>) {
  const { query, topicId, locale = 'en', maxSections = 3 } = input;
  if (!['en', 'id'].includes(String(locale)) || typeof maxSections !== 'number' || !Number.isInteger(maxSections) || maxSections < 1 || maxSections > 5
    || query !== undefined && (typeof query !== 'string' || !query.trim() || query.length > 200)
    || topicId !== undefined && typeof topicId !== 'string') throw new AiError(400, 'AI_TOOL_INPUT_INVALID', 'Choose en/id, a guide query up to 200 characters and 1–5 sections.');
  const language = locale as 'en' | 'id', sections = getGuideSections(language);
  if (topicId !== undefined && !sections.some(section => section.id === topicId)) throw new AiError(404, 'AI_GUIDE_NOT_FOUND', 'Choose a topic ID from the guide search.');
  const scope = topicId ? sections.filter(section => section.id === topicId) : sections;
  const matches = query ? searchGuide(scope, query as string) : topicId ? scope : sections.filter(section => section.id === 'workflow');
  let remaining = 14_000;
  const selected = matches.slice(0, maxSections).map(section => {
    const blocks = [];
    // Visual specifications serve the guide UI; the reader needs the actual text.
    const words = typeof query === 'string' ? query.toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
    const ranked = section.blocks.map((block, index) => ({ block, index, score: words.filter(word => JSON.stringify(block).toLocaleLowerCase().includes(word)).length })).sort((a, b) => b.score - a.score || a.index - b.index);
    for (const { block } of ranked) {
      const { visuals: _visuals, ...content } = block; void _visuals;
      const size = JSON.stringify(content).length;
      if (size > remaining) continue;
      blocks.push(content); remaining -= size;
    }
    return { id: section.id, title: section.title, group: section.group, blocks, totalBlocks: section.blocks.length,
      omittedBlocks: section.blocks.length - blocks.length, source: guidePath(language, section.id) };
  });
  return { sections: selected, totalMatches: matches.length, source: guidePath(language, typeof topicId === 'string' ? topicId : 'workflow'),
    truncated: matches.length > selected.length || selected.some(section => section.omittedBlocks > 0),
    ...(!query && !topicId ? { boundaries: 'QE uses personal compute or configured local HPC. MD uses personal Docker/native compute. Preserve exact inputs, units, potential mappings and checksums; save editor changes before AI inspection.' } : {}) };
}

export function inspectAiDftSetup(draft: JobDraft, material: MaterialContext, calculation: string, uploadedFiles: string[] = []) {
  if (!material) throw new AiError(409, 'AI_STRUCTURE_REQUIRED', 'Connect or select a saved structure before inspecting its setup.');
  if (!['Total energy', 'Structural relaxation', 'Band structure', 'Density of states', 'Phonon dispersion', 'Thermoelectric properties', 'Nudged elastic band'].includes(calculation)) throw new AiError(400, 'AI_DRAFT_INVALID', 'Choose a supported QE calculation type.');
  const manual = Boolean(draft.rawInput.trim());
  const resolved = manual ? null : resolveQeWorkflowParameters(draft, material, calculation), issue = qeMethodIssue(draft, calculation, manual);
  const metadata: Record<string, { filename: string; md5: string; cutoff_wfc: number; cutoff_rho: number; pseudopotential: string }> | undefined =
    draft.pseudoFamily === 'SSSP efficiency' ? efficiency : draft.pseudoFamily === 'SSSP precision' ? precision : undefined;
  const species = material.species.map(element => {
    const entry = metadata?.[element], filename = entry?.filename ?? null;
    const type = filename ? /kjpaw|\.paw\./i.test(filename) ? 'PAW' : /rrkjus|\.us\.|\.uspp\./i.test(filename) ? 'USPP' : /oncv|\.nc\.|sg15/i.test(filename) ? 'NC' : 'unknown' : 'unknown';
    return { element, family: draft.pseudoFamily, functional: metadata ? 'PBE' : null, filename, type,
      recommendedEcutwfcRy: entry?.cutoff_wfc ?? null, recommendedEcutrhoRy: entry?.cutoff_rho ?? null,
      publishedMd5: entry?.md5 ?? null, sha256: null,
      availability: 'not checked by this metadata inspection' };
  });
  return { valid: !issue, issues: issue ? [issue] : [], calculation, species, resolved, uploadedFiles, metadataRole: 'family recommendations, not verified execution files',
    inputAuthority: manual ? 'expert-raw-input; inspect its exact namelists and ATOMIC_SPECIES, not the Guided reference settings' : 'guided-draft',
    settings: manual ? null : { functional: draft.functional, pseudoFamily: draft.pseudoFamily, cutoffRy: draft.cutoff, chargeDensityCutoffRy: draft.chargeDensityCutoff, soc: draft.soc, noncollinear: draft.noncollinear },
    note: 'Read-only metadata inspection. SSSP publishes MD5 here, not SHA-256. Runtime UPF bytes, custom uploads and fully relativistic PseudoDojo compatibility are verified separately; no installation or scientific setting was changed.' };
}

export function diagnoseAiCalculation(calculation: Record<string, unknown>, summary: Record<string, unknown> = {}) {
  const stages = (Array.isArray(summary.stageConvergence) ? summary.stageConvergence : []).filter((stage): stage is Record<string, unknown> => !!stage && typeof stage === 'object' && !Array.isArray(stage));
  const accepted = calculation.status === 'COMPLETED' && qeResultAccepted(summary, String(calculation.calculationType));
  const issues: string[] = [];
  if (!stages.length) issues.push('Per-stage convergence evidence is unavailable. Inspect the retained input and logs.');
  if (calculation.status !== 'COMPLETED') issues.push(`Job status is ${String(calculation.status)}; it is not a completed scientific result.`);
  if (!accepted) issues.push('The retained evidence does not establish acceptance for every required solver stage.');
  return { calculation, accepted, relaxationConverged: qeRelaxationConverged(summary), description: qeConvergenceDescription(summary), issues,
    stages: stages.map(stage => ({ ...stage, scfAccuracyAccepted: qeScfAccuracyAccepted(stage) })),
    observableConvergence: summary.observableConvergence ?? { status: 'not-assessed' }, physicalValidation: summary.physicalValidation ?? { status: 'not-assessed' } };
}

export function diagnoseAiFigure(document: unknown, datasets: ResearchDataset[]) {
  try {
    const figure = validateFigure(document), issues = figureIssues(figure, datasets);
    return { valid: issues.length === 0, issues, panels: figure.panels.map(panel => ({ id: panel.id, title: panel.title,
      datasetIds: [...new Set(panel.layers.map(layer => layer.datasetId))] })) };
  } catch (error) { return { valid: false, issues: [error instanceof Error ? error.message : 'The saved figure is invalid.'], panels: [] }; }
}
