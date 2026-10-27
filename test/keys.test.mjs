import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { hiddenKey, keyStatus, readKeyFile, validateTypesafeKey, writeKey } from '../src/keys.mjs';

const kit = fileURLToPath(new URL('..', import.meta.url));
const fakeKey = 'fixture-typesafe-key-123';
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

test('key write preserves unrelated lines, uses a private atomic replacement and removes only its key', async t => {
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

test('key input validation and private file checks reject unsafe values', t => {
  const f = fixture(t), path = join(f.base, 'key.txt');
  for (const value of ['', 'short', 'bad value', 'bad\nvalue', 'bad$(command)']) assert.throws(() => validateTypesafeKey(value));
  writeFileSync(path, `${fakeKey}\n`, { mode: 0o600 });
  assert.equal(readKeyFile(path), fakeKey);
  chmodSync(path, 0o644);
  assert.throws(() => readKeyFile(path), /private file/);
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

test('keys CLI reads only a named private file, records a flag and never exposes the fake key', t => {
  const f = fixture(t), path = join(f.base, 'key.txt');
  writeFileSync(path, `${fakeKey}\n`, { mode: 0o600 });
  const argv = ['bin/agent-kit.mjs', 'keys', '--root', f.root, '--typesafe-key-file', path, '--yes'];
  const env = { HOME: f.home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const run = () => spawnSync(process.execPath, argv, { cwd: kit, env, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(statSync(f.envPath).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(f.receipt, 'utf8')).setup.keys, { TYPESAFE_API_KEY: true });
  for (const text of [first.stdout, first.stderr, readFileSync(f.receipt, 'utf8'), argv.join(' '), ...readdirSync(f.tools).filter(name => name.endsWith('.log')).map(name => readFileSync(join(f.tools, name), 'utf8'))])
    assert.equal(text.includes(fakeKey), false);
  const old = readFileSync(f.envPath, 'utf8');
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(f.envPath, 'utf8'), old, 'unattended rerun keeps existing value');
  assert.match(second.stdout, /TYPESAFE_API_KEY: set/);
});

test('install.sh --reconfigure keys routes to the installed command without GitHub access', t => {
  const f = fixture(t), commit = 'a'.repeat(40);
  const bin = join(f.tools, 'kit', commit, 'bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'agent-kit.mjs'), 'process.stdout.write(process.argv.slice(2).join(" ") + "\\n");\n');
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
  receipt.setup.kit = { commit };
  writeFileSync(f.receipt, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const run = spawnSync('bash', ['install.sh', '--reconfigure', 'keys', '--root', f.root, '--yes'], {
    cwd: kit, env: { HOME: f.home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /keys --install-root .*\.tools --yes/);
  assert.doesNotMatch(run.stderr, /Fetching the reviewed kit|sign in to GitHub/);
  assert.equal(existsSync(f.envPath), false);
});
