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
  for (const name of ['node', 'brew', 'xcode-select', 'bash', 'curl', 'jq', 'python3', 'tar', 'shasum']) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  writeFileSync(join(second, 'node'), 'fixture', { mode: 0o755 });
  const tool = structuredClone(manifest.tools.find(x => x.id === 'node'));
  tool.version.status = 'verified';
  tool.artifacts['darwin-arm64'] = { url: 'https://example.test/node.tgz', sha256: 'a'.repeat(64), status: 'verified', reason: '' };
  const fixtureManifest = { ...manifest, tools: [tool] };
  const context = { env: { HOME: home, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${second}` }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
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
  for (const name of ['node', 'brew', 'xcode-select', 'bash', 'curl', 'jq', 'python3', 'tar', 'shasum']) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    runCommand: path => basename(path) === 'xcode-select' ? '/fake/CommandLineTools' : 'v24.15.0' };
  const result = run(['--check', '--json'], { ...manifest, tools: [manifest.tools[0]] }, context);
  assert.equal(result.exitCode, 1);
  assert.ok(result.result.issues.some(x => x.status === 'unknown'));
  assert.deepEqual(readdirSync(home), []);
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
