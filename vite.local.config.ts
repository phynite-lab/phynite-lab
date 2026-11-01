import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { bundledJsNotices } from './scripts/bundled-js-notices.mjs';

/** The public local build has no dependency on the hosted deployment config. */
export default defineConfig(() => {
  if (process.env.PHYNITE_DEV_SANDBOX === 'true' || process.env.PHYNITE_LOCAL_API === 'true') {
    throw new Error('The local application cannot use development identity providers.');
  }
  return {
    define: { 'process.env.PHYNITE_BUILD_TARGET': JSON.stringify('local') },
    resolve: { alias: [{ find: '@/lib/runtime-bindings', replacement: fileURLToPath(new URL('./lib/runtime-bindings.local.ts', import.meta.url)) }] },
    css: { postcss: { plugins: [tailwindcss()] } },
    build: { sourcemap: false },
    server: { host: '127.0.0.1', ...(process.env.CODEX_SANDBOX === 'seatbelt' ? { watch: { useFsEvents: false, usePolling: true } } : {}) },
    plugins: [vinext(), bundledJsNotices()],
  };
});
