#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, run, validateManifest } from '../src/kit.mjs';
import { formatInstall, installMacOS } from '../src/install/macos.mjs';

const manifestPath = fileURLToPath(new URL('../manifests/pilot-skeleton.json', import.meta.url));
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  const context = {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
  };
  if (options.command === 'install') {
    validateManifest(manifest);
    if (!options.installRoot || !options.firstmateHome) throw new Error('install requires --install-root and --firstmate-home (both absolute paths)');
    const result = await installMacOS(manifest, { platform: context.platform, arch: context.arch, home: process.env.HOME,
      installRoot: options.installRoot, firstmateHome: options.firstmateHome, harness: options.harness, withFigma: options.withFigma, nodeVersion: context.nodeVersion });
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatInstall(result));
    process.exitCode = result.exitCode;
  } else {
    const result = run(argv, manifest, context);
    process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  }
} catch (error) {
  process.stderr.write(`agent-kit: ${error.message}\n`);
  process.exitCode = 2;
}
