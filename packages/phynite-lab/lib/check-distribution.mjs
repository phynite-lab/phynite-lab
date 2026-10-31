import { readdir, lstat, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDistribution, verifyLauncherManifest, verifyRuntimePackage } from './distribution.mjs';

export function prohibitedDistributionPath(path) {
  const parts = path.split(/[\\/]/);
  return parts.some(part => part.startsWith('.env') || part.startsWith('.venv') || ['.npmrc', '.pypirc', '.netrc', '.aws', '.ssh', '.git', '.agent-state', '.local-backend', '.artifacts', '.aws-sam', '.wrangler', '__pycache__'].includes(part))
    || /(?:\.map|\.pyc|\.pem|\.key|\.p12|\.pfx|\.tgz|\.log)$/.test(path)
    || /(?:^|\/)(?:phynite-computer\.json|local-worker\.env|core-service\.json|identity\.json|auth\.json|credentials|sessions\.sqlite|instance\.json)$/.test(path);
}

export async function checkDistribution(root) {
  const manifest = JSON.parse(await readFile(join(root, 'distribution.json'), 'utf8'));
  if (manifest.schemaVersion === 2 && manifest.kind === 'launcher') await verifyLauncherManifest(root);
  else if (manifest.schemaVersion === 2 && manifest.kind === 'runtime') await verifyRuntimePackage(root, manifest.target);
  else {
    if (manifest.schemaVersion !== 1 || !manifest.targets || !Object.keys(manifest.targets).length) throw new Error('No platform core is present in this distribution.');
    for (const target of Object.keys(manifest.targets)) await resolveDistribution(root, target);
  }
  if (manifest.schemaVersion === 2) {
    const license = await readFile(join(root, 'LICENSE'), 'utf8');
    if (!license.includes('GNU AFFERO GENERAL PUBLIC LICENSE') || !license.includes('Version 3, 19 November 2007')) throw new Error('The complete GNU AGPL v3 license must be included.');
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (['preinstall', 'install', 'postinstall', 'prepare'].some(name => packageJson.scripts?.[name])) throw new Error('Release packages cannot run installation lifecycle scripts.');
  }
  if (!(await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')).trim()) throw new Error('Third-party notices are missing.');
  async function inspect(directory) {
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry), name = relative(root, path);
      if (prohibitedDistributionPath(name)) throw new Error(`Prohibited distribution file: ${name}`);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Distribution symlinks are not allowed: ${name}`);
      if (info.isDirectory()) await inspect(path);
      else if (manifest.schemaVersion === 2 && name.startsWith('node_modules/')) {
        if (entry === 'binding.gyp') throw new Error('Native release dependencies cannot trigger implicit npm builds.');
        if (entry === 'package.json') {
          const dependency = JSON.parse(await readFile(path, 'utf8'));
          if (['preinstall', 'install', 'postinstall', 'prepare'].some(hook => dependency.scripts?.[hook])) throw new Error('Native release dependencies cannot run installation lifecycle scripts.');
        }
      }
    }
  }
  await inspect(root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkDistribution(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
}
