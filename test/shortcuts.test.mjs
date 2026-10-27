import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyShortcuts, describeShortcuts, herdrConfigPath, keysBegin, keysEnd, kitKeys, launcherScript, planRemoveShortcuts, planShortcuts, previewKeys, removeShortcuts, splitBlock } from '../src/shortcuts.mjs';
import { applyUninstall, planUninstall } from '../src/lifecycle.mjs';

const kit = fileURLToPath(new URL('..', import.meta.url));
const sha = body => createHash('sha256').update(body).digest('hex');
const posixOnly = { skip: process.platform === 'win32' };
const python = spawnSync('/bin/sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
const ok = () => ({ ok: true, detail: '' });

// A kit root as setup leaves it: Herdr, Codex and the tower runtime recorded in the receipt, the kit copy at
// this checkout, a temp HOME and PATH that holds python3 and a claude stub.
function fixture(t, { harness = 'both', tower = true, config = null } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-shortcuts-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), root = join(base, 'Agentic', '.tools'), firstmate = join(base, 'Agentic', 'firstmate'), bin = join(base, 'bin');
  for (const dir of [home, bin, firstmate, join(root, 'releases', 'r', 'bin'), join(root, 'releases', 'r', 'npm-codex', 'node_modules', '.bin'), join(root, 'releases', 'r', 'zoe-fleet-runtime', 'bin')])
    mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'releases', 'r', 'bin', 'herdr'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(bin, 'python3'), `#!/bin/sh\nexec '${python}' "$@"\n`, { mode: 0o755 });
  const configPath = join(home, '.config', 'herdr', 'config.toml');
  if (config !== null) { mkdirSync(dirname(configPath), { recursive: true }); writeFileSync(configPath, config); }
  const receipt = { schemaVersion: 1, release: 'r', phases: {
    herdr: { state: 'complete', path: 'releases/r/bin/herdr' }, 'npm-codex': { state: 'complete', path: 'releases/r/npm-codex' },
    ...(tower ? { 'zoe-fleet-runtime': { state: 'complete', path: 'releases/r/zoe-fleet-runtime' }, 'zoe-fleet-tower': { state: 'complete', path: join(home, '.config', 'zoe-fleet', 'config') } } : {}),
    firstmate: { state: 'complete', path: firstmate } },
  setup: { answers: { harness, globalHooks: true, tower }, paths: { firstmateHome: firstmate, installRoot: root }, kit: { commit: 'fixture', path: kit } } };
  writeFileSync(join(root, 'receipt.json'), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
  const readReceipt = () => JSON.parse(readFileSync(join(root, 'receipt.json'), 'utf8'));
  const run = async (options = {}) => {
    const r = readReceipt();
    const result = await applyShortcuts(planShortcuts(r, root, { env, home, record: r.setup.shortcuts || null, ...options }), root, { env, check: options.check || ok });
    if (result.action !== 'skip') assert.equal(result.record.node, process.execPath);
    const next = readReceipt(); if (result.action !== 'skip') next.setup.shortcuts = result.record; writeFileSync(join(root, 'receipt.json'), `${JSON.stringify(next)}\n`, { mode: 0o600 });
    return result;
  };
  return { base, home, root, firstmate, configPath, env, readReceipt, run, launcher: join(root, 'bin', 'open-firstmate'), mate: join(root, 'bin', 'fm-mate') };
}

test('the keys block binds only free keys, keeps your own bindings and is fenced by agent-kit markers', posixOnly, async t => {
  const mine = '[keys]\nprefix = "ctrl+b"\n\n# my own key, kept\n[[keys.command]]\nkey = "prefix+f"\ntype = "shell"\ncommand = "lazygit"\n';
  const f = fixture(t, { config: mine });
  const result = await f.run();
  assert.deepEqual(result.keys.bound, ['prefix+shift+f', 'prefix+shift+m']);
  assert.deepEqual(result.keys.skipped, ['prefix+f'], 'a key you bound yourself is skipped');
  const text = readFileSync(f.configPath, 'utf8');
  assert.ok(text.startsWith(mine), 'everything you wrote stays first and unchanged');
  const { block, rest } = splitBlock(text);
  assert.equal(rest.trimEnd(), mine.trimEnd());
  assert.ok(block.startsWith(keysBegin) && block.endsWith(keysEnd));
  assert.match(block, /key = "prefix\+shift\+f"\ntype = "popup"\ncommand = "'[^']+\/open-firstmate' codex"/);
  assert.match(block, /key = "prefix\+shift\+m"\ntype = "popup"\ncommand = "'[^']+\/open-firstmate' mates"/);
  assert.doesNotMatch(block, /prefix\+shift\+c/, 'no graph key until the kit registered the session-graph plugin');
  assert.doesNotMatch(block, /prefix\+n"|key = "prefix\+f"/);
  assert.equal(f.readReceipt().setup.shortcuts.keys.blockSha256, sha(block));
  assert.match(describeShortcuts(result).join('\n'), /bound prefix\+shift\+f, prefix\+shift\+m; skipped prefix\+f: already bound in .*; reload Herdr with prefix\+shift\+r/);
  // The file was backed up under the kit root before the write.
  const backups = readdirSync(join(f.root, 'backups', 'shortcuts'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(f.root, 'backups', 'shortcuts', backups[0]), 'utf8'), mine);

  // A rerun finds nothing to change and never duplicates the block.
  const again = await f.run();
  assert.equal(again.keys.action, 'verify');
  assert.equal(readFileSync(f.configPath, 'utf8'), text);
  assert.equal(text.split(keysBegin).length, 2);
});

test('pieces identical to what the kit writes are adopted without a receipt record, and differing ones stay the person\'s', posixOnly, async t => {
  const f = fixture(t);
  const first = await f.run();
  const text = readFileSync(f.configPath, 'utf8'), block = splitBlock(text).block, files = first.record.files;
  // A rolled-back upgrade leaves the pieces in place but drops their record.
  const forget = () => { const r = f.readReceipt(); delete r.setup.shortcuts; writeFileSync(join(f.root, 'receipt.json'), `${JSON.stringify(r)}\n`, { mode: 0o600 }); };
  forget();
  const adopted = await f.run();
  assert.ok(adopted.launchers.every(l => l.action === 'verify'), JSON.stringify(adopted.launchers.map(l => [l.file, l.action])));
  assert.deepEqual(adopted.record.files, files);
  assert.equal(adopted.keys.action, 'verify');
  assert.equal(adopted.record.keys.blockSha256, sha(block));
  assert.equal(readFileSync(f.configPath, 'utf8'), text);
  // Differing pieces are kept as they are and not recorded.
  writeFileSync(f.launcher, '#!/bin/sh\necho mine\n', { mode: 0o755 });
  writeFileSync(f.configPath, text.replace('Firstmate: new second mate', 'my mates'));
  forget();
  const kept = await f.run();
  assert.equal(kept.launchers.find(l => l.file === 'bin/open-firstmate').action, 'conflict');
  assert.equal('bin/open-firstmate' in kept.record.files, false);
  assert.equal(kept.keys.action, 'keep');
  assert.equal(kept.record.keys, null);
  assert.equal(readFileSync(f.launcher, 'utf8'), '#!/bin/sh\necho mine\n');
});

test('only the chosen agent CLIs get coordinator keys; Herdr defaults the kit would replace are named', posixOnly, async t => {
  const f = fixture(t, { harness: 'codex', tower: false });
  const result = await f.run();
  assert.deepEqual(result.keys.bound, ['prefix+shift+f', 'prefix+shift+m']);
  assert.equal(result.keys.created, true);
  assert.deepEqual(Object.keys(result.record.agents), ['codex']);
  // None of the kit keys is a Herdr 0.9.3 default; a key that were one is reported as an override.
  assert.deepEqual(previewKeys(f.configPath, kitKeys), []);
  assert.deepEqual(previewKeys(f.configPath, [{ key: 'prefix+n', purpose: 'create a second mate in the Mates tab' }]),
    ["Ctrl+B n will create a second mate in the Mates tab instead of Herdr's next-tab"]);
  writeFileSync(f.configPath, 'next_tab = "prefix+right"\n');
  assert.deepEqual(previewKeys(f.configPath, [{ key: 'prefix+n', purpose: 'x' }]), [], 'a default you moved is no longer replaced');
});

test('a rejected config is restored from the backup, and an edited kit block is left alone and released', posixOnly, async t => {
  const f = fixture(t, { config: 'theme = "x"\n' });
  const rejected = await f.run({ check: () => ({ ok: false, detail: 'unknown key type' }) });
  assert.equal(rejected.keys.action, 'skip');
  assert.match(rejected.keys.detail, /herdr config check rejected the kit keys, so .* was restored: unknown key type/);
  assert.equal(readFileSync(f.configPath, 'utf8'), 'theme = "x"\n');
  assert.equal(f.readReceipt().setup.shortcuts.keys, null);

  await f.run();
  writeFileSync(f.configPath, readFileSync(f.configPath, 'utf8').replace('Firstmate: Codex coordinator', 'my wording'));
  const kept = await f.run();
  assert.equal(kept.keys.action, 'keep');
  assert.match(kept.keys.detail, /edited; left as it is and no longer tracked/);
  assert.equal(f.readReceipt().setup.shortcuts.keys, null);
  assert.equal(planRemoveShortcuts(f.root, f.readReceipt().setup.shortcuts).keys, null, 'uninstall then leaves the block');
});

test('repair restores a removed block and a changed launcher; setup and upgrade only report them', posixOnly, async t => {
  const f = fixture(t, { config: '[keys]\n' });
  await f.run();
  const text = readFileSync(f.configPath, 'utf8');
  writeFileSync(f.configPath, '[keys]\n');
  const rerun = await f.run();
  assert.equal(rerun.keys.action, 'keep');
  assert.match(rerun.keys.detail, /removed; not added again \(agent-kit repair restores it\)/);
  assert.equal(readFileSync(f.configPath, 'utf8'), '[keys]\n');
  assert.ok(f.readReceipt().setup.shortcuts.keys.blockSha256, 'the record survives for repair');
  writeFileSync(f.launcher, '#!/bin/sh\necho changed\n');
  assert.equal((await f.run()).launchers[0].action, 'keep');
  const repaired = await f.run({ repair: true });
  assert.equal(repaired.keys.action, 'add');
  assert.deepEqual(repaired.launchers.map(l => [l.file, l.action]).filter(([, action]) => action !== 'verify'), [['bin/open-firstmate', 'replace']]);
  assert.equal(readFileSync(f.configPath, 'utf8'), text);
  assert.ok(readdirSync(join(f.root, 'backups', 'shortcuts')).some(name => name.endsWith('open-firstmate')), 'the changed launcher was backed up');
});

test('uninstall removes only the unchanged kit block and launcher, and a file the kit created goes with it', posixOnly, async t => {
  const f = fixture(t, { config: '# mine\n[keys]\nprefix = "ctrl+a"\n' });
  await f.run();
  const plan = planRemoveShortcuts(f.root, f.readReceipt().setup.shortcuts);
  assert.ok(plan.launchers.length >= 5 && plan.launchers.every(l => l.action === 'remove unchanged kit launcher'));
  assert.ok([f.launcher, f.mate, join(f.root, 'env.sh'), join(f.root, 'bin', 'firstmate')].every(path => plan.launchers.some(l => l.path === path)));
  assert.equal(plan.keys.action, 'remove the unchanged agent-kit keys block');
  await removeShortcuts(f.root, plan);
  assert.equal(readFileSync(f.configPath, 'utf8'), '# mine\n[keys]\nprefix = "ctrl+a"\n');
  assert.equal(existsSync(f.launcher), false);
  assert.equal(existsSync(f.mate), false);

  const created = fixture(t);
  await created.run();
  assert.equal(existsSync(created.configPath), true);
  await removeShortcuts(created.root, planRemoveShortcuts(created.root, created.readReceipt().setup.shortcuts));
  assert.equal(existsSync(created.configPath), false, 'the kit created the file and nothing else is in it');
});

test('the launcher wrapper carries receipt paths only and needs python3, the pinned Herdr and the kit copy', posixOnly, async t => {
  const f = fixture(t);
  const result = await f.run();
  const body = readFileSync(f.launcher, 'utf8');
  assert.equal(body, launcherScript(result.inputs));
  assert.match(body, new RegExp(`OPEN_FIRSTMATE_HERDR='${join(f.root, 'releases', 'r', 'bin', 'herdr')}'`));
  assert.match(body, new RegExp(`OPEN_FIRSTMATE_CODEX='${join(f.root, 'bin', 'firstmate')}'`));
  assert.match(body, new RegExp(`OPEN_FIRSTMATE_MATE='${f.mate}'`));
  assert.equal(readFileSync(f.mate, 'utf8'), `#!/bin/sh\n# agent-kit:fm-mate - create, list or retire a second mate with Firstmate's own secondmate commands.\n# Written by Agent Kit from its receipt; repair rewrites it.\nexec '${process.execPath}' '${join(kit, 'bin', 'agent-kit.mjs')}' mate --install-root '${f.root}' "$@"\n`);
  assert.match(body, new RegExp(`exec '${join(f.base, 'bin', 'python3')}' '${join(kit, 'templates', 'shortcuts', 'open_firstmate.py')}'`));
  const files = f.readReceipt().setup.shortcuts.files;
  assert.equal(files['bin/open-firstmate'], sha(body));
  assert.equal(files['bin/fm-mate'], sha(readFileSync(f.mate)));
  for (const [file, digest] of Object.entries(files)) assert.equal(sha(readFileSync(join(f.root, file))), digest, file);
  const none = fixture(t);
  const r = none.readReceipt(); delete r.phases.herdr;
  assert.match(planShortcuts(r, none.root, { env: { HOME: none.home, PATH: '/nonexistent' }, home: none.home }).detail, /^needs the pinned Herdr, python3 on PATH$/);
  assert.equal(herdrConfigPath({ XDG_CONFIG_HOME: '/x' }, '/h'), '/x/herdr/config.toml');
  assert.equal(herdrConfigPath({ HERDR_CONFIG_PATH: '/y/c.toml' }, '/h'), '/y/c.toml');
});

// The launcher against a stub herdr that answers with JSON shaped as Herdr 0.9.3's CLI responses.
function stubHerdr(f, state) {
  const log = join(f.base, 'herdr.log'), file = join(f.base, 'herdr-state.json');
  writeFileSync(file, JSON.stringify(state));
  writeFileSync(join(f.root, 'releases', 'r', 'bin', 'herdr'), `#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
open(${JSON.stringify(log)}, 'a').write(' '.join(args) + '\\n')
s = json.load(open(${JSON.stringify(file)}))
key = ' '.join(args[:2])
if key == 'workspace list': out = {'workspaces': s['workspaces']}
elif key == 'workspace create': out = {'workspace': {'workspace_id': 'w9'}, 'tab': {'tab_id': 'w9:t1'}, 'root_pane': {'pane_id': 'w9:p1'}}
elif key == 'tab list': out = {'tabs': s['tabs']}
elif key == 'tab create': out = {'tab': {'tab_id': 'w1:t9'}, 'root_pane': {'pane_id': 'w1:p9'}}
elif key == 'pane list': out = {'panes': s['panes']}
elif key == 'pane process-info': out = {'process_info': s['process'][args[3]]}
elif key == 'pane run': sys.exit(0)
else: out = {}
print(json.dumps({'id': 'cli', 'result': out}))
`, { mode: 0o755 });
  return () => readFileSync(log, 'utf8').trim().split('\n');
}
const launch = (f, mode, extra = {}) => spawnSync(f.launcher, mode ? [mode] : [], { env: { ...f.env, HERDR_ENV: '1', ...extra }, encoding: 'utf8', input: '' });

test('open-firstmate creates the Control Tower, starts the agent in an idle captain tab and never types into a busy one', posixOnly, async t => {
  const f = fixture(t);
  await f.run();
  const calls = stubHerdr(f, { workspaces: [], tabs: [], panes: [], process: {} });
  const created = launch(f, 'codex');
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(calls(), ['workspace list', `workspace create --cwd ${f.firstmate} --label Control Tower --focus`, 'tab rename w9:t1 Captain (Codex)',
    `pane run w9:p1 cd ${f.firstmate} && ${join(f.root, 'bin', 'firstmate')} codex`]);

  const idle = fixture(t);
  await idle.run();
  const idleCalls = stubHerdr(idle, { workspaces: [{ workspace_id: 'w1', label: 'Control Tower' }], tabs: [{ tab_id: 'w1:t1', label: 'Captain (Claude)' }],
    panes: [{ pane_id: 'w1:p1', tab_id: 'w1:t1', agent: null }], process: { 'w1:p1': { shell_pid: 7, foreground_processes: [{ pid: 7, name: '-zsh' }] } } });
  const started = launch(idle, 'claude');
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /Started claude in Captain \(Claude\)/);
  assert.equal(idleCalls().at(-1), `pane run w1:p1 cd ${idle.firstmate} && ${join(idle.root, 'bin', 'firstmate')} claude`);

  const busy = fixture(t);
  await busy.run();
  const busyCalls = stubHerdr(busy, { workspaces: [{ workspace_id: 'w1', label: 'Control Tower' }], tabs: [{ tab_id: 'w1:t4', label: 'renamed' }],
    panes: [{ pane_id: 'w1:p4', tab_id: 'w1:t4', agent: 'claude' }], process: {} });
  const focused = launch(busy, 'claude');
  assert.equal(focused.status, 0, focused.stderr);
  assert.match(focused.stdout, /Focused renamed; it is already running something/);
  assert.ok(!busyCalls().some(call => call.startsWith('pane run')), 'nothing typed into a running coordinator');

  const outside = spawnSync(f.launcher, ['claude'], { env: f.env, encoding: 'utf8', input: '' });
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /Run open-firstmate inside Herdr/);
});

test('open-firstmate mates opens the Mates tab and runs fm-mate there, never typing into a busy tab', posixOnly, async t => {
  const f = fixture(t, { tower: false });
  await f.run();
  const calls = stubHerdr(f, { workspaces: [{ workspace_id: 'w1', label: 'Control Tower' }], tabs: [{ tab_id: 'w1:t1', label: 'Captain (Claude)' }], panes: [], process: {} });
  const mates = launch(f, 'mates');
  assert.equal(mates.status, 0, mates.stderr);
  assert.match(mates.stdout, /Opened Mates and started mates there/);
  assert.deepEqual(calls().slice(-2), [`tab create --workspace w1 --cwd ${f.firstmate} --label Mates --focus`, `pane run w1:p9 cd ${f.firstmate} && ${f.mate}`]);
  const busy = fixture(t);
  await busy.run();
  const busyCalls = stubHerdr(busy, { workspaces: [{ workspace_id: 'w1', label: 'Control Tower' }], tabs: [{ tab_id: 'w1:t2', label: 'Mates' }],
    panes: [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent: null }], process: { 'w1:p2': { shell_pid: 7, foreground_processes: [{ pid: 7, name: 'zsh' }, { pid: 8, name: 'node' }] } } });
  const focused = launch(busy, 'mates');
  assert.equal(focused.status, 0, focused.stderr);
  assert.match(focused.stdout, /Focused Mates; it is already running something/);
  assert.ok(!busyCalls().some(call => call.startsWith('pane run')));
});

test('agent-kit uninstall plans and removes the kit shortcuts and leaves the rest of the Herdr config', posixOnly, async t => {
  const f = fixture(t, { config: '# mine\n' });
  await f.run();
  const plan = planUninstall({ installRoot: f.root, home: f.home, env: f.env, isRunning: () => false });
  assert.ok(plan.shortcuts.launchers.every(l => l.action === 'remove unchanged kit launcher'));
  assert.deepEqual(plan.shortcuts.keys, { path: f.configPath, action: 'remove the unchanged agent-kit keys block' });
  assert.equal(plan.plugin, null, 'no session-graph plugin was registered here');
  await applyUninstall({ installRoot: f.root, home: f.home, env: f.env, isRunning: () => false });
  assert.equal(readFileSync(f.configPath, 'utf8'), '# mine\n');
  assert.equal(existsSync(f.launcher), false);
});
