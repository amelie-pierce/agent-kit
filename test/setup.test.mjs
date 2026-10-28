import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, linkSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withOwnerTiers } from '../src/dispatch.mjs';
import { finishLine, charterText, checkRoot, derivePaths, expandRoot, parseSetupArgs, resumeSummary, setup, wrapperScript } from '../src/setup.mjs';
import { doctor } from '../src/doctor.mjs';
import { planRemoveProfile, renderProfileBlock } from '../src/shell-profile.mjs';
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
  // A python3 that reports 3.12, as the Linux preflight requires; the shortcuts step finds it too.
  writeFileSync(join(bin, 'python3'), '#!/bin/sh\n[ "$1" = --version ] && { echo Python 3.12.3; exit 0; }\nexit 1\n', { mode: 0o755 });
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
    return { argv, env, platform: 'linux', arch: 'x64', nodeVersion: '24.21.0', libc: 'glibc', procVersion: 'Linux version 6.8.0-generic', osRelease: 'PRETTY_NAME="Fixture Linux"', herdrPath: { servers: () => [] },
      input: Readable.from(input ? [input] : []), output: new Writable({ write(chunk, _enc, done) { chunks.push(chunk.toString()); done(); } }), installOptions,
      get text() { return chunks.join(''); } };
  };
  return { base, home, bin, root, env, fixtureManifest, installOptions, downloads, ctx };
}

const kitCopyOf = (f, kit) => join(f.root, '.tools', 'kit', kit.commit);
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

test('setup refuses the Windows-only --distro and --handoff off Windows, like the CLI', posixOnly, async t => {
  for (const platform of ['darwin', 'linux'])
    for (const argv of [['--distro', 'Ubuntu'], ['--handoff'], ['--yes', '--distro', 'Ubuntu', '--handoff']])
      assert.throws(() => parseSetupArgs(argv, platform), /--handoff and --distro apply only on Windows/, `${platform} ${argv.join(' ')}`);
  assert.deepEqual(parseSetupArgs(['--distro', 'Ubuntu', '--handoff'], 'win32'), { distro: 'Ubuntu', handoff: true });
  const f = fixture(t);
  const c = f.ctx(['--yes', '--dry-run', '--root', f.root, '--distro', 'Ubuntu']);
  await assert.rejects(setup(f.fixtureManifest, c), /--handoff and --distro apply only on Windows/);
  assert.equal(existsSync(f.root), false);
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

test('the summary lists exactly the Herdr keys the kit will bind, by the placement rules', posixOnly, async t => {
  const f = fixture(t);
  const c = f.ctx(['--yes', '--dry-run', '--harness', 'claude', '--no-tower', '--root', f.root]);
  assert.equal(await setup(f.fixtureManifest, c), 0);
  const line = c.text.split('\n').find(l => l.includes('agent-kit keys block'));
  assert.ok(line, c.text);
  assert.match(line, /\(prefix\+f open-firstmate claude, prefix\+shift\+m open-firstmate mates;/, 'the mates key is bound even with the tower off');
  assert.doesNotMatch(line, /prefix\+shift\+f|prefix\+shift\+c|prefix\+m /, 'no Codex key, and no plugin keys for plugins not registered');
});

const keyInstall = async (_manifest, options) => {
  assert.equal(options.env.TYPESAFE_API_KEY, undefined, 'install child environment is sanitized');
  mkdirSync(options.firstmateHome, { recursive: true });
  writeFileSync(join(options.firstmateHome, '.gitignore'), '.env\n');
  const git = spawnSync('git', ['init', '-q', options.firstmateHome], { env: options.env, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  return { status: 'partial', components: [], bin: null, towerParity: 'unavailable', loginSteps: [] };
};
function ttyCtx(f, argv, replies) {
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  const chunks = [];
  const c = { ...f.ctx(argv.includes('--shell-profile') ? argv : ['--no-shell-profile', ...argv]), input, installPlatform: keyInstall, output: new Writable({ write(chunk, _enc, done) {
    chunks.push(chunk.toString());
    const next = replies[0];
    if (next && next[0].test(chunks.join(''))) { replies.shift(); setImmediate(() => input.write(next[1])); }
    done();
  } }) };
  Object.defineProperty(c, 'text', { get: () => chunks.join('') });
  return c;
}

test('setup writes only the optional key typed at the hidden prompt and records a boolean', posixOnly, async t => {
  const f = fixture(t), key = 'fixture-typesafe-key-123';
  const unattended = f.ctx(['--yes', '--root', f.root, '--no-tower', '--no-global-hooks']);
  unattended.env = { ...f.env, TYPESAFE_API_KEY: key };
  unattended.installPlatform = keyInstall;
  assert.equal(await setup(f.fixtureManifest, unattended), 0, unattended.text);
  const envPath = join(f.root, 'firstmate', '.env');
  assert.equal(existsSync(envPath), false, '--yes leaves the key unset even with the variable in the environment');
  assert.match(unattended.text, /10\. Optional TYPESAFE_API_KEY: not set[^\n]*\n\s+Add, change or remove it later [^\n]*bash install\.sh --reconfigure keys --root /);

  const c = ttyCtx(f, ['--root', f.root], [[/Add optional TYPESAFE_API_KEY[^\n]*$/, 'y\n'], [/TYPESAFE_API_KEY \(hidden[^\n]*$/, `${key}\r`], [/Write these changes now[^\n]*$/, 'y\n']]);
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

test('setup writes Firstmate\'s balanced starter rules only once the key is set and never over existing rules', posixOnly, async t => {
  const f = fixture(t), key = 'fixture-typesafe-key-123';
  const template = { dispatch: { rules: [{ when: 'Light', use: [{ harness: 'claude', model: 'claude-small' }, { harness: 'codex', model: 'codex-small' }], strategy: 'light' }],
    default: [{ harness: 'codex', model: 'codex-fixture' }] }, autonomy: { level: 'balanced' } };
  const install = async (manifest, options) => {
    const result = await keyInstall(manifest, options);
    writeFileSync(join(options.firstmateHome, '.gitignore'), '.env\nconfig/\n');
    mkdirSync(join(options.firstmateHome, 'bin', 'strategies'), { recursive: true });
    writeFileSync(join(options.firstmateHome, 'bin', 'strategies', 'balanced.json'), JSON.stringify(template));
    return result;
  };
  const rules = join(f.root, 'firstmate', 'config', 'crew-dispatch.json'), receiptPath = join(f.root, '.tools', 'receipt.json');
  const first = f.ctx(['--yes', '--root', f.root, '--no-tower', '--no-global-hooks']);
  first.installPlatform = install;
  assert.equal(await setup(f.fixtureManifest, first), 0, first.text);
  assert.match(first.text, /Starter dispatch rules: will select Firstmate's \w+ strategy for [^\n]* with bin\/fm-strategy\.sh --plans/, 'a home not cloned yet is judged by the pinned Firstmate, key or not');
  assert.equal(existsSync(rules), false, 'no key, no rules');

  const c = ttyCtx(f, ['--root', f.root], [[/Add optional TYPESAFE_API_KEY[^\n]*$/, 'y\n'], [/TYPESAFE_API_KEY \(hidden[^\n]*$/, `${key}\r`], [/Write these changes now[^\n]*$/, 'y\n']]);
  c.installPlatform = install;
  assert.equal(await setup(f.fixtureManifest, c), 0, c.text);
  assert.match(c.text, /Starter dispatch rules: will write Firstmate's balanced rules for codex to [^\n]*crew-dispatch\.json/);
  assert.match(c.text, /Starter dispatch rules: wrote Firstmate's balanced rules for codex/);
  const rendered = { rules: [{ ...template.dispatch.rules[0], use: [template.dispatch.rules[0].use[1]] }], default: template.dispatch.default };
  assert.deepEqual(JSON.parse(readFileSync(rules, 'utf8')), JSON.parse(withOwnerTiers(`${JSON.stringify(rendered)}\n`)), 'the template rules, then the kit\'s check and research tiers');
  assert.deepEqual(readdirSync(join(f.root, 'firstmate', 'config')), ['crew-dispatch.json']);
  const receipt = readFileSync(receiptPath, 'utf8');
  assert.deepEqual(JSON.parse(receipt).setup.dispatch, { file: 'config/crew-dispatch.json', template: 'balanced', providers: 'codex', plans: { codex: 'not-sure' }, sha256: sha(readFileSync(rules)) });
  assert.equal(receipt.includes(key) || c.text.includes(key), false);

  writeFileSync(rules, '{"rules":[]}\n');
  const rerun = f.ctx(['--yes', '--root', f.root]);
  rerun.installPlatform = install;
  assert.equal(await setup(f.fixtureManifest, rerun), 0, rerun.text);
  assert.match(rerun.text, /Starter dispatch rules: keep your existing [^\n]*crew-dispatch\.json/);
  assert.match(rerun.text, /Starter dispatch rules: kept [^\n]*existing rules are yours/);
  assert.equal(readFileSync(rules, 'utf8'), '{"rules":[]}\n');
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).setup.dispatch, undefined);
});

test('the plan and mode questions use the approved plan ids, warn before full on a small plan, and change with --reconfigure', posixOnly, async t => {
  const f = fixture(t);
  const c = ttyCtx(f, ['--root', f.root, '--no-tower', '--no-global-hooks', '--no-figma', '--github-owner', 'my-org', '--no-starter-mate', '--channel', 'releases'],
    [[/2b\. Codex subscription plan, for starter dispatch rules: plus, pro, business-standard, business-premium, enterprise-edu, api or skip \[skip\][^\n]*$/, 'plus\n'],
      [/2c\. Starter routing mode for Firstmate's dispatch strategy: lean, balanced or full \[lean\][^\n]*$/, 'full\n'],
      [/Warning: full on ChatGPT Plus can reach the five-hour limit first, then the weekly limit\. Use full anyway[^\n]*$/, 'n\n'],
      [/2d\. Use the full-access Codex launch[^\n]*$/, '\n'],
      [/Keep it as it is[^\n]*$/, 'y\n'], [/Add optional TYPESAFE_API_KEY[^\n]*$/, 'n\n'], [/Write these changes now[^\n]*$/, 'y\n']]);
  assert.equal(await setup(f.fixtureManifest, c), 0, c.text);
  assert.match(c.text, /2c\. Firstmate token strategy modes:\n   full: unlock full power\n   balanced: optimize for token saving while everything still work\n   lean: harder optimization for token saving while everything still work\n/, 'the owner\'s definitions come before the question');
  assert.match(c.text, /2\. Agent CLIs: codex \(plan: codex plus; starter routing mode: lean\)/);
  assert.match(c.text, /2d\. Full-access Codex launch: ON - Codex workers can read and write anything your account can/, 'the default is on and the summary says so');
  assert.equal(JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8')).setup.answers.codexFullAccess, true);
  const receiptPath = join(f.root, '.tools', 'receipt.json'), saved = () => JSON.parse(readFileSync(receiptPath, 'utf8')).setup.answers;
  assert.deepEqual([saved().plans, saved().dispatchMode], [{ codex: 'plus' }, 'lean']);
  const rerun = f.ctx(['--yes', '--root', f.root]); rerun.installPlatform = keyInstall;
  assert.equal(await setup(f.fixtureManifest, rerun), 0, rerun.text);
  assert.deepEqual([saved().plans, saved().dispatchMode], [{ codex: 'plus' }, 'lean'], 'saved answers reused');
  const flagged = f.ctx(['--yes', '--reconfigure', '--root', f.root, '--codex-plan', 'pro']); flagged.installPlatform = keyInstall;
  assert.equal(await setup(f.fixtureManifest, flagged), 0, flagged.text);
  assert.deepEqual([saved().plans, saved().dispatchMode], [{ codex: 'pro' }, 'balanced'], 'a new plan takes its default mode');
  const full = f.ctx(['--yes', '--root', f.root, '--codex-plan', 'business-standard', '--dispatch-mode', 'full']); full.installPlatform = keyInstall;
  assert.equal(await setup(f.fixtureManifest, full), 0, full.text);
  assert.match(full.text, /Warning: full on Business Standard seat can reach the five-hour limit first/);
  assert.equal(saved().dispatchMode, 'full');
  const skip = f.ctx(['--yes', '--root', f.root, '--codex-plan', 'skip']); skip.installPlatform = keyInstall;
  assert.equal(await setup(f.fixtureManifest, skip), 0, skip.text);
  assert.deepEqual(saved().plans, { codex: 'not-sure' });
  for (const [argv, message] of [[['--codex-plan', 'max5x'], /--codex-plan must be one of: plus, pro, business-standard, business-premium, enterprise-edu, api or skip/],
    [['--claude-plan', 'pro'], /--claude-plan needs claude among the agent CLIs/], [['--dispatch-mode', 'turbo'], /--dispatch-mode must be lean, balanced or full/]])
    await assert.rejects(setup(f.fixtureManifest, f.ctx(['--yes', '--dry-run', '--root', f.root, ...argv])), message);
});

test('a terminal dry run never asks for the key and shows only its current status', posixOnly, async t => {
  const f = fixture(t), key = 'fixture-typesafe-key-123';
  const first = f.ctx(['--yes', '--root', f.root, '--no-tower', '--no-global-hooks']);
  first.installPlatform = keyInstall;
  assert.equal(await setup(f.fixtureManifest, first), 0, first.text);
  const c = ttyCtx(f, ['--root', f.root, '--dry-run'], [[/Add optional TYPESAFE_API_KEY[^\n]*$/, 'y\n'], [/TYPESAFE_API_KEY \(hidden[^\n]*$/, `${key}\r`]]);
  assert.equal(await setup(f.fixtureManifest, c), 0, c.text);
  assert.doesNotMatch(c.text, /Add optional TYPESAFE_API_KEY|hidden; press Enter|will set/);
  assert.match(c.text, /10\. Optional TYPESAFE_API_KEY: not set/);
  assert.equal(existsSync(join(f.root, 'firstmate', '.env')), false);
});

test('setup continues past a symlinked or hard-linked .env without reading, changing or recording it', posixOnly, async t => {
  const f = fixture(t), key = 'fixture-typesafe-key-123';
  const first = f.ctx(['--yes', '--root', f.root, '--no-tower', '--no-global-hooks']);
  first.installPlatform = keyInstall;
  assert.equal(await setup(f.fixtureManifest, first), 0, first.text);
  const envPath = join(f.root, 'firstmate', '.env'), target = join(f.base, 'shared.env');
  for (const link of [symlinkSync, linkSync]) {
    rmSync(envPath, { force: true });
    writeFileSync(target, `TYPESAFE_API_KEY=${key}\n`, { mode: 0o600 });
    link(target, envPath);
    const c = ttyCtx(f, ['--root', f.root], [[/Write these changes now[^\n]*$/, 'y\n']]);
    assert.equal(await setup(f.fixtureManifest, c), 0, c.text);
    assert.match(c.text, /10\. Optional TYPESAFE_API_KEY: not checked\. Warning: [^\n]*\.env is a symlink, hard link/);
    assert.doesNotMatch(c.text, /Add optional TYPESAFE_API_KEY|TYPESAFE_API_KEY: (set|not set|will set)/);
    assert.equal(c.text.includes(key), false);
    assert.equal(readFileSync(target, 'utf8'), `TYPESAFE_API_KEY=${key}\n`);
    assert.equal(JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8')).setup.keys, undefined);
  }
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
  const answers = [f.root, 'y', '', '', 'n', 'n', 'n', 'y', '', '', 'my-org', 'n', 'Pat Example', 'pat@example.test', 'y', 'n', 'main'];
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
  assert.match(c.text, /2d\. Full-access Codex launch: Codex workers that Firstmate starts can read and write anything your user account can, run any command without asking you first, and run hooks without the hook trust review\./);
  assert.deepEqual(receipt.setup.answers, { root: f.root, harness: 'codex', plans: { codex: 'not-sure' }, dispatchMode: 'balanced', codexFullAccess: false, figma: false, tower: false, globalHooks: true, herdrLayout: true, shellProfile: true, githubOwner: 'my-org',
    gitIdentity: { action: 'set', name: 'Pat Example', email: 'pat@example.test' }, starterMate: { create: false }, channel: 'main' });
  assert.deepEqual(receipt.setup.paths, { root: f.root, installRoot: join(f.root, '.tools'), firstmateHome: join(f.root, 'firstmate'), treehouseRoot: f.root, towerState: join(f.root, '.zoe-fleet') });
  assert.deepEqual(Object.values(receipt.setup.steps).map(x => x.state), ['complete', 'complete', 'complete', 'complete', 'complete', 'not-selected', 'complete', 'complete']);
  assert.equal(receipt.setup.steps.shortcuts.detail, 'not set up: needs an agent CLI, the installed kit source; shell profile add');
  const fm = join(f.root, 'firstmate'), kitBin = join(f.root, '.tools', 'releases', 'fixture-1', 'bin');
  assert.ok(c.text.endsWith(['Next steps:',
    `  1. Open a new terminal. The kit put its PATH block in ${join(f.home, '.bashrc')}, so every new terminal finds the kit tools (undo it with agent-kit uninstall).`,
    `  2. Health check later: node ${join(kitCopyOf(f, kit), 'bin', 'agent-kit.mjs')} doctor --install-root ${join(f.root, '.tools')}`,
    '  3. Sign in to codex yourself in that terminal; the kit never signs in for you.',
    '  4. Start Herdr: herdr',
    `  5. In a Herdr pane, start codex in your Firstmate home: cd '${fm}' && codex`,
    'Start-up walkthrough: see "After a successful install: start it up" in the Agent Kit guide.', ''].join('\n')), c.text.slice(-1200));
  const rc = readFileSync(join(f.home, '.bashrc'), 'utf8');
  assert.equal(rc, `${renderProfileBlock([join(f.root, '.tools', 'bin'), kitBin])}\n`);
  assert.match(c.text, /5b\. Shell profile PATH block: on/);
  assert.equal(receipt.setup.shellProfile.path, join(f.home, '.bashrc'));
  assert.equal(receipt.setup.shellProfile.created, true);
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
  assert.match(again.text, /All 8 setup steps are recorded complete/);
  assert.doesNotMatch(again.text, /Claude Code is offered|3\. Figma support: check|7\. Git identity is/);
  assert.match(again.text, /1\. kit source at its pinned commit: complete/);
  assert.match(again.text, /Step 1 of 8: kit source at its pinned commit\n  complete: kit source verified at its pinned commit/);
  assert.equal(f.downloads.length, 2, 'rerun downloads nothing');
  const override = f.ctx(['--yes', '--dry-run', '--root', f.root, '--channel', 'releases']);
  assert.equal(await setup(f.fixtureManifest, override), 0, override.text);
  assert.match(override.text, /9\. Update channel: releases \(from --channel; your saved answer was main\)/);
  // --reconfigure asks again.
  const reconfigure = f.ctx(['--reconfigure', '--dry-run'], [f.root, '', '', '', 'n', 'n', 'n', '', 'my-org', 'y', 'n', 'releases', ''].join('\n'));
  assert.equal(await setup(f.fixtureManifest, reconfigure), 0, reconfigure.text);
  assert.match(reconfigure.text, /3\. Figma support: check/);
  const skippedProfile = f.ctx(['--yes', '--root', f.root, '--no-shell-profile']);
  assert.equal(await setup(f.fixtureManifest, skippedProfile), 0, skippedProfile.text);
  const afterSkip = JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8'));
  assert.equal(afterSkip.setup.answers.shellProfile, false);
  assert.deepEqual(afterSkip.setup.shellProfile, receipt.setup.shellProfile);
  assert.equal(readFileSync(join(f.home, '.bashrc'), 'utf8'), rc);
  assert.equal(planRemoveProfile(afterSkip.setup.shellProfile).action, 'remove the unchanged agent-kit PATH block');
  assert.match(skippedProfile.text, /1\. Open a new terminal\. The kit put its PATH block/);
  assert.doesNotMatch(skippedProfile.text, /1\. Add these folders to the start of your PATH yourself/);
  writeFileSync(join(f.home, '.bashrc'), rc.replace(/^export PATH=/m, '# export PATH='));
  const skippedBroken = f.ctx(['--yes', '--root', f.root, '--no-shell-profile']);
  assert.equal(await setup(f.fixtureManifest, skippedBroken), 1, skippedBroken.text);
  assert.match(skippedBroken.text, /1\. Add these folders to the start of your PATH yourself/);
  // A profile the person saves while the step writes it: the step stops, nonzero, with the file as they left it.
  writeFileSync(join(f.home, '.bashrc'), 'alias a=b\n');
  const busy = Object.assign(f.ctx(['--yes', '--root', f.root, '--shell-profile']), { beforeProfileReplace: path => writeFileSync(path, `${readFileSync(path, 'utf8')}export MINE=1\n`) });
  assert.equal(await setup(f.fixtureManifest, busy), 1, busy.text);
  assert.equal(readFileSync(join(f.home, '.bashrc'), 'utf8'), 'alias a=b\nexport MINE=1\n');
  assert.ok(busy.text.includes(`failed: ${join(f.home, '.bashrc')} changed while the kit was updating its PATH block; left unchanged. Save the file, then re-run the command.`), busy.text);
});

test('a failed step stops safely; the rerun prints the resume summary, re-verifies done steps and redoes only the failure', posixOnly, async t => {
  const f = fixture(t);
  const fetch = f.installOptions.fetchArtifact;
  f.installOptions.fetchArtifact = async (url, target) => { if (url.endsWith('treehouse')) throw new Error('network down'); return fetch(url, target); };
  const first = f.ctx(['--yes', '--root', f.root, '--no-tower', '--github-owner', 'my-org']);
  assert.equal(await setup(f.fixtureManifest, first), 1);
  assert.match(first.text, /Step 2 of 8: pinned tools[\s\S]*failed: network down\nStopped safely at step 2/);
  let receipt = JSON.parse(readFileSync(join(f.root, '.tools', 'receipt.json'), 'utf8'));
  assert.equal(receipt.setup.steps.tools.state, 'failed');
  assert.equal(receipt.phases.herdr.state, 'complete');
  assert.equal(receipt.setup.answers.githubOwner, 'my-org');
  assert.equal(resumeSummary(receipt).step, 2);

  f.installOptions.fetchArtifact = fetch;
  const second = f.ctx(['--yes', '--root', f.root]);
  assert.equal(await setup(f.fixtureManifest, second), 0, second.text);
  assert.match(second.text, /Resuming from step 2 of 8 \(pinned tools, Firstmate home, tower and global hooks\)\.\n  1\. kit source at its pinned commit: not-selected/);
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

test('the summary shows the exact PATH block, --no-shell-profile skips it, and a stale Herdr gets restart steps without anything being stopped', posixOnly, async t => {
  const f = fixture(t), rc = join(f.home, '.bashrc');
  const run = (argv, herdrPath) => Object.assign(f.ctx(['--yes', '--root', f.root, '--no-tower', '--no-global-hooks', ...argv]), { installPlatform: keyInstall, herdrPath });
  const skipped = run(['--no-shell-profile'], { servers: () => [] });
  assert.equal(await setup(f.fixtureManifest, skipped), 0, skipped.text);
  assert.match(skipped.text, /5b\. Shell profile PATH block: off/);
  assert.equal(existsSync(rc), false);
  assert.match(skipped.text, /you chose not to let the kit edit your shell profile/);
  rmSync(f.root, { recursive: true, force: true });
  const stale = run(['--shell-profile'], { servers: () => [41], serverPath: () => '/usr/bin' });
  await setup(f.fixtureManifest, stale);
  assert.match(stale.text, new RegExp(`${rc.replaceAll('.', '\\.')}: one marked PATH block, added at the end[^\\n]*\\n    # >>> agent-kit PATH >>>`));
  assert.match(readFileSync(rc, 'utf8'), /^# >>> agent-kit PATH >>>\n/);
  assert.match(stale.text, /  4\. Herdr is already running and cannot see the kit tools[^\n]*\n       a\. quit the agents[^\n]*\n       b\. run: herdr server stop\n       c\. open a new terminal[^\n]*\n       d\. run: herdr\n/);
  assert.match(stale.text, /WARN herdr-path-env: the running Herdr server cannot see/);
  assert.doesNotMatch(stale.text, /\/usr\/bin/, 'no environment value is printed');
});

test('a setup that finishes with failures tells you to open a new terminal and run doctor again', () => {
  assert.equal(finishLine(true, false), 'Agent Kit setup finished with failures.\nIf the failure says an older copy of a tool comes first on PATH, open a new terminal and run doctor again.');
  assert.equal(finishLine(false, false), 'Agent Kit setup complete.');
  assert.equal(finishLine(false, true), 'Agent Kit setup finished; some tools are partial and are retried on rerun.');
});
