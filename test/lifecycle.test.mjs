import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRepair, applyUninstall, applyUpgrade, formatLifecycle, planRepair, planUninstall, planUpgrade, resolveReviewedCommit } from '../src/lifecycle.mjs';
import { parseArgs } from '../src/kit.mjs';
import { windowsLifecycle } from '../src/install/windows.mjs';

const sha = body => createHash('sha256').update(body).digest('hex');
const bundled = JSON.parse(readFileSync(new URL('../manifests/pilot-skeleton.json', import.meta.url)));
const source = fileURLToPath(new URL('..', import.meta.url));
const stopped = () => false;
function fixture(t, channel = 'releases') {
  const base = mkdtempSync(join(tmpdir(), 'kit-lifecycle-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), setupRoot = join(home, 'Agentic'), root = join(setupRoot, '.tools'), firstmate = join(setupRoot, 'firstmate');
  mkdirSync(home); mkdirSync(root, { recursive: true }); mkdirSync(firstmate);
  for (const dir of ['bin', 'data', 'state', 'config', 'projects']) mkdirSync(join(firstmate, dir));
  writeFileSync(join(firstmate, 'README.md'), 'fixture\n');
  writeFileSync(join(firstmate, '.gitignore'), '.env\n');
  const git = (...args) => {
    const r = spawnSync('git', ['-C', firstmate, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init', '-q'); git('add', 'README.md', '.gitignore'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  git('remote', 'add', 'origin', bundled.tools.find(x => x.id === 'firstmate').approvedUpstream);
  const pin = git('rev-parse', 'HEAD');
  const first = structuredClone(bundled.tools.find(x => x.id === 'firstmate'));
  first.version.value = pin;
  const herdr = structuredClone(bundled.tools.find(x => x.id === 'herdr'));
  herdr.version.value = '0.9.3';
  herdr.artifacts['darwin-arm64'] = { status: 'verified', url: 'https://fixture.test/herdr', sha256: sha('restored'), reason: '' };
  const manifest = { ...bundled, release: 'old-release', tools: [first, herdr] };
  const bin = join(root, 'releases', 'old-release', 'bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'herdr'), 'original', { mode: 0o755 });
  const receipt = { schemaVersion: 1, release: 'old-release', phases: {
    firstmate: { state: 'complete', version: pin, artifactSha256: first.artifacts['darwin-arm64'].sha256, path: firstmate },
    herdr: { state: 'complete', version: '0.9.3', artifactSha256: sha('old-artifact'), path: 'releases/old-release/bin/herdr', ownedSha256: sha('original') },
  }, setup: { version: 1, answers: { channel, harness: 'claude', tower: false, globalHooks: false }, paths: { root: setupRoot, installRoot: root, firstmateHome: firstmate } } };
  const receiptPath = join(root, 'receipt.json');
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const options = { installRoot: root, home, env: { HOME: home, PATH: '/usr/bin:/bin' }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    isRunning: stopped, fetchArtifact: async (_url, path) => writeFileSync(path, 'restored') };
  return { base, home, root, setupRoot, firstmate, bin, manifest, receiptPath, options, git };
}

test('repair plans without writes, refuses running services, and keeps a private copy of a changed binary', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), path = join(f.bin, 'herdr');
  writeFileSync(join(f.firstmate, '.env'), 'TYPESAFE_API_KEY=fixture-secret-123\n', { mode: 0o600 });
  writeFileSync(path, 'person edit');
  const before = readFileSync(f.receiptPath, 'utf8');
  const plan = planRepair(f.manifest, f.options);
  assert.equal(plan.files.find(x => x.id === 'herdr').action, 'backup and replace changed');
  assert.equal(readFileSync(path, 'utf8'), 'person edit');
  assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
  await assert.rejects(applyRepair(f.manifest, { ...f.options, isRunning: id => id === 'herdr' }), /herdr: finish or stop running agents and validation runs first.*run `herdr server stop`; the kit never runs this itself/);
  const running = planRepair(f.manifest, { ...f.options, isRunning: () => true }).running;
  assert.deepEqual(running.map(x => x.id), ['herdr', 'no-mistakes', 'zoe-fleet-tower']);
  assert.match(running[1].step, /run `no-mistakes daemon stop`; the kit never runs this itself/);
  assert.match(running[2].step, /close the Fleet pane in the Herdr Team tab \(`herdr pane close <pane-id>`\)/);
  assert.equal(readFileSync(path, 'utf8'), 'person edit');
  const result = await applyRepair(f.manifest, f.options);
  assert.equal(readFileSync(path, 'utf8'), 'restored');
  assert.equal(readFileSync(join(result.backup, 'releases', 'old-release', 'bin', 'herdr'), 'utf8'), 'person edit');
  assert.ok(existsSync(f.firstmate));
  assert.equal(readFileSync(join(f.firstmate, '.env'), 'utf8'), 'TYPESAFE_API_KEY=fixture-secret-123\n');
});

test('uninstall leaves the Firstmate home, preserves kit backups and refuses unsafe home removal', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  writeFileSync(join(f.firstmate, '.env'), 'TYPESAFE_API_KEY=fixture-secret-123\n', { mode: 0o600 });
  const plan = planUninstall(f.options);
  assert.equal(plan.removeFirstmateHome, false);
  assert.ok(existsSync(f.receiptPath));
  assert.throws(() => planUninstall({ ...f.options, removeFirstmateHome: true, confirmHome: '/wrong' }), /type the exact/);
  assert.equal(planUninstall({ ...f.options, removeFirstmateHome: true, confirmHome: f.firstmate, matesRunning: () => false }).removeFirstmateHome, true);
  assert.throws(() => planUninstall({ ...f.options, removeFirstmateHome: true, confirmHome: f.firstmate, matesRunning: () => true }), /live second mates/);
  writeFileSync(join(f.firstmate, 'README.md'), 'dirty');
  assert.throws(() => planUninstall({ ...f.options, removeFirstmateHome: true, confirmHome: f.firstmate }), /uncommitted/);
  writeFileSync(join(f.firstmate, 'README.md'), 'fixture\n');
  writeFileSync(join(f.firstmate, 'README.md'), 'unpushed\n');
  f.git('add', 'README.md'); f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'unpushed');
  assert.throws(() => planUninstall({ ...f.options, removeFirstmateHome: true, confirmHome: f.firstmate }), /no upstream proves/);
  mkdirSync(join(f.home, '.codex'));
  writeFileSync(join(f.home, '.codex', 'config.toml'), '[features]\nhooks = true\nother = "keep"\n');
  const receipt = JSON.parse(readFileSync(f.receiptPath));
  receipt.phases.hooks = { state: 'complete', codexHooksPrevious: false, files: [], skills: [] };
  writeFileSync(f.receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  await assert.rejects(applyUninstall({ ...f.options, isRunning: id => id === 'zoe-fleet-tower' }), /zoe-fleet-tower: .*close the Fleet pane in the Herdr Team tab/);
  assert.ok(existsSync(f.receiptPath));
  const result = await applyUninstall(f.options);
  assert.ok(existsSync(f.firstmate));
  assert.equal(readFileSync(join(f.firstmate, '.env'), 'utf8'), 'TYPESAFE_API_KEY=fixture-secret-123\n');
  assert.equal(existsSync(f.receiptPath), false);
  assert.equal(readFileSync(join(result.backup, 'releases', 'old-release', 'bin', 'herdr'), 'utf8'), 'original');
  assert.match(readFileSync(join(f.home, '.codex', 'config.toml'), 'utf8'), /hooks = false\nother = "keep"/);
  assert.ok(existsSync(result.record));
});

test('uninstall removes .env only with an exact typed path', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), path = join(f.firstmate, '.env');
  writeFileSync(path, 'TYPESAFE_API_KEY=fixture-secret-123\n', { mode: 0o600 });
  assert.throws(() => planUninstall({ ...f.options, removeEnv: true, confirmEnv: '/wrong' }), /type the exact Firstmate .env path/);
  await applyUninstall({ ...f.options, removeEnv: true, confirmEnv: path });
  assert.equal(existsSync(path), false);
});

test('uninstall removes tagged hooks while retaining an unrelated hook', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.claude'));
  const settings = join(f.home, '.claude', 'settings.json');
  writeFileSync(settings, `${JSON.stringify({ hooks: { SessionStart: [{ matcher: '', hooks: [
    { type: 'command', command: `'${f.root}/releases/old-release/npm/node_modules/.bin/gh-axi' # agent-kit:gh-axi`, timeout: 10 },
    { type: 'command', command: 'echo personal' },
  ] }] } }, null, 2)}\n`);
  const plan = planUninstall(f.options);
  assert.deepEqual(plan.registration.files, [settings]);
  await applyUninstall(f.options);
  const after = JSON.parse(readFileSync(settings));
  assert.deepEqual(after.hooks.SessionStart[0].hooks, [{ type: 'command', command: 'echo personal' }]);
});

test('repair reports a changed Firstmate home and manifest-unverified tools while restoring kit files', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), path = join(f.bin, 'herdr');
  const runtime = structuredClone(bundled.tools.find(x => x.id === 'zoe-fleet-runtime'));
  runtime.artifacts['darwin-arm64'] = { ...runtime.artifacts['darwin-arm64'], status: 'unverified', reason: 'no reviewed artifact for this platform' };
  const manifest = { ...f.manifest, tools: [...f.manifest.tools, runtime] };
  const receipt = JSON.parse(readFileSync(f.receiptPath));
  receipt.setup.answers.tower = true;
  writeFileSync(f.receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  writeFileSync(join(f.firstmate, 'README.md'), 'person work\n');
  writeFileSync(path, 'person edit');
  const result = await applyRepair(manifest, f.options);
  assert.equal(result.status, 'repaired');
  assert.ok(result.nextSteps.some(x => x.startsWith('firstmate: ')));
  assert.equal(result.components.find(x => x.id === 'zoe-fleet-runtime').status, 'unverified');
  assert.equal(readFileSync(path, 'utf8'), 'restored');
  assert.equal(readFileSync(join(f.firstmate, 'README.md'), 'utf8'), 'person work\n');
});

test('uninstall keeps a Codex hooks setting the person changed and still removes kit registrations', { skip: process.platform === 'win32' }, async t => {
  for (const config of ['[features]\nhooks = false\n', '[features]\nother = "keep"\n', '[features]\nhooks = true\nhooks = true\n']) {
    const f = fixture(t);
    mkdirSync(join(f.home, '.codex')); mkdirSync(join(f.home, '.claude'));
    const toml = join(f.home, '.codex', 'config.toml'), settings = join(f.home, '.claude', 'settings.json');
    writeFileSync(toml, config);
    writeFileSync(settings, `${JSON.stringify({ hooks: { SessionStart: [{ matcher: '', hooks: [
      { type: 'command', command: `'${f.root}/releases/old-release/npm/node_modules/.bin/gh-axi' # agent-kit:gh-axi`, timeout: 10 },
    ] }] } }, null, 2)}\n`);
    const receipt = JSON.parse(readFileSync(f.receiptPath));
    receipt.phases.hooks = { state: 'complete', codexHooksPrevious: null, files: [], skills: [] };
    writeFileSync(f.receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    const plan = planUninstall(f.options);
    assert.deepEqual(plan.registration.files, [settings]);
    assert.equal(plan.registration.kept.length, 1);
    assert.match(plan.registration.kept[0], /config\.toml: .*left unchanged/);
    await applyUninstall(f.options);
    assert.equal(readFileSync(toml, 'utf8'), config);
    assert.doesNotMatch(readFileSync(settings, 'utf8'), /agent-kit:gh-axi/);
    assert.equal(existsSync(f.receiptPath), false);
  }
});

async function stagedKit(_commit, _env, destination, release = 'new-release') {
  mkdirSync(destination, { recursive: true });
  cpSync(join(source, 'src'), join(destination, 'src'), { recursive: true });
  cpSync(join(source, 'manifests'), join(destination, 'manifests'), { recursive: true });
  const target = { ...bundled, release, tools: [] };
  return target;
}

test('upgrade resolves each saved channel and rolls activated kit files back after a step failure', { skip: process.platform === 'win32' }, async t => {
  for (const channel of ['releases', 'main']) {
    const f = fixture(t, channel), commit = channel === 'main' ? 'b'.repeat(40) : 'a'.repeat(40), queried = [];
    const fetchKit = async (_commit, _env, destination) => {
      await stagedKit(_commit, _env, destination);
      const target = structuredClone(f.manifest);
      target.release = 'new-release';
      target.tools.find(x => x.id === 'herdr').artifacts['darwin-arm64'].sha256 = sha('restored');
      writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify(target)}\n`);
    };
    const args = { ...f.options, resolveCommit: value => { queried.push(value); return commit; }, fetchKit };
    const wrapper = join(f.root, 'bin', 'treehouse'), body = '#!/bin/sh\nexit 0\n';
    mkdirSync(join(f.root, 'bin')); writeFileSync(wrapper, body); chmodSync(wrapper, 0o755);
    const receipt = JSON.parse(readFileSync(f.receiptPath));
    receipt.phases['treehouse-root'] = { state: 'complete', version: 'old-release', path: 'bin/treehouse', ownedSha256: sha(body), treehouseRoot: join(f.setupRoot, '.treehouse') };
    writeFileSync(f.receiptPath, `${JSON.stringify(receipt)}\n`);
    const before = readFileSync(f.receiptPath, 'utf8');
    const plan = await planUpgrade(args);
    assert.deepEqual(queried, [channel]);
    assert.equal(plan.commit, commit);
    assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
    await assert.rejects(applyUpgrade(plan, { ...f.options, afterPhase: id => { if (id === 'herdr') throw new Error('injected failure'); } }), /injected failure/);
    assert.equal(readFileSync(join(f.bin, 'herdr'), 'utf8'), 'original');
    assert.equal(readFileSync(wrapper, 'utf8'), body);
    assert.equal(lstatSync(wrapper).mode & 0o777, 0o755);
    assert.equal(JSON.parse(readFileSync(f.receiptPath)).release, 'old-release');
    assert.equal(existsSync(join(f.root, 'releases', 'new-release')), false);
    assert.equal(existsSync(join(f.root, 'kit', commit)), false);
  }
});

test('upgrade activates a reviewed kit and keeps the previous release', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, 'main'), commit = 'c'.repeat(40);
  const fetchKit = async (_commit, _env, destination) => {
    await stagedKit(_commit, _env, destination);
    const target = structuredClone(f.manifest);
    target.release = 'new-release';
    writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify(target)}\n`);
  };
  const plan = await planUpgrade({ ...f.options, resolveCommit: () => commit, fetchKit });
  plan.answers = { channel: 'main', harness: 'claude', tower: false, globalHooks: false, figma: false, starterMate: false };
  const seen = [];
  const result = await applyUpgrade(plan, { ...f.options, afterPhase: () => seen.push(JSON.parse(readFileSync(f.receiptPath)).setup.answers) });
  assert.equal(result.apply, true);
  assert.ok(seen.length);
  for (const answers of seen) assert.deepEqual(answers, plan.answers);
  assert.deepEqual(JSON.parse(readFileSync(f.receiptPath)).setup.answers, plan.answers);
  assert.equal(JSON.parse(readFileSync(f.receiptPath)).release, 'new-release');
  assert.equal(JSON.parse(readFileSync(f.receiptPath)).setup.kit.commit, commit);
  assert.equal(readFileSync(join(f.bin, 'herdr'), 'utf8'), 'original');
  assert.equal(readFileSync(join(f.root, 'releases', 'new-release', 'bin', 'herdr'), 'utf8'), 'restored');
});

test('upgrade and its update alias refuse a Firstmate home with local changes; repair still runs; a clean home upgrades', { skip: process.platform === 'win32' }, async t => {
  for (const name of ['upgrade', 'update']) {
    assert.equal(parseArgs([name, '--yes', '--root', '/tmp/kit']).command, 'upgrade');
    const f = fixture(t), commit = 'f'.repeat(40);
    const fetchKit = async (_commit, _env, destination) => {
      await stagedKit(_commit, _env, destination);
      const target = structuredClone(f.manifest);
      target.release = 'new-release';
      writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify(target)}\n`);
    };
    const args = { ...f.options, resolveCommit: () => commit, fetchKit };
    const before = readFileSync(f.receiptPath, 'utf8');
    const refusal = new RegExp(`Firstmate home ${f.firstmate} has uncommitted changes to tracked files\\. Save them elsewhere if you want to keep them, then discard them so the home is clean\\. The kit will not reset the Firstmate home itself; rerun agent-kit upgrade afterwards\\.`);
    writeFileSync(join(f.firstmate, 'README.md'), 'person work\n');
    await assert.rejects(planUpgrade(args), refusal);
    assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
    writeFileSync(join(f.firstmate, 'README.md'), 'fixture\n');
    const stale = await planUpgrade(args);
    writeFileSync(join(f.firstmate, 'README.md'), 'person work\n');
    await assert.rejects(applyUpgrade(stale, f.options), refusal);
    assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
    assert.equal(JSON.parse(before).pendingUpdate, undefined);
    assert.equal(existsSync(join(f.root, 'releases', 'new-release')), false);
    const pin = f.git('rev-parse', 'HEAD');
    f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qam', 'person commit');
    const offPin = new RegExp(`is not on the kit's pinned Firstmate commit ${pin}\\. Return the home to commit ${pin}; Firstmate updates go through Firstmate's own /updatefirstmate path\\. The kit will not reset`);
    await assert.rejects(planUpgrade(args), offPin);
    await assert.rejects(applyUpgrade(stale, f.options), offPin);
    assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
    f.git('reset', '-q', '--hard', pin);
    const upstream = bundled.tools.find(x => x.id === 'firstmate').approvedUpstream;
    f.git('remote', 'set-url', 'origin', 'https://example.test/fork.git');
    const wrongOrigin = new RegExp(`has an origin remote other than the approved upstream ${upstream.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, or its Git state cannot be read\\. Set origin back to .* The kit will not reset`);
    await assert.rejects(planUpgrade(args), wrongOrigin);
    await assert.rejects(applyUpgrade(stale, f.options), wrongOrigin);
    assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
    f.git('remote', 'set-url', 'origin', upstream);
    writeFileSync(join(f.firstmate, 'README.md'), 'person work\n');
    const repaired = await applyRepair(f.manifest, f.options);
    assert.equal(repaired.status, 'repaired');
    assert.ok(repaired.nextSteps.some(x => x.startsWith('firstmate: ')));
    assert.equal(readFileSync(join(f.firstmate, 'README.md'), 'utf8'), 'person work\n');
    writeFileSync(join(f.firstmate, 'README.md'), 'fixture\n');
    const result = await applyUpgrade(await planUpgrade(args), f.options);
    assert.match(formatLifecycle(result), /^Agent Kit upgrade: upgraded\n/);
    const after = JSON.parse(readFileSync(f.receiptPath));
    assert.equal(after.release, 'new-release');
    assert.equal(after.pendingUpdate, undefined);
    assert.equal(after.setup.kit.commit, commit);
  }
});

test('a Firstmate pin change already applied through /updatefirstmate is not called off-pin when origin differs', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), upstream = bundled.tools.find(x => x.id === 'firstmate').approvedUpstream;
  const oldPin = f.git('rev-parse', 'HEAD');
  writeFileSync(join(f.firstmate, 'README.md'), 'firstmate update\n');
  f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qam', 'firstmate update');
  const newPin = f.git('rev-parse', 'HEAD');
  const fetchKit = async (_commit, _env, destination) => {
    await stagedKit(_commit, _env, destination);
    const target = structuredClone(f.manifest);
    target.release = 'new-release';
    target.tools.find(x => x.id === 'firstmate').version.value = newPin;
    writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify(target)}\n`);
  };
  const args = { ...f.options, resolveCommit: () => 'a'.repeat(40), fetchKit };
  const before = readFileSync(f.receiptPath, 'utf8');
  f.git('remote', 'set-url', 'origin', 'https://example.test/fork.git');
  await assert.rejects(planUpgrade(args), error => /has an origin remote other than the approved upstream/.test(error.message) && !/Return the home to commit/.test(error.message));
  f.git('remote', 'set-url', 'origin', upstream);
  f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '--allow-empty', '-m', 'person commit');
  await assert.rejects(planUpgrade(args), new RegExp(`is not on the kit's pinned Firstmate commit ${oldPin} or ${newPin}\\. Return the home to commit ${oldPin}`));
  assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
});

test('upgrade from macos-pilot-5 with only a Firstmate pin change asks for /updatefirstmate first, then applies', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), oldPin = f.git('rev-parse', 'HEAD');
  writeFileSync(join(f.firstmate, 'README.md'), 'firstmate update\n');
  f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qam', 'firstmate update');
  const newPin = f.git('rev-parse', 'HEAD');
  f.git('checkout', '-q', '--detach', oldPin);
  const receipt = JSON.parse(readFileSync(f.receiptPath));
  receipt.release = 'macos-pilot-5';
  writeFileSync(f.receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const fetchKit = async (_commit, _env, destination) => {
    await stagedKit(_commit, _env, destination);
    const target = structuredClone(f.manifest);
    target.release = bundled.release;
    target.tools.find(x => x.id === 'firstmate').version.value = newPin;
    writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify(target)}\n`);
  };
  const args = { ...f.options, resolveCommit: () => 'a'.repeat(40), fetchKit };
  const before = readFileSync(f.receiptPath, 'utf8');
  const plan = await planUpgrade(args);
  t.after(() => rmSync(plan.stage, { recursive: true, force: true }));
  assert.equal(plan.firstmatePinChange, true);
  assert.equal(plan.firstmateReady, false);
  assert.deepEqual(plan.changes.filter(x => x.from.version !== x.to.version).map(x => x.id), ['firstmate']);
  const text = formatLifecycle(plan);
  assert.match(text, new RegExp(`\\nRelease: macos-pilot-5 -> ${bundled.release}\\n`));
  assert.match(text, new RegExp(`\\n- firstmate: ${oldPin} -> ${newPin}; `));
  assert.match(text, /\nFirstmate pin: run \/updatefirstmate in the Firstmate home before applying\n/);
  await assert.rejects(applyUpgrade(plan, f.options), new RegExp(`Firstmate pin changed; run /updatefirstmate from ${f.firstmate}, then rerun agent-kit upgrade`));
  assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
  assert.equal(existsSync(join(f.root, 'releases', bundled.release)), false);
  f.git('checkout', '-q', '--detach', newPin);
  const ready = await planUpgrade(args);
  assert.equal(ready.firstmateReady, true);
  assert.match(formatLifecycle(ready), /\nFirstmate pin: guarded update already verified\n/);
  const result = await applyUpgrade(ready, f.options);
  assert.equal(result.status, 'upgraded');
  assert.equal(result.components.find(x => x.id === 'firstmate').status, 'skipped');
  const after = JSON.parse(readFileSync(f.receiptPath));
  assert.equal(after.release, bundled.release);
  assert.equal(after.phases.firstmate.version, newPin);
  assert.equal(after.phases.herdr.version, '0.9.3');
  assert.equal(readFileSync(join(f.firstmate, 'README.md'), 'utf8'), 'firstmate update\n');
});

test('upgrade from macos-pilot-6 to pilot-9 plans and applies without a release prefix assumption', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), commit = '7'.repeat(40);
  assert.equal(bundled.release, 'pilot-9');
  renameSync(join(f.root, 'releases', 'old-release'), join(f.root, 'releases', 'macos-pilot-6'));
  const receipt = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  receipt.release = 'macos-pilot-6';
  receipt.phases.herdr.path = 'releases/macos-pilot-6/bin/herdr';
  writeFileSync(f.receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const envPath = join(f.firstmate, '.env');
  writeFileSync(envPath, 'TYPESAFE_API_KEY=fixture-secret-123\n', { mode: 0o600 });
  const fetchKit = async (_commit, _env, destination) => {
    await stagedKit(_commit, _env, destination);
    const target = structuredClone(f.manifest);
    target.release = bundled.release;
    writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify(target)}\n`);
  };
  const plan = await planUpgrade({ ...f.options, resolveCommit: () => commit, fetchKit });
  t.after(() => rmSync(plan.stage, { recursive: true, force: true }));
  assert.equal(plan.fromRelease, 'macos-pilot-6');
  assert.equal(plan.toRelease, 'pilot-9');
  assert.equal(plan.firstmatePinChange, false);
  assert.match(formatLifecycle(plan), /\nRelease: macos-pilot-6 -> pilot-9\n/);
  const result = await applyUpgrade(plan, f.options);
  assert.equal(result.status, 'upgraded');
  assert.equal(JSON.parse(readFileSync(f.receiptPath, 'utf8')).release, 'pilot-9');
  assert.equal(readFileSync(join(f.root, 'releases', 'pilot-9', 'bin', 'herdr'), 'utf8'), 'restored');
  assert.equal(readFileSync(join(f.root, 'releases', 'macos-pilot-6', 'bin', 'herdr'), 'utf8'), 'original');
  assert.equal(readFileSync(envPath, 'utf8'), 'TYPESAFE_API_KEY=fixture-secret-123\n');
});

test('upgrade refuses a missing or symlinked Firstmate home and never clones a replacement', { skip: process.platform === 'win32' }, async t => {
  for (const kind of ['missing', 'symlink']) {
    const f = fixture(t), moved = join(f.base, 'moved-firstmate');
    const fetchKit = async (_commit, _env, destination) => {
      await stagedKit(_commit, _env, destination);
      const target = structuredClone(f.manifest);
      target.release = 'new-release';
      writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify(target)}\n`);
    };
    renameSync(f.firstmate, moved);
    if (kind === 'symlink') symlinkSync(moved, f.firstmate);
    await assert.rejects(planUpgrade({ ...f.options, resolveCommit: () => 'a'.repeat(40), fetchKit }), /owned installation fails verification: firstmate/);
    assert.equal(kind === 'missing' ? existsSync(f.firstmate) : lstatSync(f.firstmate).isSymbolicLink(), kind !== 'missing');
    assert.equal(JSON.parse(readFileSync(f.receiptPath)).release, 'old-release');
  }
});

test('CLI aliases and unattended flag use the same lifecycle command', () => {
  assert.equal(parseArgs(['reinstall', '--root', '/tmp/kit']).command, 'repair');
  assert.equal(parseArgs(['update', '--yes', '--root', '/tmp/kit']).command, 'upgrade');
  assert.equal(parseArgs(['upgrade', '--yes', '--root', '/tmp/kit']).command, 'upgrade');
  assert.equal(parseArgs(['uninstall', '--yes', '--root', '/tmp/kit']).command, 'uninstall');
  assert.equal(parseArgs(['repair', '--root', '~/Agentic'], 'win32').installRoot, '~/Agentic/.tools');
  assert.equal(parseArgs(['uninstall', '--root', '~/Agentic', '--handoff'], 'win32').handoff, true);
  assert.throws(() => parseArgs(['doctor', '--handoff'], 'win32'), /--handoff applies only to install and lifecycle/);
  assert.throws(() => parseArgs(['doctor', '--root', '~/Agentic'], 'win32'), /--root must be absolute/);
});

test('reviewed release resolution asks the signed-in gh CLI for the saved channel and proves main ancestry', () => {
  const calls = [], commit = 'd'.repeat(40);
  const gh = (_file, args) => { calls.push(args); return args[1].includes('compare/') ? 'ahead' : commit; };
  assert.equal(resolveReviewedCommit('releases', { gh }), commit);
  assert.match(calls[0][1], /commits\?sha=main&path=manifests\/pilot-skeleton.json&per_page=1/);
  calls.length = 0;
  assert.equal(resolveReviewedCommit('main', { gh }), commit);
  assert.equal(calls[0][1], 'repos/amelie-pierce/agent-kit/commits/main');
  assert.throws(() => resolveReviewedCommit('releases', { gh: (_file, args) => args[1].includes('compare/') ? 'behind' : commit }), /not on main/);
});

test('Windows lifecycle handoff executes the installed kit inside a disposable WSL-style home', { skip: process.platform === 'win32' }, t => {
  const base = mkdtempSync(join(tmpdir(), 'kit-wsl-lifecycle-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const commit = 'e'.repeat(40), root = join(base, 'Agentic', '.tools'), bin = join(root, 'kit', commit, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(root, 'receipt.json'), `${JSON.stringify({ setup: { kit: { commit } } })}\n`);
  writeFileSync(join(bin, 'agent-kit.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))\n');
  const inspected = { supported: true, ready: true, build: 'fixture', linuxArch: 'x64', prerequisites: [], steps: [], wsl: { target: { name: 'Ubuntu' } } };
  const handoff = windowsLifecycle({ command: 'repair', installRoot: '~/Agentic/.tools', yes: true }, {}, inspected);
  const result = spawnSync('bash', ['-c', handoff.argv[6], 'agent-kit-lifecycle', ...handoff.argv.slice(8)],
    { env: { ...process.env, HOME: base }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['repair', '--install-root', root, '--yes']);
});
