import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePlan } from './kit.mjs';
import { atomicJson, formatInstall, installPlatform, lock, systemDirs, within } from './install/macos.mjs';
import { globalHookPaths } from './install/hooks.mjs';
import { doctor, formatDoctor } from './doctor.mjs';
import { harnessLabel, harnessProfiles, parseHarness } from './harness.mjs';
import { findOnPath } from './platforms/macos.mjs';
import { linuxIdentity } from './platforms/linux.mjs';
import { kitCommit, kitUpstream, linuxPath, powershellCommand, windowsNextSteps } from './install/windows.mjs';
import { inspectWindows } from './platforms/windows.mjs';
import { envManaged, hiddenKey, keyStatus, writeKey } from './keys.mjs';
import { applyStarter, defaultMode, describeStarter, fullWarnings, loadPlanTable, modes, planIds, planStarter, previewStarter, providersOf } from './dispatch.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
export const defaultRoot = '~/Agentic';
export const setupAnswerKeys = ['harness', 'plans', 'dispatchMode', 'figma', 'tower', 'globalHooks', 'githubOwner', 'gitIdentity', 'starterMate', 'channel'];
export const steps = [
  ['kit', 'kit source at its pinned commit'],
  ['tools', 'pinned tools, Firstmate home, tower and global hooks'],
  ['treehouse', 'Treehouse wrapper for the pool under the root'],
  ['git-identity', 'git name and email'],
  ['starter-mate', 'starter second mate'],
  ['logins', 'guided personal sign-ins'],
  ['doctor', 'health check'],
];
const valueFlags = ['--root', '--install-root', '--firstmate-home', '--harness', '--claude-plan', '--codex-plan', '--dispatch-mode', '--github-owner', '--git-name', '--git-email', '--starter-mate', '--starter-scope',
  '--channel', '--kit-dir', '--kit-commit', '--distro'];
const booleanFlags = ['--with-figma', '--no-figma', '--with-tower', '--no-tower', '--global-hooks', '--no-global-hooks', '--no-starter-mate', '--yes', '--reconfigure',
  '--dry-run', '--handoff', '--allow-existing-root'];
const oneLine = (value, flag, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0-\x1f\x7f]/.test(value)) throw new Error(`${flag} must be one line of at most ${max} characters`);
  return value.trim();
};
export const validators = {
  harness: value => parseHarness(value) || (() => { throw new Error('--harness must be claude, codex or claude,codex'); })(),
  githubOwner: value => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value) ? value : (() => { throw new Error('--github-owner must be a GitHub account or organization name'); })(),
  gitName: value => oneLine(value, '--git-name', 100),
  gitEmail: value => /^[^\s@<>]+@[^\s@<>]+$/.test(value) && value.length <= 254 ? value : (() => { throw new Error('--git-email must be an email address'); })(),
  starterId: value => /^[a-z][a-z0-9-]{0,30}$/.test(value) ? value : (() => { throw new Error('--starter-mate must start with a lowercase letter and use lowercase letters, digits and -'); })(),
  starterScope: value => oneLine(value, '--starter-scope', 200),
  channel: value => ['releases', 'main'].includes(value) ? value : (() => { throw new Error('--channel must be releases or main'); })(),
};

export function parseSetupArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valueFlags.includes(arg)) {
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      flags[arg.slice(2)] = argv[++i];
    } else if (booleanFlags.includes(arg)) flags[arg.slice(2)] = true;
    else throw new Error(`unknown setup argument: ${arg}`);
  }
  for (const [a, b] of [['with-figma', 'no-figma'], ['with-tower', 'no-tower'], ['global-hooks', 'no-global-hooks'], ['starter-mate', 'no-starter-mate']])
    if (flags[a] !== undefined && flags[b] !== undefined) throw new Error(`--${a} and --${b} conflict`);
  if (flags['starter-scope'] !== undefined && flags['no-starter-mate']) throw new Error('--starter-scope conflicts with --no-starter-mate');
  if (flags.handoff && flags['dry-run']) throw new Error('--handoff applies only without --dry-run');
  if (flags['kit-commit'] !== undefined && !/^[a-f0-9]{40}$/.test(flags['kit-commit'])) throw new Error('--kit-commit must be a full commit SHA');
  if (flags.harness !== undefined) flags.harness = validators.harness(flags.harness);
  if (flags['github-owner'] !== undefined) validators.githubOwner(flags['github-owner']);
  if (flags['git-name'] !== undefined) flags['git-name'] = validators.gitName(flags['git-name']);
  if (flags['git-email'] !== undefined) validators.gitEmail(flags['git-email']);
  if (flags['starter-mate'] !== undefined) validators.starterId(flags['starter-mate']);
  if (flags['starter-scope'] !== undefined) flags['starter-scope'] = validators.starterScope(flags['starter-scope']);
  if (flags.channel !== undefined) validators.channel(flags.channel);
  return flags;
}

export function expandRoot(value, home) {
  const path = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
  if (!isAbsolute(path)) throw new Error(`root folder must be an absolute path or start with ~/ (got ${value})`);
  return resolve(path);
}

// Hard refusals throw; a root that needs confirmation returns its reasons.
export function checkRoot(root, { home, platform, wsl, installRoot, firstmateHome }) {
  const homeDir = resolve(home);
  if (root === homeDir) throw new Error(`${root} is your home directory itself; choose a folder inside it, such as ~/Agentic`);
  if (within(homeDir, root)) throw new Error(`${root} contains your home directory; choose a folder inside it, such as ~/Agentic`);
  if (root === sep || (systemDirs[platform] || systemDirs.linux)(homeDir).some(dir => within(root, dir))) throw new Error(`${root} is a system location; choose a folder you own, such as ~/Agentic`);
  if (wsl && within(root, '/mnt')) throw new Error(`${root} is a Windows drive; keep the root on the Linux filesystem inside WSL, such as ~/Agentic`);
  const st = lstatSync(root, { throwIfNoEntry: false });
  if (st && (!st.isDirectory() || st.isSymbolicLink())) throw new Error(`${root} exists and is not a plain folder`);
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'fm-bootstrap.sh'))) throw new Error(`${root} is inside an existing Firstmate home (${dir}); the kit never touches an existing Firstmate home`);
    if (existsSync(join(dir, '.git'))) throw new Error(`${root} is inside a git checkout (${dir}); choose a folder outside any repository`);
    if (dir === dirname(dir)) break;
  }
  const receipt = join(installRoot, 'receipt.json');
  if (existsSync(receipt)) return { resume: true, receipt, reasons: [] };
  const busy = path => { const s = lstatSync(path, { throwIfNoEntry: false }); return s && (!s.isDirectory() || readdirSync(path).length > 0); };
  if (busy(firstmateHome)) throw new Error(`${firstmateHome} already exists and is not empty; the kit never touches an existing Firstmate home. Choose another root, or pass --firstmate-home <new folder>`);
  if (busy(installRoot)) throw new Error(`${installRoot} is not empty and holds no kit receipt; refusing to inherit it. Choose another root, or pass --install-root <new folder>`);
  const reasons = [];
  if (st) {
    const entries = readdirSync(root);
    for (const name of entries) {
      const child = join(root, name);
      if (existsSync(join(child, 'fm-bootstrap.sh')) || existsSync(join(child, 'bin', 'fm-session-start.sh'))) reasons.push(`it holds another Firstmate home: ${child}`);
    }
    if (entries.length && !reasons.length) reasons.push(`it is not empty (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}: ${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', ...' : ''})`);
  }
  return { resume: false, receipt, reasons };
}

export function derivePaths(root, flags, commit) {
  const installRoot = flags['install-root'] ? resolve(flags['install-root']) : join(root, '.tools');
  const firstmateHome = flags['firstmate-home'] ? resolve(flags['firstmate-home']) : join(root, 'firstmate');
  for (const [flag, path] of [['--install-root', installRoot], ['--firstmate-home', firstmateHome]]) {
    if (!isAbsolute(flags[flag.slice(2)] ?? path)) throw new Error(`${flag} must be absolute`);
    if (path === root) throw new Error(`${flag} conflicts with --root: it cannot be the root folder itself`);
    for (const derived of [join(root, '.treehouse'), join(root, '.zoe-fleet')]) if (within(path, derived) || within(derived, path)) throw new Error(`${flag} conflicts with --root: it overlaps ${derived}`);
  }
  if (within(installRoot, firstmateHome) || within(firstmateHome, installRoot)) throw new Error('--install-root and --firstmate-home must not contain each other');
  return { root, installRoot, firstmateHome, treehouseRoot: root, treehousePool: join(root, '.treehouse'), towerState: join(root, '.zoe-fleet'),
    wrapper: join(installRoot, 'bin', 'treehouse'), kit: commit ? join(installRoot, 'kit', commit) : null, secondmates: join(root, 'secondmates') };
}

// Questions read lines from the input stream: a terminal, or scripted stdin in tests and automation.
export function prompter(input, output) {
  const rl = createInterface({ input, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question, fallback = '') => {
    output.write(`${question}${fallback ? ` [${fallback}]` : ''}: `);
    const next = await lines.next();
    if (next.done) throw new Error('input ended before every question was answered; pass --yes to accept the shown defaults');
    if (!input.isTTY) output.write('\n');
    return next.value.trim() || fallback;
  };
  const confirm = async (question, fallback) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const answer = (await ask(`${question} (y/n)`, fallback ? 'y' : 'n')).toLowerCase();
      if (['y', 'yes'].includes(answer)) return true;
      if (['n', 'no'].includes(answer)) return false;
      output.write('Please answer y or n.\n');
    }
    throw new Error(`no y or n answer to: ${question}`);
  };
  const valid = async (question, fallback, check) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const answer = await ask(question, fallback);
      try { return check(answer); } catch (error) { output.write(`${error.message.replace(/^--[a-z-]+ /, 'This ')}\n`); }
    }
    throw new Error(`no valid answer to: ${question}`);
  };
  return { ask, confirm, valid, close: () => rl.close() };
}

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, ...options });
function gitIdentity(env) {
  const get = key => { const r = run('git', ['config', '--global', '--get', key], { env }); return r.status === 0 ? r.stdout.trim() : ''; };
  return { name: get('user.name'), email: get('user.email') };
}
function githubLogin(env) {
  const r = run('gh', ['api', 'user', '--jq', '.login'], { env, timeout: 15000 });
  const login = r.status === 0 ? r.stdout.trim() : '';
  return /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : '';
}

async function readReceipt(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`kit receipt ${path} is not readable JSON; refusing to continue`); }
}
async function updateReceipt(path, release, change) {
  const receipt = await readReceipt(path) || { schemaVersion: 1, release, phases: {} };
  change(receipt);
  await atomicJson(path, receipt);
  return receipt;
}
const stepState = (receipt, id) => receipt?.setup?.steps?.[id]?.state;

export function resumeSummary(receipt) {
  const recorded = receipt?.setup?.steps;
  if (!recorded) return null;
  const first = steps.findIndex(([id]) => !['complete', 'not-selected'].includes(recorded[id]?.state));
  const lines = first === -1 ? [`All ${steps.length} setup steps are recorded complete; re-verifying them (no changes expected).`]
    : [`Resuming from step ${first + 1} of ${steps.length} (${steps[first][1]}).`];
  steps.forEach(([id, label], index) => lines.push(`  ${index + 1}. ${label}: ${recorded[id]?.state || 'not started'}${recorded[id]?.detail ? ` (${recorded[id].detail})` : ''}`));
  lines.push('Completed steps are re-verified against the receipt; only failed or missing steps are redone.');
  return { step: first === -1 ? null : first + 1, text: lines.join('\n') };
}

export async function collectAnswers(flags, saved, ctx, io, paths) {
  const { env, output } = ctx, yes = !!flags.yes, answers = { ...(flags.reconfigure ? {} : saved), root: paths.root };
  const want = key => answers[key] === undefined;
  const claudeInstalled = findOnPath('claude', env.PATH || '').length > 0;
  if (flags.harness !== undefined) answers.harness = flags.harness;
  else if (want('harness')) {
    if (!claudeInstalled) {
      answers.harness = 'codex';
      output.write('2. Agent CLIs: codex (Claude Code is offered once its CLI is installed: https://code.claude.com/docs/en/setup)\n');
    } else answers.harness = yes ? 'codex' : await io.valid('2. Agent CLIs: codex, claude or claude,codex', 'codex', validators.harness);
  }
  // One plan per chosen agent CLI from the kit's plan table, then the starter routing mode. Plan ids match
  // Firstmate's fm-strategy.sh --plans names; skip (saved as not-sure) keeps Firstmate's template. Only names are saved.
  const table = ctx.planTable || loadPlanTable(), plans = {};
  for (const cli of harnessProfiles(answers.harness)) {
    const ids = planIds(table, cli), flag = flags[`${cli}-plan`];
    const check = value => { const id = value === 'skip' ? 'not-sure' : value; if (ids.includes(id)) return id; throw new Error(`--${cli}-plan must be one of: ${ids.filter(x => x !== 'not-sure').join(', ')} or skip`); };
    if (flag !== undefined) plans[cli] = check(flag);
    else if (ids.includes(answers.plans?.[cli])) plans[cli] = answers.plans[cli];
    else plans[cli] = yes ? 'not-sure' : await io.valid(`2${cli === 'claude' ? 'a' : 'b'}. ${table.harnesses[cli].label} subscription plan, for starter dispatch rules: ${ids.filter(x => x !== 'not-sure').join(', ')} or skip`, 'skip', check);
  }
  for (const flag of ['claude-plan', 'codex-plan']) if (flags[flag] !== undefined && plans[flag.slice(0, -5)] === undefined) throw new Error(`--${flag} needs ${flag.slice(0, -5)} among the agent CLIs`);
  const plansChanged = JSON.stringify(plans) !== JSON.stringify(answers.plans || {});
  answers.plans = plans;
  const providers = providersOf(answers.harness), suggested = defaultMode(providers, plans, table), warnings = fullWarnings(providers, plans, table);
  const fullNote = `full on ${warnings.join(' and ')} can reach the five-hour limit first, then the weekly limit`;
  const checkMode = value => modes.includes(value) ? value : (() => { throw new Error('--dispatch-mode must be lean, balanced or full'); })();
  if (flags['dispatch-mode'] !== undefined) {
    answers.dispatchMode = checkMode(flags['dispatch-mode']);
    if (answers.dispatchMode === 'full' && warnings.length) output.write(`Warning: ${fullNote}.\n`);
  } else if (want('dispatchMode') || plansChanged) {
    answers.dispatchMode = yes ? suggested : await io.valid(`2c. Starter routing mode used once TYPESAFE_API_KEY is set: lean, balanced or full`, suggested, checkMode);
    if (answers.dispatchMode === 'full' && warnings.length && !yes && !(await io.confirm(`   Warning: ${fullNote}. Use full anyway`, false))) answers.dispatchMode = suggested;
  }
  const toggle = async (key, on, off, number, question) => {
    if (flags[on]) answers[key] = true;
    else if (flags[off]) answers[key] = false;
    else if (want(key)) answers[key] = yes ? true : await io.confirm(`${number}. ${question}`, true);
  };
  await toggle('figma', 'with-figma', 'no-figma', 3, 'Figma support: check figma-cli and guide Figma Desktop sign-in (never patches or restarts Figma)');
  await toggle('tower', 'with-tower', 'no-tower', 4, 'Fleet tower: install the Zoe fleet tower and write its launcher config (never launched)');
  if (!flags['global-hooks'] && !flags['no-global-hooks'] && answers.globalHooks === undefined && !yes)
    output.write(`5. Global hooks and skills touch these files; each existing file or link is backed up under ${join(paths.installRoot, 'backups', 'hooks')} first:\n${globalHookPaths(env.HOME).map(x => `   ${x}`).join('\n')}\n`);
  await toggle('globalHooks', 'global-hooks', 'no-global-hooks', 5, 'Register these kit hooks and skills');
  if (flags['github-owner'] !== undefined) answers.githubOwner = flags['github-owner'];
  else if (want('githubOwner')) {
    const login = githubLogin(env);
    answers.githubOwner = yes ? login || null : await io.valid('6. GitHub account or organization for your projects (recorded only)', login || 'none', value => value === 'none' ? null : validators.githubOwner(value));
  }
  const current = gitIdentity(env);
  const savedSet = answers.gitIdentity?.action === 'set' ? answers.gitIdentity : null;
  const gitFlags = flags['git-name'] !== undefined || flags['git-email'] !== undefined;
  const stale = !ctx.onlyNew && !gitFlags && savedSet && ((current.name && current.name !== savedSet.name) || (current.email && current.email !== savedSet.email)) ? savedSet : null;
  if (stale) {
    if (yes) answers.gitIdentity = { action: 'keep' };
    else {
      output.write(`7. Your git identity changed since you saved "${stale.name}" <${stale.email}>, so it is asked again.\n`);
      delete answers.gitIdentity;
    }
  }
  if (gitFlags) {
    answers.gitIdentity = { action: 'set', name: flags['git-name'] ?? current.name, email: flags['git-email'] ?? current.email };
    if (!answers.gitIdentity.name || !answers.gitIdentity.email) throw new Error('git identity needs both a name and an email; pass --git-name and --git-email');
  } else if (want('gitIdentity')) {
    answers.gitIdentity = { action: 'keep' };
    if (!yes) {
      const shown = current.name || current.email ? `${current.name || '(no name)'} <${current.email || 'no email'}>` : 'not set';
      if (!(await io.confirm(`7. Git identity is ${shown}. Keep it as it is`, true))) {
        const name = await io.valid('   Git name', current.name, validators.gitName);
        const email = await io.valid('   Git email', current.email, validators.gitEmail);
        if (await io.confirm(`   Set git config --global user.name "${name}" and user.email "${email}"`, false)) answers.gitIdentity = { action: 'set', name, email };
      }
    }
  }
  if (flags['starter-mate'] !== undefined) answers.starterMate = { create: true, id: flags['starter-mate'], scope: flags['starter-scope'] ?? saved.starterMate?.scope };
  else if (flags['no-starter-mate']) answers.starterMate = { create: false };
  else if (want('starterMate')) {
    answers.starterMate = { create: false };
    if (!yes && await io.confirm('8. Create a starter second mate now (scaffolded and seeded, never launched)', false)) {
      const id = await io.valid('   Second mate name', 'starter', validators.starterId);
      answers.starterMate = { create: true, id, scope: await io.valid('   One-line scope', '', validators.starterScope) };
    }
  }
  if (answers.starterMate?.create && flags['starter-scope'] !== undefined) answers.starterMate.scope = flags['starter-scope'];
  if (answers.starterMate?.create && !answers.starterMate.scope) throw new Error('a starter second mate needs a one-line scope; pass --starter-scope');
  if (flags.channel !== undefined) answers.channel = flags.channel;
  else if (want('channel')) answers.channel = yes ? 'releases' : await io.valid('9. Update channel: releases (reviewed releases) or main', 'releases', validators.channel);
  const channelOverride = flags.channel !== undefined && !flags.reconfigure && saved.channel && saved.channel !== flags.channel ? saved.channel : null;
  return { answers, current, gitStale: yes ? stale : null, channelOverride };
}

const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const yesNo = value => value ? 'on' : 'off';
const indent = text => `${text.trimEnd().replace(/^/gm, '  ')}\n`;
export function formatSummary({ answers, paths, plan, gitCurrent, gitStale, channelOverride, kit, home, keyPlan = { managed: true, status: 'not set' } }) {
  const g = answers.gitIdentity, tower = plan.plan?.towerConfig;
  const lines = ['', 'Agent Kit setup summary. Nothing has been written yet.', 'Answers:',
    `  1. Root folder: ${paths.root}`, `  2. Agent CLIs: ${harnessLabel(answers.harness)} (plan: ${Object.entries(answers.plans || {}).map(([cli, id]) => `${cli} ${id === 'not-sure' ? 'skip' : id}`).join(', ') || 'skip'}; starter routing mode: ${answers.dispatchMode})`, `  3. Figma support: ${yesNo(answers.figma)}`, `  4. Fleet tower: ${yesNo(answers.tower)}`,
    `  5. Global hooks and skills: ${yesNo(answers.globalHooks)}`, `  6. GitHub owner: ${answers.githubOwner || 'none'} (recorded only; nothing is created on GitHub)`,
    `  7. Git identity: ${g.action === 'set' ? `set user.name "${g.name}" and user.email "${g.email}" with git config --global` : `keep (${gitCurrent.name || 'no name'} <${gitCurrent.email || 'no email'}>)`}${gitStale ? `; your saved "${gitStale.name}" <${gitStale.email}> was not applied because git's value changed since (pass --git-name and --git-email, or --reconfigure, to change it)` : ''}`,
    `  8. Starter second mate: ${answers.starterMate.create ? `${answers.starterMate.id}: ${answers.starterMate.scope}` : 'no'}`, `  9. Update channel: ${answers.channel}${channelOverride ? ` (from --channel; your saved answer was ${channelOverride})` : ''}`,
    ...(keyPlan.managed ? [`  10. Optional TYPESAFE_API_KEY: ${keyPlan.status} (Firstmate home .env; without it Jev routing is off and normal dispatch rules apply)`]
      : [`  10. Optional TYPESAFE_API_KEY: not checked. Warning: ${join(paths.firstmateHome, '.env')} is a symlink, hard link or other non-plain file, so the kit neither reads nor changes it`]),
    ...(keyPlan.status === 'will set' || !keyPlan.managed ? [] : [`      Add, change or remove it later from your own terminal with the hidden prompt: bash install.sh --reconfigure keys --root ${shellQuote(paths.root)}${paths.installRoot === join(paths.root, '.tools') ? '' : ` --install-root ${shellQuote(paths.installRoot)}`}`]),
    ...(keyPlan.starter ? [`      Starter dispatch rules: ${keyPlan.starter}`] : []),
    'Derived paths:', `  Firstmate home: ${paths.firstmateHome}`, `  Kit install root: ${paths.installRoot} (private receipt ${join(paths.installRoot, 'receipt.json')})`,
    `  Kit source: ${kit.commit ? `${paths.kit} at ${kit.commit}` : 'this checkout (not recorded)'}`,
    `  Treehouse pool: ${paths.treehousePool} through the kit wrapper ${paths.wrapper}`,
    `  Tower state: ${!answers.tower ? 'not selected' : tower ? tower.state : 'none on this platform (no reviewed fleet runtime, so no launcher is configured)'}`,
    ...(answers.starterMate.create ? [`  Starter second mate home: ${join(paths.secondmates, answers.starterMate.id)}`] : []),
    'Files outside the root that will be touched:'];
  const outside = [];
  if (answers.globalHooks) {
    for (const change of (plan.plan?.globalHookChanges || []).filter(x => !within(x.path, paths.installRoot)))
      outside.push(`  ${change.path}: ${change.changes.map(c => `${c.op} ${c.owner || c.path}`).join(', ')} (an existing file or link is backed up first)`);
    if (plan.issues.some(x => x.id === 'hooks')) outside.push(`  global hooks refused: ${plan.issues.find(x => x.id === 'hooks').reason}`);
  }
  if (answers.tower && tower) outside.push(`  ${tower.config}: tower launcher config, private 0600 (the launcher has no config override, so it stays in this XDG location)`);
  if (g.action === 'set' && (g.name !== gitCurrent.name || g.email !== gitCurrent.email)) outside.push(`  ${join(home, '.gitconfig')} (or your git global config): user.name and user.email`);
  lines.push(...(outside.length ? outside : ['  none']));
  lines.push('Will install (pinned and verified; nothing is downloaded until you say yes):');
  for (const item of plan.plan?.tools || []) lines.push(`  - ${item.name} ${item.version || 'UNVERIFIED'} -> ${item.installLocation}${item.versionStatus === 'verified' ? '' : ' (unverified; skipped)'}`);
  lines.push('Person-installed prerequisites (checked, never installed):');
  for (const prereq of plan.platform.prerequisites?.filter(x => x.kind === 'prerequisite') || []) lines.push(`  - ${prereq.id}: ${prereq.status}; ${prereq.detail}`);
  if (plan.plan?.loginSteps?.length) lines.push('You will sign in yourself afterwards:', ...plan.plan.loginSteps.map(x => `  - ${x}`));
  return lines.join('\n') + '\n';
}

const blocking = plan => {
  const prereqIds = new Set((plan.platform.prerequisites || []).filter(x => !['terminal', 'browser', 'virtualization'].includes(x.id) && x.required !== false).map(x => x.id));
  return plan.issues.filter(x => x.status === 'fail' && (prereqIds.has(x.id) || ['node-runtime', 'platform'].includes(x.id)));
};

async function placeKit(paths, kit, env) {
  const git = (args, cwd) => run('git', args, { cwd, env: { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
  const head = dir => { const r = git(['-C', dir, 'rev-parse', 'HEAD']); return r.status === 0 ? r.stdout.trim() : null; };
  if (existsSync(paths.kit)) {
    if (head(paths.kit) !== kit.commit || git(['-C', paths.kit, 'status', '--porcelain', '--untracked-files=no']).stdout.trim()) throw new Error(`${paths.kit} is not a clean checkout of ${kit.commit}; refusing to reuse it`);
    return 'kit source verified at its pinned commit';
  }
  if (head(kit.dir) === null) throw new Error(`${kit.dir} is not a git checkout of the kit`);
  const partial = `${paths.kit}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(dirname(paths.kit), { recursive: true, mode: 0o700 });
  for (const args of [['clone', '--quiet', '--no-hardlinks', '--no-checkout', kit.dir, partial], ['-C', partial, 'checkout', '--quiet', '--detach', kit.commit],
    ['-C', partial, 'remote', 'set-url', 'origin', kitUpstream]]) {
    const r = git(args);
    if (r.status !== 0) { await rm(partial, { recursive: true, force: true }); throw new Error(`git ${args[args.length - 2] === 'origin' ? 'remote' : args[0] === '-C' ? args[2] : args[0]} failed: ${(r.stderr || '').trim().split('\n')[0]}`); }
  }
  if (head(partial) !== kit.commit) { await rm(partial, { recursive: true, force: true }); throw new Error('kit source commit mismatch'); }
  await rename(partial, paths.kit);
  return `kit source placed at ${kit.commit}`;
}

export const wrapperScript = (root, binary) => `#!/bin/sh
# agent-kit:treehouse-root - Treehouse pools for this setup live under ${root}/.treehouse.
# An explicit treehouse --root still wins over this default.
TREEHOUSE_ROOT='${root.replaceAll("'", "'\\''")}'
export TREEHOUSE_ROOT
exec '${binary.replaceAll("'", "'\\''")}' "$@"
`;
async function placeWrapper(paths, receipt, receiptPath, release) {
  const entry = receipt.phases.treehouse;
  if (entry?.state !== 'complete') return { state: 'skipped', detail: 'Treehouse is not installed yet' };
  const body = wrapperScript(paths.treehouseRoot, join(paths.installRoot, entry.path));
  const current = lstatSync(paths.wrapper, { throwIfNoEntry: false });
  if (current) {
    const recorded = receipt.phases['treehouse-root'];
    if (!current.isFile() || current.isSymbolicLink() || !recorded || sha(readFileSync(paths.wrapper)) !== recorded.ownedSha256) throw new Error(`${paths.wrapper} exists and is not the kit-owned wrapper; left unchanged`);
    if (sha(body) === recorded.ownedSha256) return { state: 'complete', detail: 'wrapper verified' };
  }
  await mkdir(dirname(paths.wrapper), { recursive: true, mode: 0o700 });
  const temp = `${paths.wrapper}.${process.pid}.tmp`;
  await writeFile(temp, body, { mode: 0o755, flag: 'w' });
  await updateReceipt(receiptPath, release, r => { r.phases['treehouse-root'] = { state: 'complete', version: release, path: 'bin/treehouse', ownedSha256: sha(body), treehouseRoot: paths.treehouseRoot }; });
  await rename(temp, paths.wrapper);
  return { state: 'complete', detail: `TREEHOUSE_ROOT=${paths.treehouseRoot}` };
}

function applyGitIdentity(answer, env) {
  if (answer.action !== 'set') return { state: 'complete', detail: 'kept as it is' };
  const current = gitIdentity(env);
  for (const [key, value] of [['user.name', answer.name], ['user.email', answer.email]]) {
    if (current[key.slice(5)] === value) continue;
    const r = run('git', ['config', '--global', key, value], { env });
    if (r.status !== 0) throw new Error(`git config --global ${key} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
  }
  const after = gitIdentity(env);
  if (after.name !== answer.name || after.email !== answer.email) throw new Error('git identity did not take effect');
  return { state: 'complete', detail: `${answer.name} <${answer.email}>` };
}

export function charterText(scope) {
  const template = readFileSync(new URL('../templates/secondmate/charter.md', import.meta.url), 'utf8');
  // Firstmate wraps the charter under its own heading, so the template's title line is dropped.
  return template.replace(/^# .*\n+/, '').replace('<describe the work this mate owns>', scope).replace('<describe the projects and decisions this mate may handle>', scope).trim();
}
function seedStarter(answer, paths, env, releaseBin) {
  const registry = join(paths.firstmateHome, 'data', 'secondmates.md');
  if (existsSync(registry) && readFileSync(registry, 'utf8').split('\n').some(line => new RegExp(`(^|[^a-z0-9-])${answer.id}([^a-z0-9-]|$)`).test(line)))
    return { state: 'complete', detail: `${answer.id} is in ${registry}` };
  if (!existsSync(join(paths.firstmateHome, 'bin', 'fm-brief.sh'))) return { state: 'skipped', detail: 'Firstmate home is not installed yet' };
  const home = join(paths.secondmates, answer.id);
  if (existsSync(home)) throw new Error(`${home} exists but ${answer.id} is not registered; inspect it yourself, the kit leaves it unchanged`);
  const seedEnv = { ...env, PATH: [dirname(paths.wrapper), releaseBin, env.PATH].filter(Boolean).join(':'), FM_SECONDMATE_CHARTER: charterText(answer.scope), FM_SECONDMATE_SCOPE: answer.scope };
  const commands = [...(existsSync(join(paths.firstmateHome, 'data', answer.id, 'brief.md')) ? [] : [['bin/fm-brief.sh', answer.id, '--secondmate', '--no-projects']]),
    ['bin/fm-home-seed.sh', answer.id, home, '--no-projects']];
  for (const args of commands) {
    const r = run('bash', args, { cwd: paths.firstmateHome, env: seedEnv, timeout: 300000 });
    if (r.status !== 0) throw new Error(`${args[0]} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0] || `exit ${r.status}`}`);
  }
  return { state: 'complete', detail: `${answer.id} seeded at ${home}; launch it yourself from ${paths.firstmateHome} with bin/fm-spawn.sh ${answer.id} --secondmate` };
}

export async function setup(manifest, ctx) {
  const { platform, output } = ctx, flags = parseSetupArgs(ctx.argv);
  const env = { ...ctx.env };
  delete env.TYPESAFE_API_KEY; // Never pass the key to installer child processes.
  const home = env.HOME;
  if (!home || !isAbsolute(home)) throw new Error('HOME must be an absolute path');
  let io = flags.yes ? null : prompter(ctx.input, output);
  try {
    const wsl = platform === 'linux' && linuxIdentity({ env, procVersion: ctx.procVersion, osRelease: ctx.osRelease, libc: ctx.libc }).wsl;
    output.write(`Agent Kit setup (release ${manifest.release}). Every question shows its default; nothing is written until you confirm the summary.\n`);
    let root;
    for (let attempt = 0; ; attempt++) {
      const raw = flags.root ?? (io ? await io.ask('1. Root folder for your agent setup (holds firstmate/, .tools/, .treehouse/ and .zoe-fleet/)', defaultRoot) : defaultRoot);
      try { root = expandRoot(raw, home); break; } catch (error) { if (flags.root !== undefined || !io || attempt === 2) throw error; output.write(`${error.message}\n`); }
    }
    const kit = { dir: flags['kit-dir'] ? resolve(flags['kit-dir']) : fileURLToPath(new URL('..', import.meta.url)), commit: flags['kit-commit'] || null };
    const paths = derivePaths(root, flags, kit.commit);
    const rootCheck = checkRoot(root, { home, platform, wsl, installRoot: paths.installRoot, firstmateHome: paths.firstmateHome });
    let receipt = rootCheck.resume ? await readReceipt(rootCheck.receipt) : null;
    // A rerun without install.sh re-verifies the kit copy recorded by the first run.
    const recordedKit = receipt?.setup?.kit;
    if (!kit.commit && /^[a-f0-9]{40}$/.test(recordedKit?.commit || '')) Object.assign(kit, { commit: recordedKit.commit, dir: join(paths.installRoot, 'kit', recordedKit.commit) });
    if (kit.commit) paths.kit = join(paths.installRoot, 'kit', kit.commit);
    if (receipt) {
      if (receipt.release !== manifest.release || receipt.pendingUpdate) throw new Error(`${rootCheck.receipt} records kit release ${receipt.pendingUpdate || receipt.release}, but this kit is ${manifest.release}. Re-run the installer with the kit that made this install, or use agent-kit update; repair and upgrade arrive with the next installer release`);
      const recorded = receipt.setup?.paths;
      for (const key of ['root', 'installRoot', 'firstmateHome']) if (recorded?.[key] && recorded[key] !== paths[key]) throw new Error(`this install recorded ${key} ${recorded[key]}; refusing to move it to ${paths[key]}`);
      if (!recorded && receipt.phases.firstmate?.path && receipt.phases.firstmate.path !== paths.firstmateHome) throw new Error(`this kit root recorded Firstmate home ${receipt.phases.firstmate.path}; pass --firstmate-home ${receipt.phases.firstmate.path}`);
      output.write(`Found an Agent Kit install at ${paths.installRoot}.\n`);
      const resume = resumeSummary(receipt);
      if (resume) output.write(`${resume.text}\n`);
      if (receipt.setup?.answers && !flags.reconfigure) output.write('Reusing your saved answers (pass --reconfigure to answer every question again).\n');
    } else if (rootCheck.reasons.length) {
      output.write(`${root} needs confirmation: ${rootCheck.reasons.join('; ')}.\nThe kit only adds firstmate/, .tools/, .treehouse/ and .zoe-fleet/ there and leaves everything else as it is.\n`);
      if (!(flags['allow-existing-root'] || (io && await io.confirm('Use it anyway', false)))) throw new Error(`refusing ${root}: ${rootCheck.reasons.join('; ')}. Choose another root${io ? '' : ', or pass --allow-existing-root after checking it yourself'}`);
    } else if (io && flags.root === undefined && !(await io.confirm(`   Use ${root}`, true))) throw new Error('setup cancelled; nothing was written');
    const { answers, current: gitCurrent, gitStale, channelOverride } = await collectAnswers(flags, receipt?.setup?.answers || {}, { ...ctx, env }, io || { confirm: async (_q, d) => d }, paths);
    const managed = envManaged(paths.firstmateHome), wasSet = managed && keyStatus(paths.firstmateHome);
    let keyValue = null;
    if (managed && !wasSet && !flags['dry-run'] && io && ctx.input.isTTY && await io.confirm('10. Add optional TYPESAFE_API_KEY from https://console.typesafe.ai/keys now? Enabling Jev sends screened task text to typesafe.ai', false)) {
      io.close(); io = null;
      keyValue = await hiddenKey(ctx.input, output);
      io = prompter(ctx.input, output);
    }
    const keyPlan = { value: keyValue, managed, status: keyValue ? 'will set' : wasSet ? 'set' : 'not set',
      starter: managed ? previewStarter(paths.firstmateHome, { harness: answers.harness, plans: answers.plans, mode: answers.dispatchMode, table: ctx.planTable, record: receipt?.setup?.dispatch, keySet: !!keyValue || wasSet }) : null };
    const options = { command: 'plan', harness: answers.harness, withFigma: answers.figma, withTower: answers.tower, globalHooks: answers.globalHooks,
      installRoot: paths.installRoot, firstmateHome: paths.firstmateHome, towerState: paths.towerState };
    const context = { env, platform, arch: ctx.arch, nodeVersion: ctx.nodeVersion, procVersion: ctx.procVersion, osRelease: ctx.osRelease, libc: ctx.libc, runCommand: ctx.runCommand, applicationDirs: ctx.applicationDirs };
    const plan = evaluatePlan(manifest, context, options).result;
    const blockers = blocking(plan);
    output.write(formatSummary({ answers, paths, plan, gitCurrent, gitStale, channelOverride, kit, home, keyPlan }));
    if (blockers.length) {
      output.write('Install these yourself first, then rerun the installer (the kit never installs them):\n');
      for (const issue of blockers) output.write(`  - ${issue.id}: ${issue.reason}\n`);
    }
    if (flags['dry-run']) { output.write('Dry run: nothing was written.\n'); return blockers.length ? 1 : 0; }
    if (blockers.length) { output.write('Stopped before any change: required prerequisites are missing.\n'); return 1; }
    if (!(flags.yes || await io.confirm('Write these changes now', false))) { output.write('Cancelled; nothing was written.\n'); return 1; }
    io?.close();

    await mkdir(paths.installRoot, { recursive: true, mode: 0o700 });
    const unlock = await lock(paths.installRoot, '.setup.lock');
    const receiptPath = join(paths.installRoot, 'receipt.json');
    const record = (id, state, detail) => updateReceipt(receiptPath, manifest.release, r => {
      r.setup.steps[id] = { state, ...(detail ? { detail: String(detail).split('\n')[0].slice(0, 300) } : {}), at: new Date().toISOString() };
    });
    let failed = false;
    try {
      receipt = await updateReceipt(receiptPath, manifest.release, r => {
        r.setup = { version: 1, answers, paths: { root: paths.root, installRoot: paths.installRoot, firstmateHome: paths.firstmateHome, treehouseRoot: paths.treehouseRoot, towerState: paths.towerState },
          kit: kit.commit ? { commit: kit.commit, path: paths.kit } : r.setup?.kit || null, steps: r.setup?.steps || {}, ...(r.setup?.dispatch ? { dispatch: r.setup.dispatch } : {}) };
      });
      const stepRun = async (index, fn) => {
        const [id, label] = steps[index];
        output.write(`\nStep ${index + 1} of ${steps.length}: ${label}\n`);
        try {
          const result = await fn();
          await record(id, result.state, result.detail);
          output.write(`  ${result.state}${result.detail ? `: ${result.detail}` : ''}\n`);
          return result;
        } catch (error) {
          await record(id, 'failed', error.message);
          failed = true;
          output.write(`  failed: ${error.message}\nStopped safely at step ${index + 1}. Rerun the installer to resume; completed steps are re-verified, not redone.\n`);
          throw Object.assign(error, { reported: true });
        }
      };
      await stepRun(0, async () => kit.commit ? { state: 'complete', detail: await placeKit(paths, kit, env) } : { state: 'not-selected', detail: 'run from a local kit checkout; no pinned commit given' });
      let install;
      await stepRun(1, async () => {
        install = await (ctx.installPlatform || installPlatform)(manifest, { platform, arch: ctx.arch, home, env, nodeVersion: ctx.nodeVersion, procVersion: ctx.procVersion, osRelease: ctx.osRelease, libc: ctx.libc,
          installRoot: paths.installRoot, firstmateHome: paths.firstmateHome, harness: answers.harness, withFigma: answers.figma, withTower: answers.tower, globalHooks: answers.globalHooks,
          towerState: paths.towerState, ...ctx.installOptions,
          onHooksPreview: changes => output.write(`  Global hook and skill changes (kit-owned entries only; existing files backed up first):\n${changes.map(c => `    ${c.path}: ${c.changes.map(x => `${x.op} ${x.owner || x.path}`).join(', ')}`).join('\n') || '    none'}\n`) });
        output.write(indent(formatInstall(install)));
        if (install.status === 'unsupported') throw new Error(install.message);
        if (keyPlan.value) {
          await writeKey(paths.firstmateHome, 'set', keyPlan.value);
          keyPlan.value = null;
          output.write('  TYPESAFE_API_KEY: set\n');
        }
        const keySet = envManaged(paths.firstmateHome) && keyStatus(paths.firstmateHome);
        // Starter rules follow the key: written once it is set, never over rules the person or a strategy owns.
        const starter = keySet ? await applyStarter(planStarter(paths.firstmateHome, { harness: answers.harness, plans: answers.plans, mode: answers.dispatchMode, table: ctx.planTable, record: receipt.setup?.dispatch, create: true, restore: true })) : null;
        if (starter && describeStarter(starter)) output.write(`  ${describeStarter(starter)}\n`);
        await updateReceipt(receiptPath, manifest.release, r => {
          if (envManaged(paths.firstmateHome)) r.setup.keys = { TYPESAFE_API_KEY: keyStatus(paths.firstmateHome) };
          else delete r.setup.keys;
          if (starter?.record) r.setup.dispatch = starter.record;
          else if (starter) delete r.setup.dispatch;
        });
        const incomplete = install.components.filter(x => ['unverified', 'conflict', 'deferred'].includes(x.status));
        return incomplete.length ? { state: 'partial', detail: `retry on rerun: ${incomplete.map(x => x.id).join(', ')}` } : { state: 'complete', detail: install.towerParity !== 'unavailable' ? `tower: ${install.towerParity}` : '' };
      });
      receipt = await readReceipt(receiptPath);
      await stepRun(2, () => placeWrapper(paths, receipt, receiptPath, manifest.release));
      await stepRun(3, async () => applyGitIdentity(answers.gitIdentity, env));
      await stepRun(4, async () => answers.starterMate.create ? seedStarter(answers.starterMate, paths, env, install.bin) : { state: 'not-selected' });
      await stepRun(5, async () => {
        output.write('  Sign in yourself; the kit never runs, reads or stores a login:\n');
        for (const step of install.loginSteps) output.write(`  - ${step}\n`);
        if (answers.figma) output.write('  - Figma Desktop: install it from https://www.figma.com/downloads/ and sign in yourself. The kit never patches or restarts Figma.\n');
        return { state: 'complete', detail: 'shown' };
      });
      await stepRun(6, async () => {
        const health = doctor(manifest, { installRoot: paths.installRoot, home, env, nodeVersion: ctx.nodeVersion, platform, arch: ctx.arch });
        output.write(indent(formatDoctor(health)));
        if (health.exitCode) failed = true;
        return { state: health.exitCode ? 'failed' : 'complete', detail: health.exitCode ? `failing: ${health.checks.filter(x => x.status === 'fail').map(x => x.id).join(', ')}` : 'pass' };
      });
      const partial = (await readReceipt(receiptPath)).setup.steps.tools.state !== 'complete';
      output.write(`\nAgent Kit setup ${failed ? 'finished with failures' : partial ? 'finished; some tools are partial and are retried on rerun' : 'complete'}.\n`);
      output.write(`Add these folders to the start of your PATH yourself (the kit never edits shell profiles):\n  ${[dirname(paths.wrapper), install.bin, install.npmBin, install.codexBin].filter(Boolean).join('\n  ')}\n`);
      if (kit.commit) output.write(`Health check later: node ${join(paths.kit, 'bin', 'agent-kit.mjs')} doctor --install-root ${paths.installRoot}\n`);
      return failed || partial ? 1 : 0;
    } catch (error) {
      if (error.reported) return 1;
      throw error;
    } finally { await unlock(); }
  } finally { io?.close(); }
}

// Inside WSL: fetch install.sh at the Windows checkout's commit with the person's own gh sign-in, then run it
// with the same commit and the remaining setup flags. No single quotes, so the printed command pastes into PowerShell.
export const setupHandoffScript = [
  'set -uf', 'umask 077', 'commit=$1', 'shift',
  'command -v gh >/dev/null || { echo agent-kit: install the GitHub CLI inside this WSL distribution, then sign in with gh auth login: https://github.com/cli/cli#installation >&2; exit 1; }',
  'dir=$(mktemp -d) || exit 1',
  'gh api -H Accept:application/vnd.github.raw repos/amelie-pierce/agent-kit/contents/install.sh?ref=$commit > $dir/install.sh && bash $dir/install.sh --commit $commit "$@"',
  'status=$?', 'rm -rf $dir', 'exit $status',
].join('; ');

export function windowsSetup(argv, context) {
  const flags = parseSetupArgs(argv);
  for (const flag of ['kit-dir', 'kit-commit']) if (flags[flag] !== undefined) throw new Error(`--${flag} is set by install.sh; on Windows the kit commit comes from this checkout`);
  for (const flag of ['root', 'install-root', 'firstmate-home']) if (flags[flag] !== undefined) linuxPath(flags[flag], `--${flag}`);
  const passthrough = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--handoff') continue;
    if (argv[i] === '--distro') { i++; continue; }
    passthrough.push(argv[i]);
  }
  const platform = inspectWindows(context, { distro: flags.distro });
  const base = { platform: 'windows', build: platform.build, linuxArch: platform.linuxArch, prerequisites: platform.prerequisites, steps: platform.steps, nextSteps: windowsNextSteps(platform.wsl?.target?.name) };
  if (!platform.supported || !platform.ready) return { ...base, status: 'needs-setup', exitCode: 1, message: platform.message, command: null };
  const kit = (context.kitCommit || kitCommit)(context);
  if (!kit.commit || kit.reason) return { ...base, status: 'unpinned', exitCode: 2, message: `Cannot pin the kit for the WSL handoff: ${kit.reason}. Use install.ps1, or a clean git clone of ${kitUpstream}.`, command: null };
  const wslArgv = ['-d', platform.wsl.target.name, '--exec', 'bash', '-l', '-c', setupHandoffScript, 'agent-kit-setup', kit.commit, ...passthrough];
  const command = powershellCommand(wslArgv);
  if (!flags.handoff) return { ...base, status: 'handoff-ready', exitCode: 0, commit: kit.commit, command, argv: wslArgv,
    message: `WSL2 distribution ${platform.wsl.target.name} is ready. Inside WSL, install Node.js, git and the GitHub CLI and sign in with gh auth login yourself. The guided setup then runs install.sh there (questions are asked inside WSL). Run this command, or rerun with --handoff:` };
  const result = (context.spawn || ((cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', windowsHide: false })))(platform.wsl.path, wslArgv);
  if (result.error) throw result.error;
  return { ...base, status: 'handed-off', exitCode: typeof result.status === 'number' ? result.status : 1, commit: kit.commit, command, argv: wslArgv,
    message: `Guided setup inside ${platform.wsl.target.name} exited with ${result.status}.` };
}
