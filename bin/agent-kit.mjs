#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, run, validateManifest } from '../src/kit.mjs';
import { formatInstall, installPlatform } from '../src/install/macos.mjs';
import { formatWindows, windowsHandoff } from '../src/install/windows.mjs';

const manifestPath = fileURLToPath(new URL('../manifests/pilot-skeleton.json', import.meta.url));
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const argv = process.argv.slice(2);
  const options = parseArgs(argv, process.platform);
  const context = {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
  };
  if (options.command === 'install') {
    validateManifest(manifest);
    if (!options.installRoot || !options.firstmateHome) throw new Error(context.platform === 'win32'
      ? 'install requires --install-root and --firstmate-home (Linux paths inside WSL, such as ~/.agent-kit and ~/firstmate)'
      : 'install requires --install-root and --firstmate-home (both absolute paths)');
    if (context.platform === 'win32') {
      if (options.handoff) process.stderr.write('Handing off to the Linux installer inside WSL2; its output follows.\n');
      const result = windowsHandoff(options, context);
      if (result.status !== 'handed-off') process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatWindows(result));
      else if (!options.json) process.stderr.write(formatWindows(result));
      process.exitCode = result.exitCode;
    } else {
      const result = await installPlatform(manifest, { platform: context.platform, arch: context.arch, home: process.env.HOME, env: process.env,
        installRoot: options.installRoot, firstmateHome: options.firstmateHome, harness: options.harness, withFigma: options.withFigma, nodeVersion: context.nodeVersion,
        onHooksPreview: changes => {
          process.stderr.write('Global hook and skill changes before apply (kit-owned entries only):\n');
          for (const change of changes) process.stderr.write(`${change.path}: ${JSON.stringify(change.changes)}\n`);
          if (!changes.length) process.stderr.write('none\n');
        } });
      process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatInstall(result));
      process.exitCode = result.exitCode;
    }
  } else {
    const result = run(argv, manifest, context);
    process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  }
} catch (error) {
  process.stderr.write(`agent-kit: ${error.message}\n`);
  process.exitCode = 2;
}
