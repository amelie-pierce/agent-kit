import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { findOnPath } from './platforms/macos.mjs';
import { applyPlugin, describePlugin, planPlugin } from './herdr-plugin.mjs';

// Keyboard shortcuts for a teammate's Firstmate: kit-owned launchers in <root>/.tools/bin (open-firstmate runs
// the kit's templates/shortcuts/open_firstmate.py, fm-mate runs `agent-kit mate`) with paths from the receipt,
// and one marker-fenced block of [[keys.command]] bindings in the person's Herdr config.toml. The block never
// replaces a key the person already bound (that key is skipped and reported), the file is backed up before
// every write and checked with the pinned `herdr config check`, and the receipt keeps the launcher and block
// digests so repair restores an unchanged block, upgrade refreshes it, and uninstall removes only the kit block.
export const launcherFile = 'bin/open-firstmate';
export const mateFile = 'bin/fm-mate';
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
export function shortcutInputs(receipt, root, env, recorded = null, kitPath = null) {
  const phase = id => receipt.phases?.[id]?.state === 'complete' && typeof receipt.phases[id].path === 'string' ? join(root, receipt.phases[id].path) : null;
  const harness = receipt.setup?.answers?.harness || 'codex';
  const python = recorded?.python && stat(recorded.python) ? recorded.python : onPath('python3', env);
  const codexTree = phase('npm-codex');
  const agents = {
    ...(harness !== 'codex' ? { claude: recorded?.agents?.claude && stat(recorded.agents.claude) ? recorded.agents.claude : onPath('claude', env) || 'claude' } : {}),
    ...(harness !== 'claude' && codexTree ? { codex: join(codexTree, 'node_modules', '.bin', 'codex') } : {}),
  };
  // The installed kit copy at its pinned commit (during an upgrade, the new copy), never a temporary checkout.
  const kit = kitPath || receipt.setup?.kit?.path, program = kit && stat(join(kit, programFile)) ? join(kit, programFile) : null;
  const node = recorded?.node && stat(recorded.node) ? recorded.node : process.execPath;
  const runtime = phase('zoe-fleet-runtime'), npm = phase('npm'), answers = receipt.setup?.answers || {};
  // The person's own Claude CLI, never the kit's telemetry wrapper in <root>/.tools/bin.
  const realClaude = harness === 'codex' ? null : recorded?.realClaude && stat(recorded.realClaude) ? recorded.realClaude
    : findOnPath('claude', env.PATH || '').find(path => dirname(path) !== join(root, 'bin')) || null;
  const firstmateHome = receipt.setup?.paths?.firstmateHome || receipt.phases?.firstmate?.path || null;
  return { herdr: phase('herdr'), python, node, kit, firstmateHome, agents, realClaude, mate: join(root, mateFile), graph: !!recorded?.plugin?.entrySha256,
    lock: join(root, '.open-firstmate.lock'), program, firstmate: join(root, 'bin', 'firstmate'),
    paths: { root: receipt.setup?.paths?.root || dirname(root), treehouseRoot: receipt.setup?.paths?.treehouseRoot || dirname(root), installRoot: root },
    tower: receipt.phases?.['zoe-fleet-tower'] && runtime ? { launcher: join(runtime, 'bin', 'zoe-fleet-tower'), runtime } : null,
    axi: npm ? { 'gh-axi': join(npm, 'node_modules', '.bin', 'gh-axi'), 'chrome-devtools-axi': join(npm, 'node_modules', '.bin', 'chrome-devtools-axi') } : null,
    fullAccess: harness !== 'claude' && answers.codexFullAccess !== false && !!codexTree };
}

export const launcherScript = inputs => `#!/bin/sh
# agent-kit:open-firstmate - opens the Firstmate coordinator (claude or codex) or the Mates tab, where fm-mate
# creates a second mate (mates), from a Herdr pane or key. Written by Agent Kit from its receipt; repair rewrites it.
OPEN_FIRSTMATE_HERDR=${quote(inputs.herdr)}
OPEN_FIRSTMATE_HOME=${quote(inputs.firstmateHome)}
OPEN_FIRSTMATE_CLAUDE=${quote(inputs.agents.claude ? inputs.firstmate : '')}
OPEN_FIRSTMATE_CODEX=${quote(inputs.agents.codex ? inputs.firstmate : '')}
OPEN_FIRSTMATE_MATE=${quote(inputs.mate)}
OPEN_FIRSTMATE_LOCK=${quote(inputs.lock)}
export OPEN_FIRSTMATE_HERDR OPEN_FIRSTMATE_HOME OPEN_FIRSTMATE_CLAUDE OPEN_FIRSTMATE_CODEX OPEN_FIRSTMATE_MATE OPEN_FIRSTMATE_LOCK
exec ${quote(inputs.python)} ${quote(inputs.program)} "$@"
`;
const header = (id, what) => `#!/bin/sh\n# agent-kit:${id} - ${what}\n# Written by Agent Kit from its receipt; agent-kit repair rewrites it and uninstall removes it.\n`;
// The kit's own environment for Firstmate sessions: names only, values from the receipt.
export const envScript = inputs => `# agent-kit:env - the paths this Agent Kit setup uses; sourced by the kit's firstmate launcher.
# Written by Agent Kit from its receipt; agent-kit repair rewrites it and uninstall removes it.
AGENTIC_ROOT=${quote(inputs.paths.root)}
FM_HOME=${quote(inputs.firstmateHome)}
FM_BACKEND=herdr
TREEHOUSE_ROOT=${quote(inputs.paths.treehouseRoot)}
export AGENTIC_ROOT FM_HOME FM_BACKEND TREEHOUSE_ROOT
`;
// The coordinator launcher: in a Herdr pane, in the Firstmate home, only while Firstmate's own session lock is
// free. Codex gets full access only when this person answered yes at setup.
export const firstmateScript = inputs => `#!/bin/bash
# agent-kit:firstmate - start the Firstmate coordinator (claude or codex) in a Herdr pane, or check the home.
# Written by Agent Kit from its receipt; agent-kit repair rewrites it and uninstall removes it.
set -eu
. ${quote(join(inputs.paths.installRoot, 'env.sh'))}
mode=\${1:-${inputs.agents.claude ? 'claude' : 'codex'}}
if [ "$#" -gt 0 ]; then shift; fi
case "$mode" in
  check) cd "$FM_HOME"; FM_BOOTSTRAP_DETECT_ONLY=1 exec bash bin/fm-bootstrap.sh ;;
  claude|codex) ;;
  *) echo 'Usage: firstmate [claude|codex|check]' >&2; exit 2 ;;
esac
if [ "\${HERDR_ENV:-}" != 1 ]; then
  echo 'Open a Herdr pane, then run firstmate (or press Ctrl+B, then F).' >&2
  exit 2
fi
cd "$FM_HOME"
lock_status=$(bash bin/fm-lock.sh status)
case "$lock_status" in
  'lock: free'|'lock: stale '*) ;;
  *) printf '%s\\n' "$lock_status" 'Exit the current coordinator cleanly before switching.' >&2; exit 3 ;;
esac
unset CLAUDECODE CODEX_THREAD_ID GROK_AGENT PI_CODING_AGENT FM_TASK_ID
case "$mode" in
  claude) ${inputs.agents.claude ? `exec ${quote(inputs.tower && inputs.realClaude ? join(inputs.paths.installRoot, 'bin', 'claude') : inputs.agents.claude)} "$@"` : `echo 'Claude is not set up by Agent Kit here.' >&2; exit 2`} ;;
  codex) ${inputs.agents.codex ? `exec ${quote(inputs.agents.codex)}${inputs.fullAccess ? ` --sandbox danger-full-access --ask-for-approval never --add-dir ${quote(inputs.paths.root)} --enable hooks` : ''} "$@"` : `echo 'Codex is not set up by Agent Kit here.' >&2; exit 2`} ;;
esac
`;
export const helpScript = inputs => `${header('fm-help', "print this Firstmate home's captain guide (data/captain-help.md), when the home keeps one.")}home=\${FM_HOME:-${quote(inputs.firstmateHome)}}
[ -f "$home/data/captain-help.md" ] || { echo "No captain guide yet at $home/data/captain-help.md; ask Firstmate to write one." >&2; exit 1; }
exec cat "$home/data/captain-help.md"
`;
// SessionStart gates: an axi tool's context only in sessions of this Firstmate home.
export const ambientScript = (inputs, id) => `${header(`ambient-${id}`, `run ${id}'s session hook only inside this Firstmate home.`)}[ "\${FM_HOME:-}" = ${quote(inputs.firstmateHome)} ] || exit 0
exec ${quote(inputs.axi[id])} "$@"
`;
export const towerShim = (inputs, command) => `${header(`zoe-fleet-${command}`, `the tower launcher's own ${command}, with the pinned Herdr.`)}HERDR_BIN_PATH=${quote(inputs.herdr)}
export HERDR_BIN_PATH
exec ${quote(inputs.tower.launcher)} ${command} "$@"
`;
// Opens the tower's Fleet tab once for the coordinator pane that just started; never rebinds a live coordinator.
export const autostartScript = inputs => `${header('zoe-fleet-autostart', 'open the Fleet tab once for the Firstmate coordinator in this Herdr pane (SessionStart hook).')}# Already open for this pane: nothing. Open for a pane that is gone: reopen here. Open for a live pane:
# nothing, so a second mate's session never takes Fleet from the primary. Liveness must be proved; an
# unreadable answer leaves the open view alone. A pane that is not focused is skipped, since Fleet binds the
# coordinator to the focused pane. The open runs in the background and logs to the kit state.
[ "\${HERDR_ENV:-}" = 1 ] || exit 0
PANE="\${HERDR_PANE_ID:-}"
[ -n "$PANE" ] || exit 0
HERDR=${quote(inputs.herdr)}
LOG=${quote(join(inputs.paths.installRoot, 'state', 'zoe-fleet', 'autostart.log'))}
mkdir -p "$(dirname "$LOG")"
(
  exec >>"$LOG" 2>&1
  echo "--- $(date '+%F %T') pane=$PANE"
  pid=$(pgrep -f ${quote(join(inputs.tower.runtime, 'scripts', 'firstmate-fleet.py'))} | head -1)
  if [ -n "$pid" ]; then
    current=$(ps -o command= -p "$pid" | sed -n 's/.*--captain \\([^ ]*\\).*/\\1/p')
    if [ "$current" = "$PANE" ]; then echo "fleet already open for this coordinator"; exit 0; fi
    if [ -z "$current" ]; then echo "fleet open but its coordinator pane could not be read; leaving it alone"; exit 0; fi
    probe=$("$HERDR" pane get "$current" 2>&1)
    case "$probe" in
      *pane_not_found*) echo "fleet open for gone captain '$current'; restarting" ;;
      *) echo "fleet open for live captain '$current'; leaving it alone"; exit 0 ;;
    esac
    kill -INT "$pid" 2>/dev/null
    i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 30 ]; do sleep 1; i=$((i+1)); done
  fi
  sleep 3
  if ! "$HERDR" pane get "$PANE" | grep -q '"focused":true'; then
    echo "coordinator pane not focused; skipped (run zoe-fleet-open from the coordinator tab)"; exit 0
  fi
  ${quote(join(inputs.paths.installRoot, 'bin', 'zoe-fleet-open'))} >/dev/null && echo "fleet opened"
  sleep 2; "$HERDR" agent focus "$PANE" >/dev/null 2>&1 || true
) </dev/null >/dev/null 2>&1 &
exit 0
`;
// The tower's Claude quota and status bridge in front of the person's own Claude CLI.
export const claudeScript = inputs => `${header('claude', "the tower's Claude telemetry bridge in front of your own Claude CLI.")}exec ${quote(inputs.python)} ${quote(join(inputs.tower.runtime, 'scripts', 'claude-telemetry.py'))} --launch ${quote(inputs.realClaude)} -- "$@"
`;
export const codexScript = inputs => `${header('codex', 'full-access Codex launch (answered yes at setup): full access, no approval prompts, worker hook trust bypassed.')}AGENT_KIT_REAL_CODEX=${quote(inputs.agents.codex)}
export AGENT_KIT_REAL_CODEX
exec ${quote(inputs.python)} ${quote(join(inputs.kit, 'templates', 'shortcuts', 'codex_launch.py'))} "$@"
`;
// Every file the kit renders into <root>/.tools for this setup, with the condition that wants it.
export function ownedFiles(inputs, root) {
  return [
    [launcherFile, launcherScript(inputs)], [mateFile, mateScript(inputs, root)], ['env.sh', envScript(inputs), 0o644],
    ['bin/firstmate', firstmateScript(inputs)], ['bin/fm-help', helpScript(inputs)],
    ...(inputs.axi ? ['gh-axi', 'chrome-devtools-axi'].map(id => [`bin/ambient-${id}`, ambientScript(inputs, id)]) : []),
    ...(inputs.tower ? [['bin/zoe-fleet-open', towerShim(inputs, 'open')], ['bin/zoe-fleet-demo', towerShim(inputs, 'demo')], ['bin/zoe-fleet-autostart', autostartScript(inputs)]] : []),
    ...(inputs.tower && inputs.realClaude ? [['bin/claude', claudeScript(inputs)]] : []),
    ...(inputs.fullAccess ? [['bin/codex', codexScript(inputs)]] : []),
  ].map(([file, body, mode = 0o755]) => ({ file, body, mode }));
}
export const mateScript = (inputs, root) => `#!/bin/sh
# agent-kit:fm-mate - create, list or retire a second mate with Firstmate's own secondmate commands.
# Written by Agent Kit from its receipt; repair rewrites it.
exec ${quote(inputs.node)} ${quote(join(inputs.kit, 'bin', 'agent-kit.mjs'))} mate --install-root ${quote(root)} "$@"
`;

// The kit's key data, one entry per key; changing a key is a one-line change here. prefix+f and prefix+shift+f
// open the Claude and Codex coordinators (only the CLIs set up here), prefix+shift+m creates a second mate in
// the Mates tab, and prefix+shift+c opens the Zoetrope session graph in a tab once the kit registered that
// plugin (its own setup-keys binds prefix+shift+z for the overlay). No plugin manager is part of the kit stack.
export const kitKeys = [
  { mode: 'claude', key: 'prefix+f', description: 'Firstmate: Claude coordinator', purpose: 'open the Claude coordinator' },
  { mode: 'codex', key: 'prefix+shift+f', description: 'Firstmate: Codex coordinator', purpose: 'open the Codex coordinator' },
  { mode: 'mates', key: 'prefix+shift+m', description: 'Firstmate: new second mate (Mates tab)', purpose: 'create a second mate in the Mates tab' },
  { mode: 'graph', key: 'prefix+shift+c', action: 'furkankly.zoetrope.open-tab', description: 'zoetrope: session graph (tab)', purpose: 'open the session graph in a tab' },
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
  const wanted = { claude: !!inputs.agents.claude, codex: !!inputs.agents.codex, mates: true, graph: inputs.graph };
  return keys.filter(entry => entry.key && wanted[entry.mode]).map(entry => ({ ...entry, command: entry.action || `${quote(launcher)} ${entry.mode}` }));
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
  const body = bindings.flatMap(b => ['[[keys.command]]', `key = ${tomlString(b.key)}`, `type = ${b.action ? '"plugin_action"' : '"popup"'}`, `command = ${tomlString(b.command)}`,
    `description = ${tomlString(b.description)}`, ...(b.action ? [] : ['width = "60%"', 'height = "40%"']), '']);
  return [keysBegin, '# Reload with prefix+shift+r (or restart Herdr) after a change. Keys you bind yourself win: the kit skips them.', '', ...body, keysEnd].join('\n');
}
const joinBlock = (rest, block) => {
  const head = rest.replace(/\n+$/, '');
  return block ? `${head ? `${head}\n\n` : ''}${block}\n` : head ? `${head}\n` : '';
};

// What setup, repair and upgrade would do, without writing. record is receipt.setup.shortcuts.
export function planShortcuts(receipt, root, { env = process.env, home = env.HOME, record = null, repair = false, kitPath = null } = {}) {
  const inputs = shortcutInputs(receipt, root, env, record, kitPath);
  const launcher = join(root, launcherFile), configPath = record?.keys?.path || herdrConfigPath(env, home);
  const missing = [!inputs.herdr && 'the pinned Herdr', !inputs.python && 'python3 on PATH', !inputs.firstmateHome && 'the Firstmate home',
    !Object.keys(inputs.agents).length && 'an agent CLI', !inputs.program && 'the installed kit source'].filter(Boolean);
  if (missing.length) return { action: 'skip', detail: `needs ${missing.join(', ')}`, keys: { path: configPath }, record };
  const owned = (file, body) => {
    const path = join(root, file), current = stat(path), recorded = record?.files?.[file];
    const action = !current ? 'write' : !plainFile(path) || !recorded ? 'conflict' : sha(readFileSync(path)) === sha(body) ? 'verify'
      : sha(readFileSync(path)) === recorded ? 'refresh' : repair ? 'replace' : 'keep';
    return { file, path, action, body };
  };
  const wanted = ownedFiles(inputs, root);
  const launchers = wanted.map(f => ({ ...owned(f.file, f.body), mode: f.mode }));
  // A file this setup no longer wants (for example after answering no to full access) goes while unchanged.
  for (const [file, digest] of Object.entries(record?.files || {})) if (!wanted.some(f => f.file === file)) {
    const path = join(root, file);
    launchers.push({ file, path, action: plainFile(path) && sha(readFileSync(path)) === digest ? 'retire' : 'forget' });
  }
  const plan = { action: 'apply', inputs, launchers, record };
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
  const record = { ...plan.record, python: plan.inputs.python, node: plan.inputs.node, agents: plan.inputs.agents, realClaude: plan.inputs.realClaude,
    fullAccess: plan.inputs.fullAccess, files: { ...plan.record?.files }, keys: plan.record?.keys || null };
  for (const l of plan.launchers) {
    if (['retire', 'forget'].includes(l.action)) {
      if (l.action === 'retire') await rm(l.path, { force: true });
      delete record.files[l.file];
      continue;
    }
    if (['write', 'refresh', 'replace'].includes(l.action)) {
      if (l.action === 'replace') await backup(root, l.path, l.file.split('/').pop());
      await mkdir(dirname(l.path), { recursive: true, mode: 0o700 });
      const temp = `${l.path}.${randomUUID()}.tmp`;
      await writeFile(temp, l.body, { mode: l.mode ?? 0o755, flag: 'wx' });
      await chmod(temp, l.mode ?? 0o755);
      await rename(temp, l.path);
    }
    if (!['conflict', 'keep'].includes(l.action)) record.files[l.file] = sha(l.body);
  }
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
export function planRemoveShortcuts(root, record, firstmateHome = null) {
  if (!record) return null;
  const autostart = record.autostart && firstmateHome ? planAutostart({ firstmateHome, tower: null }, root, { record }) : null;
  const launchers = Object.entries(record.files || {}).map(([file, digest]) => {
    const path = join(root, file);
    return { path, action: plainFile(path) && sha(readFileSync(path)) === digest ? 'remove unchanged kit launcher' : 'keep changed or absent launcher' };
  });
  const path = record.keys?.path;
  if (!path) return { launchers, keys: null, autostart };
  const { block, rest } = plainFile(path) ? splitBlock(readFileSync(path, 'utf8')) : {};
  const keysAction = block && sha(block) === record.keys.blockSha256 ? 'remove the unchanged agent-kit keys block' : 'keep changed or absent keys block';
  return { launchers, keys: { path, action: keysAction, rest, created: !!record.keys.created }, autostart };
}
export async function removeShortcuts(root, plan) {
  if (!plan) return;
  for (const l of plan.launchers) if (l.action === 'remove unchanged kit launcher') await rm(l.path, { force: true });
  if (plan.autostart?.action === 'remove') await applyAutostart(plan.autostart, root);
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
  for (const l of result.launchers) {
    const name = l.file.split('/').pop();
    if (l.action === 'retire' || l.action === 'forget') { lines.push(`${name}: ${l.action === 'retire' ? 'removed (no longer selected)' : 'left as you changed it; no longer tracked'} at ${l.path}`); continue; }
    lines.push(l.action === 'conflict' ? `${name}: ${l.path} exists and is not the kit's; left unchanged`
      : l.action === 'keep' ? `${name}: kept your changed ${l.path}` : `${name}: ${l.action === 'verify' ? 'verified' : 'written'} at ${l.path}`);
  }
  const k = result.keys;
  const keys = k.bound?.length ? k.bound.join(', ') : 'none';
  lines.push(k.action === 'skip' || k.action === 'keep' ? `Herdr keys: ${k.detail}`
    : `Herdr keys (${k.path}): ${k.action === 'none' ? 'no kit keys to add' : `${k.action === 'verify' ? 'kept' : 'bound'} ${keys}`}${k.detail ? `; ${k.detail}` : ''}${['add', 'refresh'].includes(k.action) ? '; reload Herdr with prefix+shift+r' : ''}`);
  return lines;
}

// Everything the kit adds around Herdr, in order: the Zoetrope session-graph plugin (so its key is known), then
// the launchers and the kit keys block. Setup step 4, repair and the new kit's applyUpdate all run this, so a
// normal install and an upgrade from an earlier release place the same pieces. kitPath names the installed kit
// copy when the receipt does not yet (during an upgrade). Returns the record for receipt.setup.shortcuts.
export async function placeKitExtras(receipt, root, { env = process.env, home = env.HOME, repair = false, kitPath = null, check, isRunning } = {}) {
  if (receipt.setup?.answers?.globalHooks === false) return { action: 'not-selected', lines: [], record: receipt.setup?.shortcuts || null };
  const prior = receipt.setup?.shortcuts || null, configPath = prior?.keys?.path || herdrConfigPath(env, home);
  const plugin = await applyPlugin(planPlugin(receipt, root, { env, home, configPath, record: prior?.plugin || null, repair, isRunning }), { env });
  const record = { ...prior, plugin: plugin.action === 'apply' ? plugin.record : prior?.plugin || null };
  const result = await applyShortcuts(planShortcuts(receipt, root, { env, home, record, repair, kitPath }), root, { env, ...(check ? { check } : {}) });
  const lines = [...describeShortcuts(result), ...describePlugin(plugin)];
  if (result.action === 'skip') return { action: result.action, detail: result.detail, keys: result.keys, lines, record };
  const autostartPlan = planAutostart(result.inputs, root, { record: prior, repair });
  const autostart = await applyAutostart(autostartPlan, root);
  if (autostartPlan.action !== 'none') lines.push(autostartPlan.action === 'skip' || autostartPlan.action === 'keep' ? `Fleet autostart hook: ${autostartPlan.detail}`
    : `Fleet autostart hook (${autostartPlan.path}): ${{ add: 'added', refresh: 'refreshed', verify: 'present', remove: 'removed' }[autostartPlan.action]}`);
  return { action: result.action, detail: result.detail, keys: result.keys, lines,
    record: { ...result.record, plugin: record.plugin, autostart: autostartPlan.action === 'skip' ? prior?.autostart || null : autostart } };
}

// The tower's Fleet autostart, as the owner runs it: a marker-owned SessionStart entry in the Firstmate home's
// local Claude settings (.claude/settings.local.json). Firstmate does not ignore that file, so the kit also adds
// it to the home's own .git/info/exclude (marker-owned), keeping the home's Git state clean.
export const autostartMarker = ' # agent-kit:zoe-fleet-autostart';
const excludeLines = ['# agent-kit:settings-local - Agent Kit keeps its Fleet autostart hook here', '/.claude/settings.local.json'];
const autostartCommand = path => `[ -x ${quote(path)} ] && ${quote(path)}; exit 0${autostartMarker}`;
const ownedGroup = group => Array.isArray(group?.hooks) && group.hooks.some(h => typeof h?.command === 'string' && h.command.endsWith(autostartMarker));
export function planAutostart(inputs, root, { record = null, repair = false } = {}) {
  if (!inputs.firstmateHome) return { action: 'none' };
  const path = join(inputs.firstmateHome, '.claude', 'settings.local.json'), exclude = join(inputs.firstmateHome, '.git', 'info', 'exclude');
  const want = !!inputs.tower;
  if (stat(path) && !plainFile(path)) return { action: 'skip', path, detail: `${path} is not a plain file` };
  let settings = {};
  try { settings = stat(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; } catch { return { action: 'skip', path, detail: `${path} is not valid JSON; left as it is` }; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { action: 'skip', path, detail: `${path} is not a settings object` };
  const groups = Array.isArray(settings.hooks?.SessionStart) ? settings.hooks.SessionStart : [];
  const present = groups.some(ownedGroup), desired = { hooks: [{ type: 'command', command: autostartCommand(join(root, 'bin', 'zoe-fleet-autostart')), timeout: 10 }] };
  const current = groups.find(ownedGroup);
  let action = !want ? (present ? 'remove' : 'none') : !present ? (record?.autostart && !repair ? 'keep' : 'add') : JSON.stringify(current) === JSON.stringify(desired) ? 'verify' : 'refresh';
  const next = structuredClone(settings);
  if (['add', 'refresh', 'remove'].includes(action)) {
    const kept = groups.filter(g => !ownedGroup(g));
    next.hooks = { ...(settings.hooks || {}), SessionStart: action === 'remove' ? kept : [...kept, desired] };
    if (!next.hooks.SessionStart.length) delete next.hooks.SessionStart;
    if (!Object.keys(next.hooks).length) delete next.hooks;
  }
  const excludeText = stat(exclude) && plainFile(exclude) ? readFileSync(exclude, 'utf8') : null;
  return { action, path, exclude, excludeText, settings: next, created: !stat(path) || !!record?.autostart?.created, empty: !Object.keys(next).length,
    detail: action === 'keep' ? 'the Fleet autostart hook was removed; not added again (agent-kit repair restores it)' : null };
}
export async function applyAutostart(plan, root) {
  if (['none', 'skip', 'keep'].includes(plan.action)) return plan.action === 'keep' ? { autostart: true } : null;
  if (plan.action !== 'verify') {
    if (stat(plan.path)) await backup(root, plan.path, 'settings.local.json');
    if (plan.action === 'remove' && plan.empty && plan.created) await rm(plan.path, { force: true });
    else {
      await mkdir(dirname(plan.path), { recursive: true });
      const temp = `${plan.path}.agent-kit-${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(plan.settings, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
      await rename(temp, plan.path);
    }
  }
  let excludeAdded = false;
  if (plan.action !== 'remove' && plan.excludeText !== null && !plan.excludeText.split('\n').includes(excludeLines[1])) {
    await writeFile(plan.exclude, `${plan.excludeText.replace(/\n*$/, '\n')}${excludeLines.join('\n')}\n`);
    excludeAdded = true;
  }
  if (plan.action === 'remove') {
    if (plan.excludeText?.includes(excludeLines[0])) await writeFile(plan.exclude, plan.excludeText.split('\n').filter(line => !excludeLines.includes(line)).join('\n'));
    return null;
  }
  return { autostart: true, created: plan.created, excludeAdded: excludeAdded || undefined };
}
