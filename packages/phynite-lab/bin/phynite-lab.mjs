#!/usr/bin/env node
import { runCli } from '../lib/launcher.mjs';

runCli().catch(error => {
  console.error(`Phynite Lab: ${error.message}`);
  process.exitCode = 1;
});
