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
import { atomicJson, lock } from '../src/install/macos.mjs';
import { hiddenKey, keyStatus, writeKey } from '../src/keys.mjs';
import { applyStarter, describeStarter, harnessOf, planStarter, plansOf, starterFile } from '../src/dispatch.mjs';

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
  if (['doctor', 'upgrade', 'repair', 'uninstall', 'keys'].includes(options.command) && !options.installRoot && basename(dirname(kitDir)) === 'kit' && existsSync(join(dirname(dirname(kitDir)), 'receipt.json')))
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
  } else if (options.command === 'keys') {
    if (context.platform === 'win32') throw new Error('run keys inside the WSL2 distribution');
    if (!options.installRoot) throw new Error('keys needs --root <root> or --install-root <dir>');
    const receiptPath = join(options.installRoot, 'receipt.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const firstmateHome = receipt.setup?.paths?.firstmateHome || receipt.phases?.firstmate?.path;
    if (!firstmateHome) throw new Error('receipt has no Firstmate home');
    let set = keyStatus(firstmateHome);
    process.stdout.write(`TYPESAFE_API_KEY: ${set ? 'set' : 'not set'}\nWithout it Jev routing is off and Firstmate uses normal dispatch rules. Enabling it sends screened task text to typesafe.ai.\n`);
    let action = 'keep', value = null;
    if (!process.stdin.isTTY || options.yes) {
      process.stdout.write('Left unchanged. To add, change or remove it, run this command from your own terminal without --yes and type the key at the hidden prompt.\n');
    } else {
      const choice = (await ask(set ? 'Keep, change or remove? [keep]: ' : 'Keep or add? [keep]: ')).toLowerCase();
      if (choice === 'add' || choice === 'change') { action = 'set'; value = await hiddenKey(process.stdin, process.stdout); if (!value) action = 'keep'; }
      else if (choice === 'remove' && set) action = 'remove';
      else if (choice !== '' && choice !== 'keep') throw new Error('choose keep, add/change or remove');
    }
    if (action === 'set' && set && !['y', 'yes'].includes((await ask('Replace the existing key? (y/N): ')).toLowerCase())) action = 'keep';
    if (action === 'remove' && await ask('Type REMOVE TYPESAFE_API_KEY to confirm: ') !== 'REMOVE TYPESAFE_API_KEY') action = 'keep';
    let starter = null;
    if (action !== 'keep') {
      const unlock = await lock(options.installRoot, '.setup.lock');
      try {
        if (keyStatus(firstmateHome) !== set) throw new Error('key status changed during the prompt; rerun keys');
        const currentReceipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
        if ((currentReceipt.setup?.paths?.firstmateHome || currentReceipt.phases?.firstmate?.path) !== firstmateHome)
          throw new Error('Firstmate home changed during the prompt; rerun keys');
        set = await writeKey(firstmateHome, action, value);
        currentReceipt.setup ||= {}; currentReceipt.setup.keys = { TYPESAFE_API_KEY: set };
        if (set) {
          // A newly set key gets Firstmate's starter rules unless the person or a strategy already owns the routing.
          starter = await applyStarter(planStarter(firstmateHome, { harness: harnessOf(currentReceipt), plans: plansOf(currentReceipt), record: currentReceipt.setup.dispatch, create: true, restore: true }));
          if (starter.record) currentReceipt.setup.dispatch = starter.record;
          else delete currentReceipt.setup.dispatch;
        }
        await atomicJson(receiptPath, currentReceipt);
      } finally { await unlock(); }
    }
    process.stdout.write(`TYPESAFE_API_KEY: ${set ? 'set' : 'not set'}\n`);
    if (starter && describeStarter(starter)) process.stdout.write(`${describeStarter(starter)}\n`);
    if (action === 'remove' && existsSync(join(firstmateHome, starterFile)))
      process.stdout.write(`Dispatch rules at ${join(firstmateHome, starterFile)} are kept; without the key Firstmate reads them in its normal dispatch.\n`);
  } else if (options.command === 'doctor') {
    validateManifest(manifest);
    if (context.platform === 'win32') throw new Error('run doctor inside the WSL2 distribution');
    const result = doctor(manifest, { installRoot: options.installRoot, home: process.env.HOME, env: process.env, nodeVersion: context.nodeVersion });
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatDoctor(result));
    process.exitCode = result.exitCode;
  } else if (['repair', 'upgrade', 'uninstall'].includes(options.command)) {
    validateManifest(manifest);
    if (context.platform === 'win32') {
      const result = windowsLifecycle(options, context);
      process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatWindows(result));
      process.exitCode = result.exitCode;
    } else {
      const args = { installRoot: options.installRoot, home: process.env.HOME, env: process.env, platform: context.platform, arch: context.arch,
        nodeVersion: context.nodeVersion, removeFirstmateHome: options.removeFirstmateHome, removeEnv: options.removeEnv };
      if (options.removeFirstmateHome) {
        if (!process.stdin.isTTY) throw new Error('--remove-firstmate-home requires interactive typing of the exact home path');
        args.confirmHome = await ask('Type the exact Firstmate home path to authorize removal: ');
      }
      if (options.removeEnv && !options.removeFirstmateHome) {
        if (!process.stdin.isTTY) throw new Error('--remove-env requires interactive typing of the exact .env path');
        args.confirmEnv = await ask('Type the exact Firstmate .env path to authorize removal: ');
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
