import { strToU8, zipSync } from 'fflate';
import { manuscriptFigure } from './manuscript-evidence.ts';
import { validateDataset, validateFigure, type FigureDocument, type ResearchDataset } from './research-figures.ts';

export type ManuscriptReference = { title: string; authors: string[]; year?: number; doi?: string; arxivId?: string; journal?: string; volume?: string; issue?: string; pages?: string; articleNumber?: string; source: 'Crossref' | 'arXiv'; url: string; retrievedAt: string; providerSha256: string };
export type ManuscriptFile = { path: string; role: string; sha256: string; sizeBytes: number; text: string };
export type ManuscriptQuantity = { calculationId: string; label: string; value: number; unit: string; scope: string; jsonPointer: string; methodFingerprint: string };
export type ManuscriptSnapshot = {
  schemaVersion: 1; template: 'aps-prb-revtex4-2'; status: 'draft'; title: string; authors: Array<{ name: string; affiliation: string }>;
  projectId: string; conversationId: string; createdAt: string; sourceStamp: string; requestSha256: string;
  jobs: Array<{ id: string; revision: number; calculationType: string; manifestSha256: string; result: { calculationId: string; summary: Record<string, unknown>; provenance: Record<string, unknown> }; files: ManuscriptFile[]; methodFingerprint: string; parameters?: Array<{ name: string; valueText: string; unit: string; sourcePath: string; start: number; end: number }> }>;
  quantities: ManuscriptQuantity[];
  figures: Array<{ figure: FigureDocument; revision: number; datasets: ResearchDataset[]; svg: string; svgSha256: string }>;
  references: ManuscriptReference[];
  materialsProject: Array<{ structureId: string; mpId: string; snapshotAt: string; sourceSha256: string; snapshot: Record<string, unknown>; method: string | null; units: { band_gap: 'eV'; energy_above_hull: 'eV/atom' } }>;
  missingInformation: string[]; rendererSha256: string | null;
};
export type ManuscriptManifest = {
  schemaVersion: 1; template: 'aps-prb-revtex4-2'; status: 'draft'; projectId: string; conversationId: string; createdAt: string;
  snapshotSha256: string; sourceStamp: string; rendererSha256: string | null;
  entries: Array<{ path: string; sizeBytes: number; sha256: string }>;
  quantityBindings: ManuscriptQuantity[];
  figureBindings: Array<{ id: string; revision: number; svgPath: string; pdfPath?: string; svgSha256: string; datasets: Array<{ id: string; calculationId: string; sourceSha256: string }> }>;
  missingInformation: string[];
};
const texSymbols: Record<string, string> = Object.fromEntries([
  ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'], ['ζ', 'zeta'], ['η', 'eta'], ['θ', 'theta'], ['ι', 'iota'], ['κ', 'kappa'], ['λ', 'lambda'], ['μ', 'mu'], ['ν', 'nu'], ['ξ', 'xi'], ['π', 'pi'], ['ρ', 'rho'], ['σ', 'sigma'], ['ς', 'varsigma'], ['τ', 'tau'], ['υ', 'upsilon'], ['φ', 'phi'], ['χ', 'chi'], ['ψ', 'psi'], ['ω', 'omega'], ['Γ', 'Gamma'], ['Δ', 'Delta'], ['Θ', 'Theta'], ['Λ', 'Lambda'], ['Ξ', 'Xi'], ['Π', 'Pi'], ['Σ', 'Sigma'], ['Υ', 'Upsilon'], ['Φ', 'Phi'], ['Ψ', 'Psi'], ['Ω', 'Omega'], ['ℏ', 'hbar'], ['∞', 'infty'], ['±', 'pm'], ['×', 'times'], ['≤', 'leq'], ['≥', 'geq'],
].map(([character, command]) => [character, `\\ensuremath{\\${command}}`]));
export function escapeLatex(value: string): string {
  const special: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', '$': '\\$', '%': '\\%', '&': '\\&', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
  return Array.from(value).map(char => texSymbols[char] ?? special[char] ?? (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
}
export const manuscriptHash = async (value: string | Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(typeof value === 'string' ? strToU8(value) : value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const safePath = (path: string) => /^[A-Za-z0-9_.+/-]{1,500}$/.test(path) && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..');
const sha = (value: string) => /^[a-f0-9]{64}$/.test(value);

export function manuscriptBibtex(references: ManuscriptReference[]): string {
  return references.map((ref, index) => {
    const values: Record<string, string> = { title: ref.title };
    if (ref.authors.length) values.author = ref.authors.map(name => `{${escapeLatex(name)}}`).join(' and ');
    if (ref.year !== undefined) values.year = String(ref.year);
    for (const key of ['journal', 'volume', 'issue', 'pages', 'doi'] as const) if (ref[key]) values[key === 'issue' ? 'number' : key] = ref[key];
    if (!ref.pages && ref.articleNumber) values.pages = ref.articleNumber;
    if (ref.arxivId) { values.eprint = ref.arxivId; values.archivePrefix = 'arXiv'; }
    const body = Object.entries(values).map(([key, value]) => `  ${key} = {${key === 'author' ? value : escapeLatex(value)}}`).join(',\n');
    return `% ${ref.source}; retrieved ${ref.retrievedAt}; provider SHA-256 ${ref.providerSha256}\n@${ref.journal ? 'article' : 'misc'}{ref${index + 1},\n${body}\n}`;
  }).join('\n\n') + '\n';
}

export async function validateManuscript(snapshot: ManuscriptSnapshot): Promise<void> {
  if (snapshot?.schemaVersion !== 1 || snapshot.template !== 'aps-prb-revtex4-2' || snapshot.status !== 'draft' || !Array.isArray(snapshot.jobs) || snapshot.jobs.length > 12 || !Array.isArray(snapshot.figures) || snapshot.figures.length > 8 || !Array.isArray(snapshot.references) || snapshot.references.length > 12 || !Array.isArray(snapshot.quantities) || snapshot.quantities.length > 60 || !Array.isArray(snapshot.materialsProject) || snapshot.materialsProject.length > 8 || !Array.isArray(snapshot.missingInformation) || !snapshot.missingInformation.length) throw new Error('Invalid manuscript snapshot. Recreate it from retained evidence.');
  if (strToU8(JSON.stringify(snapshot)).length > 2_000_000) throw new Error('Manuscript snapshot exceeds 2 MB.');
  if (new Set(snapshot.jobs.map(job => job.id)).size !== snapshot.jobs.length) throw new Error('Duplicate manuscript calculation.');
  for (const job of snapshot.jobs) {
    if (job.result.calculationId !== job.id || !sha(job.manifestSha256) || !sha(job.methodFingerprint) || !job.files.some(file => file.role === 'input') || !job.files.some(file => file.role === 'log')) throw new Error('Executed job binding is incomplete.');
    if (new Set(job.files.map(file => file.path)).size !== job.files.length) throw new Error('Duplicate manuscript evidence path.');
    for (const file of job.files) if (!safePath(file.path) || /\.upf$/i.test(file.path) || strToU8(file.text).length !== file.sizeBytes || await manuscriptHash(file.text) !== file.sha256) throw new Error('Manuscript evidence checksum or path is invalid.');
    for (const parameter of job.parameters ?? []) {
      const source = job.files.find(file => file.path === parameter.sourcePath && file.role === 'input');
      if (!source || Array.from(source.text).slice(parameter.start, parameter.end).join('') !== parameter.valueText) throw new Error('Method parameter differs from executed input.');
    }
  }
  for (const quantity of snapshot.quantities) {
    const job = snapshot.jobs.find(job => job.id === quantity.calculationId), field = /^\/summary\/([A-Za-z]+)$/.exec(quantity.jsonPointer)?.[1];
    const units: Record<string, string> = { totalEnergyRy: 'Ry', fermiEnergyEv: 'eV', bandGapEv: 'eV', maximumForceRyBohr: 'Ry/bohr', pressureKbar: 'kbar' };
    if (!job || !field || units[field] !== quantity.unit || !Number.isFinite(quantity.value) || job.result.summary[field] !== quantity.value || job.methodFingerprint !== quantity.methodFingerprint) throw new Error('Manuscript number differs from its source, method or unit.');
    if (field === 'bandGapEv' && (quantity.scope !== job.result.summary.bandGapScope || !['sampled-k-path', 'full-brillouin-zone'].includes(quantity.scope) || quantity.scope === 'full-brillouin-zone' && job.result.summary.fullBrillouinZoneGapVerified !== true)) throw new Error('Band-gap scope has not been verified.');
  }
  for (const item of snapshot.figures) {
    validateFigure(item.figure);
    if (item.figure.projectId !== snapshot.projectId || await manuscriptHash(item.svg) !== item.svgSha256 || !/^<svg\b/.test(item.svg) || /<(?:script|foreignObject|image)\b|\son\w+\s*=|(?:href|src)\s*=/i.test(item.svg)) throw new Error('Manuscript figure binding is invalid.');
    for (const dataset of item.datasets) {
      validateDataset(dataset);
      const job = snapshot.jobs.find(job => job.id === dataset.source.calculationId), original = job?.files.find(file => file.path === dataset.source.filename && file.sha256 === dataset.source.sha256);
      if (dataset.projectId !== snapshot.projectId || !original || dataset.source.text !== original.text) throw new Error('Manuscript figure numerical source is missing.');
    }
    if (item.figure.panels.some(panel => panel.layers.some(layer => !item.datasets.some(dataset => dataset.id === layer.datasetId)))) throw new Error('Manuscript figure dataset is missing.');
    const regenerated = manuscriptFigure(item.figure, item.datasets, snapshot.jobs.map(job => ({ calculationId: job.id, calculationType: job.calculationType, summary: job.result.summary, provenance: job.result.provenance })));
    if (regenerated !== item.svg) throw new Error('Figure renderer or source revision changed. Recreate the manuscript from current evidence.');
  }
  for (const ref of snapshot.references) if (!sha(ref.providerSha256) || !ref.retrievedAt || !['Crossref', 'arXiv'].includes(ref.source) || !ref.title || ref.doi && !/^10\.\d{4,9}\/[^\s<>?#]+$/.test(ref.doi) || !ref.doi && !/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d{1,3})?$/.test(ref.arxivId ?? '')) throw new Error('Bibliography lacks verified identifier metadata.');
  for (const row of snapshot.materialsProject) if (!/^mp-\d+$/.test(row.mpId) || !/^\d{4}-\d{2}-\d{2}/.test(row.snapshotAt) || !sha(row.sourceSha256) || row.units.band_gap !== 'eV' || row.units.energy_above_hull !== 'eV/atom') throw new Error('Materials Project comparison identity, snapshot or units are missing.');
}

export type ManuscriptPdfRenderer = (svg: string, figure: FigureDocument) => Promise<Uint8Array | { bytes: Uint8Array; fontLicense: string }>;
export async function buildManuscriptArchive(snapshot: ManuscriptSnapshot, renderPdf?: ManuscriptPdfRenderer): Promise<{ bytes: Uint8Array; manifest: ManuscriptManifest }> {
  await validateManuscript(snapshot);
  const files: Record<string, Uint8Array> = {}, missing = [...snapshot.missingInformation], figureBindings: ManuscriptManifest['figureBindings'] = [];
  const put = (path: string, value: string | Uint8Array) => { if (!safePath(path) || files[path]) throw new Error('Invalid or duplicate archive entry.'); files[path] = typeof value === 'string' ? strToU8(value) : value; };
  put('snapshot.json', json(snapshot));
  put('references.bib', manuscriptBibtex(snapshot.references));
  const methods: string[] = [], tables: string[] = [], figures: string[] = [], comparisons: string[] = [];
  for (const [index, job] of snapshot.jobs.entries()) {
    const name = `J${index + 1}`, directory = `sources/${name}`;
    put(`${directory}/result.json`, json(job.result));
    for (const file of job.files) put(`${directory}/${file.path}`, file.text);
    methods.push(`\\subsection{${name}: ${escapeLatex(job.calculationType)}}\nCalculation ${escapeLatex(job.id)} uses the exact executed inputs and final solver evidence retained in \\texttt{${directory}}. Model and software metadata are recorded in its result snapshot.\n`);
    if (job.parameters?.length) {
      const table = `\\begin{table*}\n\\caption{Explicit executed input settings for ${name}. Full input files preserve the remaining settings, geometry, pseudopotential names and reciprocal grid.}\n\\begin{tabular}{llll}\nParameter & Value & Unit & Source \\\\\n\\hline\n${job.parameters.map(p => `${escapeLatex(p.name)} & ${escapeLatex(p.valueText)} & ${escapeLatex(p.unit)} & ${escapeLatex(p.sourcePath)} \\\\`).join('\n')}\n\\end{tabular}\n\\end{table*}\n`;
      put(`tables/methods-${name}.tex`, table); methods.push(`\\input{tables/methods-${name}.tex}\n`);
    }
    const values = snapshot.quantities.filter(quantity => quantity.calculationId === job.id);
    if (values.length) {
      const table = `\\begin{table*}\n\\caption{Retained final solver quantities for ${name}. Sampling scope is part of each reported result.}\n\\begin{tabular}{llll}\nQuantity & Value & Unit & Scope \\\\\n\\hline\n${values.map(q => `${escapeLatex(q.label)} & ${String(q.value)} & ${escapeLatex(q.unit)} & ${escapeLatex(q.scope)} \\\\`).join('\n')}\n\\end{tabular}\n\\end{table*}\n`;
      put(`tables/results-${name}.tex`, table); tables.push(`\\input{tables/results-${name}.tex}`);
    } else missing.push(`${name}: no supported scalar quantity is present in the retained result.`);
  }
  for (const [index, item] of snapshot.figures.entries()) {
    const name = `figures/figure-${index + 1}`, binding: ManuscriptManifest['figureBindings'][number] = { id: item.figure.id, revision: item.revision, svgPath: name + '.svg', svgSha256: item.svgSha256, datasets: item.datasets.map(dataset => ({ id: dataset.id, calculationId: dataset.source.calculationId!, sourceSha256: dataset.source.sha256 })) };
    put(name + '.svg', item.svg); put(name + '.json', json({ figure: item.figure, revision: item.revision, datasets: item.datasets }));
    if (renderPdf) {
      const rendered = await renderPdf(item.svg, item.figure), pdf = rendered instanceof Uint8Array ? rendered : rendered.bytes;
      if (!(rendered instanceof Uint8Array)) put(name + '-font-license.txt', rendered.fontLicense);
      if (!new TextDecoder().decode(pdf.slice(0, 5)).startsWith('%PDF-')) throw new Error('Vector PDF conversion failed. Retry export.');
      put(name + '.pdf', pdf); binding.pdfPath = name + '.pdf';
    } else missing.push(`${name}.pdf: convert the retained SVG to PDF before journal submission.`);
    figures.push(`\\begin{figure*}\n\\IfFileExists{${name}.pdf}{\\includegraphics[width=\\textwidth]{${name}.pdf}}{\\fbox{Vector SVG retained; PDF conversion required.}}\n\\caption{${escapeLatex(item.figure.caption || item.figure.name)}}\n\\label{fig:${index + 1}}\n\\end{figure*}`);
    figureBindings.push(binding);
  }
  for (const [index, row] of snapshot.materialsProject.entries()) {
    put(`references/materials-project-${index + 1}.json`, json(row));
    comparisons.push(`${escapeLatex(row.mpId)}; dated snapshot ${escapeLatex(row.snapshotAt)}; method: ${escapeLatex(row.method ?? 'unknown (comparison pending)')}.`);
    if (row.method) for (const property of ['band_gap', 'energy_above_hull'] as const) {
      const value = row.snapshot[property];
      if (typeof value === 'number' && Number.isFinite(value)) comparisons.push(`${escapeLatex(property)} = ${value} ${escapeLatex(row.units[property])}.`);
    }
  }
  const main = `\\documentclass[aps,prb,reprint]{revtex4-2}\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n\\usepackage{graphicx}\n\\usepackage{textcomp}\n\\begin{document}\n\\title{${escapeLatex(snapshot.title)}}\n${snapshot.authors.length ? snapshot.authors.map(author => `\\author{${escapeLatex(author.name)}}\n\\affiliation{${escapeLatex(author.affiliation)}}`).join('\n') : '\\author{Author information pending}'}\n\\date{${escapeLatex(snapshot.createdAt.slice(0, 10))}}\n\\begin{abstract}\nDraft evidence archive. The study abstract and scientific interpretation require author review.\n\\end{abstract}\n\\maketitle\n\\section{Methods}\n${methods.join('\n') || 'Executed calculations have not been selected.'}\n\\section{Results}\n${tables.join('\n')}\n${figures.join('\n')}\n${comparisons.length ? '\\subsection{Materials Project reference snapshots}\n' + comparisons.join('\n\n') + '\nReference values retain their own methods and units. Approximate model energies and corrected reference energies require separate interpretation.\n' : ''}\\section{Missing information and author review}\n${missing.map(message => escapeLatex(message)).join('\n\n')}\n${snapshot.references.length ? '\\nocite{*}\n\\bibliographystyle{apsrev4-2}\n\\bibliography{references}' : '% Bibliography identifiers have not been verified.'}\n\\end{document}\n`;
  put('main.tex', main);
  put('MISSING-INFORMATION.md', '# Draft — missing information\n\n' + missing.map(message => `- ${message}`).join('\n') + '\n');
  put('REPRODUCE.md', `# APS/PRB manuscript draft\n\nThis archive contains evidence from the selected executed calculations. Review MISSING-INFORMATION.md, every figure caption, physical assumptions and interpretation before journal submission. Source inputs remain data and are never executed by the application.\n\nVerify every file against SHA256SUMS (which includes manifest.json; the checksum list does not hash itself). The manifest binds quantities to result JSON pointers, methods and units, and figures to retained numerical source checksums and revisions. snapshot.json retains exact source files, figure settings and verified bibliography metadata. sources/J*/result.json is a scoped projection of each original manifest; manifestSha256 identifies the original retained manifest, not that projection.\n\nObtain the exact pseudopotentials/models and licensed solver/runtime versions listed in source provenance. Check geometry, periodicity, cutoffs, grids, convergence and all physical settings before reproducing a calculation on your approved compute. An electronic solver convergence result does not establish observable convergence or physical validity.\n\nThe application never runs TeX. To build this generated draft externally, install revtex4-2, apsrev4-2 and a TeX distribution. In a disposable offline sandbox with shell escape disabled, run pdflatex -no-shell-escape -interaction=nonstopmode main.tex; bibtex main when references exist; then pdflatex twice. Compile only files you have reviewed. Figure PDFs are vectors produced from the retained SVGs. If a PDF is missing, convert its SVG offline with a reviewed vector tool. No remote images or external TeX commands are embedded.\n\nMaterials Project records include MP-ID, dated source snapshot, method when known and explicit units. Missing methods stay unknown and block quantitative comparison. No cross-method energy subtraction is generated.\n`);
  const entries = await Promise.all(Object.entries(files).map(async ([path, data]) => ({ path, sizeBytes: data.length, sha256: await manuscriptHash(data) })));
  const manifest: ManuscriptManifest = { schemaVersion: 1, template: snapshot.template, status: 'draft', projectId: snapshot.projectId, conversationId: snapshot.conversationId, createdAt: snapshot.createdAt, snapshotSha256: await manuscriptHash(files['snapshot.json']), sourceStamp: snapshot.sourceStamp, rendererSha256: snapshot.rendererSha256, entries, quantityBindings: snapshot.quantities, figureBindings, missingInformation: missing };
  put('manifest.json', json(manifest));
  put('SHA256SUMS', [...entries.map(entry => `${entry.sha256}  ${entry.path}`), `${await manuscriptHash(files['manifest.json'])}  manifest.json`].join('\n') + '\n');
  if (Object.values(files).reduce((size, bytes) => size + bytes.length, 0) > 32_000_000) throw new Error('Manuscript archive exceeds 32 MB. Select fewer sources.');
  return { bytes: zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [path, [data, { mtime: new Date('1980-01-01T00:00:00Z') }]])), { level: 6 }), manifest };
}
