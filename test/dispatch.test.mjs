import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyStarter, effectivePlans, loadPlanTable, planStarter, readyPlans, renderStarter, starterRemovable, starterValidation } from '../src/dispatch.mjs';
import { doctor, formatDoctor } from '../src/doctor.mjs';
import { applyRepair, applyUninstall, applyUpgrade, planRepair, planUninstall, planUpgrade } from '../src/lifecycle.mjs';

const kit = fileURLToPath(new URL('..', import.meta.url));
const bundled = JSON.parse(readFileSync(new URL('../manifests/pilot-skeleton.json', import.meta.url)));
const sha = body => createHash('sha256').update(body).digest('hex');
const fakeKey = 'fixture-typesafe-key-123';
const posixOnly = { skip: process.platform === 'win32' };
const gitEnv = home => ({ HOME: home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

// The shape of Firstmate's bin/strategies/balanced.json: autonomy and coordinator settings the kit must never write.
const template = {
  mode: 'balanced', coordinator: { claude: { model: 'claude-fixture', effort: 'high' } }, secondmates: { allowed: true },
  dispatch: {
    rules: [
      { when: 'Claude requested', use: { harness: 'claude', model: 'claude-fixture', effort: 'high' }, why: 'honor it', strategy: 'claude-requested' },
      { when: 'Codex requested', use: { harness: 'codex', model: 'codex-fixture', effort: 'high' }, strategy: 'codex-requested' },
      { when: 'Light work', use: [{ harness: 'claude', model: 'claude-small', effort: 'low', floor: { scope: 'all_models', min_percent: 20 } }, { harness: 'codex', model: 'codex-small', effort: 'medium' }], strategy: 'light' },
    ],
    default: [{ harness: 'claude', model: 'claude-fixture', effort: 'medium' }, { harness: 'codex', model: 'codex-fixture', effort: 'medium' }],
  },
  autonomy: { level: 'balanced', fresh_starts: true },
};

function firstmateHome(t, { ignoreConfig = true, withTemplate = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-dispatch-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'firstmate');
  mkdirSync(join(home, 'bin', 'strategies'), { recursive: true });
  writeFileSync(join(home, '.gitignore'), `.env\n${ignoreConfig ? 'config/\n' : ''}`);
  if (withTemplate) writeFileSync(join(home, 'bin', 'strategies', 'balanced.json'), `${JSON.stringify(template, null, 2)}\n`);
  assert.equal(spawnSync('git', ['init', '-q', home], { env: gitEnv(base), encoding: 'utf8' }).status, 0);
  return { base, home, rules: join(home, 'config', 'crew-dispatch.json') };
}

test('starter rules narrow Firstmate\'s balanced template to the person\'s agent CLIs like fm-strategy.sh render_dispatch', () => {
  const claude = JSON.parse(renderStarter(template, 'claude'));
  assert.deepEqual(claude.rules.map(r => r.strategy), ['claude-requested', 'light']);
  assert.deepEqual(claude.rules[0].use, template.dispatch.rules[0].use, 'a single kept profile stays an object');
  assert.deepEqual(claude.rules[1].use, [template.dispatch.rules[2].use[0]], 'a profile array keeps only matching profiles, floor included');
  assert.deepEqual(claude.default, [template.dispatch.default[0]]);
  assert.deepEqual(Object.keys(claude), ['rules', 'default'], 'no coordinator, second mate or autonomy settings');
  assert.deepEqual(JSON.parse(renderStarter(template, 'codex')).rules.map(r => r.strategy), ['codex-requested', 'light']);
  assert.equal(JSON.parse(renderStarter(template, 'claude,codex')).rules.length, 3);
  assert.throws(() => renderStarter({ dispatch: { rules: [{ use: { harness: 'claude' } }] } }, 'claude'), /unexpected dispatch shape/);
});

test('starter rules are written only as config/crew-dispatch.json, privately linked into place and recorded by digest', posixOnly, async t => {
  const f = firstmateHome(t);
  assert.equal(planStarter(f.home, { harness: 'claude' }).action, 'none', 'nothing without create');
  const result = await applyStarter(planStarter(f.home, { harness: 'both', create: true }));
  assert.equal(result.action, 'write');
  assert.deepEqual(readdirSync(join(f.home, 'config')), ['crew-dispatch.json'], 'no strategy, secondmate-harness or fresh-start.json');
  assert.equal(readFileSync(f.rules, 'utf8'), renderStarter(template, 'claude,codex'));
  assert.deepEqual(result.record, { file: 'config/crew-dispatch.json', template: 'balanced', providers: 'claude,codex', plans: { claude: 'not-sure', codex: 'not-sure' }, sha256: sha(readFileSync(f.rules)) });
  assert.equal(statSync(f.rules).nlink, 1, 'temp link removed');
  assert.equal(planStarter(f.home, { harness: 'both', record: result.record, create: true }).action, 'verify');
});

test('existing rules, a token strategy, a missing template or an unignored config folder are never overwritten', posixOnly, async t => {
  const mine = firstmateHome(t);
  mkdirSync(join(mine.home, 'config'));
  writeFileSync(mine.rules, '{"rules":[]}\n');
  const kept = await applyStarter(planStarter(mine.home, { harness: 'claude', create: true }));
  assert.equal(kept.action, 'keep');
  assert.match(kept.detail, /existing rules are yours/);
  assert.equal(readFileSync(mine.rules, 'utf8'), '{"rules":[]}\n');
  assert.equal(kept.record, null);

  const strategy = firstmateHome(t);
  mkdirSync(join(strategy.home, 'config'));
  writeFileSync(join(strategy.home, 'config', 'strategy'), 'mode=lean\n');
  assert.equal((await applyStarter(planStarter(strategy.home, { harness: 'claude', create: true }))).action, 'keep');
  assert.equal(existsSync(strategy.rules), false);

  for (const [opts, reason] of [[{ withTemplate: false }, /no bin\/strategies\/balanced\.json/], [{ ignoreConfig: false }, /not gitignored/]]) {
    const f = firstmateHome(t, opts);
    const skipped = await applyStarter(planStarter(f.home, { harness: 'claude', create: true }));
    assert.equal(skipped.action, 'skip');
    assert.match(skipped.detail, reason);
    assert.equal(existsSync(f.rules), false);
  }
});

test('a strategy selected later owns the rules: no refresh, restore or removal, and the kit drops its record', posixOnly, async t => {
  const f = firstmateHome(t);
  const { record } = await applyStarter(planStarter(f.home, { harness: 'claude', create: true }));
  // fm-strategy.sh set renders the same file plus config/strategy; even identical rules now belong to the strategy.
  writeFileSync(join(f.home, 'config', 'strategy'), 'mode=balanced\nproviders=claude\nautonomy=balanced\n');
  for (const opts of [{ restore: true }, {}]) {
    const plan = planStarter(f.home, { harness: 'claude', record, ...opts });
    assert.equal(plan.action, 'keep');
    assert.equal(plan.record, null);
  }
  assert.equal(starterRemovable(f.home, record), null);
  rmSync(join(f.home, 'config', 'strategy'));
  writeFileSync(f.rules, '{"rules":[],"default":{"harness":"claude"}}\n');
  assert.equal(planStarter(f.home, { harness: 'claude', record }).action, 'keep', 'a changed file is the person\'s');
  assert.equal(starterRemovable(f.home, record), null);
});

// A kit root whose Firstmate home is a git checkout with the balanced template, as the kit installs it.
function lifecycleFixture(t, { key = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-dispatch-life-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), setupRoot = join(home, 'Agentic'), root = join(setupRoot, '.tools'), firstmate = join(setupRoot, 'firstmate');
  mkdirSync(root, { recursive: true }); mkdirSync(join(firstmate, 'bin', 'strategies'), { recursive: true });
  for (const dir of ['data', 'state', 'config', 'projects']) mkdirSync(join(firstmate, dir));
  writeFileSync(join(firstmate, '.gitignore'), '.env\nconfig/\n');
  writeFileSync(join(firstmate, 'bin', 'strategies', 'balanced.json'), `${JSON.stringify(template, null, 2)}\n`);
  writeFileSync(join(firstmate, 'bin', 'fm-dispatch-resolve.sh'), '#!/bin/sh\n', { mode: 0o755 });
  const git = (...args) => { const r = spawnSync('git', ['-C', firstmate, ...args], { encoding: 'utf8', env: gitEnv(home) }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  git('remote', 'add', 'origin', bundled.tools.find(x => x.id === 'firstmate').approvedUpstream);
  const first = structuredClone(bundled.tools.find(x => x.id === 'firstmate'));
  first.version.value = git('rev-parse', 'HEAD');
  const manifest = { ...bundled, release: 'pilot-7', tools: [first] };
  if (key) writeFileSync(join(firstmate, '.env'), `TYPESAFE_API_KEY=${fakeKey}\n`, { mode: 0o600 });
  const receipt = { schemaVersion: 1, release: 'pilot-7', phases: { firstmate: { state: 'complete', version: first.version.value, artifactSha256: first.artifacts['darwin-arm64'].sha256, path: firstmate } },
    setup: { version: 1, answers: { channel: 'releases', harness: 'claude', tower: false, globalHooks: false }, paths: { root: setupRoot, installRoot: root, firstmateHome: firstmate } } };
  const receiptPath = join(root, 'receipt.json');
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const options = { installRoot: root, home, env: { HOME: home, PATH: '/usr/bin:/bin' }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0', isRunning: () => false };
  const rules = join(firstmate, 'config', 'crew-dispatch.json');
  const readReceipt = () => JSON.parse(readFileSync(receiptPath, 'utf8'));
  const write = async () => {
    const result = await applyStarter(planStarter(firstmate, { harness: 'claude', create: true }));
    const r = readReceipt(); r.setup.dispatch = result.record; writeFileSync(receiptPath, `${JSON.stringify(r)}\n`, { mode: 0o600 });
    return result.record;
  };
  // A guarded Firstmate update: the home moves to a new commit and the kit records that commit as its pin.
  const updateFirstmate = (path, body) => {
    writeFileSync(join(firstmate, path), body);
    git('add', path); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'update');
    first.version.value = git('rev-parse', 'HEAD');
    const r = readReceipt(); r.phases.firstmate.version = first.version.value; writeFileSync(receiptPath, `${JSON.stringify(r)}\n`, { mode: 0o600 });
  };
  return { base, home, root, firstmate, manifest, receiptPath, options, rules, readReceipt, write, updateFirstmate };
}

test('repair keeps unchanged kit rules, restores missing ones while the key is set, and leaves changed or strategy rules alone', posixOnly, async t => {
  const f = lifecycleFixture(t);
  const record = await f.write();
  const body = readFileSync(f.rules, 'utf8');
  assert.equal(planRepair(f.manifest, f.options).dispatch.action, 'verify');
  rmSync(f.rules);
  assert.equal(planRepair(f.manifest, f.options).dispatch.action, 'restore');
  assert.equal(existsSync(f.rules), false, 'plan writes nothing');
  const restored = await applyRepair(f.manifest, f.options);
  assert.equal(restored.dispatch.action, 'restore');
  assert.equal(readFileSync(f.rules, 'utf8'), body);
  assert.deepEqual(f.readReceipt().setup.dispatch, record);

  writeFileSync(f.rules, '{"rules":[]}\n');
  const kept = await applyRepair(f.manifest, f.options);
  assert.equal(kept.dispatch.action, 'keep');
  assert.equal(readFileSync(f.rules, 'utf8'), '{"rules":[]}\n', 'existing file kept');
  assert.equal(f.readReceipt().setup.dispatch, undefined, 'the person now owns the rules');
  assert.equal(readFileSync(join(f.firstmate, '.env'), 'utf8'), `TYPESAFE_API_KEY=${fakeKey}\n`);
});

test('repair does not restore removed starter rules once the key is gone', posixOnly, async t => {
  const f = lifecycleFixture(t);
  await f.write();
  rmSync(f.rules); rmSync(join(f.firstmate, '.env'));
  assert.equal(planRepair(f.manifest, f.options).dispatch, null);
  await applyRepair(f.manifest, f.options);
  assert.equal(existsSync(f.rules), false);
});

async function upgradeTo(f) {
  const fetchKit = async (_commit, _env, destination) => {
    mkdirSync(destination, { recursive: true });
    for (const dir of ['src', 'manifests']) spawnSync('cp', ['-R', join(kit, dir), join(destination, dir)]);
    writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify({ ...f.manifest, release: 'pilot-8' })}\n`);
  };
  const plan = await planUpgrade({ ...f.options, resolveCommit: () => '8'.repeat(40), fetchKit });
  return applyUpgrade(plan, f.options);
}

test('upgrade refreshes unchanged kit rules from the home\'s template and leaves rules a person or strategy changed', posixOnly, async t => {
  const unchanged = lifecycleFixture(t);
  await unchanged.write();
  // The home's template moved on (a guarded /updatefirstmate); unchanged kit rules follow it.
  const next = structuredClone(template); next.dispatch.rules[0].why = 'new upstream wording';
  unchanged.updateFirstmate('bin/strategies/balanced.json', JSON.stringify(next));
  const result = await upgradeTo(unchanged);
  assert.equal(result.dispatch.action, 'refresh');
  assert.equal(readFileSync(unchanged.rules, 'utf8'), renderStarter(next, 'claude'));
  assert.equal(unchanged.readReceipt().setup.dispatch.sha256, sha(readFileSync(unchanged.rules)));

  const changed = lifecycleFixture(t);
  await changed.write();
  writeFileSync(changed.rules, '{"rules":[]}\n');
  assert.equal((await upgradeTo(changed)).dispatch.action, 'keep');
  assert.equal(readFileSync(changed.rules, 'utf8'), '{"rules":[]}\n');

  const strategy = lifecycleFixture(t);
  await strategy.write();
  const before = readFileSync(strategy.rules, 'utf8');
  writeFileSync(join(strategy.firstmate, 'config', 'strategy'), 'mode=balanced\n');
  assert.equal((await upgradeTo(strategy)).dispatch.action, 'keep');
  assert.equal(readFileSync(strategy.rules, 'utf8'), before);
  assert.equal(strategy.readReceipt().setup.dispatch, undefined);
});

test('uninstall removes only unchanged kit rules and keeps changed or strategy-owned ones', posixOnly, async t => {
  const unchanged = lifecycleFixture(t);
  await unchanged.write();
  assert.equal(planUninstall(unchanged.options).dispatch.action, 'remove unchanged kit starter rules');
  const result = await applyUninstall(unchanged.options);
  assert.equal(existsSync(unchanged.rules), false);
  assert.equal(JSON.parse(readFileSync(result.record, 'utf8')).removedStarterRules, true);
  assert.equal(readFileSync(join(unchanged.firstmate, '.env'), 'utf8'), `TYPESAFE_API_KEY=${fakeKey}\n`, '.env kept');

  for (const change of [f => writeFileSync(f.rules, '{"rules":[]}\n'), f => writeFileSync(join(f.firstmate, 'config', 'strategy'), 'mode=balanced\n')]) {
    const f = lifecycleFixture(t);
    await f.write();
    change(f);
    const before = readFileSync(f.rules, 'utf8');
    assert.equal(planUninstall(f.options).dispatch.action, 'keep rules you or a strategy changed');
    await applyUninstall(f.options);
    assert.equal(readFileSync(f.rules, 'utf8'), before);
  }
});

// Drives bin/agent-kit.mjs keys on a real pseudo-terminal. Replies go to python on stdin, never on a command line.
const python = spawnSync('python3', ['-c', 'import pty'], { encoding: 'utf8' }).status === 0;
const ptyDriver = `
import json, os, pty, select, sys, time
spec = json.load(sys.stdin)
pid, fd = pty.fork()
if pid == 0:
    os.execve(spec["argv"][0], spec["argv"], spec["env"])
out, replies, deadline = b"", spec["replies"], time.time() + 30
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try: chunk = os.read(fd, 4096)
        except OSError: break
        if not chunk: break
        out += chunk
    if replies and replies[0][0].encode() in out.split(b"\\x00")[-1]:
        os.write(fd, replies.pop(0)[1].encode()); out += b"\\x00"
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.replace(b"\\x00", b"").decode(errors="replace"))
sys.exit(os.waitstatus_to_exitcode(status))
`;
function keysOnTty(f, replies) {
  const argv = [process.execPath, join(kit, 'bin', 'agent-kit.mjs'), 'keys', '--install-root', f.root];
  return spawnSync('python3', ['-c', ptyDriver], { encoding: 'utf8', input: JSON.stringify({ argv, env: gitEnv(f.home), replies }) });
}

test('keys on a terminal writes starter rules when it sets the key, keeps them on removal, and never shows the value', { skip: process.platform === 'win32' || !python }, t => {
  const f = lifecycleFixture(t, { key: false });
  const run = keysOnTty(f, [['Keep or add?', 'add\n'], ['hidden; press Enter', `${fakeKey}\r`]]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /TYPESAFE_API_KEY: set/);
  assert.match(run.stdout, /Starter dispatch rules: wrote Firstmate's balanced rules for claude to .*config\/crew-dispatch\.json \(recommended/);
  assert.equal(readFileSync(f.rules, 'utf8'), renderStarter(template, 'claude'));
  const receipt = readFileSync(f.receiptPath, 'utf8');
  assert.deepEqual(JSON.parse(receipt).setup.dispatch.sha256, sha(readFileSync(f.rules)));
  for (const text of [run.stdout, run.stderr, receipt, readFileSync(f.rules, 'utf8')]) assert.equal(text.includes(fakeKey), false);

  const removed = keysOnTty(f, [['Keep, change or remove?', 'remove\n'], ['Type REMOVE', 'REMOVE TYPESAFE_API_KEY\n']]);
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  assert.match(removed.stdout, /TYPESAFE_API_KEY: not set/);
  assert.match(removed.stdout, /Dispatch rules at .* are kept; without the key Firstmate reads them in its normal dispatch/);
  assert.ok(existsSync(f.rules));
});

test('keys on a terminal keeps rules that already exist when it sets the key', { skip: process.platform === 'win32' || !python }, t => {
  const f = lifecycleFixture(t, { key: false });
  writeFileSync(f.rules, '{"rules":[]}\n');
  const run = keysOnTty(f, [['Keep or add?', 'add\n'], ['hidden; press Enter', `${fakeKey}\r`]]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /Starter dispatch rules: kept .*existing rules are yours/);
  assert.equal(readFileSync(f.rules, 'utf8'), '{"rules":[]}\n');
  assert.equal(f.readReceipt().setup.dispatch, undefined);
  assert.equal(run.stdout.includes(fakeKey), false);
});

// A plan table with one approved row, in the shipped file's format; the shipped rows stay todo until the owner approves values.
function planTable(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-plans-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const table = structuredClone(JSON.parse(readFileSync(new URL('../manifests/plan-models.json', import.meta.url))));
  Object.assign(table.harnesses.claude.plans.find(row => row.id === 'pro'), { status: 'ready', source: 'https://fixture.test/plans',
    models: ['claude-small'], substitute: { 'claude-fixture': 'claude-small' }, validation: { model: 'claude-small', effort: 'medium' } });
  const path = join(base, 'plan-models.json');
  writeFileSync(path, JSON.stringify(table));
  return loadPlanTable(path);
}

test('the shipped plan table offers only not-sure until the owner approves plan rows', () => {
  const table = loadPlanTable();
  for (const cli of ['claude', 'codex']) {
    assert.deepEqual(readyPlans(table, cli).map(row => row.id), ['not-sure']);
    assert.ok(table.harnesses[cli].plans.filter(row => row.id !== 'not-sure').every(row => row.status === 'todo' && row.models === null));
  }
  assert.equal(renderStarter(template, 'claude,codex', { claude: 'pro', codex: 'plus' }, table), renderStarter(template, 'claude,codex'), 'todo plans fall back to not-sure');
  assert.deepEqual(effectivePlans('claude', { claude: 'pro' }, table), { claude: 'not-sure' });
});

test('a ready plan row moves every profile to a model the plan can run, or drops it, and sets the validation model', t => {
  const table = planTable(t);
  const rules = JSON.parse(renderStarter(template, 'claude,codex', { claude: 'pro', codex: 'not-sure' }, table));
  const claudeModels = [...rules.rules.flatMap(r => [r.use].flat()), ...rules.default].filter(p => p.harness === 'claude').map(p => p.model);
  assert.ok(claudeModels.length && claudeModels.every(m => m === 'claude-small'), 'nothing routes to a model outside the plan');
  assert.equal(rules.rules[0].use.model, 'claude-small', 'substituted, other fields kept');
  assert.equal(rules.rules[0].use.effort, 'high');
  assert.ok(rules.rules.some(r => r.strategy === 'codex-requested'), 'codex not-sure keeps the template');
  assert.deepEqual(starterValidation({ validation: { claude: { model: 'claude-fixture', effort: 'high' }, codex: { model: 'codex-fixture', effort: 'high' } } }, 'claude,codex', { claude: 'pro' }, table),
    [{ harness: 'claude', model: 'claude-small', effort: 'medium' }, { harness: 'codex', model: 'codex-fixture', effort: 'high' }]);
  // Without a substitute the profile is dropped; a rule with no profile left goes with it.
  const strict = structuredClone(table); strict.harnesses.claude.plans.find(row => row.id === 'pro').substitute = {};
  const dropped = JSON.parse(renderStarter(template, 'claude', { claude: 'pro' }, strict));
  assert.deepEqual(dropped.rules.map(r => r.strategy), ['light']);
  assert.equal(dropped.default, undefined, 'an empty default is left out, which Firstmate accepts');
});

test('a malformed ready plan row is refused', t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-plans-bad-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const table = JSON.parse(readFileSync(new URL('../manifests/plan-models.json', import.meta.url)));
  Object.assign(table.harnesses.codex.plans.find(row => row.id === 'plus'), { status: 'ready', source: 'https://fixture.test', models: ['codex-small'], substitute: { x: 'codex-large' } });
  writeFileSync(join(base, 't.json'), JSON.stringify(table));
  assert.throws(() => loadPlanTable(join(base, 't.json')), /ready codex plan plus needs/);
});

test('changing the plan later refreshes unchanged kit rules and never rewrites rules you edited', posixOnly, async t => {
  const f = firstmateHome(t), table = planTable(t);
  const first = await applyStarter(planStarter(f.home, { harness: 'claude', table, create: true }));
  const changed = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'pro' }, table, record: first.record, create: true }));
  assert.equal(changed.action, 'refresh');
  assert.deepEqual(changed.record.plans, { claude: 'pro' });
  assert.equal(readFileSync(f.rules, 'utf8'), renderStarter(template, 'claude', { claude: 'pro' }, table));
  writeFileSync(f.rules, '{"rules":[{"when":"mine","use":{"harness":"claude"}}]}\n');
  const kept = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'not-sure' }, table, record: changed.record, create: true }));
  assert.equal(kept.action, 'keep');
  assert.equal(readFileSync(f.rules, 'utf8'), '{"rules":[{"when":"mine","use":{"harness":"claude"}}]}\n');
});

test('doctor reports jev ready only with the key, rules and resolver tools, as a warning otherwise, and never prints the key', posixOnly, async t => {
  const f = lifecycleFixture(t, { key: false });
  const tools = join(f.base, 'tools'); mkdirSync(tools);
  for (const name of ['jq', 'curl', 'quota-axi', 'awk', 'grep', 'sed', 'tr']) writeFileSync(join(tools, name), '#!/bin/sh\n', { mode: 0o755 });
  const row = env => doctor(f.manifest, { installRoot: f.root, home: f.home, env }).checks.find(x => x.id === 'jev');
  const missing = row({ HOME: f.home, PATH: '/nonexistent' });
  assert.equal(missing.status, 'warn');
  assert.match(missing.detail, /^not ready: TYPESAFE_API_KEY is not set; add it from your own terminal with agent-kit keys; no config\/crew-dispatch\.json; not on PATH: jq, curl, quota-axi/);
  writeFileSync(join(f.firstmate, '.env'), `TYPESAFE_API_KEY=${fakeKey}\n`, { mode: 0o600 });
  await f.write();
  const result = doctor(f.manifest, { installRoot: f.root, home: f.home, env: { HOME: f.home, PATH: tools } });
  assert.deepEqual(result.checks.find(x => x.id === 'jev'), { id: 'jev', status: 'pass', detail: 'ready (key set, rules present)' });
  assert.match(formatDoctor(result), /PASS jev: ready \(key set, rules present\)/);
  assert.equal(JSON.stringify(result).includes(fakeKey) || formatDoctor(result).includes(fakeKey), false);
  writeFileSync(f.rules, '{"rules":[]}\n');
  assert.match(row({ HOME: f.home, PATH: tools }).detail, /^not ready: config\/crew-dispatch\.json has no well-formed rules$/);
});
