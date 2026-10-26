import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync, copyFileSync, existsSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, validateManifest } from '../src/kit.mjs';
import { formatInstall, installPlatform } from '../src/install/macos.mjs';
import { applyHooks, previewHooks, publicHookChanges } from '../src/install/hooks.mjs';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifests/pilot-skeleton.json'), 'utf8'));

const prereqBins = ['node', 'brew', 'xcode-select', 'bash', 'zsh', 'curl', 'jq', 'python3', 'tar', 'unzip', 'shasum'];

function fakeApps(root, names) {
  const dir = join(root, 'Applications');
  for (const name of names) mkdirSync(join(dir, name), { recursive: true });
  return [dir];
}

function tempFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-kit-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  return { root, home, bin };
}

test('bundled manifest keeps verified source commits and macOS/Linux digests', () => {
  validateManifest(manifest);
  assert.match(manifest.tools.find(x => x.id === 'firstmate').version.value, /^[a-f0-9]{40}$/);
  assert.match(manifest.tools.find(x => x.id === 'zoe-fleet').version.value, /^[a-f0-9]{40}$/);
  assert.ok(['firstmate', 'zoe-fleet', 'herdr', 'treehouse', 'no-mistakes', 'shellcheck', 'actionlint'].every(id =>
    ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].every(target => manifest.tools.find(x => x.id === id).artifacts[target].status === 'verified')));
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
  const { home, bin, root } = tempFixture(t);
  for (const name of prereqBins) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']),
    runCommand: path => basename(path) === 'xcode-select' ? '/fake/CommandLineTools' : 'v24.15.0' };
  const result = run(['--check', '--json'], { ...manifest, tools: [manifest.tools[0]] }, context);
  assert.equal(result.exitCode, 1);
  assert.ok(result.result.issues.some(x => x.status === 'unknown'));
  assert.deepEqual(readdirSync(home), []);
});

test('unverified observed versions are unknown, never pass or fail', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  const applicationDirs = fakeApps(root, ['Terminal.app', 'Google Chrome.app']);
  for (const name of prereqBins.concat('git')) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const tools = ['node', 'git'].map(id => manifest.tools.find(x => x.id === id));
  assert.ok(tools.every(x => x.version.status === 'unverified'));
  const outputs = { node: 'v24.21.0', git: 'git version 2.39.5 (Apple Git-154)' };
  for (const [gitOutput, detected] of [[outputs.git, '2.39.5'], [`git version ${tools[1].version.value}`, tools[1].version.value]]) {
    const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.21.0', applicationDirs,
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
  const { home, root } = tempFixture(t);
  mkdirSync(join(home, '.git'));
  mkdirSync(join(home, '.agent-kit/sources/firstmate'), { recursive: true });
  const tool = structuredClone(manifest.tools.find(x => x.id === 'firstmate'));
  tool.version = { kind: 'git-commit', value: 'b'.repeat(40), status: 'verified', reason: '' };
  const result = run(['check', '--json'], { ...manifest, tools: [tool] }, {
    env: { HOME: home, PATH: process.env.PATH }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']),
  }).result.platform.tools[0];
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'source commit could not be read');
  assert.equal(result.detected, undefined);
});

test('Windows stub remains read only and unsupported', t => {
  const { home, bin } = tempFixture(t);
  for (const [platform, env, expected] of [['win32', { HOME: home, PATH: bin }, 'PowerShell/Node preflight']]) {
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

test('Linux and WSL2 inspect distro, libc, tools, paths and select Linux artifacts', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  for (const name of ['git', 'curl', 'tar', 'unzip', 'bash', 'sh', 'sha256sum', 'herdr']) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const tool = structuredClone(manifest.tools.find(x => x.id === 'herdr'));
  const fixtureManifest = { ...manifest, tools: [tool] };
  const base = { platform: 'linux', arch: 'x64', libc: 'glibc', osRelease: 'ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04 LTS"\n', procVersion: 'Linux version 6.8', nodeVersion: '24.21.0',
    runCommand: () => 'herdr 0.9.3' };
  for (const env of [{ HOME: home, PATH: bin, SHELL: join(bin, 'bash') }, { HOME: home, PATH: bin, SHELL: join(bin, 'bash'), WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/1_interop' }]) {
    const result = run(['plan', '--json', '--install-root', join(root, 'kit')], fixtureManifest, { ...base, env });
    assert.equal(result.result.platform.supported, true);
    assert.equal(result.result.platform.distro, 'Ubuntu 24.04 LTS');
    assert.equal(result.result.platform.libc, 'glibc');
    assert.equal(result.result.platform.wsl2, Boolean(env.WSL_INTEROP));
    assert.equal(result.result.platform.tools[0].status, 'pass');
    assert.equal(result.result.plan.tools[0].artifactUrl, tool.artifacts['linux-x64'].url);
    assert.ok(result.result.plan.globalHookChanges.length > 0);
    assert.equal(result.result.platform.prerequisites.find(x => x.id === 'sha256sum').status, 'pass');
    if (env.WSL_INTEROP) assert.match(result.result.platform.message, /Windows/);
  }
  assert.deepEqual(readdirSync(home), []);
});

test('Linux preflight reports browser and terminal without failing; WSL2 marks them Windows side', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  for (const name of ['git', 'curl', 'tar', 'unzip', 'bash', 'sh', 'sha256sum', 'herdr']) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const fixtureManifest = { ...manifest, tools: [structuredClone(manifest.tools.find(x => x.id === 'herdr'))] };
  const base = { platform: 'linux', arch: 'x64', libc: 'glibc', osRelease: 'ID=ubuntu\n', procVersion: 'Linux version 6.8', nodeVersion: '24.21.0', runCommand: () => 'herdr 0.9.3' };
  const check = env => {
    const result = run(['check', '--json', '--install-root', join(root, 'kit')], fixtureManifest, { ...base, env: { HOME: home, PATH: bin, SHELL: join(bin, 'bash'), ...env } });
    const prereq = id => result.result.platform.prerequisites.find(x => x.id === id);
    return { browser: prereq('browser'), terminal: prereq('terminal'), issues: result.result.issues, advisories: result.result.advisories,
      summary: result.result.summary, exitCode: result.exitCode, output: run(['check', '--install-root', join(root, 'kit')], fixtureManifest, { ...base, env: { HOME: home, PATH: bin, SHELL: join(bin, 'bash'), ...env } }).output };
  };
  const headless = check({});
  assert.equal(headless.browser.status, 'warn');
  assert.match(headless.browser.detail, /chrome-devtools-axi and Lavish need a browser/);
  assert.equal(headless.terminal.status, 'unknown');
  assert.match(headless.terminal.detail, /TTY or SSH/);
  assert.match(check({ SSH_CONNECTION: '10.0.0.1 1 10.0.0.2 22' }).terminal.detail, /SSH session/);
  assert.deepEqual(headless.issues, []);
  assert.deepEqual(headless.advisories.map(x => [x.id, x.status]), [['terminal', 'unknown'], ['browser', 'warn']]);
  assert.deepEqual([headless.summary, headless.exitCode], ['ready', 0]);
  assert.match(headless.output, /Advisories \(do not block readiness\):\n- UNKNOWN terminal: .*\n- WARN browser: /);
  for (const name of ['chromium', 'x-terminal-emulator']) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const desktop = check({});
  assert.deepEqual([desktop.browser.status, desktop.browser.detail], ['pass', join(bin, 'chromium')]);
  assert.deepEqual([desktop.terminal.status, desktop.terminal.detail], ['pass', join(bin, 'x-terminal-emulator')]);
  assert.deepEqual([desktop.advisories, desktop.exitCode], [[], 0]);
  const wsl2 = check({ WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/1_interop' });
  for (const prereq of [wsl2.browser, wsl2.terminal]) {
    assert.equal(prereq.status, 'unknown');
    assert.match(prereq.detail, /Windows side, not checked from Linux/);
  }
  assert.deepEqual(wsl2.advisories.map(x => [x.id, x.status]), [['terminal', 'unknown'], ['browser', 'unknown']]);
  assert.deepEqual([wsl2.issues, wsl2.summary, wsl2.exitCode], [[], 'ready', 0]);
  rmSync(join(bin, 'sha256sum'));
  const missingTool = check({ WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/1_interop' });
  assert.deepEqual([missingTool.issues.map(x => [x.id, x.status]), missingTool.exitCode], [[['sha256sum', 'fail']], 1]);
  assert.deepEqual(readdirSync(home), []);
});

test('manifest lock has no separate WSL2 artifact targets', () => {
  const tool = structuredClone(manifest.tools.find(x => x.id === 'herdr'));
  tool.artifacts['wsl2-x64'] = { ...tool.artifacts['linux-x64'] };
  assert.throws(() => validateManifest({ ...manifest, tools: [tool] }), /invalid target for herdr/);
});

test('Linux unsupported architecture, libc and WSL1 refuse before inspection or writes', async t => {
  const f = installFixture(t);
  for (const override of [{ arch: 'mips', libc: 'glibc' }, { arch: 'x64', libc: 'musl' }, { arch: 'x64', libc: 'glibc', env: { WSL_DISTRO_NAME: 'Ubuntu' }, procVersion: 'Microsoft WSL1' }]) {
    const options = { ...f.options, platform: 'linux', ...override };
    const result = await installPlatform(f.fixtureManifest, options);
    assert.equal(result.status, 'unsupported');
    assert.equal(existsSync(f.installRoot), false);
    const planned = run(['check', '--json'], f.fixtureManifest, { ...options, env: { HOME: f.home, PATH: f.bin, ...override.env } });
    assert.equal(planned.result.platform.supported, false);
    assert.deepEqual(planned.result.platform.tools, []);
    if (override.procVersion) {
      assert.equal(planned.result.platform.platform, 'wsl1');
      const plan = run(['plan', '--json'], f.fixtureManifest, { ...options, env: { HOME: f.home, PATH: f.bin, ...override.env } });
      assert.deepEqual(plan.result.plan.globalHookChanges, []);
    }
  }
});

test('macOS preflight reports shell, install root, unzip, terminal and browser read-only', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  for (const name of prereqBins.filter(name => name !== 'unzip')) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const base = { platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0', runCommand: () => '/fake/CommandLineTools', applicationDirs: [join(root, 'none')] };
  const status = (result, id) => result.result.platform.prerequisites.find(x => x.id === id);

  const bare = run(['check', '--json'], { ...manifest, tools: [] }, { ...base, env: { HOME: home, PATH: bin } });
  assert.equal(status(bare, 'shell').status, 'unknown');
  assert.equal(status(bare, 'unzip').status, 'fail');
  assert.equal(status(bare, 'zsh').status, 'pass');
  assert.equal(status(bare, 'terminal').status, 'unknown');
  assert.equal(status(bare, 'browser').status, 'fail');
  assert.ok(bare.result.issues.some(x => x.id === 'unzip' && x.status === 'fail'));
  assert.ok(!bare.result.issues.some(x => ['terminal', 'browser'].includes(x.id)));
  assert.deepEqual(bare.result.advisories.map(x => [x.id, x.status]), [['terminal', 'unknown'], ['browser', 'fail']]);
  assert.equal(bare.exitCode, 1);
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

test('install dry-run plans the selected root and stays read-only', t => {
  const { home, root } = tempFixture(t);
  const installRoot = join(root, 'new-kit'), firstmateHome = join(root, 'fresh-firstmate');
  const context = { platform: 'darwin', arch: 'arm64', env: { HOME: home, PATH: '' }, nodeVersion: '24.15.0', applicationDirs: [] };
  const result = run(['install', '--dry-run', '--json', '--install-root', installRoot, '--firstmate-home', firstmateHome], manifest, context);
  assert.equal(result.result.command, 'plan');
  assert.equal(result.result.readOnly, true);
  assert.equal(result.result.plan.tools.find(x => x.id === 'firstmate').installLocation, firstmateHome);
  assert.equal(result.result.plan.tools.find(x => x.id === 'zoe-fleet').installLocation, join(installRoot, 'releases', manifest.release, 'zoetrope', 'bin', 'zoe-fleet'));
  assert.deepEqual(readdirSync(home), []);
  assert.equal(existsSync(installRoot), false);
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
  for (const args of [['check'], ['plan'], ['install', '--dry-run']]) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      env: { HOME: home, PATH: bin }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).readOnly, true);
    assert.deepEqual(readdirSync(home), []);
  }
});

test('--with-figma does not run figma-cli, which writes into HOME', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  writeFileSync(join(bin, 'figma-cli'), '#!/bin/sh\n/bin/mkdir -p "$HOME/.figma-cli/plugins"\necho 2.2.5-make.2\n', { mode: 0o755 });
  const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']) };
  for (const command of ['check', 'plan']) {
    const result = run([command, '--json', '--with-figma'], manifest, context);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(readdirSync(home), []);
    const figma = result.result.platform.tools.find(x => x.id === 'figma-cli');
    assert.equal(figma.status, 'unknown');
    assert.deepEqual(figma.paths, [join(bin, 'figma-cli')]);
  }
});

function installFixture(t) {
  const { root, home, bin } = tempFixture(t);
  const installRoot = join(root, 'kit');
  const firstmateHome = join(root, 'fresh-firstmate');
  const artifact = join(root, 'herdr-fixture');
  writeFileSync(artifact, 'fixture herdr binary', { mode: 0o755 });
  const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  const herdr = structuredClone(manifest.tools.find(x => x.id === 'herdr'));
  herdr.artifacts['darwin-arm64'] = { url: 'https://fixture.test/herdr', sha256: digest, status: 'verified', reason: '' };
  const fixtureManifest = { ...manifest, release: 'fixture-1', tools: [herdr] };
  const downloads = [];
  const options = { platform: 'darwin', arch: 'arm64', nodeVersion: '24.21.0', home, installRoot, firstmateHome,
    fetchArtifact: async (url, target) => { downloads.push(url); copyFileSync(artifact, target); } };
  return { root, home, bin, installRoot, firstmateHome, artifact, fixtureManifest, options, downloads };
}

test('macOS install verifies ownership and a second run is a no-op', async t => {
  const f = installFixture(t);
  const first = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(first.status, 'installed');
  assert.equal(first.components[0].status, 'installed');
  assert.equal(f.downloads.length, 1);
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(second.components[0].status, 'skipped');
  assert.equal(f.downloads.length, 1);
  const receipt = JSON.parse(readFileSync(first.receipt));
  assert.equal(receipt.phases.herdr.state, 'complete');
  assert.equal(receipt.phases.herdr.artifactSha256, f.fixtureManifest.tools[0].artifacts['darwin-arm64'].sha256);
});

test('interrupted install resumes completed phases', async t => {
  const f = installFixture(t);
  const second = structuredClone(f.fixtureManifest.tools[0]);
  second.id = 'actionlint'; second.name = 'actionlint';
  f.fixtureManifest.tools.push(second);
  await assert.rejects(installPlatform(f.fixtureManifest, { ...f.options, afterPhase: id => { if (id === 'herdr') throw new Error('interrupted'); } }), /interrupted/);
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(result.components.map(x => x.status), ['skipped', 'installed']);
});

test('checksum mismatch refuses activation', async t => {
  const f = installFixture(t);
  f.fixtureManifest.tools[0].artifacts['darwin-arm64'].sha256 = '0'.repeat(64);
  await assert.rejects(installPlatform(f.fixtureManifest, f.options), /SHA-256 mismatch/);
  assert.equal(existsSync(join(f.installRoot, 'releases', 'fixture-1', 'bin', 'herdr')), false);
});

test('unsupported targets stop before any write', async t => {
  const f = installFixture(t);
  for (const [platform, arch] of [['win32', 'arm64'], ['darwin', 'mips']]) {
    const result = await installPlatform(f.fixtureManifest, { ...f.options, platform, arch });
    assert.equal(result.status, 'unsupported');
    assert.match(formatInstall(result), new RegExp(`^Agent Kit install: unsupported\nunsupported install target ${platform}/${arch}\n`));
  }
  assert.deepEqual(readdirSync(f.home), []);
});

test('Linux fixture install reuses receipts, checksum verification and global hooks', { skip: process.platform === 'win32' }, async t => {
  const f = installFixture(t);
  const artifact = f.fixtureManifest.tools[0].artifacts['darwin-arm64'];
  f.fixtureManifest.tools[0].artifacts['linux-arm64'] = { ...artifact };
  f.options = { ...f.options, platform: 'linux', libc: 'glibc' };
  const first = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(first.status, 'installed');
  assert.equal(first.components[0].status, 'installed');
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(second.components[0].status, 'skipped');
  assert.equal(f.downloads.length, 1);
  assert.equal(JSON.parse(readFileSync(first.receipt)).phases.herdr.artifactSha256, artifact.sha256);

  const hooks = hookFixture(t);
  const preview = previewHooks(hooks.fixtureManifest, hooks);
  assert.ok(preview.files.some(x => x.changes.length));
  await applyHooks(preview, hooks);
  assert.equal(previewHooks(hooks.fixtureManifest, hooks).files.flatMap(x => x.changes).length, 0);
  assert.ok(existsSync(join(hooks.home, '.claude', 'settings.json')));
});

test('WSL2 install selects Linux artifact and prints Windows-side notes', async t => {
  const f = installFixture(t);
  f.fixtureManifest.tools[0].artifacts['linux-arm64'] = { ...f.fixtureManifest.tools[0].artifacts['darwin-arm64'] };
  const result = await installPlatform(f.fixtureManifest, { ...f.options, platform: 'linux', libc: 'glibc', env: { WSL_INTEROP: '/run/WSL/1_interop' } });
  assert.equal(result.components[0].status, 'installed');
  assert.match(formatInstall(result), /Windows Terminal and a browser on the Windows side/);
});

test('Linux npm locks include Codex platform packages and run the hooks phase', { skip: process.platform === 'win32' }, async t => {
  const lock = JSON.parse(readFileSync(join(root, 'manifests/npm-codex/package-lock.json')));
  for (const arch of ['x64', 'arm64']) assert.ok(lock.packages[`node_modules/@openai/codex-linux-${arch}`]?.integrity);
  const f = installFixture(t);
  f.fixtureManifest.tools = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'].map(id => structuredClone(manifest.tools.find(x => x.id === id)));
  f.options = { ...f.options, platform: 'linux', libc: 'glibc', runNpm: async stage => {
    const bins = join(stage, 'node_modules', '.bin');
    mkdirSync(bins, { recursive: true });
    for (const id of ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi']) {
      const skill = id === 'lavish-axi' ? 'lavish' : id;
      const path = join(stage, 'node_modules', id, 'skills', skill);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'SKILL.md'), `---\nname: ${skill}\ndescription: fixture\n---\n`);
      writeFileSync(join(bins, id), 'fixture', { mode: 0o755 });
    }
  } };
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(result.components.map(x => x.id), ['npm', 'hooks']);
  assert.deepEqual(result.components.map(x => x.status), ['installed', 'installed']);
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(second.components.map(x => x.status), ['skipped', 'skipped']);
});

function hookFixture(t) {
  const f = tempFixture(t);
  const installRoot = join(f.root, 'kit');
  const ids = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'];
  const fixtureManifest = { ...manifest, release: 'fixture-1', tools: ids.map(id => structuredClone(manifest.tools.find(x => x.id === id))) };
  function packageSkills(release = fixtureManifest.release) {
    const bins = join(installRoot, 'releases', release, 'npm', 'node_modules', '.bin');
    mkdirSync(bins, { recursive: true });
    for (const id of ids) {
      const skill = id === 'lavish-axi' ? 'lavish' : id;
      const path = join(installRoot, 'releases', release, 'npm', 'node_modules', id, 'skills', skill);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'SKILL.md'), `---\nname: ${skill}\ndescription: fixture\n---\n`);
      writeFileSync(join(bins, id), `#!/bin/sh\nprintf '%s\\n' ${id}\n`, { mode: 0o755 });
    }
  }
  packageSkills();
  const receipt = { schemaVersion: 1, release: fixtureManifest.release, phases: {} };
  const save = async () => {};
  return { ...f, installRoot, fixtureManifest, receipt, save, packageSkills };
}

test('global registration previews exact owned changes, preserves unknown settings, and reruns unchanged', { skip: process.platform === 'win32' }, async t => {
  const f = hookFixture(t);
  const claude = join(f.home, '.claude', 'settings.json');
  const codex = join(f.home, '.codex', 'hooks.json');
  const toml = join(f.home, '.codex', 'config.toml');
  mkdirSync(dirname(claude), { recursive: true }); mkdirSync(dirname(codex), { recursive: true });
  const unknown = { type: 'command', command: 'unknown-owned-hook' };
  const original = { hooks: { SessionStart: [{ matcher: '', hooks: [unknown] }], Stop: [{ hooks: [unknown] }] }, permissions: { allow: ['Read'] }, enabledPlugins: { sample: true }, mcpServers: { sample: { command: 'mcp' } }, trust: { sample: true } };
  writeFileSync(claude, `${JSON.stringify(original)}\n`);
  writeFileSync(codex, `${JSON.stringify(original)}\n`);
  const tomlSource = 'model = "test"\n[projects."/x"]\ntrust_level = "trusted"\n[mcp_servers.x]\nargs = [\n  "a",\n  [1, 2]\n]\nnote = \'\'\'\n[features]\n\'\'\'\n[features]\nother = true\n\n[ tui ]\nx = 1\n';
  writeFileSync(toml, tomlSource);
  const before = [readFileSync(claude, 'utf8'), readFileSync(codex, 'utf8'), readFileSync(toml, 'utf8')];
  const preview = previewHooks(f.fixtureManifest, f);
  assert.equal(preview.files.filter(x => x.changes.length).length, 3);
  assert.equal(preview.skills.length, 10);
  const plan = run(['install', '--dry-run', '--json', '--install-root', f.installRoot], f.fixtureManifest,
    { platform: 'darwin', arch: 'arm64', env: { HOME: f.home, PATH: '' }, nodeVersion: '24.15.0', applicationDirs: [] });
  assert.deepEqual(plan.result.plan.globalHookChanges, publicHookChanges(preview));
  assert.deepEqual([readFileSync(claude, 'utf8'), readFileSync(codex, 'utf8'), readFileSync(toml, 'utf8')], before);
  assert.ok(publicHookChanges(preview).some(x => x.changes.some(c => c.after?.[0]?.hooks?.[0]?.command?.endsWith(' # agent-kit:gh-axi'))));
  await applyHooks(preview, f);
  for (const path of [claude, codex]) {
    const actual = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(actual.hooks.Stop, original.hooks.Stop);
    assert.deepEqual(actual.hooks.SessionStart[0], original.hooks.SessionStart[0]);
    for (const key of ['permissions', 'enabledPlugins', 'mcpServers', 'trust']) assert.deepEqual(actual[key], original[key]);
    assert.equal(actual.hooks.SessionStart.length, 5);
    const managed = actual.hooks.SessionStart.find(group => group.hooks.some(hook => hook.command?.endsWith(' # agent-kit:gh-axi'))).hooks[0];
    const execution = spawnSync('/bin/sh', ['-c', managed.command], { encoding: 'utf8', env: { HOME: f.home, PATH: '/usr/bin:/bin' } });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, 'gh-axi\n');
  }
  assert.equal(readFileSync(toml, 'utf8'), tomlSource.replace('other = true\n', 'other = true\nhooks = true\n'));
  assert.equal(readlinkSync(join(f.home, '.agents', 'skills', 'lavish')), join(f.installRoot, 'releases', 'fixture-1', 'npm', 'node_modules', 'lavish-axi', 'skills', 'lavish'));
  const backups = join(f.installRoot, 'backups', 'hooks');
  assert.equal(readdirSync(join(backups, readdirSync(backups)[0])).length, 3);
  const second = previewHooks(f.fixtureManifest, f);
  assert.equal(second.changed, false);
  await applyHooks(second, f);
  assert.equal(readdirSync(backups).length, 1);
});

test('global registration updates and removes only marked entries', { skip: process.platform === 'win32' }, async t => {
  const f = hookFixture(t);
  await applyHooks(previewHooks(f.fixtureManifest, f), f);
  const claude = join(f.home, '.claude', 'settings.json');
  const beforeUpdate = JSON.parse(readFileSync(claude, 'utf8'));
  beforeUpdate.hooks.SessionStart.find(group => group.hooks.some(hook => hook.command?.endsWith(' # agent-kit:gh-axi'))).hooks[0].timeout = 5;
  writeFileSync(claude, `${JSON.stringify(beforeUpdate)}\n`);
  const updated = previewHooks(f.fixtureManifest, f);
  assert.ok(updated.files[0].changes.some(x => x.op === 'replace'));
  await applyHooks(updated, f);
  const afterUpdate = JSON.parse(readFileSync(claude, 'utf8'));
  assert.equal(afterUpdate.hooks.SessionStart.findIndex(group => group.hooks.some(hook => hook.command?.endsWith(' # agent-kit:gh-axi'))),
    beforeUpdate.hooks.SessionStart.findIndex(group => group.hooks.some(hook => hook.command?.endsWith(' # agent-kit:gh-axi'))));
  assert.equal(afterUpdate.hooks.SessionStart.find(group => group.hooks.some(hook => hook.command?.endsWith(' # agent-kit:gh-axi'))).hooks[0].timeout, 10);
  f.fixtureManifest.release = 'fixture-2';
  f.packageSkills();
  const upgrade = previewHooks(f.fixtureManifest, f);
  assert.ok(upgrade.files[0].changes.some(x => x.owner === 'agent-kit:gh-axi' && x.op === 'replace'));
  await applyHooks(upgrade, f);
  assert.ok(readFileSync(claude, 'utf8').includes(join(f.installRoot, 'releases', 'fixture-2', 'npm', 'node_modules', '.bin', 'gh-axi')));
  assert.equal(readlinkSync(join(f.home, '.claude', 'skills', 'gh-axi')), join(f.installRoot, 'releases', 'fixture-2', 'npm', 'node_modules', 'gh-axi', 'skills', 'gh-axi'));
  const moved = readFileSync(claude, 'utf8');
  writeFileSync(claude, moved.replace(join(f.installRoot, 'releases', 'fixture-2'), join(f.root, 'elsewhere')));
  assert.throws(() => previewHooks(f.fixtureManifest, f), /changed outside the kit path/);
  writeFileSync(claude, moved);
  const before = JSON.parse(readFileSync(claude, 'utf8'));
  before.hooks.SessionStart.unshift({ hooks: [{ type: 'command', command: 'unknown-hook' }] });
  writeFileSync(claude, `${JSON.stringify(before)}\n`);
  f.fixtureManifest.tools = f.fixtureManifest.tools.filter(x => x.id !== 'tasks-axi');
  const removal = previewHooks(f.fixtureManifest, f);
  assert.ok(removal.files[0].changes.some(x => x.owner === 'agent-kit:tasks-axi' && x.op === 'remove'));
  await applyHooks(removal, f);
  const actual = JSON.parse(readFileSync(claude, 'utf8'));
  assert.equal(actual.hooks.SessionStart[0].hooks[0].command, 'unknown-hook');
  assert.ok(!JSON.stringify(actual).includes(' # agent-kit:tasks-axi'));
  assert.ok(JSON.stringify(actual).includes(' # agent-kit:gh-axi'));
  assert.equal(existsSync(join(f.home, '.agents', 'skills', 'tasks-axi')), false);
});

test('malformed global files and unowned skill conflicts refuse the hooks phase', { skip: process.platform === 'win32' }, async t => {
  const f = hookFixture(t);
  const claude = join(f.home, '.claude', 'settings.json');
  const toml = join(f.home, '.codex', 'config.toml');
  mkdirSync(dirname(claude), { recursive: true }); mkdirSync(dirname(toml), { recursive: true });
  writeFileSync(claude, '{bad');
  assert.throws(() => previewHooks(f.fixtureManifest, f), /malformed JSON/);
  assert.equal(readFileSync(claude, 'utf8'), '{bad');
  const context = { platform: 'darwin', arch: 'arm64', env: { HOME: f.home, PATH: '' }, nodeVersion: '24.15.0', applicationDirs: [] };
  const refused = run(['plan', '--json', '--install-root', f.installRoot], f.fixtureManifest, context);
  assert.deepEqual(refused.result.plan.globalHookChanges, []);
  assert.ok(refused.result.issues.some(x => x.id === 'hooks' && x.status === 'conflict' && /malformed JSON/.test(x.reason)));
  assert.ok(refused.result.plan.tools.length > 0);
  writeFileSync(claude, '{}\n'); writeFileSync(toml, '[features]\nhooks = "yes"\n');
  assert.throws(() => previewHooks(f.fixtureManifest, f), /invalid features.hooks/);
  writeFileSync(toml, 'not toml\n');
  assert.throws(() => previewHooks(f.fixtureManifest, f), /malformed TOML/);
  writeFileSync(toml, 'x = [\n  [1, 2]\n]\nfeatures.hooks = false\n');
  assert.throws(() => previewHooks(f.fixtureManifest, f), /dotted or inline features/);
  writeFileSync(toml, 'note = "a\n');
  assert.throws(() => previewHooks(f.fixtureManifest, f), /malformed TOML/);
  writeFileSync(toml, 'args = [\n  "a",\n');
  assert.throws(() => previewHooks(f.fixtureManifest, f), /unterminated TOML value/);
  const commented = '# say """\n[features]\nlist = [\n  [1, 2]\n]\nhooks = false # off\n';
  writeFileSync(toml, commented);
  assert.equal(previewHooks(f.fixtureManifest, f).files[2].after, commented.replace('hooks = false', 'hooks = true'));
  writeFileSync(toml, '[features]\nhooks = false\n');
  const skill = join(f.home, '.agents', 'skills', 'gh-axi');
  mkdirSync(dirname(skill), { recursive: true }); mkdirSync(skill);
  assert.throws(() => previewHooks(f.fixtureManifest, f), /existing unowned skill/);
  assert.equal(readFileSync(toml, 'utf8'), '[features]\nhooks = false\n');
});

test('Herdr vendor scripts join the owned preview and registration', { skip: process.platform === 'win32' }, async t => {
  const f = hookFixture(t);
  f.fixtureManifest.tools.push(structuredClone(manifest.tools.find(x => x.id === 'herdr')));
  const binary = join(f.installRoot, 'releases', f.fixtureManifest.release, 'bin', 'herdr');
  mkdirSync(dirname(binary), { recursive: true }); writeFileSync(binary, 'fixture', { mode: 0o755 });
  f.receipt.phases.herdr = { state: 'complete', ownedSha256: createHash('sha256').update('fixture').digest('hex') };
  const preview = previewHooks(f.fixtureManifest, f);
  assert.deepEqual(preview.scripts.map(x => x.op), ['add', 'add']);
  assert.ok(preview.files[0].changes.some(x => x.owner === 'agent-kit:herdr-claude'));
  assert.ok(preview.files[1].changes.some(x => x.owner === 'agent-kit:herdr-codex'));
  const generated = new Map();
  for (const script of preview.scripts) {
    const body = Buffer.from(`#!/bin/sh\n# fixture ${script.id}\n`);
    script.sha256 = createHash('sha256').update(body).digest('hex');
    generated.set(script.id, body);
  }
  await applyHooks(preview, { ...f, generateHerdrHooks: async () => generated });
  for (const script of preview.scripts) assert.deepEqual(readFileSync(script.path), generated.get(script.id));
  assert.equal(JSON.parse(readFileSync(join(f.home, '.claude', 'settings.json'))).hooks.SessionStart.at(-1).matcher, '^(startup|resume|clear|compact|fork)$');
  assert.equal(f.receipt.phases.hooks.scripts.length, 2);
  for (const script of preview.scripts) rmSync(script.path);
  const rerun = previewHooks(f.fixtureManifest, f);
  assert.deepEqual(rerun.files.flatMap(x => x.changes), []);
});

function firstmateFixture(t) {
  const f = installFixture(t);
  const repo = join(f.root, 'firstmate-upstream');
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), 'tracked fixture\n');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('add', 'README.md');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  const archive = join(f.root, 'source.tar.gz');
  git('archive', '--format=tar.gz', '--prefix=snapshot/', '-o', archive, 'HEAD');
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const tool = id => {
    const tool = structuredClone(manifest.tools.find(x => x.id === id));
    tool.artifacts['darwin-arm64'] = { url: `https://fixture.test/${id}.tar.gz`, sha256: digest, status: 'verified', reason: '' };
    return tool;
  };
  const firstmate = tool('firstmate');
  firstmate.version.value = git('rev-parse', 'HEAD');
  firstmate.approvedUpstream = `file://${repo}`;
  f.fixtureManifest.tools = [firstmate];
  f.options.fetchArtifact = async (_url, destination) => copyFileSync(archive, destination);
  return { ...f, tool };
}

test('verified source archives create a fresh home and stage a tower build', async t => {
  const f = firstmateFixture(t);
  f.fixtureManifest.tools.push(f.tool('zoe-fleet'));
  // POSIX rename replaces an empty directory; Windows refuses, and the installer targets macOS only.
  if (process.platform !== 'win32') mkdirSync(f.firstmateHome);
  f.options.runCargo = async (_stage, target) => {
    mkdirSync(join(target, 'release'), { recursive: true });
    writeFileSync(join(target, 'release', 'zoe'), 'fixture tower', { mode: 0o755 });
  };
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(result.status, 'partial');
  assert.match(result.towerParity, /manifest and launcher unverified/);
  assert.deepEqual(result.components.map(x => x.status), ['installed', 'installed']);
  assert.equal(result.firstmateHome, f.firstmateHome);
  assert.equal(JSON.parse(readFileSync(result.receipt)).phases.firstmate.path, f.firstmateHome);
  assert.equal(readFileSync(join(f.firstmateHome, 'README.md'), 'utf8'), 'tracked fixture\n');
  for (const dir of ['data', 'state', 'config', 'projects']) assert.deepEqual(readdirSync(join(f.firstmateHome, dir)), []);
  writeFileSync(join(f.firstmateHome, 'data', 'new-person-only'), 'private');
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(second.components.map(x => x.status), ['skipped', 'skipped']);
});

test('Firstmate rerun skips after untracked local settings appear', async t => {
  const f = firstmateFixture(t);
  assert.equal((await installPlatform(f.fixtureManifest, f.options)).components[0].status, 'installed');
  mkdirSync(join(f.firstmateHome, '.claude'));
  writeFileSync(join(f.firstmateHome, '.claude', 'settings.local.json'), '{"permissions":{"allow":["Bash(ls)"]}}\n');
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(second.status, 'installed');
  assert.equal(second.components[0].status, 'skipped');
});

test('interrupted Firstmate staging is replaced on resume', async t => {
  const f = firstmateFixture(t);
  const stale = join(f.root, '.fresh-firstmate.agent-kit-staging');
  mkdirSync(join(stale, '.git'), { recursive: true });
  writeFileSync(join(stale, 'README.md'), 'partial checkout\n');
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(result.components[0].status, 'installed');
  assert.equal(existsSync(stale), false);
  assert.equal(readFileSync(join(f.firstmateHome, 'README.md'), 'utf8'), 'tracked fixture\n');
  assert.deepEqual(readdirSync(f.root).filter(name => name.includes('agent-kit')), []);
});

test('rerun with a different Firstmate home is refused', async t => {
  const f = firstmateFixture(t);
  await installPlatform(f.fixtureManifest, f.options);
  const other = join(f.root, 'other-firstmate');
  await assert.rejects(installPlatform(f.fixtureManifest, { ...f.options, firstmateHome: other }), /differs from the Firstmate home recorded/);
  assert.equal(existsSync(other), false);
  assert.equal((await installPlatform(f.fixtureManifest, f.options)).firstmateHome, f.firstmateHome);
});

test('changed tracked Firstmate file is a phase conflict and other phases continue', async t => {
  const f = firstmateFixture(t);
  await installPlatform(f.fixtureManifest, f.options);
  writeFileSync(join(f.firstmateHome, 'README.md'), 'local edit\n');
  f.fixtureManifest.tools.push(structuredClone(manifest.tools.find(x => x.id === 'herdr')));
  f.fixtureManifest.tools[1].artifacts['darwin-arm64'] = { url: 'https://fixture.test/herdr', status: 'verified', reason: '',
    sha256: createHash('sha256').update(readFileSync(f.artifact)).digest('hex') };
  f.options.fetchArtifact = async (_url, target) => copyFileSync(f.artifact, target);
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(result.status, 'partial');
  assert.equal(result.exitCode, 1);
  assert.equal(result.components[0].status, 'conflict');
  assert.match(result.components[0].reason, /README\.md/);
  assert.equal(result.components[1].status, 'installed');
  assert.equal(result.firstmateHome, null);
  assert.equal(readFileSync(join(f.firstmateHome, 'README.md'), 'utf8'), 'local edit\n');
});

test('Firstmate home outside the install root is refused when unsafe', async t => {
  const f = installFixture(t);
  const refuse = async (firstmateHome, pattern) => {
    await assert.rejects(installPlatform(f.fixtureManifest, { ...f.options, firstmateHome }), pattern);
    assert.equal(existsSync(f.installRoot), false);
  };
  await refuse(f.home, /home directory/);
  // System locations are POSIX paths; on Windows they resolve under the current drive.
  if (process.platform !== 'win32') for (const path of ['/usr/local/agent-kit-firstmate', '/Library/agent-kit-firstmate', join(f.home, 'Library', 'firstmate')]) await refuse(path, /system location/);
  if (process.platform !== 'win32') for (const path of ['/var/lib/firstmate', '/srv/firstmate', '/run/firstmate']) {
    await assert.rejects(installPlatform(f.fixtureManifest, { ...f.options, platform: 'linux', libc: 'glibc', env: {}, firstmateHome: path }), /system location/);
    assert.equal(existsSync(f.installRoot), false);
  }
  await refuse(join(f.installRoot, 'firstmate'), /outside --install-root/);
  await refuse(dirname(f.installRoot), /outside --install-root/);
  mkdirSync(join(f.root, 'checkout', '.git'), { recursive: true });
  await refuse(join(f.root, 'checkout', 'firstmate'), /existing Firstmate home or git checkout/);
  mkdirSync(join(f.root, 'old-firstmate'));
  writeFileSync(join(f.root, 'old-firstmate', 'fm-bootstrap.sh'), '');
  await refuse(join(f.root, 'old-firstmate', 'nested'), /existing Firstmate home or git checkout/);
  mkdirSync(f.firstmateHome);
  writeFileSync(join(f.firstmateHome, 'keep'), 'mine');
  await assert.rejects(installPlatform(f.fixtureManifest, f.options), /new or empty directory/);
  assert.deepEqual(readdirSync(f.firstmateHome), ['keep']);
  assert.equal(existsSync(join(f.installRoot, 'releases', 'fixture-1', 'bin', 'herdr')), false);
});

test('Firstmate archive with runtime home content is refused', async t => {
  const f = installFixture(t);
  const sourceDir = join(f.root, 'source');
  mkdirSync(join(sourceDir, 'snapshot', 'data'), { recursive: true });
  writeFileSync(join(sourceDir, 'snapshot', 'README.md'), 'fixture\n');
  writeFileSync(join(sourceDir, 'snapshot', 'data', 'private'), 'must not copy');
  const archive = join(f.root, 'unsafe.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', sourceDir, 'snapshot']).status, 0);
  const tool = structuredClone(manifest.tools.find(x => x.id === 'firstmate'));
  tool.artifacts['darwin-arm64'] = { url: 'https://fixture.test/unsafe.tar.gz', sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), status: 'verified', reason: '' };
  f.fixtureManifest.tools = [tool];
  f.options.fetchArtifact = async (_url, destination) => copyFileSync(archive, destination);
  await assert.rejects(installPlatform(f.fixtureManifest, f.options), /runtime home content/);
  assert.equal(existsSync(f.firstmateHome), false);
});

test('npm phase uses committed integrity lock and records exact tool versions', async t => {
  const f = installFixture(t);
  f.fixtureManifest.tools = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'].map(id => structuredClone(manifest.tools.find(x => x.id === id)));
  let invocations = 0;
  f.options.runNpm = async stage => {
    invocations++;
    const bins = join(stage, 'node_modules', '.bin');
    mkdirSync(bins, { recursive: true });
    for (const id of ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi']) {
      const skill = id === 'lavish-axi' ? 'lavish' : id;
      const path = join(stage, 'node_modules', id, 'skills', skill);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'SKILL.md'), `---\nname: ${skill}\ndescription: fixture\n---\n`);
      writeFileSync(join(bins, id), 'fixture', { mode: 0o755 });
    }
  };
  const first = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(first.components[0].status, 'installed');
  assert.equal(first.components[1].id, 'hooks');
  assert.equal(first.components[0].packages['gh-axi'], '0.1.35');
  assert.equal(JSON.parse(readFileSync(first.receipt)).phases.npm.packages['gh-axi'], '0.1.35');
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(second.components[0].status, 'skipped');
  assert.equal(invocations, 1);
  writeFileSync(join(f.home, '.claude', 'settings.json'), '{bad');
  const conflicted = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(conflicted.components.find(x => x.id === 'hooks').status, 'conflict');
  assert.equal(conflicted.status, 'partial');
  assert.match(formatInstall(conflicted), /- hooks: conflict; .*malformed JSON/);
});

test('npm phase is not installed while a locked tool version is unverified', async t => {
  const f = installFixture(t);
  const tools = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'].map(id => structuredClone(manifest.tools.find(x => x.id === id)));
  tools[2].version = { ...tools[2].version, status: 'unverified', reason: 'approval pending' };
  f.fixtureManifest = { ...f.fixtureManifest, tools };
  f.options.runNpm = async () => assert.fail('npm must not run');
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.components, [{ id: 'npm', status: 'unverified', reason: 'lavish-axi: approval pending' }]);
  assert.equal(existsSync(join(f.installRoot, 'releases', 'fixture-1', 'npm')), false);
});
