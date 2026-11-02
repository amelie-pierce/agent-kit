import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCheck, detectBrowsers, detectEnvironment, detectTerminal, formatBrowserCheck, parseOsRelease, terminalBrowserOffer } from '../src/browser.mjs';
import { parseArgs } from '../src/kit.mjs';

const release = {
  ubuntu2404: 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nUBUNTU_CODENAME=noble\n',
  ubuntu2204: 'PRETTY_NAME="Ubuntu 22.04.5 LTS"\nVERSION_ID="22.04"\nVERSION_CODENAME=jammy\nID=ubuntu\nID_LIKE=debian\nUBUNTU_CODENAME=jammy\n',
  mint22: 'PRETTY_NAME="Linux Mint 22"\nVERSION_ID="22"\nVERSION_CODENAME=wilma\nID=linuxmint\nID_LIKE="ubuntu debian"\nUBUNTU_CODENAME=noble\n',
  mint21: 'PRETTY_NAME="Linux Mint 21.3"\nVERSION_ID="21.3"\nVERSION_CODENAME=virginia\nID=linuxmint\nID_LIKE="ubuntu debian"\nUBUNTU_CODENAME=jammy\n',
  debian12: 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\nID=debian\n',
  debian13: 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nVERSION_ID="13"\nVERSION_CODENAME=trixie\nID=debian\n',
  debianSid: 'PRETTY_NAME="Debian GNU/Linux forky/sid"\nID=debian\n',
  fedora: 'PRETTY_NAME="Fedora Linux 41"\nID=fedora\nVERSION_ID=41\n',
  rocky: 'PRETTY_NAME="Rocky Linux 9.4"\nID="rocky"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.4"\n',
  arch: 'PRETTY_NAME="Arch Linux"\nID=arch\n',
  manjaro: 'PRETTY_NAME="Manjaro Linux"\nID=manjaro\nID_LIKE=arch\n',
  suse: 'PRETTY_NAME="openSUSE Leap 15.6"\nID="opensuse-leap"\nID_LIKE="suse opensuse"\n',
  nixos: 'PRETTY_NAME="NixOS 24.11"\nID=nixos\n',
};
const wslVersion = 'Linux version 5.15.153.1-microsoft-standard-WSL2 (root@build) (gcc)';
const plainVersion = 'Linux version 6.8.0-45-generic (buildd@lcy02) (gcc)';
const environmentOf = (name, version = plainVersion, env = {}) => detectEnvironment({ platform: 'linux', osRelease: release[name], procVersion: version, env });

// A fake host: `files` are the paths that exist and `commands` map a command name to a result or function.
function host({ files = [], commands = {}, env = {}, platform = 'linux', name = 'ubuntu2404', version = wslVersion } = {}) {
  const calls = [];
  return { calls, platform, env, osRelease: release[name], procVersion: version, exists: path => files.includes(path), realpath: path => path,
    run: (command, args, options) => {
      calls.push([command, ...args]);
      const handler = commands[command];
      const result = typeof handler === 'function' ? handler(args, options) : handler;
      return { status: 1, stdout: '', stderr: '', ...result };
    } };
}
const lddAll = '\tlinux-vdso.so.1 (0x00007ffd)\n\tlibnss3.so => /lib/x86_64-linux-gnu/libnss3.so (0x00007f01)\n\tlibasound.so.2 => /lib/x86_64-linux-gnu/libasound.so.2 (0x00007f02)\n';
const lddMissing = '\tlibnss3.so => not found\n\tlibnssutil3.so => not found\n\tlibasound.so.2 => not found\n\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f03)\n';

test('parseOsRelease strips quotes and ignores other lines', () => {
  assert.deepEqual(parseOsRelease('ID=ubuntu\nID_LIKE="ubuntu debian"\n# comment\nNAME=\'Mint\'\n'), { ID: 'ubuntu', ID_LIKE: 'ubuntu debian', NAME: 'Mint' });
});

test('detectEnvironment identifies macOS, Windows, Linux, WSL2 and WSL1', () => {
  assert.equal(detectEnvironment({ platform: 'darwin' }).os, 'macos');
  assert.equal(detectEnvironment({ platform: 'win32' }).os, 'windows');
  assert.equal(detectEnvironment({ platform: 'freebsd' }).unsupported, true);
  const linux = environmentOf('ubuntu2404');
  assert.deepEqual([linux.os, linux.wsl, linux.wsl2, linux.distro.id, linux.distro.versionId], ['linux', false, false, 'ubuntu', '24.04']);
  assert.equal(linux.label, 'Linux, Ubuntu 24.04.1 LTS');
  const wsl2 = environmentOf('ubuntu2404', wslVersion, { WSL_INTEROP: '/run/WSL/1_interop' });
  assert.deepEqual([wsl2.os, wsl2.wsl, wsl2.wsl2], ['wsl', true, true]);
  assert.equal(wsl2.label, 'WSL2, Ubuntu 24.04.1 LTS');
  const wsl1 = environmentOf('ubuntu2204', 'Linux version 4.4.0-19041-Microsoft (Microsoft@Microsoft.com)');
  assert.deepEqual([wsl1.os, wsl1.wsl, wsl1.wsl2], ['wsl', true, false]);
});

test('detectBrowsers prefers an existing browser, this computer before the Windows side, then Chrome, Edge, Brave', () => {
  const none = host({ env: { PATH: '/usr/bin:/bin' } });
  assert.deepEqual(detectBrowsers(none, environmentOf('ubuntu2404', plainVersion)), []);

  const linux = host({ env: { PATH: '/usr/local/bin:/usr/bin' }, files: ['/usr/bin/brave-browser', '/usr/bin/microsoft-edge-stable', '/usr/bin/google-chrome'] });
  assert.deepEqual(detectBrowsers(linux, environmentOf('ubuntu2404', plainVersion)).map(x => [x.id, x.side, x.path]),
    [['chrome', 'native', '/usr/bin/google-chrome'], ['edge', 'native', '/usr/bin/microsoft-edge-stable'], ['brave', 'native', '/usr/bin/brave-browser']]);

  const chromeOnWindows = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
  const edgeForUser = '/mnt/c/Users/me/AppData/Local/Microsoft/Edge/Application/msedge.exe';
  const wsl = host({ env: { PATH: '/usr/bin' }, files: [chromeOnWindows, edgeForUser, '/usr/bin/microsoft-edge'],
    commands: { 'cmd.exe': { status: 0, stdout: 'C:\\Users\\me\\AppData\\Local\r\n' }, wslpath: { status: 0, stdout: '/mnt/c/Users/me/AppData/Local\n' } } });
  const found = detectBrowsers(wsl, environmentOf('ubuntu2404', wslVersion));
  assert.deepEqual(found.map(x => [x.id, x.side]), [['edge', 'native'], ['chrome', 'windows'], ['edge', 'windows']]);
  assert.equal(found[2].path, edgeForUser);
  assert.ok(wsl.calls.some(call => call[0] === 'cmd.exe'));
});

test('detectBrowsers finds macOS app bundles and Windows install folders', () => {
  const mac = { platform: 'darwin', env: { HOME: '/Users/me' }, exists: path => ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].includes(path) };
  assert.deepEqual(detectBrowsers(mac, detectEnvironment(mac)).map(x => [x.id, x.path]),
    [['chrome', '/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'], ['brave', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']]);
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', brave = 'C:\\Users\\me\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  const windows = { platform: 'win32', env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LocalAppData: 'C:\\Users\\me\\AppData\\Local' }, exists: path => [edge, brave].includes(path) };
  assert.deepEqual(detectBrowsers(windows, detectEnvironment(windows)).map(x => [x.id, x.path]), [['edge', edge], ['brave', brave]]);
});

test('detectTerminal says whether the terminal draws kitty graphics, and browser-check mentions terminal-browser only when it does', () => {
  const kitty = env => detectTerminal(env).kitty;
  assert.deepEqual([detectTerminal({ TERM: 'xterm-kitty' }).name, kitty({ KITTY_WINDOW_ID: '4' })], ['kitty', 'yes']);
  assert.deepEqual([detectTerminal({ TERM: 'xterm-ghostty' }).name, detectTerminal({ GHOSTTY_RESOURCES_DIR: '/x' }).name, detectTerminal({ TERM_PROGRAM: 'ghostty' }).name], ['Ghostty', 'Ghostty', 'Ghostty']);
  assert.deepEqual([detectTerminal({ TERM_PROGRAM: 'WezTerm' }).name, detectTerminal({ WEZTERM_PANE: '3' }).name, kitty({ WEZTERM_EXECUTABLE: '/x' })], ['WezTerm', 'WezTerm', 'yes']);
  assert.deepEqual([detectTerminal({ TERM_PROGRAM: 'vscode' }).name, kitty({ TERM_PROGRAM: 'vscode' }), kitty({ VSCODE_INJECTION: '1' })], ['VS Code terminal', 'no', 'no']);
  assert.deepEqual([detectTerminal({ WT_SESSION: 'x' }).name, kitty({ WT_SESSION: 'x' })], ['Windows Terminal', 'no']);
  for (const env of [{ TERM: 'xterm-kitty', TMUX: '/tmp/tmux' }, { KITTY_WINDOW_ID: '1', STY: '1.pts' }]) assert.equal(kitty(env), 'unknown', JSON.stringify(env));
  assert.deepEqual([kitty({}), kitty({ TERM: 'xterm-256color' }), kitty({ TERM_PROGRAM: 'Apple_Terminal' }), detectTerminal({ TERM_PROGRAM: 'Apple_Terminal' }).name], ['unknown', 'unknown', 'unknown', 'Apple_Terminal']);

  for (const env of [{}, { TERM: 'xterm-256color' }, { WT_SESSION: 'x' }, { TERM_PROGRAM: 'vscode' }, { TERM: 'xterm-kitty', TMUX: '/tmp/tmux' }])
    assert.equal(terminalBrowserOffer({ env, exists: () => false }).offered, false, JSON.stringify(env));
  const offer = terminalBrowserOffer({ env: { TERM: 'xterm-kitty', PATH: '/usr/bin' }, exists: path => path === '/usr/bin/terminal-browser' });
  assert.deepEqual([offer.offered, offer.terminal, offer.installed], [true, 'kitty', '/usr/bin/terminal-browser']);
  assert.match(offer.note, /run agent-kit terminal-browser/);
});

// Fakes for everything that touches a real browser, process or network.
function fakeBrowser({ files = [], env = { PATH: '/usr/bin', DISPLAY: ':0' }, commands = {}, name = 'ubuntu2404', version = plainVersion, handle, probe, platform = 'linux', windowsProfile = false } = {}) {
  const log = { launched: [], closed: [], removed: [], profiles: 0 };
  const context = host({ files, env, commands, name, version, platform });
  context.freePort = async () => 40123;
  context.sleep = async () => {};
  context.timeoutMs = 50;
  context.holdMs = 0;
  context.probe = probe || (async url => { log.probed = url; return { Browser: 'Chrome/150.0.1', webSocketDebuggerUrl: 'ws://127.0.0.1:40123/devtools/browser/x' }; });
  context.profile = async () => { log.profiles++; return { name: 'agent-kit-browser-ab12', path: windowsProfile ? 'C:\\Temp\\agent-kit-browser-ab12' : '/tmp/agent-kit-browser-ab12', remove: () => log.removed.push('profile') }; };
  context.launch = (command, args, options) => { log.launched.push({ command, args, options }); return handle || { exited: new Promise(() => {}), stderr: () => '', error: () => null, running: () => true, kill() { this.running = () => false; } }; };
  context.closeBrowser = async (webSocketUrl, h) => { log.closed.push(webSocketUrl); h.kill(); };
  return { context, log };
}
const stepsOf = result => Object.fromEntries(result.steps.map(step => [step.id, step.status]));
const axiOk = { status: 0, stdout: 'page: {title: "agent-kit browser-check", refs: 0}\n' };

test('browserCheck opens the browser visibly, drives it with chrome-devtools-axi and cleans up', async () => {
  const { context, log } = fakeBrowser({ files: ['/usr/bin/google-chrome', '/usr/bin/chrome-devtools-axi'], commands: { ldd: { status: 0, stdout: lddAll }, '/usr/bin/chrome-devtools-axi': axiOk } });
  context.env.CHROME_DEVTOOLS_AXI_AUTO_CONNECT = '1';
  const result = await browserCheck(context);
  assert.deepEqual([result.status, result.exitCode], ['pass', 0]);
  assert.deepEqual(stepsOf(result), { platform: 'pass', browser: 'pass', libraries: 'pass', display: 'pass', devtools: 'pass', axi: 'pass' });
  const [launch] = log.launched;
  assert.equal(launch.command, '/usr/bin/google-chrome');
  assert.ok(launch.args.includes('--remote-debugging-port=40123'));
  assert.ok(launch.args.includes('--user-data-dir=/tmp/agent-kit-browser-ab12'));
  assert.ok(!launch.args.some(arg => /headless/.test(arg)), 'the window must be visible');
  const axi = context.calls.filter(call => call[0] === '/usr/bin/chrome-devtools-axi');
  assert.deepEqual(axi.map(call => call[1]), ['open', 'stop']);
  assert.deepEqual(log.closed, ['ws://127.0.0.1:40123/devtools/browser/x']);
  assert.deepEqual(log.removed, ['profile']);
  assert.equal(log.probed, 'http://127.0.0.1:40123/json/version');
  assert.equal(context.calls.some(call => call.includes('sudo')), false);
});

test('browserCheck points chrome-devtools-axi at the endpoint in its own session and clears modes that would override it', async () => {
  const seen = [];
  const { context } = fakeBrowser({ files: ['/usr/bin/google-chrome', '/usr/bin/chrome-devtools-axi'],
    commands: { ldd: { status: 0, stdout: lddAll }, '/usr/bin/chrome-devtools-axi': (args, options) => { seen.push(options.env); return { status: 0, stdout: 'title: "agent-kit browser-check"' }; } } });
  context.env.CHROME_DEVTOOLS_AXI_AUTO_CONNECT = '1';
  context.env.CHROME_DEVTOOLS_AXI_MCP_SERVER_URL = 'http://example.test/mcp';
  await browserCheck(context);
  const [open] = seen;
  assert.equal(open.CHROME_DEVTOOLS_AXI_BROWSER_URL, 'http://127.0.0.1:40123');
  assert.equal(open.CHROME_DEVTOOLS_AXI_SESSION, 'agent-kit-browser-check');
  assert.equal(open.CHROME_DEVTOOLS_AXI_AUTO_CONNECT, '');
  assert.equal(open.CHROME_DEVTOOLS_AXI_MCP_SERVER_URL, '');
});

test('browserCheck reports no browser with install guidance and launches nothing', async () => {
  for (const [platform, name, pattern, version] of [['linux', 'ubuntu2404', /vendor download page/, plainVersion], ['linux', 'ubuntu2404', /on Windows .* or install a Linux browser/, wslVersion]]) {
    const { context, log } = fakeBrowser({ platform, name, version });
    const result = await browserCheck(context);
    assert.equal(result.status, 'fail');
    assert.equal(stepsOf(result).browser, 'fail');
    assert.match(result.steps.find(step => step.id === 'browser').fix, pattern);
    assert.deepEqual(log.launched, []);
  }
  const mac = await browserCheck({ platform: 'darwin', env: { HOME: '/Users/me' }, exists: () => false });
  assert.match(mac.steps.at(-1).fix, /brew install --cask google-chrome/);
  const windows = await browserCheck({ platform: 'win32', env: {}, exists: () => false });
  assert.match(windows.steps.at(-1).fix, /winget install --exact --id Google\.Chrome/);
  assert.equal((await browserCheck({ platform: 'freebsd', env: {} })).exitCode, 1);
});

test('browserCheck fails the display step before launching when a Linux browser has nowhere to open', async () => {
  const wsl = fakeBrowser({ files: ['/usr/bin/google-chrome'], env: { PATH: '/usr/bin' }, version: wslVersion, commands: { ldd: { status: 0, stdout: lddAll } } });
  const result = await browserCheck(wsl.context);
  assert.deepEqual([stepsOf(result).display, wsl.log.launched.length], ['fail', 0]);
  assert.match(result.steps.find(step => step.id === 'display').fix, /wsl --update/);
  const ssh = fakeBrowser({ files: ['/usr/bin/google-chrome'], env: { PATH: '/usr/bin' }, commands: { ldd: { status: 0, stdout: lddAll } } });
  assert.match((await browserCheck(ssh.context)).steps.find(step => step.id === 'display').fix, /ssh -X/);
});

test('browserCheck names the missing library and prints the install command when the browser cannot start', async () => {
  const stderr = '/usr/bin/google-chrome: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory\n';
  const handle = { exited: Promise.resolve({ code: 127 }), stderr: () => stderr, error: () => null, running: () => false, kill() {} };
  const { context, log } = fakeBrowser({ files: ['/usr/bin/google-chrome'], handle, probe: async () => null, commands: { ldd: { status: 0, stdout: lddMissing } } });
  const result = await browserCheck(context);
  const steps = stepsOf(result);
  assert.deepEqual([result.status, steps.libraries, steps.launch], ['fail', 'warn', 'fail']);
  const launch = result.steps.find(step => step.id === 'launch');
  assert.match(launch.detail, /exited before its DevTools endpoint was ready: it needs libnss3\.so/);
  assert.match(launch.detail, /error while loading shared libraries/);
  assert.equal(launch.fix, 'sudo apt-get update && sudo apt-get install -y libnss3');
  assert.deepEqual(log.removed, ['profile']);
  assert.equal(context.calls.some(call => call.includes('sudo')), false);
});

test('browserCheck explains the WSL2 NAT case for a Windows-side browser and sweeps the browser it started', async () => {
  const chrome = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
  const { context, log } = fakeBrowser({ files: [chrome], version: wslVersion, windowsProfile: true, probe: async () => null,
    commands: { 'cmd.exe': { status: 0, stdout: 'C:\\Users\\me\\AppData\\Local\r\n' }, wslpath: { status: 0, stdout: '/mnt/c/Users/me/AppData/Local\n' }, wslinfo: { status: 0, stdout: 'nat\n' },
      'powershell.exe': { status: 0 } } });
  context.profile = async browser => { log.profiles++; assert.equal(browser.side, 'windows'); return { name: 'agent-kit-browser-ab12', path: 'C:\\Temp\\agent-kit-browser-ab12', remove: () => log.removed.push('profile') }; };
  const result = await browserCheck(context);
  const step = result.steps.find(x => x.id === 'devtools');
  assert.equal(step.status, 'fail');
  assert.match(step.detail, /does not answer from WSL \(WSL networking mode: nat\)/);
  assert.match(step.fix, /NAT mode WSL cannot reach the Windows localhost, and the kit does not change WSL networking/);
  assert.deepEqual(log.launched[0].options, { cwd: '/mnt/c' });
  assert.ok(context.calls.some(call => call[0] === 'powershell.exe' && call.join(' ').includes('agent-kit-browser-ab12')));
  assert.deepEqual(log.removed, ['profile']);
  assert.equal(stepsOf(result).libraries, undefined, 'the library step does not apply to a Windows-side browser');
  assert.equal(stepsOf(result).display, undefined);
});

test('browserCheck reports an unreachable endpoint, a missing chrome-devtools-axi and an axi failure separately', async () => {
  const running = { exited: new Promise(() => {}), stderr: () => 'Gtk-WARNING: cannot open display\n', error: () => null, running: () => true, kill() {} };
  const hung = fakeBrowser({ files: ['/usr/bin/google-chrome'], handle: running, probe: async () => null, commands: { ldd: { status: 0, stdout: lddAll } } });
  const slow = await browserCheck(hung.context);
  assert.match(slow.steps.find(step => step.id === 'devtools').detail, /did not answer within \d+ seconds\nGtk-WARNING/);

  const noAxi = fakeBrowser({ files: ['/usr/bin/google-chrome'], commands: { ldd: { status: 0, stdout: lddAll } } });
  const missing = await browserCheck(noAxi.context);
  assert.deepEqual([stepsOf(missing).devtools, stepsOf(missing).axi], ['pass', 'fail']);
  assert.match(missing.steps.find(step => step.id === 'axi').detail, /not on PATH/);
  assert.deepEqual(noAxi.log.closed.length, 1);

  const failing = fakeBrowser({ files: ['/usr/bin/google-chrome', '/usr/bin/chrome-devtools-axi'],
    commands: { ldd: { status: 0, stdout: lddAll }, '/usr/bin/chrome-devtools-axi': { status: 1, stderr: 'npm ERR! network request failed\n' } } });
  const broken = await browserCheck(failing.context);
  assert.match(broken.steps.find(step => step.id === 'axi').detail, /could not open a page in Google Chrome \(exit 1\)\nnpm ERR! network request failed/);
  assert.deepEqual(failing.log.removed, ['profile']);
});

test('browserCheck on Windows checks the browser and leaves chrome-devtools-axi to WSL2', async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const { context, log } = fakeBrowser({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, files: [chrome] });
  const result = await browserCheck(context);
  assert.deepEqual([result.status, stepsOf(result).devtools, stepsOf(result).axi], ['pass', 'pass', 'skip']);
  assert.equal(log.launched[0].command, chrome);
  assert.equal(result.libraries, null);
  assert.deepEqual(result.settings, []);
});

test('formatBrowserCheck shows the command to run, never claims to run it, and offers the terminal browser only when detected', async () => {
  const base = { files: ['/usr/bin/google-chrome'], commands: { ldd: { status: 0, stdout: lddMissing } }, probe: async () => null,
    handle: { exited: Promise.resolve({ code: 127 }), stderr: () => 'error while loading shared libraries: libnss3.so: x', error: () => null, running: () => false, kill() {} } };
  const plain = formatBrowserCheck(await browserCheck(fakeBrowser(base).context));
  assert.match(plain, /^Agent Kit browser-check: fail/);
  assert.match(plain, /Shared libraries of the browser \(ldd\): missing \(not found: libasound\.so\.2, libnss3\.so, libnssutil3\.so\)/);
  assert.match(plain, /Run this yourself \(the kit never runs sudo\): sudo apt-get update && sudo apt-get install -y libasound2t64 libnss3\n/);
  assert.doesNotMatch(plain, /libnspr4/, 'only the libraries ldd reports are listed');
  assert.doesNotMatch(plain, /Optional:/);
  const kitty = fakeBrowser({ ...base, env: { PATH: '/usr/bin', DISPLAY: ':0', TERM: 'xterm-kitty' } });
  const offered = formatBrowserCheck(await browserCheck(kitty.context));
  assert.match(offered, /Optional: kitty draws kitty graphics, so terminal-browser can run in it/);
  assert.equal(JSON.parse(JSON.stringify(await browserCheck(kitty.context))).terminalBrowser.offered, true);
});

test('browser-check is its own command and accepts only --json', () => {
  assert.equal(parseArgs(['browser-check']).command, 'browser-check');
  assert.equal(parseArgs(['browser-check', '--json']).json, true);
  assert.equal(parseArgs(['browser-check'], 'win32').command, 'browser-check');
  for (const flag of [['--yes'], ['--dry-run'], ['--root', '/tmp/x'], ['--handoff'], ['--print']]) assert.throws(() => parseArgs(['browser-check', ...flag], flag[0] === '--handoff' ? 'win32' : 'linux'), /--yes applies|--dry-run applies|--root applies|--handoff applies|--print applies/);
});
