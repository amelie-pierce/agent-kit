import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyStarter, defaultMode, describeStarter, effectivePlans, fullWarnings, loadPlanTable, planIds, planStarter, renderStarter, starterAdvice, starterRemovable } from '../src/dispatch.mjs';
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
  assert.match(run.stdout, /Starter dispatch rules: wrote Firstmate's balanced rules for claude to .*config\/crew-dispatch\.json \(Jev uses them/);
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

// Firstmate's template slots and their template profiles, as in bin/strategies/*.json at the pinned commit.
const slots = {
  mode: 'balanced', coordinator: { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: { model: 'gpt-6-sol', effort: 'high' } },
  validation: { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: { model: 'gpt-6-sol', effort: 'high' } },
  secondmates: { allowed: true, claude: { model: 'claude-opus-5-5', effort: 'medium' }, codex: { model: 'gpt-6-sol', effort: 'high' } },
  dispatch: {
    rules: [
      { when: 'Exact Claude model', use: { harness: 'claude', model: 'claude-opus-5-5', effort: 'high' }, why: 'Honor the requested model.', strategy: 'claude-model-requested' },
      { when: 'Exact Codex model', use: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' }, strategy: 'codex-model-requested' },
      { when: 'Codex worker', use: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' }, strategy: 'codex-requested' },
      { when: 'Claude worker', use: { harness: 'claude', model: 'claude-opus-5-5', effort: 'high' }, strategy: 'claude-requested' },
      { when: 'Light', use: [{ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'low', floor: { scope: 'all_models', min_percent: 20 } }, { harness: 'codex', model: 'gpt-6-luna', effort: 'medium' }], strategy: 'light' },
      { when: 'Standard', use: [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', floor: { scope: 'all_models', min_percent: 10 } }, { harness: 'codex', model: 'gpt-6-sol', effort: 'medium' }], strategy: 'standard' },
      { when: 'Hard', use: [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'high' }, { harness: 'codex', model: 'gpt-6-sol', effort: 'high' }], strategy: 'hard' },
    ],
    default: [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' }, { harness: 'codex', model: 'gpt-6-sol', effort: 'medium' }],
  },
};
const tier = (rules, slot) => rules.rules.find(r => r.strategy === slot).use;

test('the plan table holds the approved plans under the ids Firstmate\'s fm-strategy.sh --plans uses', () => {
  const table = loadPlanTable();
  assert.equal(table.status, 'approved');
  assert.deepEqual(planIds(table, 'claude'), ['pro', 'max5x', 'max20x', 'team-standard', 'team-premium', 'enterprise-standard', 'enterprise-premium', 'api', 'not-sure']);
  assert.deepEqual(planIds(table, 'codex'), ['plus', 'pro', 'business-standard', 'business-premium', 'enterprise-edu', 'api', 'not-sure']);
  for (const [cli, profiles] of Object.entries({ claude: table.harnesses.claude.profiles, codex: table.harnesses.codex.profiles }))
    for (const [name, profile] of Object.entries(profiles)) for (const [mode, roles] of Object.entries(profile.modes))
      assert.equal(roles.validation.effort, 'high', `${cli} ${name} ${mode}: validation stays high on every plan`);
  assert.equal(renderStarter(slots, 'claude,codex', { claude: 'not-sure', codex: 'not-sure' }, table, 'balanced'), renderStarter(slots, 'claude,codex'), 'skip keeps the template');
  assert.deepEqual(effectivePlans('claude', { claude: 'unknown' }, table), { claude: 'not-sure' });
});

test('Claude Pro lean: Haiku light, Sonnet standard, Opus hard, raised floors and the Fable credit note', () => {
  const rules = JSON.parse(renderStarter(slots, 'claude', { claude: 'pro' }, loadPlanTable(), 'lean'));
  assert.deepEqual(tier(rules, 'light'), [{ harness: 'claude', model: 'claude-haiku-5-5', effort: 'medium', floor: { scope: 'all_models', min_percent: 30 } }]);
  assert.deepEqual(tier(rules, 'standard'), [{ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', floor: { scope: 'all_models', min_percent: 20 } }]);
  assert.deepEqual(tier(rules, 'hard'), [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'high' }]);
  assert.deepEqual(tier(rules, 'claude-requested'), { harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' });
  assert.deepEqual(tier(rules, 'claude-model-requested'), { harness: 'claude', model: 'claude-opus-5-5', effort: 'high' });
  assert.match(rules.rules[0].why, /^Honor the requested model\. On this plan a Fable request bills usage credits/);
  assert.deepEqual(rules.default, [{ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }], 'default is the standard profile without a floor');
  const advice = starterAdvice(slots, 'claude', { claude: 'pro' }, loadPlanTable(), 'lean');
  assert.deepEqual(advice, [{ harness: 'claude', coordinator: { model: 'claude-opus-5-5', effort: 'medium' }, validation: { model: 'claude-opus-5-5', effort: 'high' }, secondmates: 'off' }]);
});

test('Codex Plus balanced uses Terra for standard and Luna high for light with no Codex floors; Enterprise/Edu falls back to gpt-6-sol', () => {
  const table = loadPlanTable();
  const plus = JSON.parse(renderStarter(slots, 'codex', { codex: 'plus' }, table, 'balanced'));
  assert.deepEqual(tier(plus, 'light'), [{ harness: 'codex', model: 'gpt-6-luna', effort: 'high' }]);
  assert.deepEqual(tier(plus, 'standard'), [{ harness: 'codex', model: 'gpt-6.1-terra', effort: 'medium' }]);
  assert.deepEqual(tier(plus, 'hard'), [{ harness: 'codex', model: 'gpt-6.1-sol', effort: 'high' }]);
  assert.deepEqual(tier(plus, 'codex-requested'), { harness: 'codex', model: 'gpt-6.1-sol', effort: 'medium' });
  assert.equal(starterAdvice(slots, 'codex', { codex: 'plus' }, table, 'balanced')[0].coordinator.effort, 'medium', 'Plus coordinator at medium');
  const proFull = JSON.parse(renderStarter(slots, 'codex', { codex: 'pro' }, table, 'full'));
  assert.deepEqual(tier(proFull, 'hard'), [{ harness: 'codex', model: 'gpt-6-astra', effort: 'medium' }]);
  const edu = renderStarter(slots, 'codex', { codex: 'enterprise-edu' }, table, 'balanced');
  assert.equal(edu.includes('gpt-6.1-sol'), false);
  assert.ok(edu.includes('"gpt-6-sol"'));
});

test('a two-CLI home pairs both plan profiles per tier; API keys and Codex never get floors', () => {
  const rules = JSON.parse(renderStarter(slots, 'claude,codex', { claude: 'api', codex: 'pro' }, loadPlanTable(), 'balanced'));
  assert.deepEqual(tier(rules, 'light'), [{ harness: 'claude', model: 'claude-haiku-5-5', effort: 'medium' }, { harness: 'codex', model: 'gpt-6-luna', effort: 'high' }]);
  assert.equal(JSON.stringify(rules).includes('floor'), false);
  const mixed = JSON.parse(renderStarter(slots, 'claude,codex', { claude: 'max5x', codex: 'not-sure' }, loadPlanTable(), 'balanced'));
  assert.deepEqual(tier(mixed, 'standard'), [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', floor: { scope: 'all_models', min_percent: 10 } }, slots.dispatch.rules[5].use[1]], 'skip keeps the template profile');
});

test('default mode follows the plans and full is warned about on small plans', () => {
  const table = loadPlanTable();
  assert.equal(defaultMode('claude', {}, table), 'balanced');
  assert.equal(defaultMode('claude', { claude: 'max20x' }, table), 'balanced');
  for (const plans of [{ claude: 'pro' }, { claude: 'api' }, { claude: 'max5x', codex: 'plus' }]) assert.equal(defaultMode('claude,codex', plans, table), 'lean');
  assert.deepEqual(fullWarnings('claude,codex', { claude: 'team-standard', codex: 'business-standard' }, table), ['Team Standard seat', 'Business Standard seat']);
  assert.deepEqual(fullWarnings('claude,codex', { claude: 'max5x', codex: 'pro' }, table), []);
});

test('a malformed plan profile is refused', t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-plans-bad-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const table = JSON.parse(readFileSync(new URL('../manifests/plan-models.json', import.meta.url)));
  delete table.harnesses.codex.profiles.plus.modes.lean.standard;
  writeFileSync(join(base, 't.json'), JSON.stringify(table));
  assert.throws(() => loadPlanTable(join(base, 't.json')), /codex profile plus lean needs every role/);
});

test('changing the plan later refreshes unchanged kit rules and never rewrites rules you edited', posixOnly, async t => {
  const f = firstmateHome(t);
  writeFileSync(join(f.home, 'bin', 'strategies', 'balanced.json'), JSON.stringify(slots));
  const first = await applyStarter(planStarter(f.home, { harness: 'claude', create: true }));
  assert.equal(first.mode, 'balanced');
  const changed = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'max5x' }, mode: 'balanced', record: first.record, create: true }));
  assert.equal(changed.action, 'refresh');
  assert.deepEqual(changed.record.plans, { claude: 'max5x' });
  assert.equal(readFileSync(f.rules, 'utf8'), renderStarter(slots, 'claude', { claude: 'max5x' }, loadPlanTable(), 'balanced'));
  writeFileSync(f.rules, '{"rules":[{"when":"mine","use":{"harness":"claude"}}]}\n');
  const kept = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'balanced', record: changed.record, create: true }));
  assert.equal(kept.action, 'keep');
  assert.equal(readFileSync(f.rules, 'utf8'), '{"rules":[{"when":"mine","use":{"harness":"claude"}}]}\n');
});

test('a Firstmate whose fm-strategy.sh takes --plans selects the strategy itself; the pinned one gets the bridge file', posixOnly, async t => {
  const f = firstmateHome(t);
  writeFileSync(join(f.home, 'bin', 'strategies', 'lean.json'), JSON.stringify(slots));
  const log = join(f.base, 'argv');
  writeFileSync(join(f.home, 'bin', 'fm-strategy.sh'), `#!/usr/bin/env bash\nif [ "$1" = --help ]; then echo 'Usage: fm-strategy.sh set <mode> [--providers <set>] [--plans claude=<plan>,codex=<plan>]'; exit 0; fi\necho "$@" "key=\${TYPESAFE_API_KEY-unset}" > '${log}'\nmkdir -p "$FM_HOME/config"; echo mode=$2 > "$FM_HOME/config/strategy"\n`, { mode: 0o755 });
  const plan = planStarter(f.home, { harness: 'both', plans: { claude: 'pro', codex: 'not-sure' }, mode: 'lean', create: true });
  assert.equal(plan.action, 'strategy');
  process.env.TYPESAFE_API_KEY = fakeKey;
  t.after(() => { delete process.env.TYPESAFE_API_KEY; });
  const result = await applyStarter(plan);
  assert.equal(readFileSync(log, 'utf8'), 'set lean --providers claude,codex --plans claude=pro --yes key=unset\n', 'the key never reaches fm-strategy.sh');
  assert.equal(result.record, null, 'Firstmate owns a strategy it selected');
  assert.equal(existsSync(f.rules), false, 'the kit wrote no rules file itself');
  assert.match(describeStarter(result), /selected Firstmate's lean strategy .* with bin\/fm-strategy\.sh set lean --providers claude,codex --plans claude=pro --yes/);

  const bridge = firstmateHome(t);
  writeFileSync(join(bridge.home, 'bin', 'strategies', 'lean.json'), JSON.stringify(slots));
  writeFileSync(join(bridge.home, 'bin', 'fm-strategy.sh'), '#!/usr/bin/env bash\necho "Usage: fm-strategy.sh set <mode> [--providers <set>]"\n', { mode: 0o755 });
  const written = await applyStarter(planStarter(bridge.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', create: true }));
  assert.equal(written.action, 'write');
  assert.equal(readFileSync(bridge.rules, 'utf8'), renderStarter(slots, 'claude', { claude: 'pro' }, loadPlanTable(), 'lean'));
  assert.equal(existsSync(join(bridge.home, 'config', 'strategy')), false);
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

// A stand-in for a Firstmate whose fm-strategy.sh takes --plans: set renders crew-dispatch.json from its own
// arguments, records them in config/strategy, notes whether rules already existed, and answers a matching
// --dry-run with Firstmate's "no change:" line. A fail file makes set refuse without writing.
function nativeStrategy(home, log) {
  writeFileSync(join(home, 'bin', 'fm-strategy.sh'), `#!/usr/bin/env bash
if [ "$1" = --help ]; then echo 'Usage: fm-strategy.sh set <mode> [--providers claude|codex|claude,codex] [--plans <plans>] [--dry-run] [--yes]'; exit 0; fi
echo "$@" "key=\${TYPESAFE_API_KEY-unset}" >> '${log}'
[ ! -e "$FM_HOME/fail" ] || { echo "fm-strategy: refused for the fixture" >&2; exit 1; }
args=$(printf '%s ' "$@" | sed 's/ --yes //; s/ --dry-run //; s/ $//')
if [ "\${*: -1}" = --dry-run ]; then
  [ "$(cat "$FM_HOME/config/strategy" 2>/dev/null)" = "$args" ] && echo "no change: this home already matches $2" || echo "dry run: nothing written"; exit 0
fi
mkdir -p "$FM_HOME/config"
[ -e "$FM_HOME/config/crew-dispatch.json" ] && prior=present || prior=absent
printf '{"rules":[{"when":"native","use":{"harness":"claude"},"strategy":"light"}],"args":"%s","prior":"%s"}\\n' "$args" "$prior" > "$FM_HOME/config/crew-dispatch.json"
printf '%s\\n' "$args" > "$FM_HOME/config/strategy"
`, { mode: 0o755 });
}
const bridgeStrategy = home => writeFileSync(join(home, 'bin', 'fm-strategy.sh'), '#!/usr/bin/env bash\necho "Usage: fm-strategy.sh set <mode> [--providers <set>]"\n', { mode: 0o755 });

test('a native selection is recorded by digest, verified by a dry run, refreshed on a plan change and released once changed', posixOnly, async t => {
  const f = firstmateHome(t), log = join(f.base, 'argv');
  nativeStrategy(f.home, log);
  const first = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'max5x' }, mode: 'balanced', create: true }));
  assert.equal(first.action, 'strategy');
  assert.deepEqual(first.record, { file: 'config/crew-dispatch.json', via: 'fm-strategy', template: 'balanced', providers: 'claude', plans: { claude: 'max5x' },
    sha256: sha(readFileSync(f.rules)), strategySha256: sha(readFileSync(join(f.home, 'config', 'strategy'))) });
  assert.equal(JSON.parse(readFileSync(f.rules, 'utf8')).prior, 'absent');

  const same = planStarter(f.home, { harness: 'claude', plans: { claude: 'max5x' }, mode: 'balanced', record: first.record, create: true, restore: true });
  assert.equal(same.action, 'reselect');
  const verified = await applyStarter(same);
  assert.equal(verified.action, 'verify');
  assert.equal(verified.record, first.record);
  assert.match(describeStarter(verified), /balanced strategy the kit selected is unchanged/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(line => line.split(' ').at(-2)), ['--yes', '--dry-run'], 'a matching home gets only a dry run');

  const changed = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', record: first.record, create: true }));
  assert.equal(changed.action, 'reselect');
  assert.match(readFileSync(log, 'utf8'), /set lean --providers claude --plans claude=pro --yes key=unset\n$/);
  assert.deepEqual(changed.record.plans, { claude: 'pro' });
  assert.equal(changed.record.sha256, sha(readFileSync(f.rules)));
  assert.equal(starterRemovable(f.home, changed.record), null, 'uninstall keeps Firstmate\'s strategy files');

  writeFileSync(f.rules, '{"rules":[]}\n');
  const kept = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', record: changed.record, create: true, restore: true }));
  assert.equal(kept.action, 'keep');
  assert.equal(kept.record, null, 'a changed selection is Firstmate\'s alone');
  assert.equal(readFileSync(f.rules, 'utf8'), '{"rules":[]}\n');

  // Repair restores a selection only when both files are gone and the key is set.
  rmSync(f.rules); rmSync(join(f.home, 'config', 'strategy'));
  assert.equal(planStarter(f.home, { harness: 'claude', record: changed.record }).action, 'none');
  const restored = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', record: changed.record, restore: true }));
  assert.equal(restored.action, 'strategy');
  assert.equal(restored.record.sha256, sha(readFileSync(f.rules)));
});

test('an unchanged bridge file moves to the native selection once the home takes --plans; an edited one is kept and named', posixOnly, async t => {
  const f = firstmateHome(t), log = join(f.base, 'argv');
  writeFileSync(join(f.home, 'bin', 'strategies', 'lean.json'), JSON.stringify(slots));
  bridgeStrategy(f.home);
  const bridge = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', create: true }));
  assert.equal(bridge.action, 'write');
  assert.equal(bridge.record.via, undefined);
  const bridgeBody = readFileSync(f.rules, 'utf8');

  // The home's Firstmate gains --plans (a later pin). A failed selection puts the bridge file back untouched.
  nativeStrategy(f.home, log);
  writeFileSync(join(f.home, 'fail'), '');
  const plan = planStarter(f.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', record: bridge.record });
  assert.equal(plan.action, 'migrate');
  const failed = await applyStarter(plan);
  assert.equal(failed.action, 'skip');
  assert.match(describeStarter(failed), /not written; fm-strategy\.sh set lean failed: fm-strategy: refused for the fixture/);
  assert.equal(failed.record, bridge.record, 'the receipt keeps tracking the bridge file');
  assert.equal(readFileSync(f.rules, 'utf8'), bridgeBody);
  assert.deepEqual(readdirSync(join(f.home, 'config')), ['crew-dispatch.json'], 'no aside file is left behind');

  rmSync(join(f.home, 'fail'));
  const migrated = await applyStarter(planStarter(f.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', record: bridge.record }));
  assert.equal(migrated.action, 'migrate');
  assert.deepEqual(JSON.parse(readFileSync(f.rules, 'utf8')), { rules: [{ when: 'native', use: { harness: 'claude' }, strategy: 'light' }], args: 'set lean --providers claude --plans claude=pro', prior: 'absent' },
    'Firstmate renders from its own template, not on top of the bridge rules');
  assert.equal(migrated.record.via, 'fm-strategy');
  assert.equal(migrated.record.sha256, sha(readFileSync(f.rules)));
  assert.match(describeStarter(migrated), /replaced the kit's unchanged bridge rules at .* with Firstmate's lean strategy for claude fitted to your plan \(claude pro\) \(bin\/fm-strategy\.sh set lean --providers claude --plans claude=pro --yes\)/);
  assert.deepEqual(readdirSync(join(f.home, 'config')).sort(), ['crew-dispatch.json', 'strategy']);

  const edited = firstmateHome(t);
  writeFileSync(join(edited.home, 'bin', 'strategies', 'lean.json'), JSON.stringify(slots));
  bridgeStrategy(edited.home);
  const old = await applyStarter(planStarter(edited.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', create: true }));
  writeFileSync(edited.rules, '{"rules":[{"when":"mine","use":{"harness":"claude"}}]}\n');
  nativeStrategy(edited.home, join(edited.base, 'argv'));
  const kept = await applyStarter(planStarter(edited.home, { harness: 'claude', plans: { claude: 'pro' }, mode: 'lean', record: old.record, create: true, restore: true }));
  assert.equal(kept.action, 'keep');
  assert.match(describeStarter(kept), /kept .*; existing rules are yours; bin\/fm-strategy\.sh set lean --providers claude --plans claude=pro switches them to Firstmate's plan-aware strategy/);
  assert.equal(readFileSync(edited.rules, 'utf8'), '{"rules":[{"when":"mine","use":{"harness":"claude"}}]}\n');
  assert.equal(existsSync(join(edited.base, 'argv')), false, 'fm-strategy.sh set never ran');
});

test('upgrade moves an unchanged bridge file to the native selection and uninstall then keeps Firstmate\'s strategy', posixOnly, async t => {
  const f = lifecycleFixture(t);
  await f.write();
  nativeStrategy(f.firstmate, join(f.base, 'argv'));
  f.updateFirstmate('bin/fm-strategy.sh', readFileSync(join(f.firstmate, 'bin', 'fm-strategy.sh'), 'utf8'));
  const result = await upgradeTo(f);
  assert.equal(result.dispatch.action, 'migrate');
  const record = f.readReceipt().setup.dispatch;
  assert.equal(record.via, 'fm-strategy');
  assert.equal(record.strategySha256, sha(readFileSync(join(f.firstmate, 'config', 'strategy'))));
  assert.equal(planUninstall(f.options).dispatch.action, 'keep the Firstmate strategy the kit selected; Firstmate owns its files');
  await applyUninstall(f.options);
  assert.equal(existsSync(f.rules), true);
  assert.equal(existsSync(join(f.firstmate, 'config', 'strategy')), true);
});
