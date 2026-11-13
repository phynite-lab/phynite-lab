/** Bundle the existing TypeScript engine for the launcher-owned Node 22 executor. */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function buildAiExecutor(output = 'work/ai-executor.mjs') {
  const result = await build({ entryPoints: ['scripts/ai-executor.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false, metafile: true, legalComments: 'eof' });
  const code = '// Generated launcher executor from the AGPL-3.0-only corresponding source.\n' + result.outputFiles[0].text;
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, code);
  const inputs = {};
  for (const path of Object.keys(result.metafile.inputs).sort()) inputs[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  const manifest = { schemaVersion: 1, target: 'node22', sha256: createHash('sha256').update(code).digest('hex'), inputs };
  await writeFile(output + '.json', JSON.stringify(manifest, null, 2) + '\n'); return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildAiExecutor(process.argv[2]);
