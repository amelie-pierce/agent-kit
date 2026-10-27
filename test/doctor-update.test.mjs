import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { doctor } from '../src/doctor.mjs';
import { applyUpdate, planUpdate, processRunning } from '../src/update.mjs';
import { secondmateTemplate } from '../src/secondmate.mjs';
import { parseArgs } from '../src/kit.mjs';

const sha = body => createHash('sha256').update(body).digest('hex');
const bundled = JSON.parse(readFileSync(new URL('../manifests/pilot-skeleton.json', import.meta.url)));
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'kit-doctor-update-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), root = join(base, 'kit'), firstmate = join(base, 'firstmate');
  mkdirSync(home); mkdirSync(root); mkdirSync(firstmate);
  for (const dir of ['bin', 'data', 'state', 'config', 'projects']) mkdirSync(join(firstmate, dir));
  writeFileSync(join(firstmate, 'README.md'), 'source fixture\n');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: firstmate, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q'); git('add', 'README.md'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  git('remote', 'add', 'origin', bundled.tools.find(x => x.id === 'firstmate').approvedUpstream);
  const commit = git('rev-parse', 'HEAD');
  const old = join(root, 'releases', 'old-release', 'bin');
  mkdirSync(old, { recursive: true }); writeFileSync(join(old, 'herdr'), 'old-binary', { mode: 0o755 });
  const firstTool = structuredClone(bundled.tools.find(x => x.id === 'firstmate'));
  firstTool.version.value = commit;
  const herdr = structuredClone(bundled.tools.find(x => x.id === 'herdr'));
  herdr.version.value = '2.0.0';
  herdr.artifacts['darwin-arm64'] = { url: 'https://fixture.test/herdr', sha256: sha('new-binary'), status: 'verified', reason: '' };
  const manifest = { ...bundled, release: 'new-release', tools: [firstTool, herdr] };
  const receipt = { schemaVersion: 1, release: 'old-release', phases: {
    firstmate: { state: 'complete', version: commit, artifactSha256: firstTool.artifacts['darwin-arm64'].sha256, path: firstmate },
    herdr: { state: 'complete', version: '1.0.0', artifactSha256: sha('old-artifact'), path: 'releases/old-release/bin/herdr', ownedSha256: sha('old-binary') },
  } };
  const receiptPath = join(root, 'receipt.json');
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const options = { installRoot: root, home, env: { HOME: home, PATH: '/usr/bin:/bin' }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0', reviewed: true,
    fetchArtifact: async (_url, destination) => writeFileSync(destination, 'new-binary'), isRunning: async () => false };
  return { base, home, root, firstmate, manifest, receiptPath, options };
}

test('doctor verifies receipt, digest, path precedence, modes and unknown auth/live state', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const result = doctor(f.manifest, f.options);
  const find = id => result.checks.find(x => x.id === id);
  assert.equal(find('receipt-mode').status, 'pass');
  assert.equal(find('firstmate').status, 'pass');
  assert.equal(find('herdr').status, 'pass');
  assert.equal(find('authenticated').status, 'unknown');
  assert.equal(find('live-tested').status, 'unknown');
  writeFileSync(join(f.root, 'releases', 'old-release', 'bin', 'herdr'), 'edited');
  assert.equal(doctor(f.manifest, f.options).checks.find(x => x.id === 'herdr').status, 'fail');
  writeFileSync(join(f.root, 'releases', 'old-release', 'bin', 'herdr'), 'old-binary');
  chmodSync(f.receiptPath, 0o644);
  assert.equal(doctor(f.manifest, f.options).checks.find(x => x.id === 'receipt-mode').status, 'fail');
});

test('doctor checks person-installed floors and links without requiring optional Figma', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), bin = join(f.base, 'bin');
  mkdirSync(bin);
  for (const [name, version] of Object.entries({ node: 'v24.15.0', git: 'git version 2.20.0', gh: 'gh version 2.0.0', claude: '2.0.0 (Claude Code)' }))
    writeFileSync(join(bin, name), `#!/bin/sh\necho '${version}'\n`, { mode: 0o755 });
  const manifest = { ...f.manifest, tools: [...bundled.tools.filter(x => x.kind === 'prerequisite'), ...f.manifest.tools] };
  const options = { ...f.options, env: { HOME: f.home, PATH: `${bin}:/usr/bin:/bin`, SHELL: '/bin/bash' } };
  const checks = doctor(manifest, options).checks;
  assert.equal(checks.find(x => x.id === 'prerequisite-github-cli').status, 'pass');
  assert.equal(checks.find(x => x.id === 'prerequisite-figma-cli').status, 'warn');
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "gh version 1.9.9"\n', { mode: 0o755 });
  const old = doctor(manifest, options);
  assert.equal(old.exitCode, 1);
  assert.match(old.checks.find(x => x.id === 'prerequisite-github-cli').detail, /https:\/\/github.com\/cli\/cli#installation/);
  const receipt = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  receipt.phases['npm-codex'] = { path: 'releases/new-release/npm-codex' };
  writeFileSync(f.receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  assert.equal(doctor(manifest, options).checks.some(x => x.id === 'prerequisite-claude'), false);
});

test('update plan is read-only; apply keeps prior binary and updates receipt after verified activation', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const before = readFileSync(f.receiptPath, 'utf8');
  assert.throws(() => planUpdate(f.manifest, { ...f.options, reviewed: false }), /not a clean commit/);
  const plan = planUpdate(f.manifest, f.options);
  assert.equal(plan.fromRelease, 'old-release');
  assert.equal(plan.changes.find(x => x.id === 'herdr').action, 'stage and verify');
  assert.equal(readFileSync(f.receiptPath, 'utf8'), before);
  const applied = await applyUpdate(f.manifest, f.options);
  assert.equal(applied.components.find(x => x.id === 'herdr').status, 'installed');
  assert.equal(readFileSync(join(f.root, 'releases', 'old-release', 'bin', 'herdr'), 'utf8'), 'old-binary');
  assert.equal(readFileSync(join(f.root, 'releases', 'new-release', 'bin', 'herdr'), 'utf8'), 'new-binary');
  assert.equal(JSON.parse(readFileSync(f.receiptPath)).release, 'new-release');
  assert.equal(readdirSync(join(f.firstmate, 'data')).length, 0);
});

test('running binary defers activation and dirty Firstmate is a conflict', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const deferred = await applyUpdate(f.manifest, { ...f.options, isRunning: async id => id === 'herdr' });
  assert.equal(deferred.components.find(x => x.id === 'herdr').status, 'deferred');
  assert.equal(JSON.parse(readFileSync(f.receiptPath)).release, 'old-release');
  assert.equal(JSON.parse(readFileSync(f.receiptPath)).pendingUpdate, 'new-release');
  assert.equal(readdirSync(join(f.root, 'releases', 'old-release', 'bin')).includes('herdr'), true);
  writeFileSync(join(f.firstmate, 'README.md'), 'dirty');
  planUpdate(f.manifest, f.options);
  const reported = await applyUpdate(f.manifest, f.options);
  assert.equal(reported.components.find(x => x.id === 'firstmate').status, 'conflict');
  assert.equal(readFileSync(join(f.firstmate, 'README.md'), 'utf8'), 'dirty');
});

test('digest failure keeps the prior binary; changed Firstmate pin uses guarded handoff', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  await assert.rejects(applyUpdate(f.manifest, { ...f.options, fetchArtifact: async (_url, path) => writeFileSync(path, 'wrong') }), /SHA-256 mismatch/);
  assert.equal(readFileSync(join(f.root, 'releases', 'old-release', 'bin', 'herdr'), 'utf8'), 'old-binary');
  assert.equal(JSON.parse(readFileSync(f.receiptPath)).release, 'old-release');
  const changed = structuredClone(f.manifest);
  changed.tools.find(x => x.id === 'firstmate').version.value = 'a'.repeat(40);
  const result = await applyUpdate(changed, f.options);
  const firstmate = result.components.find(x => x.id === 'firstmate');
  assert.equal(firstmate.status, 'conflict');
  assert.match(firstmate.reason, /\/updatefirstmate/);
  assert.equal(readFileSync(join(f.firstmate, 'README.md'), 'utf8'), 'source fixture\n');
});

test('Firstmate pin change finishes after the guarded /updatefirstmate handoff', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: f.firstmate, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const oldPin = git('rev-parse', 'HEAD');
  writeFileSync(join(f.firstmate, 'README.md'), 'reviewed update\n');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qam', 'next');
  const newPin = git('rev-parse', 'HEAD');
  git('checkout', '-q', '--detach', oldPin);
  const changed = structuredClone(f.manifest);
  changed.tools.find(x => x.id === 'firstmate').version.value = newPin;
  const first = await applyUpdate(changed, f.options);
  assert.equal(first.components.find(x => x.id === 'firstmate').status, 'conflict');
  assert.equal(JSON.parse(readFileSync(f.receiptPath)).pendingUpdate, 'new-release');
  git('checkout', '-q', '--detach', newPin);
  const second = await applyUpdate(changed, f.options);
  assert.equal(second.components.find(x => x.id === 'firstmate').status, 'skipped');
  const receipt = JSON.parse(readFileSync(f.receiptPath));
  assert.equal(receipt.release, 'new-release');
  assert.equal(receipt.pendingUpdate, undefined);
  assert.equal(receipt.phases.firstmate.version, newPin);
  assert.equal(readFileSync(join(f.root, 'releases', 'old-release', 'bin', 'herdr'), 'utf8'), 'old-binary');
  assert.equal(doctor(changed, f.options).checks.find(x => x.id === 'firstmate').status, 'pass');
});

test('no-mistakes daemon status asks the receipt-recorded kit binary, not PATH', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), bin = join(f.base, 'kit-no-mistakes'), marker = join(f.base, 'asked');
  writeFileSync(bin, `#!/bin/sh\necho "$1 $2" > '${marker}'\necho "daemon running"\n`, { mode: 0o755 });
  assert.equal(processRunning('no-mistakes', bin), true);
  assert.equal(readFileSync(marker, 'utf8'), 'daemon status\n');
});

test('doctor catches a shadowing binary without running it', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), shadow = join(f.base, 'shadow');
  mkdirSync(shadow);
  const ran = join(f.base, 'shadow-ran');
  for (const name of ['herdr', 'treehouse', 'no-mistakes']) writeFileSync(join(shadow, name), `#!/bin/sh\necho "${name} $*" >> '${ran}'\nexit 99\n`, { mode: 0o755 });
  const result = doctor(f.manifest, { ...f.options, env: { HOME: f.home, PATH: `${shadow}:/usr/bin:/bin` } });
  assert.equal(result.checks.find(x => x.id === 'herdr-path').status, 'fail');
  assert.equal(existsSync(ran), false, 'doctor must not execute PATH binaries');
});

test('starter output is inert and contains no owner paths or origins', () => {
  const output = secondmateTemplate();
  assert.match(output, /FM_SECONDMATE_CHARTER/);
  assert.match(output, /bin\/fm-brief\.sh <id> --secondmate --no-projects/);
  assert.match(output, /bin\/fm-home-seed\.sh <id> <home\|-> --no-projects/);
  assert.match(output, /bin\/fm-spawn\.sh <id> --secondmate/);
  assert.doesNotMatch(output, /pikenguyen|amelie-pierce|\/Users\/|github\.com|@example/);
  assert.equal(parseArgs(['secondmate-template', '--print']).command, 'secondmate-template');
  assert.equal(parseArgs(['--update', '--install-root', '/tmp/kit']).command, 'upgrade');
  assert.throws(() => parseArgs(['update', '--yes', '--install-root', '/tmp/kit', '--firstmate-home', '/tmp/home']), /does not apply|requires|unknown/);
});
