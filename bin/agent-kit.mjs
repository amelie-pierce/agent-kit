#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../src/kit.mjs';

const manifestPath = fileURLToPath(new URL('../manifests/pilot-skeleton.json', import.meta.url));
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const result = run(process.argv.slice(2), manifest, {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
  });
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
} catch (error) {
  process.stderr.write(`agent-kit: ${error.message}\n`);
  process.exitCode = 2;
}
