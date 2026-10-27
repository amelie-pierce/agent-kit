import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const kitRoot = fileURLToPath(new URL('..', import.meta.url));
const script = join(kitRoot, 'install.sh');
const manifest = JSON.parse(readFileSync(join(kitRoot, 'manifests/pilot-skeleton.json'), 'utf8'));
const posixOnly = { skip: process.platform === 'win32' };
const release = 'd'.repeat(40), main = 'a'.repeat(40);
const bash = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

// gh, git and node are stubs that log their arguments; a few real system commands are linked in so a missing stub is really missing.
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-install-sh-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const stubs = join(base, 'stubs'), sys = join(base, 'sys'), home = join(base, 'home'), tmp = join(base, 'tmp'), log = join(base, 'calls.log');
  for (const dir of [stubs, sys, home, tmp]) mkdirSync(dir);
  for (const name of ['uname', 'grep', 'head', 'mktemp', 'rm', 'mkdir', 'cat']) symlinkSync(spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim(), join(sys, name));
  const stub = (name, body) => writeFileSync(join(stubs, name), `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> '${log}'\n${body}\n`, { mode: 0o755 });
  stub('gh', `case "$*" in
  --version) echo 'gh version 2.83.2 (2025-12-10)' ;;
  'auth status --hostname github.com') exit "\${GH_AUTH:-0}" ;;
  *'commits?sha=main&path=manifests/pilot-skeleton.json&per_page=1'*) echo ${release} ;;
  *'commits/main'*) echo ${main} ;;
  *compare/*) echo "\${GH_RELATION:-ahead}" ;;
  *) exit 1 ;;
esac`);
  stub('git', `[ "$1" = --version ] && { echo "git version \${GIT_VERSION:-2.48.1}"; exit 0; }
printf '%s\\n' "env GIT_CONFIG_GLOBAL=$GIT_CONFIG_GLOBAL GIT_TERMINAL_PROMPT=$GIT_TERMINAL_PROMPT" >> '${log}'
case "$*" in
  'init -q '*) /bin/mkdir -p "$3" ;;
  *' checkout -q --detach FETCH_HEAD') /bin/mkdir -p "$2/bin" "$2/src"; [ -n "$OLD_KIT" ] || : > "$2/src/setup.mjs"; : > "$2/bin/agent-kit.mjs" ;;
  *'rev-parse HEAD') echo "\${HEAD_COMMIT:-${release}}" ;;
esac
exit 0`);
  stub('node', `[ "$1" = --version ] && { echo "\${NODE_VERSION:-v24.15.0}"; exit 0; }
[ "$1" = -e ] && exec '${process.execPath}' "$@"
for arg in "$@"; do printf 'node-arg:%s\\n' "$arg" >> '${log}'; done
[ -d "$4" ] && printf 'kit-present\\n' >> '${log}'
exit "\${NODE_EXIT:-0}"`);
  stub('xcode-select', 'exit "${XCODE:-0}"');
  stub('brew', 'exit 0');
  const run = (args, env = {}, input = '') => {
    const result = spawnSync(bash, [script, ...args], { encoding: 'utf8', cwd: base, input,
      env: { HOME: home, PATH: `${stubs}:${sys}`, TMPDIR: tmp, ...env } });
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    rmSync(log, { force: true });
    return { ...result, calls, nodeArgs: calls.filter(x => x.startsWith('node-arg:')).map(x => x.slice(9)) };
  };
  return { base, stubs, home, tmp, run };
}

test('install.sh floors match the manifest prerequisites', () => {
  const body = readFileSync(script, 'utf8');
  const floor = id => manifest.tools.find(x => x.id === id).minVersion;
  assert.match(body, new RegExp(`^NODE_MIN=${floor('node').replaceAll('.', '\\.')}$`, 'm'));
  assert.match(body, new RegExp(`^GIT_MIN=${floor('git').replaceAll('.', '\\.')}$`, 'm'));
  assert.match(body, new RegExp(`^GH_MIN=${floor('github-cli').replaceAll('.', '\\.')}$`, 'm'));
  assert.equal(manifest.nodeMinimum, floor('node'));
});

test('install.sh --help prints usage without touching anything', posixOnly, t => {
  const f = fixture(t);
  const result = f.run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: bash install\.sh/);
  assert.deepEqual(result.calls, []);
});

test('install.sh guides missing or old prerequisites and never runs sudo or the kit', posixOnly, t => {
  const f = fixture(t);
  rmSync(join(f.stubs, 'node'));
  const result = f.run(['--yes'], { GIT_VERSION: '2.19.0' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Install these yourself first[\s\S]*Node\.js 24\.15\.0 or newer is not on PATH[\s\S]*nodejs\.org\/en\/download/);
  assert.match(result.stderr, /git 2\.19\.0 is older than 2\.20\.0/);
  assert.ok(!result.calls.some(x => /sudo|fetch|node-arg/.test(x)), result.calls.join('\n'));
  if (process.platform === 'linux') assert.match(result.stderr, /sudo asks for your administrator password, and this installer never runs it/);
  if (process.platform === 'darwin') {
    rmSync(join(f.stubs, 'brew'));
    const mac = f.run(['--yes'], { XCODE: '2' });
    assert.match(mac.stderr, /xcode-select --install/);
    assert.match(mac.stderr, /Homebrew: install it from https:\/\/brew\.sh/);
  }
});

test('install.sh asks for your own gh login and fetches nothing without it', posixOnly, t => {
  const f = fixture(t);
  const result = f.run(['--yes'], { GH_AUTH: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gh auth login/);
  assert.ok(!result.calls.some(x => / api | fetch /.test(x)), result.calls.join('\n'));
});

test('install.sh fetches the newest reviewed release with a one-shot gh credential helper and passes flags through', posixOnly, t => {
  const f = fixture(t);
  const result = f.run(['--yes', '--root', '/x/My Root', '--starter-mate', 'docs', '--starter-scope', 'two words here']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.includes('gh api repos/amelie-pierce/agent-kit/commits?sha=main&path=manifests/pilot-skeleton.json&per_page=1 --jq .[0].sha'));
  assert.ok(result.calls.includes(`gh api repos/amelie-pierce/agent-kit/compare/${release}...main --jq .status`));
  const fetch = result.calls.find(x => x.includes(' fetch '));
  assert.match(fetch, /-c credential\.helper= -c credential\.helper=!gh auth git-credential fetch -q --depth 1 https:\/\/github\.com\/amelie-pierce\/agent-kit\.git d{40}$/);
  assert.ok(result.calls.includes('env GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0'));
  const kit = result.nodeArgs[0].slice(0, -'/bin/agent-kit.mjs'.length);
  assert.deepEqual(result.nodeArgs, [`${kit}/bin/agent-kit.mjs`, 'setup', '--kit-dir', kit, '--kit-commit', release, '--yes', '--root', '/x/My Root', '--starter-mate', 'docs', '--starter-scope', 'two words here']);
  assert.ok(result.calls.includes('kit-present'));
  assert.ok(kit.startsWith(f.tmp));
  assert.equal(existsSync(kit), false, 'the temporary fetch is removed afterwards');
  assert.ok(!result.calls.some(x => /token|sudo/.test(x)));
});

test('install.sh main channel, an exact commit, refusals and the setup exit code', posixOnly, t => {
  const f = fixture(t);
  const mainRun = f.run(['--yes', '--channel', 'main'], { HEAD_COMMIT: main });
  assert.equal(mainRun.status, 0, mainRun.stderr);
  assert.ok(mainRun.calls.includes('gh api repos/amelie-pierce/agent-kit/commits/main --jq .sha'));
  assert.deepEqual(mainRun.nodeArgs.slice(-2), ['--channel', 'main']);
  const diverged = f.run(['--yes', '--commit', 'b'.repeat(40)], { GH_RELATION: 'diverged' });
  assert.equal(diverged.status, 1);
  assert.match(diverged.stderr, /is not on main, so it is not a reviewed kit commit/);
  assert.ok(!diverged.calls.some(x => x.includes(' fetch ')));
  const old = f.run(['--yes'], { OLD_KIT: '1' });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /predates this installer; rerun with --channel main/);
  assert.equal(f.run(['--yes'], { NODE_EXIT: '3' }).status, 3);
  assert.match(f.run(['--commit', 'abc']).stderr, /full 40-character commit SHA/);
  assert.match(f.run(['--channel', 'nightly']).stderr, /releases or main/);
  assert.match(f.run(['--kit-commit', release]).stderr, /use --commit/);
});

test('install.sh reuses the update channel saved in the receipt at the chosen or default root; --channel wins', posixOnly, t => {
  const f = fixture(t);
  const save = (dir, channel) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ setup: { answers: { channel } } })); };
  save(join(f.home, 'Agentic', '.tools'), 'main');
  const fetched = result => result.calls.find(x => x.includes(' fetch ')).split(' ').pop();
  const byDefault = f.run(['--yes'], { HEAD_COMMIT: main });
  assert.equal(byDefault.status, 0, byDefault.stderr);
  assert.match(byDefault.stderr, /Using the main channel saved in .*Agentic\/\.tools\/receipt\.json/);
  assert.equal(fetched(byDefault), main);
  assert.ok(!byDefault.nodeArgs.includes('--channel'), 'setup reuses the saved answer itself');
  const explicit = f.run(['--yes', '--channel', 'releases']);
  assert.equal(fetched(explicit), release);
  assert.doesNotMatch(explicit.stderr, /saved in/);

  const chosen = join(f.base, 'Chosen');
  save(join(chosen, '.tools'), 'releases');
  const atRoot = f.run(['--yes', '--root', chosen]);
  assert.match(atRoot.stderr, /Using the releases channel saved in/);
  assert.equal(fetched(atRoot), release);
  save(join(f.base, 'kit-tools'), 'main');
  assert.equal(fetched(f.run(['--yes', '--root', chosen, '--install-root', join(f.base, 'kit-tools')], { HEAD_COMMIT: main })), main);
  writeFileSync(join(chosen, '.tools', 'receipt.json'), 'not json');
  const unreadable = f.run(['--yes', '--root', chosen]);
  assert.equal(unreadable.status, 0, unreadable.stderr);
  assert.equal(fetched(unreadable), release, 'an unreadable receipt falls back to releases; setup reports the receipt itself');
});

test('install.sh asks the root folder first, reads that root\'s saved channel, and passes the root to setup', posixOnly, t => {
  const f = fixture(t);
  const save = (dir, channel) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ setup: { answers: { channel } } })); };
  const fetched = result => result.calls.find(x => x.includes(' fetch ')).split(' ').pop();
  const rootArgs = result => result.nodeArgs.slice(6, 8);

  const chosen = join(f.base, 'Work', 'Agentic');
  save(join(chosen, '.tools'), 'main');
  const rerun = f.run([], { HEAD_COMMIT: main }, `${chosen}\n`);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stderr, /1\. Root folder for your agent setup .*\[~\/Agentic\]: /);
  assert.doesNotMatch(rerun.stderr, /Use .*\(y\/n\)/, 'a root with a receipt is a resume, so it is not confirmed again');
  assert.match(rerun.stderr, /Using the main channel saved in .*Work\/Agentic\/\.tools\/receipt\.json/);
  assert.equal(fetched(rerun), main);
  assert.deepEqual(rootArgs(rerun), ['--root', chosen]);

  save(join(f.home, 'Agentic', '.tools'), 'main');
  const other = f.run([], {}, '~/Other\ny\n');
  assert.equal(other.status, 0, other.stderr);
  assert.match(other.stderr, new RegExp(`Use ${join(f.home, 'Other')} \\(y/n\\)`));
  assert.doesNotMatch(other.stderr, /saved in/, 'the receipt at ~/Agentic belongs to another root');
  assert.equal(fetched(other), release);
  assert.deepEqual(rootArgs(other), ['--root', join(f.home, 'Other')]);

  const retried = f.run([], { HEAD_COMMIT: main }, 'relative/path\n\n');
  assert.match(retried.stderr, /must be an absolute path or start with ~\/ \(got relative\/path\)/);
  assert.deepEqual(rootArgs(retried), ['--root', join(f.home, 'Agentic')]);
  const cancelled = f.run([], {}, '~/Other\nn\n');
  assert.equal(cancelled.status, 1);
  assert.match(cancelled.stderr, /setup cancelled; nothing was written/);
  assert.ok(!cancelled.calls.some(x => / api | fetch |node-arg/.test(x)), cancelled.calls.join('\n'));
  const ended = f.run([]);
  assert.equal(ended.status, 1);
  assert.match(ended.stderr, /input ended before every question was answered; pass --yes/);
});

test('install.sh --kit-dir uses a local clean checkout; a dry run continues before sign-in', posixOnly, t => {
  const f = fixture(t);
  const local = join(f.base, 'local-kit');
  mkdirSync(join(local, '.git'), { recursive: true }); mkdirSync(join(local, 'bin'));
  writeFileSync(join(local, 'bin', 'agent-kit.mjs'), '');
  const result = f.run(['--kit-dir', local, '--dry-run', '--yes'], { GH_AUTH: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /not signed in to GitHub yet/);
  assert.deepEqual(result.nodeArgs, [join(local, 'bin', 'agent-kit.mjs'), 'setup', '--kit-dir', local, '--kit-commit', release, '--root', join(f.home, 'Agentic'), '--dry-run', '--yes']);
  assert.ok(!result.calls.some(x => x.startsWith('gh api')));
  const unsigned = f.run(['--yes', '--kit-dir', local], { GH_AUTH: '1' });
  assert.equal(unsigned.status, 1, 'a real run still needs your gh login');
  assert.match(unsigned.stderr, /gh auth login/);
  assert.match(f.run(['--yes', '--kit-dir', local, '--commit', 'b'.repeat(40)]).stderr, /differs from the --kit-dir checkout/);
});
