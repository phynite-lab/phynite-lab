/** Review the actual standalone server graph; never infer runtime need from dev dependencies. */
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
const moduleText = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
const createRequireCall = node => ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && node.expression.text === 'createRequire' || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'createRequire');

export async function localRuntimeClosure(standalone) {
  const root = await realpath(standalone), modules = join(root, 'node_modules');
  const queue = [join(root, 'server.js')], files = new Set(), packages = new Map(), appExternals = new Set(), variableImports = [];
  const readMetadata = async name => {
    if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name)) throw new Error('Unsafe standalone runtime dependency name.');
    const path = join(modules, name, 'package.json'), metadata = JSON.parse(await readFile(path, 'utf8'));
    if (metadata.name !== name) throw new Error('Standalone runtime dependency identity differs from its directory.');
    return { root: dirname(path), metadata };
  };
  async function addPackage(name, optional = false) {
    if (packages.has(name)) return;
    let item;
    try { item = await readMetadata(name); } catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
    packages.set(name, item);
    if (name === 'vinext') {
      if (item.metadata.version !== '1.0.0') throw new Error('Review the standalone runtime graph before packaging a different Vinext version.');
      queue.push(join(item.root, 'dist/server/prod-server.js'));
      return;
    }
    // Other actually imported packages retain their complete declared runtime
    // dependency closure, including any installed optional/native dependencies.
    for (const dependency of Object.keys(item.metadata.dependencies ?? {})) await addPackage(dependency);
    for (const dependency of Object.keys(item.metadata.optionalDependencies ?? {})) await addPackage(dependency, true);
  }
  async function walk(directory) {
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (/\.[cm]?js$/.test(entry.name)) queue.push(path);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Include every route and lazy server chunk, rather than only routes visited
  // by a smoke test. Client-only chunks are copied intact separately.
  await walk(join(root, 'dist/server'));
  while (queue.length) {
    const path = queue.shift();
    if (files.has(path)) continue;
    const info = await lstat(path), actual = await realpath(path);
    if (!info.isFile() || info.isSymbolicLink() || actual !== path || !path.startsWith(root + '/')) throw new Error('Runtime imports must resolve to regular files in the standalone application.');
    files.add(path);
    if (!/\.[cm]?js$/.test(path)) continue;
    const syntax = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true), imports = [], requires = new Set(['require']);
    function findRequire(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && createRequireCall(node.initializer)) requires.add(node.name.text);
      ts.forEachChild(node, findRequire);
    }
    findRequire(syntax);
    const vinextRelative = relative(join(modules, 'vinext'), path).replaceAll('\\', '/');
    const appRelative = relative(root, path).replaceAll('\\', '/');
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && requires.has(node.expression.text)
        || ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && requires.has(node.expression.expression.text) && node.expression.name.text === 'resolve')) {
        const specifier = node.arguments.length ? moduleText(node.arguments[0]) : undefined;
        if (specifier !== undefined) imports.push(specifier);
        else {
          const expression = node.arguments[0];
          const entryLoader = vinextRelative === 'dist/server/prod-server.js' && ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'resolveServerEntryImportUrl';
          const reactEdgeLoader = appRelative === 'dist/server/ssr/index.js' && ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
            && expression.expression.name.text === 'join' && expression.arguments.length === 2 && /^cjs\/react-dom-server\.edge\.(?:development|production)\.js$/.test(moduleText(expression.arguments[1]) ?? '');
          if (!entryLoader && !reactEdgeLoader) throw new Error(`Review a nonliteral module import before packaging: ${appRelative}`);
          variableImports.push({ file: appRelative, purpose: entryLoader ? 'canonical built server entry; all emitted chunks retained' : 'fixed ReactDOM edge renderer; complete ReactDOM package retained' });
          if (reactEdgeLoader) imports.push('react-dom');
        }
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.length === 2) {
        const asset = moduleText(node.arguments[0]);
        if (asset?.startsWith('.') && /\.(?:json|wasm|node)$/.test(asset)) imports.push(asset);
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    for (const specifier of imports) {
      if (isBuiltin(specifier)) continue;
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(path), specifier);
        if (!['.js', '.mjs', '.cjs', '.json', '.wasm', '.node'].includes(extname(target))) throw new Error(`Review an unsupported runtime import: ${appRelative}`);
        queue.push(target);
      } else {
        const name = packageName(specifier);
        if (appRelative.startsWith('dist/server/')) appExternals.add(name);
        await addPackage(name);
      }
    }
  }
  if (packages.has('vinext')) {
    const declared = JSON.parse(await readFile(join(root, 'dist/server/vinext-externals.json'), 'utf8'));
    if (!Array.isArray(declared) || declared.some(name => typeof name !== 'string')) throw new Error('The exact standalone server externals manifest is required.');
    for (const name of appExternals) if (!declared.includes(name)) throw new Error(`Emitted server import is missing from its externals manifest: ${name}`);
    for (const name of declared) await addPackage(name);
    if (queue.length) throw new Error('An unvisited runtime entry was introduced by the server manifest. Review the standalone graph.');
  }
  const vinextFiles = [...files].filter(path => path.startsWith(join(modules, 'vinext') + '/'));
  const vinextDirectories = new Set();
  for (const path of vinextFiles) for (let directory = dirname(path); directory.startsWith(join(modules, 'vinext')); directory = dirname(directory)) vinextDirectories.add(directory);
  const sourceHashes = [];
  for (const path of [...files].sort()) sourceHashes.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  return { packages, vinextFiles: new Set(vinextFiles), vinextDirectories,
    manifest: { schemaVersion: 1, method: 'standalone-server-and-lazy-chunks', ...(packages.has('vinext') ? { vinextVersion: packages.get('vinext').metadata.version } : {}), packages: [...packages.keys()].sort(), files: sourceHashes, variableImports } };
}
