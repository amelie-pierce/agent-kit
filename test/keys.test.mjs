import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { hiddenKey, keyStatus, validateTypesafeKey, writeKey } from '../src/keys.mjs';

const kit = fileURLToPath(new URL('..', import.meta.url));
const fakeKey = 'fixture-typesafe-key-123';
// File modes, bash and Linux --root paths are POSIX behavior; on Windows the kit runs inside WSL.
const posixOnly = { skip: process.platform === 'win32' };
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'kit-keys-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), root = join(home, 'Agentic'), firstmate = join(root, 'firstmate'), tools = join(root, '.tools');
  mkdirSync(firstmate, { recursive: true }); mkdirSync(tools); writeFileSync(join(firstmate, '.gitignore'), '.env\n');
  const init = spawnSync('git', ['init', '-q', firstmate], { encoding: 'utf8', env: { HOME: home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(init.status, 0, init.stderr);
  const receipt = join(tools, 'receipt.json');
  writeFileSync(receipt, `${JSON.stringify({ schemaVersion: 1, release: 'fixture', phases: {}, setup: { paths: { firstmateHome: firstmate } } })}\n`, { mode: 0o600 });
  return { base, home, root, firstmate, tools, receipt, envPath: join(firstmate, '.env') };
}

test('key write preserves unrelated lines, uses a private atomic replacement and removes only its key', posixOnly, async t => {
  const f = fixture(t);
  const before = '# keep this comment\nOTHER=keep\nTYPESAFE_API_KEY=oldfixture123\n';
  writeFileSync(f.envPath, before, { mode: 0o600 });
  const inode = statSync(f.envPath).ino;
  assert.equal(keyStatus(f.firstmate), true);
  await writeKey(f.firstmate, 'set', fakeKey);
  assert.notEqual(statSync(f.envPath).ino, inode, 'renamed temp file replaces the old inode');
  assert.equal(statSync(f.envPath).mode & 0o777, 0o600);
  assert.match(readFileSync(f.envPath, 'utf8'), /^# keep this comment\nOTHER=keep\n/);
  assert.match(readFileSync(f.envPath, 'utf8'), /TYPESAFE_API_KEY=fixture-typesafe-key-123/);
  assert.deepEqual(readdirSync(f.firstmate).filter(name => name.includes('agent-kit-')), []);
  await writeKey(f.firstmate, 'remove');
  assert.equal(keyStatus(f.firstmate), false);
  assert.match(readFileSync(f.envPath, 'utf8'), /^# keep this comment\nOTHER=keep\n/);
  assert.doesNotMatch(readFileSync(f.envPath, 'utf8'), /TYPESAFE_API_KEY/);
});

test('key input validation rejects empty and unsafe values', () => {
  for (const value of ['', 'short', 'bad value', 'bad\nvalue', 'bad$(command)']) assert.throws(() => validateTypesafeKey(value));
  assert.equal(validateTypesafeKey(fakeKey), fakeKey);
});

test('hidden TTY entry never echoes the fake value', async () => {
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  let shown = '';
  const output = new Writable({ write(chunk, _encoding, done) { shown += chunk.toString(); done(); } });
  const promise = hiddenKey(input, output);
  setImmediate(() => input.write(`${fakeKey}\r`));
  assert.equal(await promise, fakeKey);
  assert.doesNotMatch(shown, /fixture-typesafe-key/);
});

test('keys CLI without a terminal or with --yes leaves the key unchanged and says how to add it', posixOnly, t => {
  const f = fixture(t);
  const env = { HOME: f.home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', TYPESAFE_API_KEY: fakeKey };
  const run = extra => spawnSync(process.execPath, ['bin/agent-kit.mjs', 'keys', '--root', f.root, ...extra], { cwd: kit, env, encoding: 'utf8', input: `add\n${fakeKey}\n` });
  const first = run([]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /TYPESAFE_API_KEY: not set/);
  assert.match(first.stdout, /Left unchanged\. To add, change or remove it, run this command from your own terminal/);
  assert.equal(existsSync(f.envPath), false);
  writeFileSync(f.envPath, 'TYPESAFE_API_KEY=existing-fixture-123\n', { mode: 0o600 });
  const second = run(['--yes']);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /TYPESAFE_API_KEY: set/);
  assert.equal(readFileSync(f.envPath, 'utf8'), 'TYPESAFE_API_KEY=existing-fixture-123\n');
  assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).setup.keys, undefined);
  for (const text of [first.stdout, first.stderr, second.stdout, second.stderr]) assert.equal(text.includes(fakeKey), false);
  for (const flag of ['--typesafe-key-file', '--typesafe-key-env']) assert.match(run([flag, 'x']).stderr, /unknown argument/);
});

function installedKit(f, { withKeys = true } = {}) {
  const commit = 'a'.repeat(40), dir = join(f.tools, 'kit', commit);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'agent-kit.mjs'), 'process.stdout.write(process.argv.slice(2).join(" ") + "\\n");\n');
  if (withKeys) { mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src', 'keys.mjs'), ''); }
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
  receipt.setup.kit = { commit };
  writeFileSync(f.receipt, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
}
const installSh = (f, extra) => spawnSync('bash', ['install.sh', '--reconfigure', 'keys', '--root', f.root, ...extra], {
  cwd: kit, env: { HOME: f.home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });

test('install.sh --reconfigure keys routes to the installed command without GitHub access', posixOnly, t => {
  const f = fixture(t);
  installedKit(f);
  for (const [extra, args] of [[['--yes'], /^keys --install-root .*\.tools --yes$/m], [[], /^keys --install-root .*\.tools$/m]]) {
    const run = installSh(f, extra);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, args);
    assert.doesNotMatch(run.stderr, /unbound variable|Fetching the reviewed kit|sign in to GitHub/);
  }
  assert.equal(existsSync(f.envPath), false);
});

test('install.sh --reconfigure keys asks for an upgrade of the receipt it read when the installed kit predates the keys command', posixOnly, t => {
  const f = fixture(t);
  installedKit(f, { withKeys: false });
  const custom = join(f.base, 'custom tools');
  renameSync(f.tools, custom);
  const run = installSh(f, ['--install-root', custom]);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /predates the keys command; upgrade it first/);
  assert.doesNotMatch(run.stdout, /^keys /m);
  const hint = run.stderr.match(/upgrade it first with: (node .*?) \(or rerun/)[1];
  const upgrade = spawnSync('bash', ['-c', hint], { encoding: 'utf8' });
  assert.equal(upgrade.stdout, `upgrade --install-root ${custom}\n`);
  assert.ok(existsSync(join(custom, 'receipt.json')));
});
