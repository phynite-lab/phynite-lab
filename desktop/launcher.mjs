import { runCli } from './phynite-lab/lib/launcher.mjs';

const controller = new AbortController();
process.stdin.once('end', () => controller.abort());
process.stdin.resume();
try {
  await runCli(['--no-open', ...process.argv.slice(2)], {
    desktop: {
      signal: controller.signal,
      onReady: () => console.log('PHYNITE_DESKTOP_READY'),
    },
  });
} catch (error) {
  process.exitCode = 1;
  console.error(error.message);
} finally {
  process.stdin.pause();
}
