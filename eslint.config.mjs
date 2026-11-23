import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.local-backend/**', '.next/**', 'out/**', 'build/**', '.agent-state/**', '**/.wrangler/**', 'backend/.aws-sam/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**', '**/.venv*/**', 'desktop/target/**', 'desktop/payload/**', 'desktop/gen/**']),
]);

export default eslintConfig;
