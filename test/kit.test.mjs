import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, validateManifest } from '../src/kit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifests/pilot-skeleton.json'), 'utf8'));

const prereqBins = ['node', 'brew', 'xcode-select', 'bash', 'zsh', 'curl', 'jq', 'python3', 'tar', 'unzip', 'shasum'];

function fakeApps(root, names) {
  const dir = join(root, 'Applications');
  for (const name of names) mkdirSync(join(dir, name), { recursive: true });
  return [dir];
}

function tempFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-kit-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  return { root, home, bin };
}

test('bundled manifest is safe and preserves unverified source pins', () => {
  validateManifest(manifest);
  assert.equal(manifest.tools.find(x => x.id === 'firstmate').version.value, null);
  assert.equal(manifest.tools.find(x => x.id === 'zoe-fleet').version.value, null);
  assert.ok(manifest.tools.every(x => Object.values(x.artifacts).every(a => a.sha256 === null && a.status === 'unverified')));
});

test('macOS check uses fake HOME and PATH, detects versions and path precedence', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  const second = join(root, 'second-bin');
  mkdirSync(second);
  for (const name of prereqBins) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  writeFileSync(join(second, 'node'), 'fixture', { mode: 0o755 });
  const tool = structuredClone(manifest.tools.find(x => x.id === 'node'));
  tool.version.status = 'verified';
  tool.artifacts['darwin-arm64'] = { url: 'https://example.test/node.tgz', sha256: 'a'.repeat(64), status: 'verified', reason: '' };
  const fixtureManifest = { ...manifest, tools: [tool] };
  const context = { env: { HOME: home, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${second}`, SHELL: join(bin, 'zsh') }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']),
    runCommand: (path, args) => basename(path) === 'xcode-select' ? '/fake/CommandLineTools' : 'v24.15.0' };
  const result = run(['check', '--json'], fixtureManifest, context);
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.platform.tools[0].status, 'pass');
  assert.equal(result.result.platform.pathConflicts.length, 1);
  assert.ok(result.result.issues.some(x => x.reason.includes('PATH precedence')));
  rmSync(join(second, 'node'));
  const clean = run(['check', '--json'], fixtureManifest, context);
  assert.equal(clean.exitCode, 0);
  assert.deepEqual(readdirSync(home), []);
});

test('unknown pins remain unknown even when the command is present', { skip: process.platform === 'win32' }, t => {
  const { home, bin } = tempFixture(t);
  for (const name of prereqBins) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    runCommand: path => basename(path) === 'xcode-select' ? '/fake/CommandLineTools' : 'v24.15.0' };
  const result = run(['--check', '--json'], { ...manifest, tools: [manifest.tools[0]] }, context);
  assert.equal(result.exitCode, 1);
  assert.ok(result.result.issues.some(x => x.status === 'unknown'));
  assert.deepEqual(readdirSync(home), []);
});

test('unverified observed versions are unknown, never pass or fail', { skip: process.platform === 'win32' }, t => {
  const { home, bin } = tempFixture(t);
  for (const name of prereqBins.concat('git')) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const tools = ['node', 'git'].map(id => manifest.tools.find(x => x.id === id));
  assert.ok(tools.every(x => x.version.status === 'unverified'));
  const outputs = { node: 'v24.21.0', git: 'git version 2.39.5 (Apple Git-154)' };
  for (const [gitOutput, detected] of [[outputs.git, '2.39.5'], [`git version ${tools[1].version.value}`, tools[1].version.value]]) {
    const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.21.0',
      runCommand: path => ({ ...outputs, git: gitOutput })[basename(path)] ?? '/fake/CommandLineTools' };
    const result = run(['check', '--json'], { ...manifest, tools }, context).result;
    for (const id of ['node', 'git']) assert.equal(result.platform.tools.find(x => x.id === id).status, 'unknown');
    assert.equal(result.platform.tools.find(x => x.id === 'git').detected, detected);
    assert.equal(result.platform.tools.find(x => x.id === 'node').detected, '24.21.0');
    assert.ok(!result.issues.some(x => x.id === 'node-runtime'));
    assert.ok(!result.issues.some(x => x.status === 'fail'));
  }
});

test('source commit detection does not walk up into an enclosing HOME repository', { skip: process.platform === 'win32' }, t => {
  const { home } = tempFixture(t);
  const git = (...args) => spawnSync('git', args, { cwd: home, encoding: 'utf8' });
  if (git('--version').status !== 0) return t.skip('git unavailable');
  git('init', '-q');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '--allow-empty', '-m', 'home');
  const homeHead = git('rev-parse', 'HEAD').stdout.trim();
  assert.match(homeHead, /^[a-f0-9]{40}$/);
  mkdirSync(join(home, '.agent-kit/sources/firstmate'), { recursive: true });
  const tool = structuredClone(manifest.tools.find(x => x.id === 'firstmate'));
  tool.version = { kind: 'git-commit', value: 'b'.repeat(40), status: 'verified', reason: '' };
  const result = run(['check', '--json'], { ...manifest, tools: [tool] }, {
    env: { HOME: home, PATH: process.env.PATH }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
  }).result.platform.tools[0];
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'source commit could not be read');
  assert.notEqual(result.detected, homeHead);
});

test('Windows and WSL2 stubs state the handoff and do not inspect tools', t => {
  const { home, bin } = tempFixture(t);
  for (const [platform, env, expected] of [
    ['win32', { HOME: home, PATH: bin }, 'PowerShell/Node preflight'],
    ['linux', { HOME: home, PATH: bin, WSL_DISTRO_NAME: 'Ubuntu' }, 'wsl2 adapter is not yet supported'],
  ]) {
    const result = run(['plan', '--json', '--harness', 'codex'], manifest, { platform, arch: 'x64', env, nodeVersion: '24.15.0' });
    assert.equal(result.exitCode, 1);
    assert.match(result.output, new RegExp(expected));
    assert.equal(result.result.platform.tools.length, 0);
    assert.ok(result.result.plan.tools.some(x => x.id === 'codex'));
    assert.ok(!result.result.plan.tools.some(x => x.id === 'claude'));
    assert.equal(result.result.plan.hookChanges.length, 2);
    assert.equal(result.result.plan.globalHookChanges.length, 0);
  }
  assert.deepEqual(readdirSync(home), []);
});

test('macOS preflight reports shell, install root, unzip, terminal and browser read-only', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  for (const name of prereqBins.filter(name => name !== 'unzip')) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const base = { platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0', runCommand: () => '/fake/CommandLineTools' };
  const status = (result, id) => result.result.platform.prerequisites.find(x => x.id === id);

  const bare = run(['check', '--json'], { ...manifest, tools: [] }, { ...base, env: { HOME: home, PATH: bin }, applicationDirs: [join(root, 'none')] });
  assert.equal(status(bare, 'shell').status, 'unknown');
  assert.equal(status(bare, 'unzip').status, 'fail');
  assert.equal(status(bare, 'zsh').status, 'pass');
  assert.equal(status(bare, 'terminal').status, 'unknown');
  assert.equal(status(bare, 'browser').status, 'fail');
  assert.equal(status(bare, 'install-root').status, 'pass');
  assert.match(status(bare, 'install-root').detail, new RegExp(`nearest existing ancestor ${home}`));

  const apps = fakeApps(root, ['iTerm.app', 'Safari.app']);
  const fish = join(bin, 'fish');
  writeFileSync(fish, 'fixture', { mode: 0o755 });
  const partial = run(['check', '--json'], { ...manifest, tools: [] }, { ...base, env: { HOME: home, PATH: bin, SHELL: fish }, applicationDirs: apps });
  assert.equal(status(partial, 'shell').status, 'unknown');
  assert.equal(status(partial, 'terminal').status, 'pass');
  assert.equal(status(partial, 'browser').status, 'unknown');
  assert.match(status(partial, 'browser').detail, /Google Chrome absent; found .*Safari\.app/);

  const ok = run(['check', '--json'], { ...manifest, tools: [] }, { ...base, env: { HOME: home, PATH: bin, SHELL: join(bin, 'bash') }, applicationDirs: fakeApps(root, ['Google Chrome.app']) });
  assert.equal(status(ok, 'shell').status, 'pass');
  assert.equal(status(ok, 'browser').status, 'pass');
  assert.equal(status(run(['check', '--json'], { ...manifest, tools: [] }, { ...base, env: { HOME: home, PATH: bin, SHELL: join(home, 'missing') } }), 'shell').status, 'fail');
  assert.deepEqual(readdirSync(home), []);

  mkdirSync(join(home, '.agent-kit'), { mode: 0o555 });
  const locked = run(['check', '--json'], { ...manifest, tools: [] }, { ...base, env: { HOME: home, PATH: bin } });
  if (process.getuid?.() !== 0) assert.equal(status(locked, 'install-root').status, 'fail');
  assert.deepEqual(readdirSync(join(home, '.agent-kit')), []);
});

test('plan lists unselected Figma and harness as optional components', t => {
  const { home, bin } = tempFixture(t);
  const context = { platform: 'win32', arch: 'x64', env: { HOME: home, PATH: bin }, nodeVersion: '24.15.0' };
  const claude = run(['plan', '--json'], manifest, context);
  const optional = claude.result.plan.optionalComponents;
  assert.deepEqual(optional.map(x => x.id).sort(), ['codex', 'figma-cli']);
  const codex = optional.find(x => x.id === 'codex');
  const lock = manifest.tools.find(x => x.id === 'codex');
  assert.equal(codex.status, 'optional, not selected');
  assert.equal(codex.version, lock.version.value);
  assert.equal(codex.origin, lock.approvedUpstream);
  const selected = run(['plan', '--json', '--harness', 'codex', '--with-figma'], manifest, context);
  assert.deepEqual(selected.result.plan.optionalComponents.map(x => x.id), ['claude']);
  const text = run(['plan'], manifest, context).output;
  assert.match(text, new RegExp(`- ${lock.name}: optional, not selected; ${lock.version.value.replace(/\./g, '\\.')} from ${lock.approvedUpstream}`));
  assert.deepEqual(readdirSync(home), []);
});

test('unsafe manifest detection and install paths are rejected', () => {
  const badCommand = structuredClone(manifest);
  badCommand.tools[0].detection.args = ['--eval', 'unsafe'];
  assert.throws(() => validateManifest(badCommand), /unsafe detection/);
  const badPath = structuredClone(manifest);
  badPath.tools[0].installLocation.relativePath = '../private';
  assert.throws(() => validateManifest(badPath), /unsafe install location/);
});

test('CLI writes no files under a temporary HOME in check or plan', t => {
  const { home, bin } = tempFixture(t);
  const cli = join(root, 'bin', 'agent-kit.mjs');
  for (const command of ['check', 'plan']) {
    const result = spawnSync(process.execPath, [cli, command, '--json'], {
      env: { HOME: home, PATH: bin }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).readOnly, true);
    assert.deepEqual(readdirSync(home), []);
  }
});
