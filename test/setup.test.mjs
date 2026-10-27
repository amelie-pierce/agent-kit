import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { charterText, checkRoot, derivePaths, expandRoot, parseSetupArgs, resumeSummary, setup, wrapperScript } from '../src/setup.mjs';
import { doctor } from '../src/doctor.mjs';
import { parseHarness } from '../src/harness.mjs';
import { parseArgs } from '../src/kit.mjs';

const kitRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(kitRoot, 'manifests/pilot-skeleton.json'), 'utf8'));
const sha = body => createHash('sha256').update(body).digest('hex');
const posixOnly = { skip: process.platform === 'win32' };

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-setup-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), bin = join(base, 'bin'), root = join(base, 'Agentic');
  mkdirSync(home); mkdirSync(bin);
  // Person-installed and platform commands the Linux preflight looks for; gh answers only `api user` and `auth status`.
  for (const name of ['curl', 'tar', 'unzip', 'sh', 'sha256sum', 'firefox', 'xterm']) writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nif [ "$1 $2" = "api user" ]; then echo fixture-owner; exit 0; fi\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\nexit 1\n', { mode: 0o755 });
  // PATH holds only these stubs plus the real git and bash, so a removed stub is really missing.
  for (const name of ['git', 'bash']) symlinkSync(spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim(), join(bin, name));
  const env = { HOME: home, PATH: bin, SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1' };
  const artifacts = {};
  const tools = ['herdr', 'treehouse'].map(id => {
    const tool = structuredClone(manifest.tools.find(x => x.id === id));
    const body = `fixture ${id} binary`;
    artifacts[`https://fixture.test/${id}`] = body;
    tool.artifacts['linux-x64'] = { url: `https://fixture.test/${id}`, sha256: sha(body), status: 'verified', reason: '' };
    return tool;
  });
  const fixtureManifest = { ...manifest, release: 'fixture-1', tools };
  const downloads = [];
  const installOptions = { fetchArtifact: async (url, target) => { downloads.push(url); writeFileSync(target, artifacts[url]); } };
  const ctx = (argv, input = '') => {
    const chunks = [];
    return { argv, env, platform: 'linux', arch: 'x64', nodeVersion: '24.21.0', libc: 'glibc', procVersion: 'Linux version 6.8.0-generic', osRelease: 'PRETTY_NAME="Fixture Linux"',
      input: Readable.from(input ? [input] : []), output: new Writable({ write(chunk, _enc, done) { chunks.push(chunk.toString()); done(); } }), installOptions,
      get text() { return chunks.join(''); } };
  };
  return { base, home, bin, root, env, fixtureManifest, installOptions, downloads, ctx };
}

function kitCheckout(t, base) {
  const dir = join(base, 'kit-source');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'agent-kit.mjs'), '// fixture kit\n');
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'kit');
  return { dir, commit: git('rev-parse', 'HEAD') };
}

test('harness accepts claude, codex and both in either order', () => {
  assert.equal(parseHarness('claude,codex'), 'both');
  assert.equal(parseHarness('codex,claude'), 'both');
  assert.equal(parseHarness('codex'), 'codex');
  assert.equal(parseHarness('gemini'), null);
  assert.equal(parseArgs(['plan', '--harness', 'claude,codex']).harness, 'both');
  assert.equal(parseArgs(['doctor', '--root', '/x/Agentic'], 'linux').installRoot, join('/x/Agentic', '.tools'));
  assert.throws(() => parseArgs(['plan', '--root', '/x']), /only to doctor, keys and lifecycle commands/);
  assert.throws(() => parseArgs(['doctor', '--root', '/x', '--install-root', '/y']), /conflicts/);
});

test('setup flags validate values and refuse contradictions', () => {
  assert.deepEqual(parseSetupArgs(['--harness', 'codex,claude', '--no-figma', '--yes']), { harness: 'both', 'no-figma': true, yes: true });
  for (const [argv, message] of [
    [['--with-figma', '--no-figma'], /conflict/], [['--no-tower', '--with-tower'], /conflict/], [['--harness', 'gemini'], /--harness/],
    [['--channel', 'nightly'], /--channel/], [['--github-owner', 'bad owner'], /--github-owner/], [['--git-email', 'nope'], /--git-email/],
    [['--starter-mate', 'Bad_Name'], /--starter-mate/], [['--starter-scope', 'two\nlines'], /one line/], [['--kit-commit', 'abc'], /full commit/],
    [['--handoff', '--dry-run'], /--handoff/], [['--token', 'x'], /unknown setup argument/], [['--root'], /needs a value/],
    [['--starter-mate', 'mate', '--no-starter-mate'], /conflict/]]) assert.throws(() => parseSetupArgs(argv), message, argv.join(' '));
});

test('root folder refusals: home, its parents, system locations, Windows drives, existing homes and checkouts', posixOnly, t => {
  const f = fixture(t);
  const check = (root, extra = {}) => checkRoot(root, { home: f.home, platform: 'linux', installRoot: join(root, '.tools'), firstmateHome: join(root, 'firstmate'), ...extra });
  assert.throws(() => check(f.home), /home directory itself/);
  assert.throws(() => check(f.base), /contains your home directory/);
  assert.throws(() => check('/usr/local/agentic'), /system location/);
  assert.throws(() => check('/'), /home directory|system location/);
  assert.throws(() => check('/mnt/c/Agentic', { wsl: true }), /Windows drive/);
  assert.equal(expandRoot('~/Agentic', f.home), join(f.home, 'Agentic'));
  assert.throws(() => expandRoot('Agentic', f.home), /absolute path or start with ~\//);

  const repo = join(f.base, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  assert.throws(() => check(join(repo, 'Agentic')), /inside a git checkout/);
  const fmHome = join(f.base, 'fm');
  mkdirSync(fmHome); writeFileSync(join(fmHome, 'fm-bootstrap.sh'), '');
  assert.throws(() => check(join(fmHome, 'Agentic')), /inside an existing Firstmate home/);

  const root = join(f.base, 'root');
  mkdirSync(join(root, 'firstmate'), { recursive: true }); writeFileSync(join(root, 'firstmate', 'README.md'), 'someone else');
  assert.throws(() => check(root), /never touches an existing Firstmate home/);
  rmSync(join(root, 'firstmate'), { recursive: true });
  mkdirSync(join(root, '.tools')); writeFileSync(join(root, '.tools', 'other'), 'x');
  assert.throws(() => check(root), /holds no kit receipt/);
  writeFileSync(join(root, '.tools', 'receipt.json'), '{}');
  assert.equal(check(root).resume, true);

  const shared = join(f.base, 'shared');
  mkdirSync(join(shared, 'other-home', 'bin'), { recursive: true }); writeFileSync(join(shared, 'other-home', 'bin', 'fm-session-start.sh'), '');
  assert.match(check(shared).reasons.join(), /another Firstmate home/);
  const busy = join(f.base, 'busy');
  mkdirSync(busy); writeFileSync(join(busy, 'notes.txt'), 'x');
  assert.match(check(busy).reasons.join(), /not empty \(1 entry: notes\.txt\)/);
  assert.deepEqual(check(join(f.base, 'fresh')).reasons, []);
});

test('derived paths come from the root, and advanced overrides conflict-check against it', posixOnly, () => {
  const paths = derivePaths('/x/Agentic', {}, 'a'.repeat(40));
  assert.deepEqual([paths.firstmateHome, paths.installRoot, paths.treehousePool, paths.towerState, paths.wrapper, paths.kit],
    ['/x/Agentic/firstmate', '/x/Agentic/.tools', '/x/Agentic/.treehouse', '/x/Agentic/.zoe-fleet', '/x/Agentic/.tools/bin/treehouse', `/x/Agentic/.tools/kit/${'a'.repeat(40)}`]);
  assert.equal(derivePaths('/x/Agentic', { 'firstmate-home': '/y/fm' }).firstmateHome, '/y/fm');
  assert.throws(() => derivePaths('/x/Agentic', { 'install-root': '/x/Agentic' }), /cannot be the root folder/);
  assert.throws(() => derivePaths('/x/Agentic', { 'firstmate-home': '/x/Agentic/.treehouse/fm' }), /overlaps/);
  assert.throws(() => derivePaths('/x/Agentic', { 'install-root': '/x/Agentic/firstmate/kit' }), /contain each other/);
});

test('--yes --dry-run without a terminal uses the defaults, prints the summary and writes nothing', posixOnly, async t => {
  const f = fixture(t);
  const c = f.ctx(['--yes', '--dry-run', '--root', f.root]);
  assert.equal(await setup(f.fixtureManifest, c), 0);
  for (const line of ['1. Root folder: ' + f.root, '2. Agent CLIs: codex', '3. Figma support: on', '4. Fleet tower: on', '5. Global hooks and skills: on',
    '6. GitHub owner: fixture-owner', '7. Git identity: keep', '8. Starter second mate: no', '9. Update channel: releases',
    `Treehouse pool: ${join(f.root, '.treehouse')}`, 'Dry run: nothing was written.']) assert.ok(c.text.includes(line), line);
  assert.equal(existsSync(f.root), false);
  assert.deepEqual(readdirSync(f.home), []);
  assert.equal(f.downloads.length, 0);
});

test('setup writes only the optional key typed at the hidden prompt and records a boolean', posixOnly, async t => {
  const f = fixture(t), key = 'fixture-typesafe-key-123';
  const installPlatform = async (_manifest, options) => {
    assert.equal(options.env.TYPESAFE_API_KEY, undefined, 'install child environment is sanitized');
    mkdirSync(options.firstmateHome, { recursive: true });
    writeFileSync(join(options.firstmateHome, '.gitignore'), '.env\n');
    const git = spawnSync('git', ['init', '-q', options.firstmateHome], { env: options.env, encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    return { status: 'partial', components: [], bin: null, towerParity: 'unavailable', loginSteps: [] };
  };
  const unattended = f.ctx(['--yes', '--root', f.root, '--no-tower', '--no-global-hooks']);
  unattended.env = { ...f.env, TYPESAFE_API_KEY: key };
  unattended.installPlatform = installPlatform;
  assert.equal(await setup(f.fixtureManifest, unattended), 0, unattended.text);
  const envPath = join(f.root, 'firstmate', '.env');
  assert.equal(existsSync(envPath), false, '--yes leaves the key unset even with the variable in the environment');
  assert.match(unattended.text, /10\. Optional TYPESAFE_API_KEY: not set[^\n]*\n\s+Add, change or remove it later [^\n]*bash install\.sh --reconfigure keys --root /);

  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  const replies = [[/Add optional TYPESAFE_API_KEY[^\n]*$/, 'y\n'], [/TYPESAFE_API_KEY \(hidden[^\n]*$/, `${key}\r`], [/Write these changes now[^\n]*$/, 'y\n']];
  const chunks = [];
  const c = { ...f.ctx(['--root', f.root]), input, installPlatform, output: new Writable({ write(chunk, _enc, done) {
    chunks.push(chunk.toString());
    const next = replies[0];
    if (next && next[0].test(chunks.join(''))) { replies.shift(); setImmediate(() => input.write(next[1])); }
    done();
  } }) };
  Object.defineProperty(c, 'text', { get: () => chunks.join('') });
  assert.equal(await setup(f.fixtureManifest, c), 0, c.text);
  assert.equal(readFileSync(envPath, 'utf8'), `TYPESAFE_API_KEY=${key}\n`);
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  const receipt = readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8');
  assert.deepEqual(JSON.parse(receipt).setup.keys, { TYPESAFE_API_KEY: true });
  assert.equal(receipt.includes(key), false);
  assert.equal(c.text.includes(key), false);
  assert.match(c.text, /TYPESAFE_API_KEY: will set/);
  assert.throws(() => parseSetupArgs(['--typesafe-key-env']), /unknown|not/i);
});

test('the add-later key hint keeps a custom install root and pastes as shell arguments', posixOnly, async t => {
  const f = fixture(t), root = join(f.base, "Agent ic's"), installRoot = join(f.base, 'custom tools');
  const c = f.ctx(['--yes', '--dry-run', '--root', root, '--install-root', installRoot]);
  assert.equal(await setup(f.fixtureManifest, c), 0, c.text);
  const hint = c.text.match(/hidden prompt: bash install\.sh (.*)$/m)[1];
  const args = spawnSync('/bin/sh', ['-c', `printf '%s\\n' ${hint}`], { encoding: 'utf8' }).stdout.split('\n').slice(0, -1);
  assert.deepEqual(args, ['--reconfigure', 'keys', '--root', root, '--install-root', installRoot]);
});

test('scripted answers drive every prompt; nothing is written before yes; answers are saved without secrets', posixOnly, async t => {
  const f = fixture(t);
  const kit = kitCheckout(t, f.base);
  const answers = [f.root, 'y', 'n', 'n', 'y', 'my-org', 'n', 'Pat Example', 'pat@example.test', 'y', 'n', 'main'];
  const declined = f.ctx(['--kit-dir', kit.dir, '--kit-commit', kit.commit], [...answers, 'n', ''].join('\n'));
  assert.equal(await setup(f.fixtureManifest, declined), 1);
  assert.match(declined.text, /Cancelled; nothing was written/);
  assert.equal(existsSync(f.root), false);
  assert.equal(existsSync(join(f.home, '.gitconfig')), false);

  const c = f.ctx(['--kit-dir', kit.dir, '--kit-commit', kit.commit], [...answers, 'y', ''].join('\n'));
  const code = await setup(f.fixtureManifest, c);
  assert.equal(code, 0, c.text);
  for (const prompt of ['1. Root folder', '3. Figma support', '4. Fleet tower', '5. Register these kit hooks', '6. GitHub account', '7. Git identity', '8. Create a starter', '9. Update channel'])
    assert.ok(c.text.includes(prompt), prompt);
  const receipt = JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8'));
  assert.equal(statSync(join(f.root, '.tools', 'receipt.json')).mode & 0o777, 0o600);
  assert.deepEqual(receipt.setup.answers, { root: f.root, harness: 'codex', figma: false, tower: false, globalHooks: true, githubOwner: 'my-org',
    gitIdentity: { action: 'set', name: 'Pat Example', email: 'pat@example.test' }, starterMate: { create: false }, channel: 'main' });
  assert.deepEqual(receipt.setup.paths, { root: f.root, installRoot: join(f.root, '.tools'), firstmateHome: join(f.root, 'firstmate'), treehouseRoot: f.root, towerState: join(f.root, '.zoe-fleet') });
  assert.deepEqual(Object.values(receipt.setup.steps).map(x => x.state), ['complete', 'complete', 'complete', 'complete', 'not-selected', 'complete', 'complete']);
  assert.doesNotMatch(JSON.stringify(receipt), /token|password|secret/i);
  const gitconfig = readFileSync(join(f.home, '.gitconfig'), 'utf8');
  assert.match(gitconfig, /name = Pat Example/);
  assert.match(gitconfig, /email = pat@example.test/);
  const kitCopy = join(f.root, '.tools', 'kit', kit.commit);
  assert.equal(spawnSync('git', ['-C', kitCopy, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), kit.commit);
  assert.equal(spawnSync('git', ['-C', kitCopy, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.trim(), 'https://github.com/amelie-pierce/agent-kit.git');
  const wrapper = join(f.root, '.tools', 'bin', 'treehouse');
  assert.equal(readFileSync(wrapper, 'utf8'), wrapperScript(f.root, join(f.root, '.tools', 'releases', 'fixture-1', 'bin', 'treehouse')));
  assert.equal(receipt.phases['treehouse-root'].ownedSha256, sha(readFileSync(wrapper)));
  assert.equal(existsSync(join(f.home, '.claude')), false, 'no hook files for a manifest without hook tools');

  // Rerun: saved answers are reused and only the root and the final confirmation are asked.
  const again = f.ctx([], [f.root, 'y', ''].join('\n'));
  assert.equal(await setup(f.fixtureManifest, again), 0, again.text);
  assert.match(again.text, /Reusing your saved answers/);
  assert.match(again.text, /All 7 setup steps are recorded complete/);
  assert.doesNotMatch(again.text, /Claude Code is offered|3\. Figma support: check|7\. Git identity is/);
  assert.match(again.text, /1\. kit source at its pinned commit: complete/);
  assert.match(again.text, /Step 1 of 7: kit source at its pinned commit\n  complete: kit source verified at its pinned commit/);
  assert.equal(f.downloads.length, 2, 'rerun downloads nothing');
  const override = f.ctx(['--yes', '--dry-run', '--root', f.root, '--channel', 'releases']);
  assert.equal(await setup(f.fixtureManifest, override), 0, override.text);
  assert.match(override.text, /9\. Update channel: releases \(from --channel; your saved answer was main\)/);
  // --reconfigure asks again.
  const reconfigure = f.ctx(['--reconfigure', '--dry-run'], [f.root, 'n', 'n', 'n', 'my-org', 'y', 'n', 'releases', ''].join('\n'));
  assert.equal(await setup(f.fixtureManifest, reconfigure), 0, reconfigure.text);
  assert.match(reconfigure.text, /3\. Figma support: check/);
});

test('a failed step stops safely; the rerun prints the resume summary, re-verifies done steps and redoes only the failure', posixOnly, async t => {
  const f = fixture(t);
  const fetch = f.installOptions.fetchArtifact;
  f.installOptions.fetchArtifact = async (url, target) => { if (url.endsWith('treehouse')) throw new Error('network down'); return fetch(url, target); };
  const first = f.ctx(['--yes', '--root', f.root, '--no-tower', '--github-owner', 'my-org']);
  assert.equal(await setup(f.fixtureManifest, first), 1);
  assert.match(first.text, /Step 2 of 7: pinned tools[\s\S]*failed: network down\nStopped safely at step 2/);
  let receipt = JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8'));
  assert.equal(receipt.setup.steps.tools.state, 'failed');
  assert.equal(receipt.phases.herdr.state, 'complete');
  assert.equal(receipt.setup.answers.githubOwner, 'my-org');
  assert.equal(resumeSummary(receipt).step, 2);

  f.installOptions.fetchArtifact = fetch;
  const second = f.ctx(['--yes', '--root', f.root]);
  assert.equal(await setup(f.fixtureManifest, second), 0, second.text);
  assert.match(second.text, /Resuming from step 2 of 7 \(pinned tools, Firstmate home, tower and global hooks\)\.\n  1\. kit source at its pinned commit: not-selected/);
  assert.match(second.text, /2\. pinned tools, Firstmate home, tower and global hooks: failed \(network down\)/);
  assert.match(second.text, /- herdr: skipped; receipt and owned files match/);
  assert.match(second.text, /- treehouse: installed/);
  assert.deepEqual(f.downloads.filter(x => x.endsWith('herdr')).length, 1, 'herdr is not downloaded again');
  receipt = JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8'));
  assert.equal(receipt.setup.steps.tools.state, 'complete');
  assert.equal(receipt.setup.answers.tower, false, 'saved answer reused');
  const health = doctor(f.fixtureManifest, { installRoot: join(f.root, '.tools'), home: f.home, env: { ...f.env, PATH: `${join(f.root, '.tools', 'bin')}:${f.env.PATH}` }, platform: 'linux', arch: 'x64', nodeVersion: '24.21.0' });
  assert.equal(health.checks.find(x => x.id === 'treehouse-root').status, 'pass');
  assert.equal(health.checks.find(x => x.id === 'treehouse-path').status, 'pass', 'the kit wrapper counts as the kit treehouse');
});

test('the health-check hint names the actual install root, so an --install-root override is honoured', posixOnly, async t => {
  const f = fixture(t);
  const kit = kitCheckout(t, f.base);
  const installRoot = join(f.base, 'kit-tools');
  const c = f.ctx(['--yes', '--root', f.root, '--install-root', installRoot, '--no-tower', '--kit-dir', kit.dir, '--kit-commit', kit.commit]);
  assert.equal(await setup(f.fixtureManifest, c), 0, c.text);
  const hint = c.text.match(/Health check later: node (\S+) (doctor .*)\n/);
  assert.ok(hint, c.text);
  assert.equal(hint[1], join(installRoot, 'kit', kit.commit, 'bin', 'agent-kit.mjs'));
  const options = parseArgs(hint[2].split(' '));
  assert.equal(options.installRoot, installRoot);
  const health = doctor(f.fixtureManifest, { installRoot: options.installRoot, home: f.home, env: f.env, platform: 'linux', arch: 'x64', nodeVersion: '24.21.0' });
  assert.notEqual(health.checks.find(x => x.id === 'receipt')?.status, 'fail');
});

test('a saved git identity is not re-applied once you changed it: asked again, or kept under --yes', posixOnly, async t => {
  const f = fixture(t);
  const first = f.ctx(['--yes', '--root', f.root, '--no-tower', '--git-name', 'Pat Example', '--git-email', 'pat@example.test']);
  assert.equal(await setup(f.fixtureManifest, first), 0, first.text);
  const gitconfig = () => readFileSync(join(f.home, '.gitconfig'), 'utf8');
  assert.match(gitconfig(), /name = Pat Example/);
  const set = (key, value) => assert.equal(spawnSync('git', ['config', '--global', key, value], { env: f.env }).status, 0);
  set('user.name', 'Sam Changed'); set('user.email', 'sam@example.test');

  const asked = f.ctx(['--dry-run'], [f.root, 'y', ''].join('\n'));
  assert.equal(await setup(f.fixtureManifest, asked), 0, asked.text);
  assert.match(asked.text, /Your git identity changed since you saved "Pat Example" <pat@example\.test>, so it is asked again/);
  assert.match(asked.text, /7\. Git identity is Sam Changed <sam@example\.test>\. Keep it as it is/);
  assert.match(asked.text, /7\. Git identity: keep \(Sam Changed <sam@example\.test>\)\n/);

  const unattended = f.ctx(['--yes', '--root', f.root]);
  assert.equal(await setup(f.fixtureManifest, unattended), 0, unattended.text);
  assert.match(unattended.text, /7\. Git identity: keep \(Sam Changed <sam@example\.test>\); your saved "Pat Example" <pat@example\.test> was not applied because git's value changed since/);
  assert.match(gitconfig(), /name = Sam Changed/);
  assert.match(gitconfig(), /email = sam@example\.test/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8')).setup.answers.gitIdentity, { action: 'keep' });
});

test('unattended root confirmation needs --allow-existing-root; a changed recorded root is refused', posixOnly, async t => {
  const f = fixture(t);
  mkdirSync(f.root); writeFileSync(join(f.root, 'notes.txt'), 'mine');
  await assert.rejects(setup(f.fixtureManifest, f.ctx(['--yes', '--dry-run', '--root', f.root])), /refusing .*not empty.*--allow-existing-root/);
  assert.equal(await setup(f.fixtureManifest, f.ctx(['--yes', '--dry-run', '--root', f.root, '--allow-existing-root'])), 0);
  const asked = f.ctx(['--dry-run', '--root', f.root], 'n\n');
  await assert.rejects(setup(f.fixtureManifest, asked), /refusing/);
  assert.match(asked.text, /needs confirmation: it is not empty/);
  await assert.rejects(setup(f.fixtureManifest, f.ctx(['--yes', '--dry-run', '--root', f.home])), /home directory itself/);

  const other = join(f.base, 'Other');
  mkdirSync(join(other, '.tools'), { recursive: true });
  writeFileSync(join(other, '.tools', 'receipt.json'), JSON.stringify({ schemaVersion: 1, release: 'fixture-1', phases: {}, setup: { paths: { root: '/elsewhere' } } }));
  await assert.rejects(setup(f.fixtureManifest, f.ctx(['--yes', '--dry-run', '--root', other])), /refusing to move it/);
  writeFileSync(join(other, '.tools', 'receipt.json'), JSON.stringify({ schemaVersion: 1, release: 'older-release', phases: {} }));
  await assert.rejects(setup(f.fixtureManifest, f.ctx(['--yes', '--dry-run', '--root', other])), /records kit release older-release/);
});

test('missing prerequisites stop before any write, with install links', posixOnly, async t => {
  const f = fixture(t);
  rmSync(join(f.bin, 'curl'));
  const node = structuredClone(manifest.tools.find(x => x.id === 'github-cli'));
  f.fixtureManifest.tools.push(node);
  rmSync(join(f.bin, 'gh'));
  const c = f.ctx(['--yes', '--root', f.root]);
  assert.equal(await setup(f.fixtureManifest, c), 1);
  assert.match(c.text, /Install these yourself first[\s\S]*- curl: curl absent from PATH[\s\S]*- github-cli: gh absent from PATH; .*https:\/\/github\.com\/cli\/cli#installation/);
  assert.match(c.text, /Stopped before any change/);
  assert.equal(existsSync(f.root), false);
});

test('starter second mate runs Firstmate scaffold and seed with the scope, and never launches it', posixOnly, async t => {
  const f = fixture(t);
  const log = join(f.base, 'calls.log');
  const fakeInstall = async (_manifest, options) => {
    const fm = options.firstmateHome;
    mkdirSync(join(fm, 'bin'), { recursive: true }); mkdirSync(join(fm, 'data'));
    for (const name of ['fm-brief.sh', 'fm-home-seed.sh', 'fm-spawn.sh']) writeFileSync(join(fm, 'bin', name),
      `printf '%s|%s|%s\\n' "${name} $*" "$FM_SECONDMATE_SCOPE" "$(command -v treehouse || true)" >> '${log}'\n${name === 'fm-home-seed.sh' ? `printf '%s\\n' "- $1: home=$2" >> data/secondmates.md\n` : ''}`);
    return { status: 'installed', exitCode: 0, components: [{ id: 'firstmate', status: 'installed', reason: 'fixture' }], bin: join(options.installRoot, 'releases', 'fixture-1', 'bin'),
      npmBin: null, codexBin: null, firstmateHome: fm, towerParity: 'unavailable', towerLauncher: null, loginSteps: [] };
  };
  const c = Object.assign(f.ctx(['--yes', '--root', f.root, '--starter-mate', 'docs-mate', '--starter-scope', 'Keep the docs tidy']), { installPlatform: fakeInstall });
  await setup(f.fixtureManifest, c);
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(calls.map(x => x.split('|')[0]), ['fm-brief.sh docs-mate --secondmate --no-projects', `fm-home-seed.sh docs-mate ${join(f.root, 'secondmates', 'docs-mate')} --no-projects`]);
  assert.ok(calls.every(x => x.split('|')[1] === 'Keep the docs tidy'));
  assert.equal(charterText('Keep the docs tidy'), 'Responsibility: Keep the docs tidy\n\nScope: Keep the docs tidy\n\nThe teammate reviews this charter and supplies their own project list and permissions in Firstmate.');
  assert.match(c.text, /docs-mate seeded at .*launch it yourself .*fm-spawn\.sh docs-mate --secondmate/);
  const receipt = JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8'));
  assert.equal(receipt.setup.steps['starter-mate'].state, 'complete');
  // A rerun finds the registered mate and does not seed again.
  await setup(f.fixtureManifest, Object.assign(f.ctx(['--yes', '--root', f.root]), { installPlatform: fakeInstall }));
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
});

test('the kit Treehouse wrapper sets only the default root and still lets --root win', posixOnly, t => {
  const f = fixture(t);
  const fake = join(f.base, 'treehouse-binary');
  writeFileSync(fake, '#!/bin/sh\nprintf "%s|%s\\n" "$TREEHOUSE_ROOT" "$*"\n', { mode: 0o755 });
  const wrapper = join(f.base, 'wrapper');
  writeFileSync(wrapper, wrapperScript(join(f.base, "it's root"), fake), { mode: 0o755 });
  const out = spawnSync(wrapper, ['get', '--root', '/explicit'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).stdout;
  assert.equal(out, `${join(f.base, "it's root")}|get --root /explicit\n`);
});
