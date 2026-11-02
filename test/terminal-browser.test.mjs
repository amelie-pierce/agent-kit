import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatTerminalBrowser, installTerminalBrowser, terminalBrowserPaths, terminalBrowserPlan } from '../src/terminal-browser.mjs';
import { parseArgs } from '../src/kit.mjs';

const ubuntu = 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nUBUNTU_CODENAME=noble\n';
const wslVersion = 'Linux version 5.15.153.1-microsoft-standard-WSL2 (root@build) (gcc)';
const plainVersion = 'Linux version 6.8.0-45-generic (buildd@lcy02) (gcc)';
const engine = '/home/u/.local/share/terminal-browser/app/electron/pixel';
const launcher = '/home/u/.local/bin/terminal-browser';

// A fake machine: `files` exist, `ldd` is what ldd prints for the engine, and nothing touches the real system.
function machine({ platform = 'linux', version = plainVersion, files = [], env = {}, ldd = '\tlibc.so.6 => /lib/libc.so.6 (0x1)\n' } = {}) {
  const calls = [];
  return { calls, platform, osRelease: ubuntu, procVersion: version, env: { HOME: '/home/u', PATH: '/usr/bin', ...env }, exists: path => files.includes(path), realpath: path => path,
    run: (command, args) => { calls.push([command, ...args]); return command === 'ldd' ? { status: 0, stdout: ldd, stderr: '' } : { status: 1, stdout: '', stderr: '' }; } };
}
const ids = plan => plan.steps.map(step => step.id);

test('terminalBrowserPaths follows the XDG folders terminal-browser\'s own installer uses', () => {
  assert.deepEqual(terminalBrowserPaths({ HOME: '/home/u' }), { launcher, engine });
  assert.deepEqual(terminalBrowserPaths({ HOME: '/home/u', XDG_DATA_HOME: '/d', XDG_BIN_HOME: '/b' }), { launcher: '/b/terminal-browser', engine: '/d/terminal-browser/app/electron/pixel' });
});

test('on WSL2 in the VS Code terminal the plan routes to kitty on X11, then install, open, herdr and verify, and runs nothing', () => {
  const context = machine({ version: wslVersion, env: { TERM_PROGRAM: 'vscode', WSL_INTEROP: '/run/WSL/1_interop', PATH: '/usr/bin:/opt/herdr' }, files: ['/opt/herdr/herdr'] });
  const plan = terminalBrowserPlan(context);
  assert.deepEqual(ids(plan), ['terminal', 'install', 'open', 'herdr', 'verify']);
  assert.deepEqual([plan.terminal.name, plan.terminal.kitty, plan.environment.wsl], ['VS Code terminal', 'no', true]);
  const [terminal, install, open, herdr, verify] = plan.steps;
  assert.deepEqual(terminal.commands, ['sudo apt-get update && sudo apt-get install -y kitty', 'kitty -o linux_display_server=x11']);
  assert.match(terminal.note, /Wayland: Failed to connect to display/);
  assert.deepEqual(install.commands, ['curl -fsSL https://terminal-browser.sh/install | bash']);
  assert.match(install.title, /runs it only if you pass --install/);
  assert.match(open.note, /terminal-browser action -- snapshot/);
  assert.deepEqual(herdr.commands, ['herdr plugin install zenbu-labs/terminal-browser/herdr-plugin']);
  assert.match(herdr.note, /unverified/);
  assert.deepEqual(verify.commands, ['agent-kit browser-check']);
  for (const step of plan.steps) assert.ok(step.check, `${step.id} has a one-line check`);
  assert.deepEqual(context.calls, [], 'planning runs no command at all');
});

test('a kitty-graphics terminal with terminal-browser installed and nothing missing shows only open and verify', () => {
  const plan = terminalBrowserPlan(machine({ env: { TERM: 'xterm-kitty' }, files: [launcher, engine] }));
  assert.deepEqual(ids(plan), ['open', 'verify']);
  assert.equal(plan.installed, launcher);
  assert.equal(plan.steps[0].note, undefined, 'no snapshot fallback is needed in a graphics terminal');
  assert.equal(plan.libraries.status, 'present');
  assert.match(formatTerminalBrowser(plan), /^Agent Kit terminal-browser: Linux, Ubuntu 24\.04\.1 LTS\nTerminal: kitty, draws kitty graphics\nterminal-browser: installed at \/home\/u\/\.local\/bin\/terminal-browser\n\n1\. Open a page\./);
});

test('an installed engine with missing libraries gets only the not-found ones, mapped to this distro, and no sudo is run', () => {
  const context = machine({ env: { TERM: 'xterm-kitty' }, files: [launcher, engine], ldd: '\tlibnspr4.so => not found\n\tlibnss3.so => not found\n\tlibnssutil3.so => not found\n\tlibsmime3.so => not found\n\tlibasound.so.2 => not found\n\tlibc.so.6 => /lib/libc.so.6 (0x1)\n' });
  const plan = terminalBrowserPlan(context);
  assert.deepEqual(ids(plan), ['libraries', 'open', 'verify']);
  assert.deepEqual(plan.steps[0].commands, ['sudo apt-get update && sudo apt-get install -y libasound2t64 libnspr4 libnss3']);
  assert.equal(plan.steps[0].check, `ldd ${engine} | grep 'not found' prints nothing.`);
  assert.deepEqual(context.calls, [['ldd', engine]]);
});

test('a terminal the kit does not recognise is asked to be confirmed rather than called unsupported', () => {
  const plan = terminalBrowserPlan(machine({ env: { TERM_PROGRAM: 'Apple_Terminal' }, files: [launcher] }));
  assert.equal(plan.terminal.kitty, 'unknown');
  assert.match(plan.steps[0].title, /Make sure your terminal draws kitty graphics/);
  assert.match(formatTerminalBrowser(plan), /Terminal: Apple_Terminal, kitty graphics unknown/);
});

test('macOS prefers brew when it is on PATH, and other machines get the curl command', () => {
  const brew = terminalBrowserPlan(machine({ platform: 'darwin', env: { TERM_PROGRAM: 'ghostty', PATH: '/opt/homebrew/bin' }, files: ['/opt/homebrew/bin/brew'] }));
  assert.deepEqual(brew.steps.find(step => step.id === 'install').commands, ['brew install terminal-browser']);
  assert.equal(brew.steps.find(step => step.id === 'install').note, undefined);
  const noBrew = terminalBrowserPlan(machine({ platform: 'darwin', env: { TERM_PROGRAM: 'ghostty' } }));
  assert.deepEqual(noBrew.steps.find(step => step.id === 'install').commands, ['curl -fsSL https://terminal-browser.sh/install | bash']);
  assert.deepEqual(terminalBrowserPlan(machine({ platform: 'darwin' })).steps[0].commands, ['brew install --cask kitty']);
});

test('native Windows is pointed at WSL2 and an unsupported platform fails', () => {
  const windows = terminalBrowserPlan(machine({ platform: 'win32', env: { WT_SESSION: 'x' } }));
  assert.deepEqual([ids(windows), windows.exitCode], [['wsl'], 0]);
  assert.deepEqual(windows.steps[0].commands, ['agent-kit terminal-browser']);
  const other = terminalBrowserPlan(machine({ platform: 'freebsd' }));
  assert.deepEqual([other.status, other.exitCode], ['unsupported', 1]);
});

test('--install runs the vendor command only after a typed yes, and never without a terminal', async () => {
  const plan = terminalBrowserPlan(machine({ env: { TERM: 'xterm-kitty' } }));
  const ran = [], asked = [];
  const context = answer => ({ interactive: true, ask: async question => { asked.push(question); return answer; }, runInstall: command => { ran.push(command); return { status: 0 }; } });
  for (const answer of ['', 'n', 'no', 'maybe']) assert.equal((await installTerminalBrowser(context(answer), plan)).ran, false, `"${answer}" does not confirm`);
  assert.deepEqual(ran, []);
  assert.match(asked[0], /downloads and runs a third-party script\. \[y\/N\]/);
  assert.deepEqual(await installTerminalBrowser({ ...context('y'), interactive: false }, plan), { ran: false, reason: '--install asks for a yes, so it needs a terminal; run the command above yourself' });
  assert.deepEqual(await installTerminalBrowser(context(' Yes '), plan), { ran: true, status: 0 });
  assert.deepEqual(ran, ['curl -fsSL https://terminal-browser.sh/install | bash']);
  const installed = terminalBrowserPlan(machine({ env: { TERM: 'xterm-kitty' }, files: [launcher] }));
  assert.equal((await installTerminalBrowser(context('y'), installed)).ran, false);
  assert.equal(ran.length, 1);
});

test('terminal-browser is its own command; --install applies only to it and not with --json', () => {
  assert.equal(parseArgs(['terminal-browser']).command, 'terminal-browser');
  assert.equal(parseArgs(['terminal-browser', '--install']).runInstall, true);
  assert.equal(parseArgs(['terminal-browser', '--json']).json, true);
  assert.equal(parseArgs(['terminal-browser'], 'win32').command, 'terminal-browser');
  assert.throws(() => parseArgs(['terminal-browser', '--install', '--json']), /cannot be combined with --json/);
  assert.throws(() => parseArgs(['browser-check', '--install']), /unknown argument: --install/);
  for (const flag of [['--yes'], ['--dry-run'], ['--root', '/tmp/x'], ['--print']]) assert.throws(() => parseArgs(['terminal-browser', ...flag]), /applies/);
});

test('the real command prints the numbered steps and exits 0', () => {
  const cli = fileURLToPath(new URL('../bin/agent-kit.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'terminal-browser', '--json'], { encoding: 'utf8', env: { ...process.env, TERM_PROGRAM: 'ghostty' } });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.command, 'terminal-browser');
  assert.ok(plan.steps.length >= 1);
  const text = spawnSync(process.execPath, [cli, 'terminal-browser'], { encoding: 'utf8', env: { ...process.env, TERM_PROGRAM: 'ghostty' } });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^Agent Kit terminal-browser: .+\nTerminal: /);
  assert.match(text.stdout, /\n1\. /);
});
