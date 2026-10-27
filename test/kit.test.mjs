import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync, copyFileSync, existsSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, validateManifest } from '../src/kit.mjs';
import { formatInstall, installPlatform } from '../src/install/macos.mjs';
import { applyHooks, previewHooks, publicHookChanges } from '../src/install/hooks.mjs';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifests/pilot-skeleton.json'), 'utf8'));

const wsl2Kernel = 'Linux version 6.6.87.2-microsoft-standard-WSL2 (root@build) #1 SMP';
const elf = machine => { const body = Buffer.alloc(64); body.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); body.writeUInt16LE(machine, 18); return body; };
const prereqBins = ['node', 'git', 'gh', 'claude', 'brew', 'xcode-select', 'bash', 'zsh', 'curl', 'jq', 'python3', 'tar', 'unzip', 'shasum'];

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
  const tower = manifest.tools.find(x => x.id === 'zoe-fleet'), runtime = manifest.tools.find(x => x.id === 'zoe-fleet-runtime');
  assert.equal(tower.version.value, 'fc45c4d9ea1de0af27092f26eaa8f5008881f01e');
  assert.deepEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].map(target => tower.artifacts[target].kind), ['release-archive', 'release-archive', 'source-archive', 'source-archive']);
  assert.equal(tower.artifacts['darwin-arm64'].sha256, '067ff921f660840b3cf4f0ab84a7a0500a8b2705f25f0164f1b3f970ca413e65');
  assert.equal(tower.artifacts['darwin-x64'].sha256, 'f167a67bab048fb06a2c7e0e5254ba497c19249eda94441f3a08ed92e6f47a27');
  for (const target of ['darwin-arm64', 'darwin-x64']) {
    assert.match(tower.artifacts[target].url, /^https:\/\/github\.com\/pikenguyen227\/zoetrope\/releases\/download\/fleet-v0\.2\.0-fc45c4d9ea1d\//);
    assert.equal(runtime.artifacts[target].sha256, '48b30346cec0ab1174e296745154defade431b1fb66da6a88c992b383a4e381a');
  }
  assert.deepEqual(['linux-arm64', 'linux-x64'].map(target => runtime.artifacts[target].status), ['unverified', 'unverified']);
  assert.deepEqual(['wsl2-arm64', 'wsl2-x64'].map(target => [tower.artifacts[target].kind, tower.artifacts[target].sha256]),
    [['release-archive', 'c22035f08c5f23631ebc87cac6d5116f86cae894d22f68bda60389d860609a3e'], ['release-archive', '8085a73f24d6290df078e4e7edf34ea00ab712288e9fbbd72ff50c50bb549a45']]);
  for (const target of ['wsl2-arm64', 'wsl2-x64']) {
    assert.match(tower.artifacts[target].url, /^https:\/\/github\.com\/pikenguyen227\/zoetrope\/releases\/download\/fleet-v0\.2\.0-fc45c4d9ea1d-linux\//);
    assert.deepEqual(runtime.artifacts[target], { ...runtime.artifacts['darwin-arm64'], reason: runtime.artifacts[target].reason });
  }
  assert.ok(manifest.tools.filter(x => x.artifacts && !['zoe-fleet', 'zoe-fleet-runtime', 'zoetrope-herdr-plugin'].includes(x.id)).every(x => !Object.keys(x.artifacts).some(target => target.startsWith('wsl2-'))));
  const badKind = structuredClone(tower);
  badKind.artifacts['darwin-arm64'].kind = 'installer';
  assert.throws(() => validateManifest({ ...manifest, tools: [badKind] }), /invalid artifact kind/);
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
  writeFileSync(join(second, 'herdr'), 'fixture', { mode: 0o755 });
  const tool = structuredClone(manifest.tools.find(x => x.id === 'herdr'));
  writeFileSync(join(bin, 'herdr'), 'fixture', { mode: 0o755 });
  tool.artifacts['darwin-arm64'] = { url: 'https://example.test/herdr.tgz', sha256: 'a'.repeat(64), status: 'verified', reason: '' };
  const fixtureManifest = { ...manifest, tools: [tool] };
  const context = { env: { HOME: home, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${second}`, SHELL: join(bin, 'zsh') }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']),
    runCommand: (path, args) => basename(path) === 'xcode-select' ? '/fake/CommandLineTools' : 'herdr 0.9.3' };
  const result = run(['check', '--json'], fixtureManifest, context);
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.platform.tools[0].status, 'pass');
  assert.equal(result.result.platform.pathConflicts.length, 1);
  assert.ok(result.result.issues.some(x => x.reason.includes('PATH precedence')));
  rmSync(join(second, 'herdr'));
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

test('person-installed prerequisites pass at their floors and fail below them with install docs', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  const applicationDirs = fakeApps(root, ['Terminal.app', 'Google Chrome.app']);
  for (const name of prereqBins) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const tools = ['node', 'git', 'github-cli', 'claude'].map(id => manifest.tools.find(x => x.id === id));
  const outputs = { node: 'v24.15.0', git: 'git version 2.20.0 (Apple Git-154)', gh: 'gh version 2.0.0', claude: '2.1.293 (Claude Code)' };
  for (const [gitOutput, expected] of [[outputs.git, 'pass'], ['git version 2.19.9', 'fail']]) {
    const context = { env: { HOME: home, PATH: bin, SHELL: join(bin, 'zsh') }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.21.0', applicationDirs,
      runCommand: path => ({ ...outputs, git: gitOutput })[basename(path)] ?? '/fake/CommandLineTools' };
    const result = run(['check', '--json'], { ...manifest, tools }, context).result;
    assert.equal(result.platform.prerequisites.find(x => x.id === 'git').status, expected);
    assert.equal(result.platform.prerequisites.find(x => x.id === 'node').status, 'pass');
    assert.ok(!result.issues.some(x => x.id === 'node-runtime'));
    if (expected === 'fail') assert.match(result.issues.find(x => x.id === 'git').reason, /https:\/\/git-scm.com\/downloads/);
    else assert.equal(result.summary, 'ready');
  }
  const oldRuntime = run(['check', '--json'], { ...manifest, tools }, { env: { HOME: home, PATH: bin, SHELL: join(bin, 'zsh') },
    platform: 'darwin', arch: 'arm64', nodeVersion: '24.14.0', applicationDirs,
    runCommand: path => outputs[basename(path)] ?? '/fake/CommandLineTools' }).result;
  assert.match(oldRuntime.issues.find(x => x.id === 'node-runtime').reason, /https:\/\/nodejs.org\/en\/download/);
});

test('correct macOS, headless Linux and WSL2 prerequisite checks are ready; optional Figma is advisory', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  for (const name of [...prereqBins, 'sh', 'sha256sum']) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const tools = manifest.tools.filter(x => x.kind === 'prerequisite');
  const outputs = { node: 'v24.15.0', git: 'git version 2.20.0', gh: 'gh version 2.0.0', claude: '2.1.293 (Claude Code)', python3: 'Python 3.12.3' };
  const base = { arch: 'arm64', nodeVersion: '24.15.0', runCommand: path => outputs[basename(path)] || '/fake/CommandLineTools' };
  const mac = { ...base, platform: 'darwin', env: { HOME: home, PATH: bin, SHELL: join(bin, 'zsh') },
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']) };
  const linux = { ...base, platform: 'linux', libc: 'glibc', osRelease: 'ID=ubuntu\n', procVersion: 'Linux version 6.8',
    env: { HOME: home, PATH: bin, SHELL: join(bin, 'bash') } };
  for (const context of [mac, linux, { ...linux, env: { ...linux.env, WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/1_interop' } }]) {
    for (const command of ['check', 'plan']) {
      const result = run([command, '--json'], { ...manifest, tools }, context);
      assert.deepEqual([result.result.summary, result.exitCode], ['ready', 0], JSON.stringify(result.result.issues));
      assert.equal(result.result.issues.length, 0);
      assert.ok(result.result.advisories.some(x => x.id === 'figma-cli' && /figma-cli absent.*https:\/\//.test(x.reason)));
    }
  }
  assert.deepEqual(readdirSync(home), []);
});

test('full reviewed manifest can report ready on macOS, Linux and WSL2 fixture machines', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  const names = new Set([...prereqBins, 'sh', 'sha256sum', 'zoe-fleet-tower',
    ...manifest.tools.filter(x => x.kind !== 'prerequisite' && ['core', 'claude'].includes(x.profile)).map(x => x.detection.command)]);
  for (const name of names) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  for (const tool of manifest.tools.filter(x => x.detection.kind === 'git-head')) {
    mkdirSync(join(home, tool.installLocation.relativePath, '.git'), { recursive: true });
  }
  const versions = Object.fromEntries(manifest.tools.filter(x => x.detection.kind === 'command').map(x => [x.detection.command, x.kind === 'prerequisite' ? x.minVersion : x.version.value]));
  const runCommand = (path, args, cwd) => {
    if (basename(path) === 'xcode-select') return '/fake/CommandLineTools';
    if (basename(path) === 'python3') return 'Python 3.12.3';
    if (basename(path) === 'git' && args[0] === 'rev-parse') return manifest.tools.find(x => x.installLocation?.relativePath.endsWith(`/${basename(cwd)}`)).version.value;
    return `${basename(path)} ${versions[basename(path)]}`;
  };
  const base = { arch: 'arm64', nodeVersion: '24.15.0', runCommand };
  const mac = { ...base, platform: 'darwin', env: { HOME: home, PATH: bin, SHELL: join(bin, 'zsh') },
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']) };
  const linux = { ...base, platform: 'linux', libc: 'glibc', osRelease: 'ID=ubuntu\n', procVersion: 'Linux version 6.8',
    env: { HOME: home, PATH: bin, SHELL: join(bin, 'bash') } };
  const wslEnv = { ...linux.env, WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/1_interop' };
  const wsl2 = { ...linux, glibcVersion: '2.35', procVersion: wsl2Kernel, env: wslEnv };
  for (const context of [mac, linux, wsl2]) {
    for (const command of ['check', 'plan']) {
      const result = run([command, '--json'], manifest, context);
      assert.deepEqual([result.result.summary, result.exitCode], ['ready', 0], JSON.stringify(result.result.issues));
      assert.ok(result.result.advisories.some(x => x.id === 'zoe-fleet-runtime'));
    }
  }
  const tower = manifest.tools.find(x => x.id === 'zoe-fleet');
  const urls = context => Object.fromEntries(run(['plan', '--json'], manifest, context).result.plan.tools.map(x => [x.id, x.artifactUrl]));
  assert.deepEqual([urls(wsl2)['zoe-fleet'], urls(wsl2).herdr], [tower.artifacts['wsl2-arm64'].url, manifest.tools.find(x => x.id === 'herdr').artifacts['linux-arm64'].url]);
  assert.equal(urls(linux)['zoe-fleet'], tower.artifacts['linux-arm64'].url);
  const envOnly = { ...linux, glibcVersion: '2.35', env: wslEnv };
  assert.equal(run(['check', '--json'], manifest, envOnly).result.platform.wsl2, true);
  assert.equal(urls(envOnly)['zoe-fleet'], tower.artifacts['linux-arm64'].url);
  assert.equal(run(['plan', '--json'], manifest, envOnly).result.plan.towerConfig, null);
  const towerTools = context => run(['check', '--json'], manifest, context).result.advisories.filter(x => x.id.startsWith('tower-')).map(x => x.id);
  assert.deepEqual([towerTools(wsl2), towerTools(envOnly), towerTools(linux)], [[], [], []]);
  rmSync(join(bin, 'jq'));
  const missing = run(['check', '--json'], manifest, { ...wsl2, runCommand: (path, args, cwd) => basename(path) === 'python3' ? 'Python 3.8.10' : runCommand(path, args, cwd) });
  assert.deepEqual([missing.result.summary, missing.exitCode], ['1 gaps or unknowns', 1], 'python3 3.9 is required on every Linux install now');
  assert.deepEqual(missing.result.advisories.filter(x => x.id.startsWith('tower-')).map(x => [x.id, x.status]), [['tower-jq', 'warn']]);
  assert.match(missing.result.advisories.find(x => x.id === 'tower-jq').reason, /sudo apt install jq/);
  assert.match(missing.result.issues.find(x => x.id === 'python3').reason, /python3 3\.8 is older than 3\.9; the kit's launchers and the tower need python3 3\.9 or newer/);
  assert.ok(run(['plan', '--json'], manifest, wsl2).result.plan.towerConfig);
  assert.equal(run(['plan', '--json'], manifest, linux).result.plan.towerConfig, null);
  const old = run(['check', '--json'], manifest, { ...wsl2, glibcVersion: '2.31' });
  assert.equal(old.exitCode, 1);
  assert.match(old.result.issues.find(x => x.id === 'zoe-fleet').reason, /needs Ubuntu 22\.04 or newer \(glibc 2\.35 or newer\); this distribution has glibc 2\.31/);
  assert.equal(run(['check', '--json'], manifest, { ...linux, glibcVersion: '2.31' }).exitCode, 0);
});

test('missing required prerequisite fails with its vendor install link', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  for (const name of prereqBins.filter(x => x !== 'gh')) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const context = { env: { HOME: home, PATH: bin, SHELL: join(bin, 'zsh') }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']), runCommand: path => basename(path) === 'xcode-select' ? '/fake/CommandLineTools' : '2.20.0' };
  const result = run(['check', '--json'], { ...manifest, tools: [manifest.tools.find(x => x.id === 'github-cli')] }, context);
  assert.equal(result.exitCode, 1);
  assert.match(result.result.issues.find(x => x.id === 'github-cli').reason, /https:\/\/github.com\/cli\/cli#installation/);
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
  for (const name of ['git', 'curl', 'tar', 'unzip', 'bash', 'sh', 'sha256sum', 'herdr', 'python3']) writeFileSync(join(bin, name), 'fixture', { mode: 0o755 });
  const fixtureManifest = { ...manifest, tools: [structuredClone(manifest.tools.find(x => x.id === 'herdr'))] };
  const base = { platform: 'linux', arch: 'x64', libc: 'glibc', osRelease: 'ID=ubuntu\n', procVersion: 'Linux version 6.8', nodeVersion: '24.21.0', runCommand: path => basename(path) === 'python3' ? 'Python 3.12.3' : 'herdr 0.9.3' };
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

test('manifest accepts wsl2 artifact targets and refuses other operating systems', () => {
  const tool = structuredClone(manifest.tools.find(x => x.id === 'herdr'));
  tool.artifacts['wsl2-x64'] = { ...tool.artifacts['linux-x64'] };
  validateManifest({ ...manifest, tools: [tool] });
  tool.artifacts['wsl1-x64'] = { ...tool.artifacts['linux-x64'] };
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

test('plan lists the unselected harness and reports Figma as an optional prerequisite', t => {
  const { home, bin } = tempFixture(t);
  const context = { platform: 'linux', arch: 'x64', env: { HOME: home, PATH: bin }, nodeVersion: '24.15.0', libc: 'glibc', procVersion: '', osRelease: '' };
  const claude = run(['plan', '--json'], manifest, context);
  const optional = claude.result.plan.optionalComponents;
  assert.deepEqual(optional.map(x => x.id).sort(), ['codex']);
  const codex = optional.find(x => x.id === 'codex');
  const lock = manifest.tools.find(x => x.id === 'codex');
  assert.equal(codex.status, 'optional, not selected');
  assert.equal(codex.version, lock.version.value);
  assert.equal(codex.origin, lock.approvedUpstream);
  assert.ok(claude.result.plan.loginSteps.some(x => x.includes('GitHub CLI')));
  assert.ok(claude.result.plan.loginSteps.some(x => x.includes('Claude Code')));
  const selected = run(['plan', '--json', '--harness', 'codex', '--with-figma'], manifest, context);
  assert.deepEqual(selected.result.plan.optionalComponents.map(x => x.id), []);
  assert.equal(selected.result.platform.prerequisites.find(x => x.id === 'figma-cli').required, false);
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
  assert.equal(result.result.plan.tools.find(x => x.id === 'zoe-fleet').installLocation, join(installRoot, 'releases', manifest.release, 'bin', 'zoe-fleet'));
  assert.equal(result.result.plan.tools.find(x => x.id === 'zoe-fleet-runtime').installLocation, join(installRoot, 'releases', manifest.release, 'zoe-fleet-runtime'));
  const digest = createHash('sha256').update(firstmateHome).digest('hex').slice(0, 12);
  assert.deepEqual(result.result.plan.towerConfig, { firstmateHome, config: join(home, '.config', 'zoe-fleet', 'config'), state: join(home, '.local', 'state', 'zoe-fleet', digest) });
  assert.match(run(['install', '--dry-run', '--install-root', installRoot, '--firstmate-home', firstmateHome], manifest, context).output, /Tower launcher configuration .*\n- .*zoe-fleet[\\/]config: FM_HOME /);
  const linux = run(['plan', '--json', '--install-root', installRoot, '--firstmate-home', firstmateHome], manifest, { ...context, platform: 'linux', arch: 'x64', libc: 'glibc', osRelease: 'ID=ubuntu\n', procVersion: 'Linux' });
  assert.equal(linux.result.plan.tools.find(x => x.id === 'zoe-fleet').installLocation, join(installRoot, 'releases', manifest.release, 'zoetrope', 'bin', 'zoe-fleet'));
  assert.equal(linux.result.plan.towerConfig, null);
  assert.ok(linux.result.advisories.some(x => x.id === 'zoe-fleet-runtime' && /no Linux tower release/.test(x.reason)));
  assert.deepEqual(readdirSync(home), []);
  assert.equal(existsSync(installRoot), false);
});

test('unsafe manifest detection and install paths are rejected', () => {
  const badCommand = structuredClone(manifest);
  badCommand.tools[0].detection.args = ['--eval', 'unsafe'];
  assert.throws(() => validateManifest(badCommand), /unsafe detection/);
  const badPath = structuredClone(manifest);
  badPath.tools.find(x => x.id === 'firstmate').installLocation.relativePath = '../private';
  assert.throws(() => validateManifest(badPath), /unsafe install location/);
  const fakePin = structuredClone(manifest);
  fakePin.tools.find(x => x.id === 'git').artifacts = { 'darwin-arm64': { status: 'unverified' } };
  assert.throws(() => validateManifest(fakePin), /invalid prerequisite/);
  const missingDocs = structuredClone(manifest);
  missingDocs.tools.find(x => x.id === 'github-cli').installDocs = 'http://invalid.example';
  assert.throws(() => validateManifest(missingDocs), /invalid prerequisite/);
  const mismatchedNode = structuredClone(manifest);
  mismatchedNode.tools.find(x => x.id === 'node').minVersion = '24.14.0';
  assert.throws(() => validateManifest(mismatchedNode), /Node prerequisite and runtime minimum disagree/);
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

test('optional figma version runs with disposable HOME and never writes the teammate HOME', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  writeFileSync(join(bin, 'figma-cli'), '#!/bin/sh\n/bin/mkdir -p "$HOME/.figma-cli/plugins"\necho 2.2.5-make.2\n', { mode: 0o755 });
  const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']) };
  for (const command of ['check', 'plan']) {
    const result = run([command, '--json', '--with-figma'], manifest, context);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(readdirSync(home), []);
    const figma = result.result.platform.prerequisites.find(x => x.id === 'figma-cli');
    assert.equal(figma.status, 'pass');
    assert.deepEqual(figma.paths, [join(bin, 'figma-cli')]);
  }
});

test('codex version probe runs with disposable HOME and never writes the teammate HOME', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\n/bin/mkdir -p "$HOME/.codex/tmp/arg0"\necho codex-cli 0.164.0\n', { mode: 0o755 });
  const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']) };
  const result = run(['check', '--json', '--harness', 'codex'], manifest, context);
  assert.equal(result.result.platform.tools.find(x => x.id === 'codex').status, 'pass');
  assert.deepEqual(readdirSync(home), []);
});

test('prerequisite version probes such as gh run with disposable HOME and never write the teammate HOME', { skip: process.platform === 'win32' }, t => {
  const { home, bin, root } = tempFixture(t);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\n/bin/mkdir -p "$HOME/.local/state/gh"\necho > "$HOME/.local/state/gh/device-id"\necho gh version 2.102.0\n', { mode: 0o755 });
  const context = { env: { HOME: home, PATH: bin }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0',
    applicationDirs: fakeApps(root, ['Terminal.app', 'Google Chrome.app']) };
  for (const command of ['check', 'plan']) {
    const result = run([command, '--json'], manifest, context);
    assert.equal(result.result.platform.prerequisites.find(x => x.id === 'github-cli').status, 'pass');
    assert.deepEqual(readdirSync(home), []);
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

test('install never stages person-installed prerequisites', async t => {
  const f = installFixture(t);
  f.fixtureManifest.tools.push(...manifest.tools.filter(x => x.kind === 'prerequisite'));
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(result.components.map(x => x.id), ['herdr']);
  const receipt = JSON.parse(readFileSync(result.receipt));
  for (const id of ['node', 'git', 'github-cli', 'claude', 'figma-cli']) assert.equal(receipt.phases[id], undefined);
  assert.equal(f.downloads.length, 1);
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
  mkdirSync(join(repo, 'bin'));
  writeFileSync(join(repo, 'bin', 'fm-fleet-snapshot.sh'), '#!/bin/sh\n', { mode: 0o755 });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('add', 'README.md', 'bin/fm-fleet-snapshot.sh');
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
  // POSIX rename replaces an empty directory; Windows refuses, and the installer targets macOS and Linux only.
  if (process.platform !== 'win32') mkdirSync(f.firstmateHome);
  f.options.runCargo = async (_stage, target) => {
    mkdirSync(join(target, 'release'), { recursive: true });
    writeFileSync(join(target, 'release', 'zoe'), 'fixture tower', { mode: 0o755 });
  };
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(result.status, 'partial');
  assert.equal(result.towerParity, 'source build; no Linux tower release this round');
  assert.deepEqual(result.components.map(x => x.status), ['installed', 'installed']);
  assert.equal(result.firstmateHome, f.firstmateHome);
  assert.equal(JSON.parse(readFileSync(result.receipt)).phases.firstmate.path, f.firstmateHome);
  assert.equal(readFileSync(join(f.firstmateHome, 'README.md'), 'utf8'), 'tracked fixture\n');
  // Firstmate seeds and syncs second mates from the primary home's local default branch.
  assert.equal(spawnSync('git', ['-C', f.firstmateHome, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), 'main');
  for (const dir of ['data', 'state', 'config', 'projects']) assert.deepEqual(readdirSync(join(f.firstmateHome, dir)), []);
  writeFileSync(join(f.firstmateHome, 'data', 'new-person-only'), 'private');
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(second.components.map(x => x.status), ['skipped', 'skipped']);
});

// A launcher whose setup writes the same data-only config as the Zoetrope runtime's zoe-fleet-tower.
const fixtureLauncher = `#!/usr/bin/env bash
set -euo pipefail
[ "\${1:-}" = setup ] || exit 2
shift
nm=''
while [ "$#" -gt 0 ]; do
  case "$1" in --home) h=$2 ;; --bin) b=$2 ;; --state) s=$2 ;; --telemetry) tl=$2 ;; --no-mistakes) nm=$2 ;; *) exit 2 ;; esac
  shift 2
done
[ -x "$h/bin/fm-fleet-snapshot.sh" ] || exit 1
umask 077
mkdir -p "$s" "$s/telemetry"
d="\${XDG_CONFIG_HOME:-$HOME/.config}/zoe-fleet"
mkdir -p "$d"
printf 'FM_HOME=%s\\nZOE_FLEET_BIN=%s\\nZOE_FLEET_STATE_DIR=%s\\nZOE_TELEMETRY_DIR=%s\\nZOE_NO_MISTAKES_BIN=%s\\n' "$h" "$b" "$(cd "$s" && pwd -P)" "$(cd "$tl" && pwd -P)" "$nm" > "$d/config"
`;

function towerFixture(t, { runtimeFiles, towerBinary = 'fixture tower binary' } = {}) {
  const f = firstmateFixture(t);
  const pack = (name, files) => {
    const dir = join(f.root, `${name}-tree`), archive = join(f.root, `${name}.tar.gz`);
    for (const [path, [body, mode = 0o644]] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), body, { mode });
    }
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', dir, ...readdirSync(dir)]).status, 0);
    return archive;
  };
  const archives = {
    'https://fixture.test/zoe-fleet.tar.gz': pack('tower', { 'zoe-fleet': [towerBinary, 0o755], LICENSE: ['MIT'], NOTICE: ['notice'], 'BUILD.txt': ['version=0.2.0'] }),
    'https://fixture.test/runtime.tar.gz': pack('runtime', runtimeFiles || { 'bin/zoe-fleet-tower': [fixtureLauncher, 0o755], 'scripts/fleet-config.sh': [''], 'scripts/firstmate-fleet.py': [''],
      'fleet-plugin/herdr-plugin.toml': [''], 'fleet-plugin/open.sh': [''], 'docs/FLEET-PACKAGING.md': [''], LICENSE: ['MIT'] }),
  };
  const firstmateArchive = join(f.root, 'source.tar.gz');
  const verified = (tool, url, kind) => {
    tool.artifacts['darwin-arm64'] = { url, sha256: createHash('sha256').update(readFileSync(archives[url])).digest('hex'), kind, status: 'verified', reason: '' };
    return tool;
  };
  f.fixtureManifest.tools.push(verified(structuredClone(manifest.tools.find(x => x.id === 'zoe-fleet')), 'https://fixture.test/zoe-fleet.tar.gz', 'release-archive'),
    verified(structuredClone(manifest.tools.find(x => x.id === 'zoe-fleet-runtime')), 'https://fixture.test/runtime.tar.gz', 'release-archive'));
  f.options.fetchArtifact = async (url, destination) => { f.downloads.push(url); copyFileSync(archives[url] || firstmateArchive, destination); };
  f.options.runCargo = async () => assert.fail('cargo must not run when a release archive is pinned');
  const kitPath = (...parts) => join(f.installRoot, 'releases', 'fixture-1', ...parts);
  const digest = createHash('sha256').update(f.firstmateHome).digest('hex').slice(0, 12);
  return { ...f, kitPath, digest };
}

test('a tower download network failure leaves the tower partial and later phases complete', { skip: process.platform === 'win32' }, async t => {
  const f = towerFixture(t);
  const herdr = structuredClone(manifest.tools.find(x => x.id === 'herdr'));
  herdr.artifacts['darwin-arm64'] = { url: 'https://fixture.test/herdr', sha256: createHash('sha256').update(readFileSync(f.artifact)).digest('hex'), status: 'verified', reason: '' };
  f.fixtureManifest.tools.push(herdr);
  const fetchArtifact = f.options.fetchArtifact;
  f.options.fetchArtifact = async (url, destination) => {
    if (url.endsWith('zoe-fleet.tar.gz')) { writeFileSync(destination, 'partial'); throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); }
    if (url.endsWith('/herdr')) return copyFileSync(f.artifact, destination);
    return fetchArtifact(url, destination);
  };
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(result.components.map(x => [x.id, x.status]), [['firstmate', 'installed'], ['zoe-fleet', 'unverified'], ['zoe-fleet-runtime', 'installed'], ['herdr', 'installed'], ['zoe-fleet-tower', 'unverified']]);
  assert.equal(result.components[1].reason, 'tower download unavailable: ECONNRESET');
  assert.equal(result.towerParity, 'unavailable');
  assert.equal(result.status, 'partial');
  assert.deepEqual(readdirSync(f.kitPath('staging')).filter(name => name.startsWith('zoe-fleet-') && !name.startsWith('zoe-fleet-runtime-')), []);
  assert.equal(existsSync(f.kitPath('bin', 'zoe-fleet')), false);
});

test('a tower checksum mismatch still stops the install', { skip: process.platform === 'win32' }, async t => {
  const f = towerFixture(t);
  f.fixtureManifest.tools.find(x => x.id === 'zoe-fleet').artifacts['darwin-arm64'].sha256 = '0'.repeat(64);
  await assert.rejects(installPlatform(f.fixtureManifest, f.options), /SHA-256 mismatch for zoe-fleet/);
  assert.equal(existsSync(f.kitPath('bin', 'zoe-fleet')), false);
});

test('macOS release archives install the tower and configure its launcher without a source build',{ skip: process.platform === 'win32' }, async t => {
  const f = towerFixture(t);
  const ids = ['firstmate', 'zoe-fleet', 'zoe-fleet-runtime', 'zoe-fleet-tower'];
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(ids.map(id => result.components.find(x => x.id === id)?.status), Array(4).fill('installed'));
  assert.equal(result.status, 'partial');
  assert.equal(result.towerParity, 'installed from verified release; hands-on acceptance pending (Zoetrope Phase B)');
  assert.equal(result.towerLauncher, f.kitPath('zoe-fleet-runtime', 'bin', 'zoe-fleet-tower'));
  assert.match(formatInstall(result), /Tower parity: installed from verified release; hands-on acceptance pending.*\nTower launcher: /);
  assert.equal(readFileSync(f.kitPath('bin', 'zoe-fleet'), 'utf8'), 'fixture tower binary');
  assert.equal(existsSync(f.kitPath('zoetrope')), false);
  const state = join(f.home, '.local', 'state', 'zoe-fleet', f.digest), configPath = join(f.home, '.config', 'zoe-fleet', 'config');
  const config = readFileSync(configPath, 'utf8');
  assert.equal(config, `FM_HOME=${f.firstmateHome}\nZOE_FLEET_BIN=${f.kitPath('bin', 'zoe-fleet')}\nZOE_FLEET_STATE_DIR=${state}\nZOE_TELEMETRY_DIR=${join(state, 'telemetry')}\nZOE_NO_MISTAKES_BIN=\n`);
  if (!f.root.startsWith(homedir())) assert.ok(!config.includes(homedir()));
  assert.deepEqual(readdirSync(state), ['telemetry']);
  const receipt = JSON.parse(readFileSync(result.receipt));
  assert.equal(receipt.phases['zoe-fleet-runtime'].artifactSha256, f.fixtureManifest.tools[2].artifacts['darwin-arm64'].sha256);
  assert.deepEqual([receipt.phases['zoe-fleet-tower'].path, receipt.phases['zoe-fleet-tower'].state], [configPath, 'complete']);
  assert.deepEqual(readdirSync(f.kitPath('staging')).filter(name => !name.endsWith('.artifact')), []);

  const downloads = f.downloads.length;
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(ids.map(id => second.components.find(x => x.id === id)?.status), Array(4).fill('skipped'));
  assert.equal(f.downloads.length, downloads);
  assert.equal(second.towerParity, result.towerParity);

  writeFileSync(configPath, `FM_HOME=${f.root}\n`);
  const edited = await installPlatform(f.fixtureManifest, f.options);
  assert.match(edited.components.find(x => x.id === 'zoe-fleet-tower').reason, /not the kit-owned launcher config; left unchanged/);
  assert.equal(edited.towerLauncher, null);
  assert.equal(readFileSync(configPath, 'utf8'), `FM_HOME=${f.root}\n`);
});

test('existing launcher config or used fleet state is left untouched', { skip: process.platform === 'win32' }, async t => {
  const f = towerFixture(t);
  const configPath = join(f.home, '.config', 'zoe-fleet', 'config');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, 'FM_HOME=/someone/else\n');
  const owned = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(owned.components.find(x => x.id === 'zoe-fleet-tower').status, 'conflict');
  assert.equal(owned.components.find(x => x.id === 'zoe-fleet-runtime').status, 'installed');
  assert.equal(owned.towerParity, 'release binary installed; fleet runtime or launcher configuration incomplete');
  assert.equal(readFileSync(configPath, 'utf8'), 'FM_HOME=/someone/else\n');

  const xdgConfig = join(f.root, 'xdg-config'), xdgState = join(f.root, 'xdg-state');
  const options = { ...f.options, env: { XDG_CONFIG_HOME: xdgConfig, XDG_STATE_HOME: xdgState } };
  mkdirSync(join(xdgState, 'zoe-fleet', f.digest), { recursive: true });
  writeFileSync(join(xdgState, 'zoe-fleet', f.digest, 'fleet.json'), '{}');
  const used = await installPlatform(f.fixtureManifest, options);
  assert.match(used.components.find(x => x.id === 'zoe-fleet-tower').reason, /not a new empty directory; left unchanged/);
  assert.equal(existsSync(join(xdgConfig, 'zoe-fleet', 'config')), false);
  rmSync(join(xdgState, 'zoe-fleet', f.digest, 'fleet.json'));
  const fresh = await installPlatform(f.fixtureManifest, options);
  assert.equal(fresh.components.find(x => x.id === 'zoe-fleet-tower').status, 'installed');
  assert.match(readFileSync(join(xdgConfig, 'zoe-fleet', 'config'), 'utf8'), new RegExp(`ZOE_FLEET_STATE_DIR=${join(xdgState, 'zoe-fleet', f.digest)}\n`));
  const relative = await installPlatform(f.fixtureManifest, { ...options, env: { XDG_CONFIG_HOME: 'relative' } });
  assert.match(relative.components.find(x => x.id === 'zoe-fleet-tower').reason, /XDG_CONFIG_HOME must be an absolute path/);
});

test('failed launcher setup removes only the fleet state it created so a rerun succeeds', { skip: process.platform === 'win32' }, async t => {
  const failing = fixtureLauncher.replace('mkdir -p "$s" "$s/telemetry"\n', 'mkdir -p "$s" "$s/telemetry"\nif [ -e "$h.fail" ]; then rm "$h.fail"; exit 1; fi\n');
  const f = towerFixture(t, { runtimeFiles: { 'bin/zoe-fleet-tower': [failing, 0o755], 'scripts/fleet-config.sh': [''], 'scripts/firstmate-fleet.py': [''],
    'fleet-plugin/herdr-plugin.toml': [''], 'fleet-plugin/open.sh': [''], 'docs/FLEET-PACKAGING.md': [''], LICENSE: ['MIT'] } });
  const state = join(f.home, '.local', 'state', 'zoe-fleet', f.digest);
  writeFileSync(`${f.firstmateHome}.fail`, '');
  const failed = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(failed.components.find(x => x.id === 'zoe-fleet-tower').status, 'conflict');
  assert.equal(existsSync(state), false);
  assert.equal(JSON.parse(readFileSync(failed.receipt)).phases['zoe-fleet-tower'], undefined);
  const rerun = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(rerun.components.find(x => x.id === 'zoe-fleet-tower').status, 'installed');
  assert.deepEqual(readdirSync(state), ['telemetry']);

  const xdgState = join(f.root, 'xdg-state'), kept = join(xdgState, 'zoe-fleet', f.digest);
  mkdirSync(kept, { recursive: true });
  writeFileSync(`${f.firstmateHome}.fail`, '');
  const preexisting = await installPlatform(f.fixtureManifest, { ...f.options, env: { XDG_CONFIG_HOME: join(f.root, 'xdg-config'), XDG_STATE_HOME: xdgState } });
  assert.equal(preexisting.components.find(x => x.id === 'zoe-fleet-tower').status, 'conflict');
  assert.deepEqual(readdirSync(kept), ['telemetry']);
});

test('plan canonicalizes a Firstmate home under a symlinked parent like install does', { skip: process.platform === 'win32' }, t => {
  const { home, root } = tempFixture(t);
  mkdirSync(join(root, 'real'));
  symlinkSync(join(root, 'real'), join(root, 'link'));
  const context = { platform: 'darwin', arch: 'arm64', env: { HOME: home, PATH: '' }, nodeVersion: '24.15.0', applicationDirs: [] };
  const result = run(['plan', '--json', '--install-root', join(root, 'kit'), '--firstmate-home', join(root, 'link', 'fm')], manifest, context);
  const firstmateHome = join(root, 'real', 'fm');
  const digest = createHash('sha256').update(firstmateHome).digest('hex').slice(0, 12);
  assert.deepEqual(result.result.plan.towerConfig, { firstmateHome, config: join(home, '.config', 'zoe-fleet', 'config'), state: join(home, '.local', 'state', 'zoe-fleet', digest) });
  assert.equal(existsSync(firstmateHome), false);
});

test('runtime archive with a link or without its launcher is refused',{ skip: process.platform === 'win32' }, async t => {
  const f = towerFixture(t, { runtimeFiles: { 'scripts/fleet-config.sh': [''], LICENSE: ['MIT'] } });
  await assert.rejects(installPlatform(f.fixtureManifest, f.options), /fleet runtime archive lacks bin\/zoe-fleet-tower/);
  assert.equal(existsSync(f.kitPath('zoe-fleet-runtime')), false);
  assert.deepEqual(readdirSync(f.kitPath('staging')).filter(name => name.startsWith('zoe-fleet-runtime-') && !name.endsWith('.artifact')), []);

  const linked = towerFixture(t);
  const tree = join(linked.root, 'linked-tree'), archive = join(linked.root, 'linked.tar.gz');
  mkdirSync(join(tree, 'bin'), { recursive: true });
  symlinkSync('/etc/hosts', join(tree, 'bin', 'zoe-fleet-tower'));
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', tree, 'bin']).status, 0);
  linked.fixtureManifest.tools[2].artifacts['darwin-arm64'].sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  linked.options.fetchArtifact = async (url, destination) => copyFileSync(url.endsWith('runtime.tar.gz') ? archive : url.endsWith('zoe-fleet.tar.gz') ? join(linked.root, 'tower.tar.gz') : join(linked.root, 'source.tar.gz'), destination);
  await assert.rejects(installPlatform(linked.fixtureManifest, linked.options), /unsupported runtime archive member: bin\/zoe-fleet-tower/);
  assert.equal(existsSync(linked.kitPath('zoe-fleet-runtime')), false);
});

function wsl2TowerFixture(t, towerBinary = elf(0xb7)) {
  const f = towerFixture(t, { towerBinary });
  for (const tool of f.fixtureManifest.tools) {
    if (tool.id === 'firstmate') tool.artifacts['linux-arm64'] = tool.artifacts['darwin-arm64'];
    else tool.artifacts['wsl2-arm64'] = tool.artifacts['darwin-arm64'];
    delete tool.artifacts['darwin-arm64'];
  }
  f.options = { ...f.options, platform: 'linux', libc: 'glibc', glibcVersion: '2.35', procVersion: wsl2Kernel, env: { WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/1_interop' } };
  return { ...f, towerBinary };
}

test('WSL2 installs the tower from its release archives and configures the launcher without a source build', { skip: process.platform === 'win32' }, async t => {
  const f = wsl2TowerFixture(t);
  const ids = ['firstmate', 'zoe-fleet', 'zoe-fleet-runtime', 'zoe-fleet-tower'];
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(ids.map(id => result.components.find(x => x.id === id)?.status), Array(4).fill('installed'));
  assert.equal(result.status, 'partial');
  assert.equal(result.towerParity, 'installed from verified release; hands-on acceptance pending (Zoetrope Phase B)');
  assert.equal(result.towerLauncher, f.kitPath('zoe-fleet-runtime', 'bin', 'zoe-fleet-tower'));
  assert.ok(result.nextSteps.some(x => x.includes(`${result.towerLauncher} doctor`)));
  assert.deepEqual(readFileSync(f.kitPath('bin', 'zoe-fleet')), f.towerBinary);
  assert.equal(existsSync(f.kitPath('zoetrope')), false);
  const state = join(f.home, '.local', 'state', 'zoe-fleet', f.digest);
  assert.equal(readFileSync(join(f.home, '.config', 'zoe-fleet', 'config'), 'utf8'), `FM_HOME=${f.firstmateHome}\nZOE_FLEET_BIN=${f.kitPath('bin', 'zoe-fleet')}\nZOE_FLEET_STATE_DIR=${state}\nZOE_TELEMETRY_DIR=${join(state, 'telemetry')}\nZOE_NO_MISTAKES_BIN=\n`);
  const receipt = JSON.parse(readFileSync(result.receipt));
  assert.equal(receipt.phases['zoe-fleet'].artifactSha256, f.fixtureManifest.tools[1].artifacts['wsl2-arm64'].sha256);
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(ids.map(id => second.components.find(x => x.id === id)?.status), Array(4).fill('skipped'));
});

test('WSL2 below glibc 2.35 refuses the tower release before downloading it', { skip: process.platform === 'win32' }, async t => {
  for (const glibcVersion of ['2.31', null]) {
    const f = wsl2TowerFixture(t);
    const result = await installPlatform(f.fixtureManifest, { ...f.options, glibcVersion });
    assert.deepEqual(result.components.map(x => [x.id, x.status]), [['firstmate', 'installed'], ['zoe-fleet', 'unverified'], ['zoe-fleet-runtime', 'installed'], ['zoe-fleet-tower', 'unverified']]);
    assert.match(result.components[1].reason, glibcVersion ? /^refused: the WSL2 tower release needs Ubuntu 22\.04 or newer \(glibc 2\.35 or newer\); this distribution has glibc 2\.31\./ : /glibc version could not be read/);
    assert.equal(result.status, 'partial');
    assert.ok(!f.downloads.includes('https://fixture.test/zoe-fleet.tar.gz'));
    assert.equal(existsSync(f.kitPath('bin', 'zoe-fleet')), false);
    assert.equal(existsSync(join(f.home, '.config')), false);
  }
});

test('WSL2 refuses a tower release binary that is not a Linux ELF for this architecture', { skip: process.platform === 'win32' }, async t => {
  for (const binary of [elf(0x3e), Buffer.from('\xcf\xfa\xed\xfe darwin binary', 'latin1')]) {
    const f = wsl2TowerFixture(t, binary);
    const result = await installPlatform(f.fixtureManifest, f.options);
    assert.deepEqual(result.components.find(x => x.id === 'zoe-fleet'), { id: 'zoe-fleet', status: 'unverified', reason: 'refused: the zoe-fleet release binary is not a Linux arm64 ELF executable; not activated' });
    assert.equal(result.components.find(x => x.id === 'zoe-fleet-tower').status, 'unverified');
    assert.equal(existsSync(f.kitPath('bin', 'zoe-fleet')), false);
    assert.deepEqual(readdirSync(f.kitPath('bin')).filter(x => x.startsWith('zoe-fleet')), []);
    assert.equal(JSON.parse(readFileSync(result.receipt)).phases['zoe-fleet'], undefined);
  }
});

test('Linux keeps the source-built tower and has no fleet runtime pin', { skip: process.platform === 'win32' }, async t => {
  const f = firstmateFixture(t);
  f.fixtureManifest.tools[0].artifacts['linux-arm64'] = { ...f.fixtureManifest.tools[0].artifacts['darwin-arm64'] };
  const tower = f.tool('zoe-fleet');
  tower.artifacts['linux-arm64'] = { ...tower.artifacts['darwin-arm64'], kind: 'source-archive' };
  f.fixtureManifest.tools.push(tower, structuredClone(manifest.tools.find(x => x.id === 'zoe-fleet-runtime')));
  let builds = 0;
  f.options = { ...f.options, platform: 'linux', libc: 'glibc', env: {}, runCargo: async (_stage, target) => {
    builds++;
    mkdirSync(join(target, 'release'), { recursive: true });
    writeFileSync(join(target, 'release', 'zoe'), 'fixture tower', { mode: 0o755 });
  } };
  const result = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(builds, 1);
  assert.deepEqual(result.components.map(x => [x.id, x.status]), [['firstmate', 'installed'], ['zoe-fleet', 'installed'], ['zoe-fleet-runtime', 'unverified']]);
  assert.match(result.components[2].reason, /no Linux tower release/);
  assert.equal(result.towerParity, 'source build; no Linux tower release this round');
  assert.equal(result.towerLauncher, null);
  assert.equal(existsSync(join(f.home, '.config')), false);
});

test('Linux rerun over an older source-built tower reports a tower conflict and completes other phases', { skip: process.platform === 'win32' }, async t => {
  const f = firstmateFixture(t);
  f.fixtureManifest.tools[0].artifacts['linux-arm64'] = { ...f.fixtureManifest.tools[0].artifacts['darwin-arm64'] };
  const tower = f.tool('zoe-fleet');
  tower.artifacts['linux-arm64'] = { ...tower.artifacts['darwin-arm64'], kind: 'source-archive' };
  tower.version.value = 'a8c495a887ed78308f7c682c5d194835e7094b05';
  const axi = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'];
  f.fixtureManifest.tools.push(tower, ...axi.map(id => structuredClone(manifest.tools.find(x => x.id === id))));
  let builds = 0;
  f.options = { ...f.options, platform: 'linux', libc: 'glibc', env: {}, runCargo: async (_stage, target) => {
    builds++;
    mkdirSync(join(target, 'release'), { recursive: true });
    writeFileSync(join(target, 'release', 'zoe'), 'fixture tower', { mode: 0o755 });
  }, runNpm: async stage => {
    const bins = join(stage, 'node_modules', '.bin');
    mkdirSync(bins, { recursive: true });
    for (const id of axi) {
      const skill = id === 'lavish-axi' ? 'lavish' : id;
      mkdirSync(join(stage, 'node_modules', id, 'skills', skill), { recursive: true });
      writeFileSync(join(stage, 'node_modules', id, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: fixture\n---\n`);
      writeFileSync(join(bins, id), 'fixture', { mode: 0o755 });
    }
  } };
  const first = await installPlatform(f.fixtureManifest, f.options);
  assert.deepEqual(first.components.map(x => [x.id, x.status]), [['firstmate', 'installed'], ['zoe-fleet', 'installed'], ['npm', 'installed'], ['hooks', 'installed']]);
  tower.version.value = manifest.tools.find(x => x.id === 'zoe-fleet').version.value;
  const second = await installPlatform(f.fixtureManifest, f.options);
  assert.equal(builds, 1);
  assert.deepEqual(second.components.map(x => [x.id, x.status]), [['firstmate', 'skipped'], ['zoe-fleet', 'conflict'], ['npm', 'skipped'], ['hooks', 'skipped']]);
  assert.equal(second.components[1].reason, 'older tower build present; an explicit update is needed (planned)');
  assert.equal(second.towerParity, 'conflict: older tower build present; an explicit update is needed (planned)');
  assert.equal(second.status, 'partial');
  assert.deepEqual(readdirSync(join(f.installRoot, 'releases', f.fixtureManifest.release, 'staging')).filter(name => !name.endsWith('.artifact')), []);
  assert.equal(JSON.parse(readFileSync(second.receipt)).phases['zoe-fleet'].version, 'a8c495a887ed78308f7c682c5d194835e7094b05');
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
  // Firstmate seeds and syncs second mates from the primary home's local default branch.
  assert.equal(spawnSync('git', ['-C', f.firstmateHome, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), 'main');
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
  if (process.platform !== 'win32') {
    await assert.rejects(installPlatform({ ...f.fixtureManifest, release: '../stop-before-writes' }, { ...f.options, platform: 'linux', libc: 'glibc', env: {}, home: '/var/home/u', firstmateHome: '/var/home/u/firstmate' }), /unsafe release name/);
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
