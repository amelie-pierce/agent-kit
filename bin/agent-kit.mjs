#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { parseArgs, run, validateManifest } from '../src/kit.mjs';
import { formatInstall, installPlatform } from '../src/install/macos.mjs';
import { formatWindows, windowsHandoff, windowsLifecycle } from '../src/install/windows.mjs';
import { doctor, formatDoctor } from '../src/doctor.mjs';
import { applyUpdate, formatUpdate, planUpdate, reviewedCheckout } from '../src/update.mjs';
import { secondmateTemplate } from '../src/secondmate.mjs';
import { setup, windowsSetup } from '../src/setup.mjs';
import { applyRepair, applyUninstall, applyUpgrade, formatLifecycle, planRepair, planUninstall, planUpgrade } from '../src/lifecycle.mjs';

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

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
  if (['doctor', 'upgrade', 'repair', 'uninstall'].includes(options.command) && !options.installRoot && basename(dirname(kitDir)) === 'kit' && existsSync(join(dirname(dirname(kitDir)), 'receipt.json')))
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
    if (context.platform === 'win32') {
      const result = windowsLifecycle(options, context);
      process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatWindows(result));
      process.exitCode = result.exitCode;
    } else {
      const result = doctor(manifest, { installRoot: options.installRoot, home: process.env.HOME, env: process.env, nodeVersion: context.nodeVersion });
      process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatDoctor(result));
      process.exitCode = result.exitCode;
    }
  } else if (['repair', 'upgrade', 'uninstall'].includes(options.command)) {
    validateManifest(manifest);
    if (context.platform === 'win32') {
      const result = windowsLifecycle(options, context);
      process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatWindows(result));
      process.exitCode = result.exitCode;
    } else {
      const args = { installRoot: options.installRoot, home: process.env.HOME, env: process.env, platform: context.platform, arch: context.arch,
        nodeVersion: context.nodeVersion, removeFirstmateHome: options.removeFirstmateHome };
      if (options.removeFirstmateHome) {
        if (!process.stdin.isTTY) throw new Error('--remove-firstmate-home requires interactive typing of the exact home path');
        args.confirmHome = await ask('Type the exact Firstmate home path to authorize removal: ');
      }
      let plan;
      try {
        plan = options.command === 'repair' ? planRepair(manifest, args) : options.command === 'uninstall' ? planUninstall(args) : await planUpgrade(args);
        process.stdout.write(options.json ? `${JSON.stringify(plan, (key, value) => ['manifest', 'kit', 'stage'].includes(key) ? undefined : value, 2)}\n` : formatLifecycle(plan));
        if (plan.running.length) { process.exitCode = 1; }
        else {
          if (options.command === 'upgrade' && plan.newPrompts.length && (options.yes || process.stdin.isTTY)) {
            const targetSetup = await import(pathToFileURL(join(plan.kit, 'src', 'setup.mjs')).href);
            const recorded = JSON.parse(readFileSync(join(plan.root, 'receipt.json'), 'utf8'));
            const io = options.yes ? { confirm: async (_question, fallback) => fallback } : targetSetup.prompter(process.stdin, process.stdout);
            try {
              plan.answers = (await targetSetup.collectAnswers({ yes: options.yes }, recorded.setup?.answers || {},
                { env: process.env, output: process.stdout, onlyNew: true }, io, recorded.setup?.paths || {})).answers;
            } finally { if (!options.yes) io.close(); }
          }
          const confirm = options.yes || process.stdin.isTTY && ['y', 'yes'].includes((await ask('Apply this plan now? (y/N): ')).toLowerCase());
          if (confirm) {
            const result = options.command === 'repair' ? await applyRepair(manifest, args) : options.command === 'uninstall' ? await applyUninstall(args) : await applyUpgrade(plan, args);
            process.stdout.write(options.json ? `${JSON.stringify(result, (key, value) => ['manifest', 'kit', 'stage'].includes(key) ? undefined : value, 2)}\n` : formatLifecycle(result));
            process.exitCode = result.status === 'partial' ? 1 : 0;
          }
        }
      } finally {
        if (plan?.stage && existsSync(plan.stage)) { const { rm } = await import('node:fs/promises'); await rm(plan.stage, { recursive: true, force: true }); }
      }
    }
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
