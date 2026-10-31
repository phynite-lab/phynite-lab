import { sha256 } from '@noble/hashes/sha2.js';
import { strToU8, zipSync } from 'fflate';

export type StudyRun = {
  runId: string; inputSha256: string; invariantSettingsSha256: string; modelIdentity: string; structureIdentity: string;
  observable: number; refinement: number; seed?: number; initialStateSha256?: string;
};
export type StudyEvidence = {
  schemaVersion: 1; name: string; observable: string; unit: string;
  normalization: string; method: string; tolerance: number;
  refinementParameter: string; refinementDirection: 'increasing' | 'decreasing';
  runs: StudyRun[]; physicalValidation: { status: 'unassessed' | 'documented'; reference?: string; scope?: string };
};
const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;

export function readMdThermoEvidence(value: unknown): Array<Record<string, number>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100000 || value.some(row => !row || typeof row !== 'object' || !Number.isFinite(row.timePs) || !Number.isFinite(row.step) || Object.values(row).some(number => typeof number !== 'number' || !Number.isFinite(number)))) throw new Error('Thermo evidence requires finite measured rows with explicit physical time (up to 100,000 samples for the browser plot).');
  return value;
}

export function validateStudyEvidence(value: unknown): StudyEvidence {
  const study = value as StudyEvidence;
  if (!study || study.schemaVersion !== 1 || ![study.name, study.observable, study.unit, study.normalization, study.method, study.refinementParameter].every(text) || !Number.isFinite(study.tolerance) || study.tolerance <= 0 || !['increasing', 'decreasing'].includes(study.refinementDirection)) throw new Error('Define the observable, unit, method, normalization, refinement and a positive study-specific tolerance.');
  if (!Array.isArray(study.runs) || study.runs.length > 500 || study.runs.some(run => !run || !text(run.runId) || !hash(run.inputSha256) || !hash(run.invariantSettingsSha256) || !text(run.modelIdentity) || !text(run.structureIdentity) || !Number.isFinite(run.observable) || !Number.isFinite(run.refinement) || (run.seed !== undefined && (!Number.isSafeInteger(run.seed) || run.seed < 1)) || (run.initialStateSha256 !== undefined && !hash(run.initialStateSha256)))) throw new Error('Every evidence row needs its actual run/input hash, invariant settings hash, model, structure, refinement and finite observable.');
  if (new Set(study.runs.map(run => run.runId)).size !== study.runs.length) throw new Error('Each evidence run must have a distinct identity.');
  if (!study.physicalValidation || !['unassessed', 'documented'].includes(study.physicalValidation.status) || (study.physicalValidation.status === 'documented' && (!text(study.physicalValidation.reference) || !text(study.physicalValidation.scope)))) throw new Error('Document the physical comparison reference and scope, or mark it unassessed.');
  return study;
}

function compatibleRuns(runs: StudyRun[]) {
  if (new Set(runs.map(run => run.modelIdentity)).size > 1 || new Set(runs.map(run => run.structureIdentity)).size > 1 || new Set(runs.map(run => run.invariantSettingsSha256)).size > 1) throw new Error('Refinement and replica comparisons require the same declared model, structure/composition and invariant settings (excluding the tested refinement or replica seed/state).');
}

export function assessRefinementSeries(value: StudyEvidence) {
  const study = validateStudyEvidence(value);
  compatibleRuns(study.runs);
  if (new Set(study.runs.map(run => run.refinement)).size !== study.runs.length) throw new Error('Refinement evidence requires distinct parameter values. Use replica analysis for repeated settings.');
  const ordered = [...study.runs].sort((a, b) => (study.refinementDirection === 'increasing' ? 1 : -1) * (a.refinement - b.refinement));
  const changes = ordered.slice(1).map((run, index) => ({ fromRun: ordered[index].runId, toRun: run.runId, absoluteChange: Math.abs(run.observable - ordered[index].observable) }));
  const tail = ordered.slice(-3);
  const spread = tail.length === 3 ? Math.max(...tail.map(run => run.observable)) - Math.min(...tail.map(run => run.observable)) : null;
  if ((spread !== null && !Number.isFinite(spread)) || changes.some(change => !Number.isFinite(change.absoluteChange))) throw new Error('Observable differences overflow the numeric range. Use an appropriate physical normalization.');
  return { status: spread === null ? 'insufficient-refinement' : spread <= study.tolerance ? 'within-tested-tolerance' : 'outside-tested-tolerance', observable: study.observable, unit: study.unit, tolerance: study.tolerance, lastThreeSpread: spread, orderedRuns: ordered, changes, scope: `Only the tested ${study.refinementParameter} series; other discretization errors and model validity require separate evidence.` };
}

export function aggregateStudyReplicas(value: StudyEvidence) {
  const study = validateStudyEvidence(value);
  compatibleRuns(study.runs);
  if (new Set(study.runs.map(run => run.refinement)).size > 1) throw new Error('Replicas require identical numerical settings.');
  const n = study.runs.length;
  const seeded = study.runs.every(run => run.seed !== undefined) && new Set(study.runs.map(run => run.seed)).size === n;
  const independentStates = study.runs.every(run => run.initialStateSha256 !== undefined) && new Set(study.runs.map(run => run.initialStateSha256)).size === n;
  if (n && !seeded && !independentStates) throw new Error('Replicas need distinct recorded random seeds or independent initial-state hashes. Repeated identical runs are not independent samples.');
  const mean = n ? study.runs.reduce((sum, run) => sum + run.observable / n, 0) : null;
  const variance = n > 1 ? study.runs.reduce((sum, run) => sum + (run.observable - mean!) ** 2, 0) / (n - 1) : null;
  if ((mean !== null && !Number.isFinite(mean)) || (variance !== null && !Number.isFinite(variance))) throw new Error('Replica statistics overflow the numeric range. Use an appropriate physical normalization.');
  return { status: n < 3 ? 'insufficient-replicas' : 'replica-estimate', replicaCount: n, mean, standardError: variance === null ? null : Math.sqrt(variance / n), unit: study.unit, independenceEvidence: seeded ? 'distinct-seeds' : independentStates ? 'distinct-initial-states' : 'absent', scope: 'Equal-weight means of user-declared equilibrated independent replicas. Statistical error excludes systematic model error; distinct seeds alone do not establish equilibration.' };
}

export function fitMsdDiffusion(points: Array<{ timePs: number; msdAngstrom2: number }>, window: { startPs: number; endPs: number }, dimensions: 1 | 2 | 3) {
  if (![1, 2, 3].includes(dimensions) || !Number.isFinite(window.startPs) || !Number.isFinite(window.endPs) || window.startPs < 0 || window.endPs <= window.startPs) throw new Error('Choose physical fitting times and 1–3 measured displacement dimensions.');
  if (points.some((point, index) => !Number.isFinite(point.timePs) || !Number.isFinite(point.msdAngstrom2) || point.msdAngstrom2 < 0 || (index > 0 && point.timePs <= points[index - 1].timePs))) throw new Error('MSD requires strictly increasing physical time and finite nonnegative mean-square displacement.');
  const selected = points.filter(point => point.timePs >= window.startPs && point.timePs <= window.endPs);
  if (selected.length < 3) throw new Error('The diffusion fitting window needs at least three physical-time samples.');
  const n = selected.length, x = selected.reduce((sum, p) => sum + p.timePs / n, 0), y = selected.reduce((sum, p) => sum + p.msdAngstrom2 / n, 0);
  const xx = selected.reduce((sum, p) => sum + (p.timePs - x) ** 2, 0);
  const slope = selected.reduce((sum, p) => sum + (p.timePs - x) * (p.msdAngstrom2 - y), 0) / xx;
  const intercept = y - slope * x;
  const residual = selected.reduce((sum, p) => sum + (p.msdAngstrom2 - intercept - slope * p.timePs) ** 2, 0);
  const total = selected.reduce((sum, p) => sum + (p.msdAngstrom2 - y) ** 2, 0);
  if (!(xx > 0) || ![x, y, xx, slope, intercept, residual, total, slope * 1e-8 / (2 * dimensions)].every(Number.isFinite)) throw new Error('The diffusion fit is degenerate or overflows the numeric range. Use finite physical time and an appropriate MSD scale.');
  return { diffusionM2PerSecond: slope < 0 ? null : slope * 1e-8 / (2 * dimensions), slopeAngstrom2PerPs: slope, interceptAngstrom2: intercept, rSquared: total === 0 ? null : 1 - residual / total, window, dimensions, samples: n, status: slope < 0 ? 'non-diffusive-fit' : 'fit-requires-diffusive-regime-validation', uncertainty: null, uncertaintyReason: 'Correlated MSD points do not establish independent sampling. Fit independent replicas/windows and record uncertainty separately.', displacementRequirement: 'Solver MSD or unwrapped/image-aware positions, declared COM subtraction and reference state.' };
}

export type StudyPackageFile = { path: string; bytes: Uint8Array; sha256?: string; role: string };
export function studyModelDependencies(provenance: unknown, files: StudyPackageFile[]) {
  const record = provenance && typeof provenance === 'object' ? provenance as Record<string, unknown> : {};
  const potential = record.potential && typeof record.potential === 'object' ? record.potential as Record<string, unknown> : {};
  const raw = record.modelIdentity ?? record.pseudopotentials ?? potential.files;
  const dependencies: Array<{ name: string; sha256: string; source: string; included: boolean }> = [];
  if (Array.isArray(raw)) for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const model = item as Record<string, unknown>;
    if (!hash(model.sha256) || !text(model.filename)) continue;
    const citation = model.citation ?? potential.citation;
    const version = model.modelVersion ?? potential.modelVersion;
    dependencies.push({ name: model.filename as string, sha256: model.sha256 as string, included: files.some(file => digest(file.bytes) === model.sha256), source: `Acquire the exact ${model.filename} under its original license and verify SHA-256. ${text(citation) ? `Source: ${citation}. ` : 'Source citation is absent; retain the original acquisition record. '}${text(version) ? `Model identifier: ${version}.` : 'Use the recorded model header/library identity.'}` });
  }
  if (potential.kind === 'builtin') {
    const source = files.find(file => file.path.endsWith('potential-provenance.json'));
    if (source) dependencies.push({ name: String(potential.id ?? 'builtin-potential'), sha256: digest(source.bytes), included: true, source: 'Built-in analytical model parameters are retained in potential-provenance.json. Use its exact parameters and the recorded particle masses/runtime.' });
  }
  return dependencies;
}
export async function buildStudyReplayPackage(files: StudyPackageFile[], context: { name: string; runId: string; domain: 'dft' | 'md'; evidence?: StudyEvidence; dependencies?: Array<{ name: string; sha256: string; source: string; included: boolean }> }): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {}, manifestFiles: Array<{ path: string; role: string; sha256: string; sizeBytes: number }> = [];
  let total = 0;
  for (const file of files) {
    if (!/^[A-Za-z0-9_.\/-]+$/.test(file.path) || file.path.startsWith('/') || file.path.split('/').some(part => !part || part === '.' || part === '..') || ['study-manifest.json', 'study-evidence.json'].includes(file.path) || entries[file.path]) throw new Error('Study files require unique safe relative paths outside reserved package metadata.');
    total += file.bytes.length;
    if (total > 200_000_000) throw new Error('A study package may contain up to 200 MB. Download large trajectories separately and retain their checksums.');
    const actual = digest(file.bytes);
    if (file.sha256 && file.sha256 !== actual) throw new Error(`Study artifact checksum mismatch: ${file.path}.`);
    entries[file.path] = file.bytes;
    manifestFiles.push({ path: file.path, role: file.role, sha256: actual, sizeBytes: file.bytes.length });
  }
  if (context.evidence) {
    const bytes = strToU8(JSON.stringify(validateStudyEvidence(context.evidence), null, 2));
    total += bytes.length;
    if (total > 200_000_000) throw new Error('Expanded study evidence exceeds the package limit.');
    entries['study-evidence.json'] = bytes;
    manifestFiles.push({ path: 'study-evidence.json', role: 'evidence', sha256: digest(bytes), sizeBytes: bytes.length });
  }
  const missingRoles = ['input', 'log', 'runtime', 'data'].filter(role => !files.some(file => file.role === role));
  const missingDependencies = (context.dependencies ?? []).filter(dep => !dep.included);
  if ((context.dependencies ?? []).some(dep => !hash(dep.sha256) || !text(dep.source))) throw new Error('Study model dependencies require exact hashes and acquisition/source instructions.');
  if ((context.dependencies ?? []).some(dep => dep.included && !manifestFiles.some(file => file.sha256 === dep.sha256))) throw new Error('An included model dependency must match an actual packaged file hash.');
  entries['study-manifest.json'] = strToU8(JSON.stringify({ schemaVersion: 1, ...context, evidence: undefined, files: manifestFiles, generatedAt: new Date().toISOString(), replayStatus: missingRoles.length || missingDependencies.length || !context.dependencies?.length ? 'requires-dependencies-or-evidence' : 'files-collected-replay-unverified', missingRoles, missingDependencies, physicalValidation: context.evidence?.physicalValidation ?? { status: 'unassessed' }, comparison: 'Verify solver/build/model versions and rerun observable agreement using study-specific numerical/statistical tolerances. File integrity is not physical validation.' }, null, 2));
  return zipSync(entries, { level: 6 });
}
