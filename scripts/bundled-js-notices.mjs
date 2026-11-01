/** Collect notices from modules that actually survive the production bundler. */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { validateBundledNoticeReport } from '../packages/phynite-lab/lib/bundled-notices.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const noticeName = /(?:^|[._ -])(?:licen[cs]es?|copying|copyright|notices?|authors)(?:[._ -]|$)/i;
const safeRelative = value => typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');

async function packageFor(moduleId) {
  const clean = moduleId.replace(/^\0/, '').split('?')[0];
  if (!isAbsolute(clean) || !clean.includes('/node_modules/')) return;
  let file;
  try { file = await realpath(clean); } catch { throw new Error('A rendered dependency source file is unavailable.'); }
  if (!(await lstat(file)).isFile()) return;
  for (let directory = dirname(file); directory !== dirname(directory); directory = dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (typeof metadata.name === 'string' && typeof metadata.version === 'string') return { root: directory, file, metadata };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('A rendered dependency has no installed package identity.');
}

async function installedNotices(root) {
  const result = [];
  async function walk(directory, depth, licenseDirectory = false) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && depth < 3) await walk(path, depth + 1, licenseDirectory || noticeName.test(entry.name));
      else if (entry.isFile() && (licenseDirectory || noticeName.test(entry.name)) && !/\.(?:[cm]?[jt]sx?|py|json|map|wasm|node|woff2?|ttf|otf)$/i.test(entry.name)) {
        const content = await readFile(path, 'utf8');
        if (content.trim()) result.push({ name: relative(root, path).replaceAll('\\', '/'), sha256: hash(content), text: content });
      }
    }
  }
  await walk(root, 0);
  return result;
}

async function reviewedNotices(projectRoot, metadata, packageRoot) {
  let document;
  try { document = JSON.parse(await readFile(join(projectRoot, 'distribution/notices/web/manifest.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { notices: [] }; throw error; }
  if (document.schemaVersion !== 1 || !Array.isArray(document.components)) throw new Error('Invalid reviewed bundled dependency notice manifest.');
  const matches = document.components.filter(item => item.name === metadata.name && item.version === metadata.version);
  if (matches.length > 1) throw new Error('A bundled dependency has conflicting reviewed notice records.');
  if (!matches.length) return { notices: [] };
  const component = matches[0], result = [];
  if (!['fallback', 'supplemental'].includes(component.mode) || !component.sourceUrl?.startsWith('https://') || !Array.isArray(component.notices) || !component.notices.length) throw new Error('Reviewed dependency notices need their original source evidence.');
  if (component.evidence?.fontManifest) {
    const evidence = component.evidence;
    if (!safeRelative(evidence.fontManifest) || !evidence.fontManifest.startsWith('distribution/notices/web/')) throw new Error('Unsafe reviewed font manifest path.');
    const path = join(projectRoot, evidence.fontManifest), info = await lstat(path), content = await readFile(path);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path || hash(content) !== evidence.fontManifestSha256) throw new Error('Reviewed font manifest checksum mismatch.');
    const fonts = JSON.parse(content.toString('utf8'));
    if (fonts.schemaVersion !== 1 || fonts.name !== metadata.name || fonts.version !== metadata.version || !Array.isArray(fonts.fontFiles) || fonts.fontFiles.length !== evidence.fontCount) throw new Error('Reviewed font identity or inventory differs from its installed package.');
    for (const font of fonts.fontFiles) {
      if (!safeRelative(font.path) || !/\.(?:ttf|otf|woff2?)$/.test(font.path)) throw new Error('Unsafe reviewed font asset path.');
      const file = join(packageRoot, font.path), stat = await lstat(file), bytes = await readFile(file);
      if (!stat.isFile() || stat.isSymbolicLink() || await realpath(file) !== file || bytes.length !== font.bytes || hash(bytes) !== font.sha256) throw new Error('Bundled font bytes differ from their reviewed license evidence.');
    }
  }
  for (const record of component.notices) {
    if (!safeRelative(record.path) || !record.path.startsWith('distribution/notices/web/')) throw new Error('Unsafe reviewed bundled notice path.');
    const path = resolve(projectRoot, record.path), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || !path.startsWith(await realpath(projectRoot) + '/') || await realpath(path) !== path) throw new Error('Reviewed dependency notice must be a regular source file.');
    const content = await readFile(path, 'utf8');
    if (!content.trim() || hash(content) !== record.sha256) throw new Error('Reviewed dependency notice checksum mismatch.');
    result.push({ name: record.path, sha256: record.sha256, text: content, sourceUrl: record.sourceUrl ?? component.sourceUrl, sourceCommit: component.sourceCommit });
  }
  return { notices: result, evidence: component };
}

export async function collectBundledJsNotices(bundle, projectRoot, environment) {
  projectRoot = await realpath(projectRoot);
  const packages = new Map(), chunks = [], assets = [], missing = [];
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') {
      if (chunk.type === 'asset' && /\.(?:css|woff2?|ttf|otf|svg|png|jpe?g|webp|ico)$/i.test(chunk.fileName)) {
        const source = Buffer.from(chunk.source);
        assets.push({ path: chunk.fileName, sha256: hash(source), bytes: source.length });
      }
      continue;
    }
    if (!chunk.modules || typeof chunk.modules !== 'object') throw new Error('Production bundler module evidence is unavailable.');
    chunks.push({ path: chunk.fileName, sha256: hash(chunk.code), bytes: Buffer.byteLength(chunk.code) });
    for (const [id, rendered] of Object.entries(chunk.modules)) {
      if (typeof rendered.renderedLength !== 'number') throw new Error('Production bundler rendered-module evidence is unavailable.');
      if (rendered.renderedLength <= 0) continue;
      const item = await packageFor(id);
      if (!item) continue;
      const key = `${item.metadata.name}@${item.metadata.version}`;
      if (!packages.has(key)) {
        const reviewed = await reviewedNotices(projectRoot, item.metadata, item.root), notices = [...await installedNotices(item.root), ...reviewed.notices];
        if (!notices.length) missing.push({ name: item.metadata.name, version: item.metadata.version });
        packages.set(key, { name: item.metadata.name, version: item.metadata.version, licenseMetadata: item.metadata.license ?? null,
          repository: item.metadata.repository ?? null, ...(reviewed.evidence ? { reviewedEvidence: reviewed.evidence } : {}), notices, modules: new Map() });
      }
      const source = await readFile(item.file), modulePath = relative(item.root, item.file).replaceAll('\\', '/'), component = packages.get(key);
      if (!component.modules.has(modulePath)) {
        const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source.toString('utf8'));
        let token, count = 0;
        while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
          if (token !== ts.SyntaxKind.MultiLineCommentTrivia && token !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
          const comment = scanner.getTokenText();
          if (/@license|@preserve|\bcopyright\b/i.test(comment)) component.notices.push({ name: `${modulePath} (original legal comment ${++count})`, sha256: hash(comment), text: comment });
        }
      }
      component.modules.set(modulePath, hash(source));
    }
  }
  return { schemaVersion: 1, format: 'phynite-bundled-js-notices', environment, complete: missing.length === 0,
    packages: [...packages.values()].map(item => ({ ...item, modules: [...item.modules].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })) })).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)),
    chunks: chunks.sort((a, b) => a.path.localeCompare(b.path)), assets: assets.sort((a, b) => a.path.localeCompare(b.path)), missing };
}

/** @returns {import('vite').Plugin} */
export function bundledJsNotices({ reportOnly = false } = {}) {
  let projectRoot;
  return {
    name: 'phynite-bundled-js-notices', apply: 'build', enforce: 'post',
    configResolved(config) { projectRoot = config.root; },
    generateBundle: { order: 'post', async handler(output, bundle) {
      const environment = this.environment?.name ?? relative(projectRoot, output.dir ?? '').replaceAll('/', '-');
      const report = await collectBundledJsNotices(bundle, projectRoot, environment);
      this.emitFile({ type: 'asset', fileName: 'phynite-bundled-notices.json', source: JSON.stringify(report, null, 2) + '\n' });
      if (!report.complete) {
        const message = 'Missing original bundled dependency notices: ' + report.missing.map(item => `${item.name}@${item.version}`).join(', ');
        if (reportOnly) this.warn(message); else this.error(message);
      }
    } },
  };
}

/** Verify emitted notice reports against the real files copied to standalone. */
export async function aggregateBundledJsNotices(standalone) {
  const root = await realpath(standalone), manifests = [], components = new Map(), reports = [];
  async function find(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Standalone bundled notice inputs cannot be symlinks.');
      if (entry.isDirectory()) await find(path);
      else if (entry.name === 'phynite-bundled-notices.json') manifests.push(path);
    }
  }
  await find(join(root, 'dist'));
  if (!manifests.length) throw new Error('Build the application with emitted bundled dependency notices before packaging.');
  for (const path of manifests.sort()) {
    const text = await readFile(path, 'utf8'), report = validateBundledNoticeReport(JSON.parse(text));
    for (const chunk of [...report.chunks, ...report.assets]) {
      if (!safeRelative(chunk.path) || !/^[a-f0-9]{64}$/.test(chunk.sha256 ?? '') || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1) throw new Error('Invalid emitted chunk notice binding.');
      const file = join(dirname(path), chunk.path), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || await realpath(file) !== file) throw new Error('Emitted chunk notice binding requires a regular file.');
      const bytes = await readFile(file);
      if (hash(bytes) !== chunk.sha256 || bytes.length !== chunk.bytes) throw new Error('Emitted application chunk changed after license collection.');
    }
    for (const item of report.packages) {
      const key = `${item.name}@${item.version}`;
      if (!components.has(key)) components.set(key, { name: item.name, version: item.version, notices: new Map() });
      for (const notice of item.notices) {
        components.get(key).notices.set(notice.sha256, notice);
      }
    }
    reports.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: hash(text), environment: report.environment });
  }
  const sections = ['## JavaScript dependencies rendered into application chunks\n\n'
    + 'These notices come from installed package files, verified upstream supplements and original legal comments of modules that survived the production bundler. Every emitted client/server/lazy chunk is retained and checked against its build checksum.'];
  for (const [key, item] of [...components].sort(([a], [b]) => a.localeCompare(b))) sections.push(`### ${key}\n\n`
    + [...item.notices.values()].sort((a, b) => a.name.localeCompare(b.name)).map(notice => `#### ${notice.name}\n\n${notice.text}`).join('\n\n'));
  return { text: sections.join('\n\n') + '\n', manifest: { schemaVersion: 1, format: 'phynite-bundled-js-notice-index', reports,
    packages: [...components.values()].map(item => ({ name: item.name, version: item.version, notices: [...item.notices.keys()].sort() })).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)) } };
}
