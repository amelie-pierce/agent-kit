#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, run, validateManifest } from '../src/kit.mjs';
import { formatInstall, installPlatform } from '../src/install/macos.mjs';
import { formatWindows, windowsHandoff } from '../src/install/windows.mjs';
import { doctor, formatDoctor } from '../src/doctor.mjs';
import { applyUpdate, formatUpdate, planUpdate, reviewedCheckout } from '../src/update.mjs';
import { secondmateTemplate } from '../src/secondmate.mjs';
import { setup, windowsSetup } from '../src/setup.mjs';

const manifestPath = fileURLToPath(new URL('../manifests/pilot-skeleton.json', import.meta.url));
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const argv = process.argv.slice(2);
  const context = {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
  };
  const options = argv[0] === 'setup' ? { command: 'setup' } : parseArgs(argv, process.platform);
  // A kit copy that setup placed at <install-root>/kit/<commit> finds its own receipt.
  const kitDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
  if (['doctor', 'update'].includes(options.command) && !options.installRoot && basename(dirname(kitDir)) === 'kit' && existsSync(join(dirname(dirname(kitDir)), 'receipt.json')))
    options.installRoot = dirname(dirname(kitDir));
  if (options.command === 'setup') {
    validateManifest(manifest);
    if (context.platform === 'win32') {
      const result = windowsSetup(argv.slice(1), context);
      if (result.status === 'handed-off') process.stderr.write(formatWindows(result));
      else process.stdout.write(formatWindows(result));
      process.exitCode = result.exitCode;
    } else {
      process.exitCode = await setup(manifest, { ...context, argv: argv.slice(1), input: process.stdin, output: process.stdout });
    }
  } else if (options.command === 'doctor') {
    validateManifest(manifest);
    if (context.platform === 'win32') throw new Error('run doctor inside the WSL2 distribution');
    const result = doctor(manifest, { installRoot: options.installRoot, home: process.env.HOME, env: process.env, nodeVersion: context.nodeVersion });
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatDoctor(result));
    process.exitCode = result.exitCode;
  } else if (options.command === 'update') {
    validateManifest(manifest);
    if (context.platform === 'win32') throw new Error('run update inside the WSL2 distribution');
    const args = { installRoot: options.installRoot, home: process.env.HOME, env: process.env, platform: context.platform, arch: context.arch,
      harness: options.harness, withFigma: options.withFigma, nodeVersion: context.nodeVersion, reviewed: reviewedCheckout() };
    const result = options.yes ? await applyUpdate(manifest, args) : planUpdate(manifest, args);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatUpdate(result));
    process.exitCode = result.exitCode || 0;
  } else if (options.command === 'secondmate-template') {
    const result = secondmateTemplate();
    process.stdout.write(options.json ? `${JSON.stringify({ command: 'secondmate-template', template: result }, null, 2)}\n` : result);
  } else if (options.command === 'install') {
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
