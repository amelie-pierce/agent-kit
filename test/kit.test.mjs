import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, validateManifest } from '../src/kit.mjs';
import { formatInstall, installMacOS } from '../src/install/macos.mjs';
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
  const root = mkdtempSync(join(tmpdir(), 'agent-kit-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  return { root, home, bin };
}

test('bundled manifest keeps verified source commits and macOS digests', () => {
  validateManifest(manifest);
  assert.match(manifest.tools.find(x => x.id === 'firstmate').version.value, /^[a-f0-9]{40}$/);
  assert.match(manifest.tools.find(x => x.id === 'zoe-fleet').version.value, /^[a-f0-9]{40}$/);
  assert.ok(['firstmate', 'zoe-fleet', 'herdr', 'treehouse', 'no-mistakes', 'shellcheck', 'actionlint'].every(id =>
    ['darwin-arm64', 'darwin-x64'].every(target => manifest.tools.find(x => x.id === id).artifacts[target].status === 'verified')));
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
  const base = { platform: 'darwin', arch: 'arm64', nodeVersion: '24.15.0', runCommand: () => '/fake/CommandLineTools', applicationDirs: [join(root, 'none')] };
  const status = (result, id) => result.result.platform.prerequisites.find(x => x.id === id);

  const bare = run(['check', '--json'], { ...manifest, tools: [] }, { ...base, env: { HOME: home, PATH: bin } });
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
  const first = await installMacOS(f.fixtureManifest, f.options);
  assert.equal(first.status, 'installed');
  assert.equal(first.components[0].status, 'installed');
  assert.equal(f.downloads.length, 1);
  const second = await installMacOS(f.fixtureManifest, f.options);
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
  await assert.rejects(installMacOS(f.fixtureManifest, { ...f.options, afterPhase: id => { if (id === 'herdr') throw new Error('interrupted'); } }), /interrupted/);
  const result = await installMacOS(f.fixtureManifest, f.options);
  assert.deepEqual(result.components.map(x => x.status), ['skipped', 'installed']);
});

test('checksum mismatch refuses activation', async t => {
  const f = installFixture(t);
  f.fixtureManifest.tools[0].artifacts['darwin-arm64'].sha256 = '0'.repeat(64);
  await assert.rejects(installMacOS(f.fixtureManifest, f.options), /SHA-256 mismatch/);
  assert.equal(existsSync(join(f.installRoot, 'releases', 'fixture-1', 'bin', 'herdr')), false);
});

test('unsupported targets stop before any write', async t => {
  const f = installFixture(t);
  for (const [platform, arch] of [['linux', 'arm64'], ['darwin', 'mips']]) {
    const result = await installMacOS(f.fixtureManifest, { ...f.options, platform, arch });
    assert.equal(result.status, 'unsupported');
    assert.match(formatInstall(result), new RegExp(`^Agent Kit install: unsupported\nunsupported install target ${platform}/${arch}\n`));
  }
  assert.deepEqual(readdirSync(f.home), []);
});

test('install writes no global Claude or Codex settings', async t => {
  const f = installFixture(t);
  mkdirSync(join(f.home, '.claude'));
  mkdirSync(join(f.home, '.codex'));
  const claude = join(f.home, '.claude', 'settings.json'), codex = join(f.home, '.codex', 'hooks.json');
  const content = '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"unknown-owned-hook"}]}]},"permissions":{"allow":["Read"]}}\n';
  writeFileSync(claude, content); writeFileSync(codex, content);
  const result = await installMacOS(f.fixtureManifest, f.options);
  assert.equal(result.status, 'installed');
  assert.deepEqual(readdirSync(f.home).sort(), ['.claude', '.codex']);
  assert.deepEqual(readdirSync(join(f.home, '.claude')), ['settings.json']);
  assert.deepEqual(readdirSync(join(f.home, '.codex')), ['hooks.json']);
  assert.equal(readFileSync(claude, 'utf8'), content);
  assert.equal(readFileSync(codex, 'utf8'), content);
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
  const result = await installMacOS(f.fixtureManifest, f.options);
  assert.equal(result.status, 'partial');
  assert.match(result.towerParity, /manifest and launcher unverified/);
  assert.deepEqual(result.components.map(x => x.status), ['installed', 'installed']);
  assert.equal(result.firstmateHome, f.firstmateHome);
  assert.equal(JSON.parse(readFileSync(result.receipt)).phases.firstmate.path, f.firstmateHome);
  assert.equal(readFileSync(join(f.firstmateHome, 'README.md'), 'utf8'), 'tracked fixture\n');
  for (const dir of ['data', 'state', 'config', 'projects']) assert.deepEqual(readdirSync(join(f.firstmateHome, dir)), []);
  writeFileSync(join(f.firstmateHome, 'data', 'new-person-only'), 'private');
  const second = await installMacOS(f.fixtureManifest, f.options);
  assert.deepEqual(second.components.map(x => x.status), ['skipped', 'skipped']);
});

test('Firstmate rerun skips after untracked local settings appear', async t => {
  const f = firstmateFixture(t);
  assert.equal((await installMacOS(f.fixtureManifest, f.options)).components[0].status, 'installed');
  mkdirSync(join(f.firstmateHome, '.claude'));
  writeFileSync(join(f.firstmateHome, '.claude', 'settings.local.json'), '{"permissions":{"allow":["Bash(ls)"]}}\n');
  const second = await installMacOS(f.fixtureManifest, f.options);
  assert.equal(second.status, 'installed');
  assert.equal(second.components[0].status, 'skipped');
});

test('interrupted Firstmate staging is replaced on resume', async t => {
  const f = firstmateFixture(t);
  const stale = join(f.root, '.fresh-firstmate.agent-kit-staging');
  mkdirSync(join(stale, '.git'), { recursive: true });
  writeFileSync(join(stale, 'README.md'), 'partial checkout\n');
  const result = await installMacOS(f.fixtureManifest, f.options);
  assert.equal(result.components[0].status, 'installed');
  assert.equal(existsSync(stale), false);
  assert.equal(readFileSync(join(f.firstmateHome, 'README.md'), 'utf8'), 'tracked fixture\n');
  assert.deepEqual(readdirSync(f.root).filter(name => name.includes('agent-kit')), []);
});

test('rerun with a different Firstmate home is refused', async t => {
  const f = firstmateFixture(t);
  await installMacOS(f.fixtureManifest, f.options);
  const other = join(f.root, 'other-firstmate');
  await assert.rejects(installMacOS(f.fixtureManifest, { ...f.options, firstmateHome: other }), /differs from the Firstmate home recorded/);
  assert.equal(existsSync(other), false);
  assert.equal((await installMacOS(f.fixtureManifest, f.options)).firstmateHome, f.firstmateHome);
});

test('changed tracked Firstmate file is a phase conflict and other phases continue', async t => {
  const f = firstmateFixture(t);
  await installMacOS(f.fixtureManifest, f.options);
  writeFileSync(join(f.firstmateHome, 'README.md'), 'local edit\n');
  f.fixtureManifest.tools.push(structuredClone(manifest.tools.find(x => x.id === 'herdr')));
  f.fixtureManifest.tools[1].artifacts['darwin-arm64'] = { url: 'https://fixture.test/herdr', status: 'verified', reason: '',
    sha256: createHash('sha256').update(readFileSync(f.artifact)).digest('hex') };
  f.options.fetchArtifact = async (_url, target) => copyFileSync(f.artifact, target);
  const result = await installMacOS(f.fixtureManifest, f.options);
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
    await assert.rejects(installMacOS(f.fixtureManifest, { ...f.options, firstmateHome }), pattern);
    assert.equal(existsSync(f.installRoot), false);
  };
  await refuse(f.home, /home directory/);
  // System locations are POSIX paths; on Windows they resolve under the current drive.
  if (process.platform !== 'win32') for (const path of ['/usr/local/agent-kit-firstmate', '/Library/agent-kit-firstmate', join(f.home, 'Library', 'firstmate')]) await refuse(path, /system location/);
  await refuse(join(f.installRoot, 'firstmate'), /outside --install-root/);
  await refuse(dirname(f.installRoot), /outside --install-root/);
  mkdirSync(join(f.root, 'checkout', '.git'), { recursive: true });
  await refuse(join(f.root, 'checkout', 'firstmate'), /existing Firstmate home or git checkout/);
  mkdirSync(join(f.root, 'old-firstmate'));
  writeFileSync(join(f.root, 'old-firstmate', 'fm-bootstrap.sh'), '');
  await refuse(join(f.root, 'old-firstmate', 'nested'), /existing Firstmate home or git checkout/);
  mkdirSync(f.firstmateHome);
  writeFileSync(join(f.firstmateHome, 'keep'), 'mine');
  await assert.rejects(installMacOS(f.fixtureManifest, f.options), /new or empty directory/);
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
  await assert.rejects(installMacOS(f.fixtureManifest, f.options), /runtime home content/);
  assert.equal(existsSync(f.firstmateHome), false);
});

test('npm phase uses committed integrity lock and records exact tool versions', async t => {
  const f = installFixture(t);
  f.fixtureManifest.tools = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'].map(id => structuredClone(manifest.tools.find(x => x.id === id)));
  let invocations = 0;
  f.options.runNpm = async stage => {
    invocations++;
    mkdirSync(join(stage, 'node_modules', 'gh-axi'), { recursive: true });
    writeFileSync(join(stage, 'node_modules', 'gh-axi', 'package.json'), '{"version":"0.1.35"}\n');
  };
  const first = await installMacOS(f.fixtureManifest, f.options);
  assert.equal(first.components[0].status, 'installed');
  assert.equal(first.components[0].packages['gh-axi'], '0.1.35');
  assert.equal(JSON.parse(readFileSync(first.receipt)).phases.npm.packages['gh-axi'], '0.1.35');
  const second = await installMacOS(f.fixtureManifest, f.options);
  assert.equal(second.components[0].status, 'skipped');
  assert.equal(invocations, 1);
});

test('npm phase is not installed while a locked tool version is unverified', async t => {
  const f = installFixture(t);
  const tools = ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'].map(id => structuredClone(manifest.tools.find(x => x.id === id)));
  tools[2].version = { ...tools[2].version, status: 'unverified', reason: 'approval pending' };
  f.fixtureManifest = { ...f.fixtureManifest, tools };
  f.options.runNpm = async () => assert.fail('npm must not run');
  const result = await installMacOS(f.fixtureManifest, f.options);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.components, [{ id: 'npm', status: 'unverified', reason: 'lavish-axi: approval pending' }]);
  assert.equal(existsSync(join(f.installRoot, 'releases', 'fixture-1', 'npm')), false);
});
