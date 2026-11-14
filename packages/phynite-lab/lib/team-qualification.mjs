import { join } from 'node:path';

/** Bundled reviewed evidence is still checked by the core for each exact target.
 * @param {string} packageRoot
 * @param {Record<string, string | undefined>} environment
 */
export function teamQualificationEnvironment(packageRoot, environment = process.env) {
  if (environment.PHYNITE_AI_TEAM === '0') return { PHYNITE_AI_TEAM: '0' };
  return {
    PHYNITE_AI_TEAM: '1',
    PHYNITE_AI_TEAM_QUALIFICATION: environment.PHYNITE_AI_TEAM_QUALIFICATION || join(packageRoot, 'lib', 'team-qualification', 'index.json'),
  };
}
