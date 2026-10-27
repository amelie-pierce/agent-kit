import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { findOnPath } from './platforms/macos.mjs';

// Keyboard shortcuts for a teammate's Firstmate: a kit-owned <root>/.tools/bin/open-firstmate launcher that
// runs the kit's templates/shortcuts/open_firstmate.py with paths from the receipt, and one marker-fenced
// block of [[keys.command]] bindings in the person's Herdr config.toml. The block never replaces a key the
// person already bound (that key is skipped and reported), the file is backed up before every write and
// checked with the pinned `herdr config check`, and the receipt keeps the launcher and block digests so
// repair restores an unchanged block, upgrade refreshes it, and uninstall removes only the kit block.
// The pinned tower launcher (zoe-fleet-tower setup|doctor|open|inspect|demo) has no keys command, so the
// tower gets its key here, as `open-firstmate mates` running the launcher's own `open`.
export const launcherFile = 'bin/open-firstmate';
export const keysBegin = '# >>> agent-kit keys (managed: agent-kit setup and upgrade write this block, uninstall removes it)';
export const keysEnd = '# <<< agent-kit keys';
export const programFile = join('templates', 'shortcuts', 'open_firstmate.py');
const sha = data => createHash('sha256').update(data).digest('hex');
const stat = path => lstatSync(path, { throwIfNoEntry: false });
const plainFile = path => { const s = stat(path); return !!s && s.isFile() && !s.isSymbolicLink() && s.nlink === 1; };
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const tomlString = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

// Herdr reads HERDR_CONFIG_PATH, then $XDG_CONFIG_HOME/herdr/config.toml, then ~/.config/herdr/config.toml.
export function herdrConfigPath(env, home) {
  if (env.HERDR_CONFIG_PATH && isAbsolute(env.HERDR_CONFIG_PATH)) return env.HERDR_CONFIG_PATH;
  return join(env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config'), 'herdr', 'config.toml');
}
const onPath = (name, env) => findOnPath(name, env.PATH || '')[0] || null;

// What the launcher runs, all from the receipt: the pinned Herdr, the Firstmate home, the chosen agent CLIs
// (the kit's Codex; Claude as found on PATH), the configured tower launcher, and python3.
export function shortcutInputs(receipt, root, env, recorded = null) {
  const phase = id => receipt.phases?.[id]?.state === 'complete' && typeof receipt.phases[id].path === 'string' ? join(root, receipt.phases[id].path) : null;
  const harness = receipt.setup?.answers?.harness || 'codex';
  const python = recorded?.python && stat(recorded.python) ? recorded.python : onPath('python3', env);
  const codexTree = phase('npm-codex');
  const agents = {
    ...(harness !== 'codex' ? { claude: recorded?.agents?.claude && stat(recorded.agents.claude) ? recorded.agents.claude : onPath('claude', env) || 'claude' } : {}),
    ...(harness !== 'claude' && codexTree ? { codex: join(codexTree, 'node_modules', '.bin', 'codex') } : {}),
  };
  const runtime = phase('zoe-fleet-runtime');
  const tower = receipt.phases?.['zoe-fleet-tower'] && runtime ? join(runtime, 'bin', 'zoe-fleet-tower') : null;
  // The installed kit copy at its pinned commit, never the temporary checkout setup runs from.
  const kit = receipt.setup?.kit?.path, program = kit && stat(join(kit, programFile)) ? join(kit, programFile) : null;
  return { herdr: phase('herdr'), python, firstmateHome: receipt.setup?.paths?.firstmateHome || receipt.phases?.firstmate?.path || null, agents, tower,
    lock: join(root, '.open-firstmate.lock'), program };
}

export const launcherScript = inputs => `#!/bin/sh
# agent-kit:open-firstmate - opens the Firstmate coordinator (claude or codex) or the tower Team tab (mates)
# from a Herdr pane or key. Written by Agent Kit from its receipt; agent-kit repair rewrites it.
OPEN_FIRSTMATE_HERDR=${quote(inputs.herdr)}
OPEN_FIRSTMATE_HOME=${quote(inputs.firstmateHome)}
OPEN_FIRSTMATE_CLAUDE=${quote(inputs.agents.claude || '')}
OPEN_FIRSTMATE_CODEX=${quote(inputs.agents.codex || '')}
OPEN_FIRSTMATE_TOWER=${quote(inputs.tower || '')}
OPEN_FIRSTMATE_LOCK=${quote(inputs.lock)}
export OPEN_FIRSTMATE_HERDR OPEN_FIRSTMATE_HOME OPEN_FIRSTMATE_CLAUDE OPEN_FIRSTMATE_CODEX OPEN_FIRSTMATE_TOWER OPEN_FIRSTMATE_LOCK
exec ${quote(inputs.python)} ${quote(inputs.program)} "$@"
`;

// The kit's key data, one entry per launcher mode; changing a key is a one-line change here.
// prefix+f and prefix+shift+f open the Claude and Codex coordinators (only the CLIs set up here), and the
// mates key, once chosen, opens the tower Team tab (only with the tower; `open-firstmate mates` works without a key). No plugin manager is part of the kit stack, so
// the kit binds nothing for one.
export const kitKeys = [
  { mode: 'claude', key: 'prefix+f', description: 'Firstmate: Claude coordinator', purpose: 'open the Claude coordinator' },
  { mode: 'codex', key: 'prefix+shift+f', description: 'Firstmate: Codex coordinator', purpose: 'open the Codex coordinator' },
  { mode: 'mates', key: 'prefix+shift+m', description: 'Firstmate: second mates (tower Team tab)', purpose: 'open the tower Team tab for your second mates' },
];
// Herdr 0.9.3's own prefix bindings (`herdr --default-config`). A kit key on one of them overrides that
// action unless the person moved the action to another key; the plan reports every such override.
export const herdrDefaults = {
  help: 'prefix+?', settings: 'prefix+s', detach: 'prefix+q', reload_config: 'prefix+shift+r', open_notification_target: 'prefix+o', workspace_picker: 'prefix+w',
  goto: 'prefix+g', new_workspace: 'prefix+shift+n', new_worktree: 'prefix+shift+g', rename_workspace: 'prefix+shift+w', close_workspace: 'prefix+shift+d',
  new_tab: 'prefix+c', rename_tab: 'prefix+shift+t', previous_tab: 'prefix+p', next_tab: 'prefix+n', switch_tab: 'prefix+1..9', close_tab: 'prefix+shift+x',
  rename_pane: 'prefix+shift+p', edit_scrollback: 'prefix+e', focus_pane_left: 'prefix+h', focus_pane_down: 'prefix+j', focus_pane_up: 'prefix+k',
  focus_pane_right: 'prefix+l', cycle_pane_next: 'prefix+tab', cycle_pane_previous: 'prefix+shift+tab', split_vertical: 'prefix+v', split_horizontal: 'prefix+minus',
  close_pane: 'prefix+x', zoom: 'prefix+z', resize_mode: 'prefix+r', toggle_sidebar: 'prefix+b',
};
const shown = (key, rest) => /^\s*prefix\s*=/m.test(rest) ? key : key.replace(/^prefix\+/, 'Ctrl+B ').replace(/^(Ctrl\+B )shift\+([a-z])$/, (_, p, c) => `${p}Shift+${c.toUpperCase()}`);
export function overrideNote(entry, action, rest = '') {
  return `${shown(entry.key, rest)} will ${entry.purpose} instead of Herdr's ${action.replaceAll('_', '-')}`;
}
// For the summary screen: per kit key, whether it is skipped (the person bound it) or replaces a Herdr default.
export function previewKeys(configPath, entries) {
  const text = plainFile(configPath) ? readFileSync(configPath, 'utf8') : '';
  const { rest } = splitBlock(text), taken = boundKeys(rest), defaults = defaultsInEffect(rest);
  return entries.flatMap(entry => taken.has(entry.key) ? [`${entry.key} is already bound in ${configPath}; the kit skips it`]
    : defaults.filter(d => d.key === entry.key).map(d => overrideNote(entry, d.action, rest)));
}
export function keyBindings(inputs, launcher, keys = kitKeys) {
  const wanted = { claude: !!inputs.agents.claude, codex: !!inputs.agents.codex, mates: !!inputs.tower };
  return keys.filter(entry => entry.key && wanted[entry.mode]).map(entry => ({ ...entry, command: `${quote(launcher)} ${entry.mode}` }));
}
// Herdr default actions still on their default key: an action the person set in their config is no longer there.
export function defaultsInEffect(rest) {
  const set = new Set([...rest.matchAll(/^\s*([a-z_]+)\s*=/gm)].map(match => match[1]));
  return Object.entries(herdrDefaults).filter(([action]) => !set.has(action)).map(([action, key]) => ({ action, key }));
}

// The file split around the kit block: what is outside it, and the block lines when exactly one well-formed block exists.
export function splitBlock(text) {
  const lines = text.split('\n'), begin = lines.indexOf(keysBegin), end = lines.indexOf(keysEnd);
  if (begin === -1 && end === -1) return { rest: text, block: null };
  if (begin === -1 || end < begin || lines.lastIndexOf(keysBegin) !== begin || lines.lastIndexOf(keysEnd) !== end) return { rest: text, block: null, malformed: true };
  return { rest: [...lines.slice(0, begin), ...lines.slice(end + 1)].join('\n'), block: lines.slice(begin, end + 1).join('\n') };
}
// Keys the person already bound anywhere outside the kit block, as quoted values on non-comment lines.
export function boundKeys(rest) {
  const keys = new Set();
  for (const line of rest.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) keys.add((match[1] ?? match[2]).trim().toLowerCase());
  }
  return keys;
}
export function renderBlock(bindings) {
  const body = bindings.flatMap(b => ['[[keys.command]]', `key = ${tomlString(b.key)}`, 'type = "popup"', `command = ${tomlString(b.command)}`,
    `description = ${tomlString(b.description)}`, 'width = "60%"', 'height = "40%"', '']);
  return [keysBegin, '# Reload with prefix+shift+r (or restart Herdr) after a change. Keys you bind yourself win: the kit skips them.', '', ...body, keysEnd].join('\n');
}
const joinBlock = (rest, block) => {
  const head = rest.replace(/\n+$/, '');
  return block ? `${head ? `${head}\n\n` : ''}${block}\n` : head ? `${head}\n` : '';
};

// What setup, repair and upgrade would do, without writing. record is receipt.setup.shortcuts.
export function planShortcuts(receipt, root, { env = process.env, home = env.HOME, record = null, repair = false } = {}) {
  const inputs = shortcutInputs(receipt, root, env, record);
  const launcher = join(root, launcherFile), configPath = record?.keys?.path || herdrConfigPath(env, home);
  const missing = [!inputs.herdr && 'the pinned Herdr', !inputs.python && 'python3 on PATH', !inputs.firstmateHome && 'the Firstmate home',
    !Object.keys(inputs.agents).length && 'an agent CLI', !inputs.program && 'the installed kit source'].filter(Boolean);
  if (missing.length) return { action: 'skip', detail: `needs ${missing.join(', ')}`, launcher: { path: launcher }, keys: { path: configPath }, record };
  const body = launcherScript(inputs), current = stat(launcher);
  const launcherAction = !current ? 'write'
    : !plainFile(launcher) || !record?.launcherSha256 ? 'conflict'
      : sha(readFileSync(launcher)) === sha(body) ? 'verify'
        : sha(readFileSync(launcher)) === record.launcherSha256 ? 'refresh' : repair ? 'replace' : 'keep';
  const plan = { action: 'apply', inputs, launcher: { path: launcher, action: launcherAction, body }, record };
  const bindings = keyBindings(inputs, launcher);
  const file = stat(configPath);
  if (file && !plainFile(configPath)) return { ...plan, keys: { path: configPath, action: 'skip', detail: `${configPath} is not a plain file` } };
  const text = file ? readFileSync(configPath, 'utf8') : '';
  const { rest, block, malformed } = splitBlock(text);
  if (malformed) return { ...plan, keys: { path: configPath, action: 'skip', detail: 'the agent-kit keys markers are incomplete or repeated; fix them by hand' } };
  if (block && (!record?.keys?.blockSha256 || sha(block) !== record.keys.blockSha256))
    return { ...plan, keys: { path: configPath, action: 'keep', detail: 'the agent-kit keys block was edited; left as it is and no longer tracked' } };
  if (!block && record?.keys?.blockSha256 && !repair)
    return { ...plan, keys: { path: configPath, action: 'keep', release: false, detail: 'the agent-kit keys block was removed; not added again (agent-kit repair restores it)' } };
  const taken = boundKeys(rest), bound = bindings.filter(b => !taken.has(b.key)), skipped = bindings.filter(b => taken.has(b.key)).map(b => b.key);
  const defaults = defaultsInEffect(rest), overrides = bound.flatMap(b => defaults.filter(d => d.key === b.key).map(d => overrideNote(b, d.action, rest)));
  const nextBlock = bound.length ? renderBlock(bound) : null, next = joinBlock(rest, nextBlock);
  const keys = { path: configPath, bound: bound.map(b => b.key), skipped, block: nextBlock, body: next, prior: file ? sha(text) : null, created: !file || !!record?.keys?.created,
    action: next === text ? (block ? 'verify' : 'none') : block ? 'refresh' : bound.length ? 'add' : 'none',
    overrides, ...(skipped.length || overrides.length ? { detail: [skipped.length ? `skipped ${skipped.join(', ')}: already bound in ${configPath}` : null, ...overrides].filter(Boolean).join('; ') } : {}) };
  return { ...plan, keys };
}

// Writes the planned launcher and block. The config is backed up under the kit root first, replaced
// atomically, and restored when the pinned `herdr config check` rejects the result.
export async function applyShortcuts(plan, root, { env = process.env, check = herdrCheck } = {}) {
  if (plan.action === 'skip') return { ...plan, record: plan.record };
  const record = { python: plan.inputs.python, agents: plan.inputs.agents, launcherSha256: plan.record?.launcherSha256 || null, keys: plan.record?.keys || null };
  const l = plan.launcher;
  if (['write', 'refresh', 'replace'].includes(l.action)) {
    if (l.action === 'replace') await backup(root, l.path, 'open-firstmate');
    await mkdir(dirname(l.path), { recursive: true, mode: 0o700 });
    const temp = `${l.path}.${randomUUID()}.tmp`;
    await writeFile(temp, l.body, { mode: 0o755, flag: 'wx' });
    await chmod(temp, 0o755);
    await rename(temp, l.path);
  }
  if (!['conflict', 'keep'].includes(l.action)) record.launcherSha256 = sha(l.body);
  const k = plan.keys;
  if (k.action === 'keep' && k.release !== false) record.keys = null;
  if (['add', 'refresh'].includes(k.action)) {
    const now = stat(k.path) ? sha(readFileSync(k.path)) : null;
    if (now !== k.prior) return { ...plan, keys: { ...k, action: 'skip', detail: `${k.path} changed while updating; left as it is` }, record };
    const saved = now ? await backup(root, k.path, 'herdr-config.toml') : null;
    await mkdir(dirname(k.path), { recursive: true });
    const temp = `${k.path}.agent-kit-${randomUUID()}.tmp`;
    await writeFile(temp, k.body, { mode: now ? lstatSync(k.path).mode & 0o777 : 0o644, flag: 'wx' });
    await rename(temp, k.path);
    const result = check(plan.inputs.herdr, k.path, env);
    if (!result.ok) {
      if (saved) await writeFile(k.path, readFileSync(saved)); else await rm(k.path, { force: true });
      return { ...plan, keys: { ...k, action: 'skip', detail: `herdr config check rejected the kit keys, so ${k.path} was restored: ${result.detail}` }, record };
    }
    record.keys = { path: k.path, blockSha256: sha(k.block), bound: k.bound, skipped: k.skipped, created: k.created };
  } else if (k.action === 'verify') record.keys = { ...record.keys, path: k.path, blockSha256: sha(k.block), bound: k.bound, skipped: k.skipped };
  return { ...plan, record };
}

export function herdrCheck(herdr, path, env) {
  const r = spawnSync(herdr, ['config', 'check'], { env: { PATH: env.PATH || '', HOME: env.HOME || '', HERDR_CONFIG_PATH: path }, encoding: 'utf8', timeout: 30000 });
  return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').trim().split('\n').pop() || `exit ${r.status}` };
}

async function backup(root, path, name) {
  const dir = join(root, 'backups', 'shortcuts');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const destination = join(dir, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}-${name}`);
  await writeFile(destination, readFileSync(path), { mode: 0o600, flag: 'wx' });
  return destination;
}

// Uninstall: the launcher only while unchanged, and the kit block only while unchanged (the rest of the
// file stays; a file the kit created and that holds nothing else is removed).
export function planRemoveShortcuts(root, record) {
  if (!record) return null;
  const launcher = join(root, launcherFile);
  const launcherAction = plainFile(launcher) && record.launcherSha256 && sha(readFileSync(launcher)) === record.launcherSha256 ? 'remove unchanged kit launcher' : 'keep changed or absent launcher';
  const path = record.keys?.path;
  if (!path) return { launcher: { path: launcher, action: launcherAction }, keys: null };
  const { block, rest } = plainFile(path) ? splitBlock(readFileSync(path, 'utf8')) : {};
  const keysAction = block && sha(block) === record.keys.blockSha256 ? 'remove the unchanged agent-kit keys block' : 'keep changed or absent keys block';
  return { launcher: { path: launcher, action: launcherAction }, keys: { path, action: keysAction, rest, created: !!record.keys.created } };
}
export async function removeShortcuts(root, plan) {
  if (!plan) return;
  if (plan.launcher.action === 'remove unchanged kit launcher') await rm(plan.launcher.path, { force: true });
  if (plan.keys?.action === 'remove the unchanged agent-kit keys block') {
    await backup(root, plan.keys.path, 'herdr-config.toml');
    const next = joinBlock(plan.keys.rest, null);
    if (!next && plan.keys.created) await rm(plan.keys.path, { force: true });
    else await writeFile(plan.keys.path, next);
  }
}

export function describeShortcuts(result) {
  if (result.action === 'skip') return [`Herdr shortcuts: not set up; ${result.detail}`];
  const lines = [];
  const l = result.launcher;
  lines.push(l.action === 'conflict' ? `open-firstmate: ${l.path} exists and is not the kit's; left unchanged`
    : l.action === 'keep' ? `open-firstmate: kept your changed ${l.path}` : `open-firstmate: ${l.action === 'verify' ? 'verified' : 'written'} at ${l.path}`);
  const k = result.keys;
  const keys = k.bound?.length ? k.bound.join(', ') : 'none';
  lines.push(k.action === 'skip' || k.action === 'keep' ? `Herdr keys: ${k.detail}`
    : `Herdr keys (${k.path}): ${k.action === 'none' ? 'no kit keys to add' : `${k.action === 'verify' ? 'kept' : 'bound'} ${keys}`}${k.detail ? `; ${k.detail}` : ''}${['add', 'refresh'].includes(k.action) ? '; reload Herdr with prefix+shift+r' : ''}`);
  return lines;
}
