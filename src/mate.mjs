import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { firstmateScript, listMates, seedMate } from './secondmate.mjs';

// agent-kit mate (run as <root>/.tools/bin/fm-mate, and by Ctrl+B Shift+M in the Mates tab): create, list or
// retire a second mate through Firstmate's own guarded scripts only - fm-brief.sh --secondmate and
// fm-home-seed.sh to set it up, fm-spawn.sh --secondmate to launch it, fm-teardown.sh to retire it - so their
// refusals still apply. It never signs in, reads credentials or passes the dispatch key on.
export const mateUsage = 'usage: fm-mate [new <name> --scope <text> [--no-launch] | list | retire <name> [--yes]] [--install-root <dir>]';
const nameRule = /^[a-z][a-z0-9-]{0,30}$/;

export function parseMateArgs(argv) {
  const out = { command: null, name: null, scope: null, launch: true, yes: false, installRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], value = () => { if (i + 1 >= argv.length) throw new Error(`${arg} needs a value\n${mateUsage}`); return argv[++i]; };
    if (arg === '--install-root') out.installRoot = value();
    else if (arg === '--root') out.installRoot = join(value(), '.tools');
    else if (arg === '--scope') out.scope = value();
    else if (arg === '--no-launch') out.launch = false;
    else if (arg === '--yes') out.yes = true;
    else if (!out.command && ['new', 'list', 'retire'].includes(arg)) out.command = arg;
    else if (['new', 'retire'].includes(out.command) && !out.name && !arg.startsWith('-')) out.name = arg;
    else throw new Error(`unknown argument ${arg}\n${mateUsage}`);
  }
  if (out.installRoot && !isAbsolute(out.installRoot)) throw new Error('--install-root must be an absolute path');
  if (out.name !== null && !nameRule.test(out.name)) throw new Error('a mate name starts with a lowercase letter and uses lowercase letters, digits and -');
  if (out.scope !== null && (!out.scope.trim() || out.scope.length > 200 || /[\0-\x1f\x7f]/.test(out.scope))) throw new Error('--scope must be one line of at most 200 characters');
  if (out.command === 'new' && (!out.name || !out.scope)) throw new Error(`new needs a name and --scope\n${mateUsage}`);
  if (out.command === 'retire' && !out.name) throw new Error(`retire needs a name\n${mateUsage}`);
  return out;
}

// Paths from the receipt: the Firstmate home, where mate homes go (<root>/secondmates) and the kit tools Firstmate's scripts call.
export function mateContext(installRoot) {
  const receipt = JSON.parse(readFileSync(join(installRoot, 'receipt.json'), 'utf8'));
  const firstmateHome = receipt.setup?.paths?.firstmateHome || receipt.phases?.firstmate?.path;
  if (!firstmateHome || !existsSync(join(firstmateHome, 'bin', 'fm-brief.sh'))) throw new Error('the kit receipt names no installed Firstmate home');
  const phase = id => receipt.phases?.[id]?.state === 'complete' && receipt.phases[id].path ? join(installRoot, receipt.phases[id].path) : null;
  const path = [join(installRoot, 'bin'), phase('herdr') && dirname(phase('herdr')), phase('npm') && join(phase('npm'), 'node_modules', '.bin'),
    phase('npm-codex') && join(phase('npm-codex'), 'node_modules', '.bin')].filter(Boolean);
  return { firstmateHome, mates: join(receipt.setup?.paths?.root || dirname(installRoot), 'secondmates'), path };
}

export async function runMate(argv, { env = process.env, input = process.stdin, output = process.stdout, kitDir } = {}) {
  const opts = parseMateArgs(argv);
  const found = kitDir && existsSync(join(dirname(dirname(kitDir)), 'receipt.json')) ? dirname(dirname(kitDir)) : null;
  if (!opts.installRoot && !found) throw new Error('fm-mate needs --install-root <dir> (the kit install root holding receipt.json)');
  const installRoot = resolve(opts.installRoot || found);
  const ctx = mateContext(installRoot), say = text => output.write(`${text}\n`);
  const run = (args, extra) => firstmateScript(ctx.firstmateHome, args, { env, path: ctx.path, stdio: 'inherit', ...extra });
  const rl = input.isTTY || opts.command === null ? createInterface({ input, output, terminal: !!input.isTTY }) : null;
  const ask = async question => rl ? (await rl.question(question)).trim() : '';
  try {
    if (opts.command === 'list') {
      const mates = listMates(ctx.firstmateHome);
      say(mates.length ? mates.map(m => `${m.id}\t${m.summary}`).join('\n') : 'No second mates yet. Press Ctrl+B, then Shift+M, or run fm-mate, to create one.');
      return 0;
    }
    if (opts.command === 'retire') {
      if (!listMates(ctx.firstmateHome).some(m => m.id === opts.name)) { say(`No second mate named ${opts.name}.`); return 2; }
      say(`Retiring ${opts.name} with Firstmate's bin/fm-teardown.sh, which refuses while the mate holds unlanded work.`);
      if (!opts.yes && !['y', 'yes'].includes((await ask(`Retire ${opts.name}? (y/N): `)).toLowerCase())) { say('Left unchanged.'); return 0; }
      run(['bin/fm-teardown.sh', opts.name]);
      say(`${opts.name} is retired.`);
      return 0;
    }
    let { name, scope } = opts;
    if (opts.command === null) {
      say('Create a second mate: its own Firstmate home for one area of work. Nothing is created until you confirm.');
      const existing = listMates(ctx.firstmateHome).map(m => m.id);
      if (existing.length) say(`You have: ${existing.join(', ')}`);
      name = await ask('Name (lowercase letters, digits and -, for example docs or jira): ');
      if (!nameRule.test(name)) { say('A mate name starts with a lowercase letter and uses lowercase letters, digits and -.'); return 2; }
      scope = await ask('One-line scope (what this mate owns): ');
      if (!scope || scope.length > 200) { say('The scope is one line of at most 200 characters.'); return 2; }
      if (!['y', 'yes'].includes((await ask(`Create ${name} at ${join(ctx.mates, name)} and launch it? (y/N): `)).toLowerCase())) { say('Nothing created.'); return 0; }
    }
    const seeded = seedMate({ id: name, scope, firstmateHome: ctx.firstmateHome, home: join(ctx.mates, name), env, path: ctx.path });
    say(seeded.registered ? `${name} is already set up; launching it.` : `${name} is set up at ${seeded.home}.`);
    if (opts.launch) { run(['bin/fm-spawn.sh', name, '--secondmate']); say(`${name} is running in its own Herdr space. Type in its tab to talk to it.`); }
    else say(`Launch it later from ${ctx.firstmateHome} with bin/fm-spawn.sh ${name} --secondmate.`);
    if (opts.command === null && input.isTTY) await ask('Press Enter to close. ');
    return 0;
  } finally { rl?.close(); }
}
