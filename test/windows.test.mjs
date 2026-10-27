import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, run } from '../src/kit.mjs';
import { decodeOutput, inspectWindows, parseWslDistros, parseWslStatus } from '../src/platforms/windows.mjs';
import { formatWindows, handoffArgv, handoffScript, kitUpstream, linuxPath, powershellCommand, windowsHandoff } from '../src/install/windows.mjs';
import { setupHandoffScript, windowsSetup } from '../src/setup.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifests/pilot-skeleton.json'), 'utf8'));
const commit = 'c'.repeat(40);

// wsl.exe output as Windows writes it: UTF-16LE with CRLF line endings, optionally with a BOM.
const utf16 = (text, bom = true) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text.replace(/\n/g, '\r\n'), 'utf16le')]);
const noDistros = 'Windows Subsystem for Linux has no installed distributions.\nUse \'wsl.exe --list --online\' to list available distributions\nand \'wsl.exe --install <Distro>\' to install.\n';

// Localized `wsl --list` output. Header and state words differ per display language and can contain
// spaces; the German and Vietnamese strings are representative, not copied from a real device.
const locales = {
  en: { header: '  NAME            STATE           VERSION', Running: 'Running', Stopped: 'Stopped', none: noDistros, noneRunning: 'There are no running distributions.\n' },
  de: { header: '  NAME                   STATUS            VERSION', Running: 'Wird ausgeführt', Stopped: 'Beendet',
    none: 'Das Windows-Subsystem für Linux verfügt über keine installierten Distributionen.\n', noneRunning: 'Es werden keine Distributionen ausgeführt.\n' },
  vi: { header: '  TÊN                    TRẠNG THÁI        PHIÊN BẢN', Running: 'Đang chạy', Stopped: 'Đã dừng',
    none: 'Hệ thống con Windows dành cho Linux không có bản phân phối nào được cài đặt.\n', noneRunning: 'Không có bản phân phối nào đang chạy.\n' },
};
const ubuntu = { name: 'Ubuntu', state: 'Running', version: 2, default: true };
function wslLists(distros, locale = 'en') {
  const l = locales[locale], running = distros.filter(d => d.state === 'Running');
  const names = list => `${list.map(d => d.name).join('\n')}\n`;
  return {
    '--quiet': distros.length ? [0, names(distros)] : [-1, l.none],
    '--running --quiet': running.length ? [0, names(running)] : [-1, l.noneRunning],
    '--verbose': distros.length ? [0, `${l.header}\n${distros.map(d => `${d.default ? '*' : ' '} ${d.name.padEnd(22)} ${l[d.state].padEnd(17)} ${d.version}`).join('\n')}\n`] : [-1, l.none],
  };
}

function windowsContext({ services = ['WslService'], status = 'Default Distribution: Ubuntu\nDefault Version: 2\n', distros = [ubuntu], locale = 'en', lists,
  wslExists = true, virtualization = null, machine = 'x86_64', arch = 'x64', osRelease = '10.0.22631', files = [], env = {} } = {}) {
  const calls = [], listed = lists || wslLists(distros, locale);
  const context = {
    platform: 'win32', arch, machine, osRelease, nodeVersion: '24.15.0', calls,
    env: { USERPROFILE: 'C:\\Users\\teammate', SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\teammate\\AppData\\Local', ProgramFiles: 'C:\\Program Files', Path: '', ...env },
    fileExists: path => (wslExists && path === 'C:\\Windows\\System32\\wsl.exe') || files.includes(path),
    kitCommit: () => ({ commit }),
    runCommand: (command, args) => {
      const name = win32.basename(command).toLowerCase();
      calls.push([name, ...args]);
      if (name === 'reg.exe') return { status: services.some(s => args[1].endsWith(`\\${s}`)) ? 0 : 1, stdout: Buffer.alloc(0) };
      if (name === 'wsl.exe' && args[0] === '--status') return { status: 0, stdout: utf16(status) };
      if (name === 'wsl.exe' && args[0] === '--list' && listed[args.slice(1).join(' ')]) {
        const [code, text] = listed[args.slice(1).join(' ')];
        return { status: code, stdout: utf16(text) };
      }
      if (name === 'powershell.exe') return virtualization === null ? null : { status: 0, stdout: Buffer.from(`${virtualization}\r\n`) };
      throw new Error(`unexpected command ${name} ${args.join(' ')}`);
    },
  };
  return context;
}

const prereq = (platform, id) => platform.prerequisites.find(x => x.id === id);
const enablement = /--install|--set-version|--set-default-version|--update|--shutdown|--terminate|--unregister|-e$|--exec/;
const assertReadOnlyCalls = calls => {
  for (const call of calls) {
    assert.ok(['reg.exe', 'wsl.exe', 'powershell.exe'].includes(call[0]), call.join(' '));
    if (call[0] === 'reg.exe') assert.equal(call[1], 'query');
    if (call[0] === 'wsl.exe') assert.ok(['--status', '--list'].includes(call[1]) && !call.some(x => enablement.test(x)), call.join(' '));
  }
};

test('wsl.exe output decodes from UTF-16LE with or without a BOM and from UTF-8, in any display language', () => {
  const distros = [{ name: 'Ubuntu-24.04', state: 'Running', version: 2, default: true }, { name: 'Debian', state: 'Stopped', version: 1, default: false }];
  for (const locale of ['en', 'de', 'vi']) {
    const lists = wslLists(distros, locale);
    const encodings = [text => utf16(text), text => utf16(text, false), text => Buffer.from(text.replace(/\n/g, '\r\n'), 'utf8')];
    for (const encode of encodings) {
      const read = key => decodeOutput(encode(lists[key][1]));
      assert.deepEqual(parseWslDistros({ quiet: read('--quiet'), running: read('--running --quiet'), verbose: read('--verbose') }), distros, locale);
    }
  }
  assert.deepEqual(parseWslStatus(decodeOutput(utf16('Default Distribution: Ubuntu\nDefault Version: 1\n'))), { defaultVersion: 1, defaultDistro: 'Ubuntu', vmPlatformMissing: false });
  assert.deepEqual(parseWslDistros({ quiet: decodeOutput(utf16(noDistros)) }), []);
  assert.equal(decodeOutput(null), '');
});

test('a running WSL2 distribution is ready on German and Vietnamese Windows', () => {
  for (const locale of ['de', 'vi']) {
    const context = windowsContext({ locale, status: '', distros: [ubuntu, { name: 'Debian', state: 'Stopped', version: 1, default: false }] });
    const platform = inspectWindows(context);
    assert.equal(platform.ready, true, locale);
    assert.deepEqual(platform.wsl.target, ubuntu);
    assert.deepEqual(platform.steps, []);
    assertReadOnlyCalls(context.calls);
    const none = inspectWindows(windowsContext({ locale, status: '', distros: [] }));
    assert.equal(prereq(none, 'wsl-distro').status, 'fail');
    assert.deepEqual(none.steps.map(x => x.command), ['wsl --install -d Ubuntu']);
  }
  const unreadable = inspectWindows(windowsContext({ lists: { ...wslLists([ubuntu]), '--verbose': [-1, ''] } }));
  assert.equal(prereq(unreadable, 'wsl-distro').status, 'unknown');
  assert.equal(unreadable.ready, false);
});

test('no WSL: guides the admin install and reboot, hints at virtualization, never runs wsl.exe', () => {
  const context = windowsContext({ services: [], wslExists: true, virtualization: 'False False' });
  const platform = inspectWindows(context);
  assert.equal(platform.supported, true);
  assert.equal(platform.ready, false);
  assert.equal(prereq(platform, 'wsl').status, 'fail');
  assert.equal(prereq(platform, 'virtualization').status, 'warn');
  assert.deepEqual(platform.steps.map(x => [x.command, x.admin, x.reboot]), [['wsl --install -d Ubuntu', true, true]]);
  assert.ok(!context.calls.some(x => x[0] === 'wsl.exe'));
  assertReadOnlyCalls(context.calls);

  const result = run(['check'], manifest, windowsContext({ services: [], wslExists: false, virtualization: 'True False' }));
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /wsl --install -d Ubuntu \(administrator PowerShell\), then restart Windows/);
  assert.ok(result.result.issues.some(x => x.id === 'wsl'));
  assert.equal(prereq(result.result.platform, 'virtualization').status, 'pass');
  assert.ok(!result.result.issues.some(x => x.id === 'virtualization'));
  const warned = run(['check', '--json'], manifest, windowsContext({ services: [], virtualization: 'False False' })).result;
  assert.ok(warned.advisories.some(x => x.id === 'virtualization' && x.status === 'warn'));
  assert.ok(!warned.issues.some(x => x.id === 'virtualization'));
});

test('WSL1 default with a WSL1 distro: set the default and convert the distro, no admin', () => {
  const context = windowsContext({ status: 'Default Distribution: Ubuntu\nDefault Version: 1\n', distros: [{ ...ubuntu, state: 'Stopped', version: 1 }] });
  const platform = inspectWindows(context);
  assert.equal(platform.ready, false);
  assert.equal(prereq(platform, 'wsl2-default').status, 'fail');
  assert.equal(prereq(platform, 'wsl-distro').status, 'fail');
  assert.deepEqual(platform.steps.map(x => [x.command, x.admin]), [['wsl --set-default-version 2', false], ['wsl --set-version Ubuntu 2', false]]);
  assertReadOnlyCalls(context.calls);
});

test('WSL2 with no distribution: install one, and ignore docker-desktop', () => {
  for (const distros of [[], [{ ...ubuntu, name: 'docker-desktop' }]]) {
    const platform = inspectWindows(windowsContext({ status: 'Default Version: 2\n', distros }));
    assert.equal(platform.ready, false);
    assert.equal(prereq(platform, 'wsl2-default').status, 'pass');
    assert.equal(prereq(platform, 'wsl-distro').status, 'fail');
    assert.deepEqual(platform.steps.map(x => [x.command, x.admin, x.reboot]), [['wsl --install -d Ubuntu', false, false]]);
  }
  const vm = inspectWindows(windowsContext({ status: 'WSL2 is not supported with your current machine configuration.\nPlease enable the "Virtual Machine Platform" optional component.\n', distros: [] }));
  assert.deepEqual(vm.steps.map(x => [x.command, x.admin, x.reboot]), [['wsl --install --no-distribution', true, true], ['wsl --install -d Ubuntu', false, false]]);
});

test('WSL2 ready: plan targets Linux artifacts, Linux-side paths and prints the handoff', t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-kit-win-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const wt = 'C:\\Users\\teammate\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
  const context = windowsContext({ status: 'Default Distribution: Ubuntu-24.04\nDefault Version: 1\n', distros: [{ ...ubuntu, name: 'Ubuntu-24.04' }, { name: 'docker-desktop', state: 'Stopped', version: 2, default: false }],
    files: [chrome, wt], env: { HOME: home } });
  const result = run(['plan', '--json', '--harness', 'codex', '--install-root', '~/.agent-kit', '--firstmate-home', '~/firstmate'], manifest, context);
  const { platform, plan } = result.result;
  assert.equal(platform.ready, true);
  assert.equal(platform.wsl.target.name, 'Ubuntu-24.04');
  assert.deepEqual(platform.wsl.ignored, ['docker-desktop']);
  assert.equal(prereq(platform, 'wsl2-default').status, 'pass');
  assert.equal(prereq(platform, 'terminal').status, 'pass');
  assert.equal(prereq(platform, 'browser').status, 'pass');
  assert.equal(platform.artifactTarget, 'wsl2-x64');
  assert.ok(!result.result.issues.some(x => ['windows-build', 'wsl', 'wsl2-default', 'wsl-distro', 'platform'].includes(x.id)));
  const herdr = plan.tools.find(x => x.id === 'herdr');
  assert.equal(herdr.artifactUrl, manifest.tools.find(x => x.id === 'herdr').artifacts['linux-x64'].url);
  assert.equal(herdr.installLocation, `~/.agent-kit/releases/${manifest.release}/bin/herdr`);
  const tower = manifest.tools.find(x => x.id === 'zoe-fleet');
  assert.deepEqual(plan.tools.find(x => x.id === 'zoe-fleet').artifactUrl, tower.artifacts['wsl2-x64'].url);
  assert.equal(plan.tools.find(x => x.id === 'zoe-fleet').installLocation, `~/.agent-kit/releases/${manifest.release}/bin/zoe-fleet`);
  assert.equal(plan.tools.find(x => x.id === 'firstmate').installLocation, '~/firstmate');
  assert.deepEqual(plan.globalHookChanges, []);
  assert.equal(plan.handoff.status, 'handoff-ready');
  assert.equal(plan.handoff.commit, commit);
  assert.match(plan.handoff.command, /^wsl\.exe -d Ubuntu-24\.04 --exec bash -l -c '.+' agent-kit-handoff c{40} '~\/\.agent-kit' '~\/firstmate' --harness codex --json$/);
  assert.ok(plan.nextSteps.some(x => /Windows Terminal.*Ubuntu-24\.04.*Herdr/.test(x)));
  assert.ok(plan.nextSteps.some(x => /chrome-devtools-axi and Lavish open the browser on the Windows side/.test(x)));
  const text = run(['plan', '--install-root', '~/.agent-kit', '--firstmate-home', '~/firstmate'], manifest, context).output;
  assert.match(text, /WSL handoff: WSL2 distribution Ubuntu-24\.04 is ready/);
  assert.match(text, /previewed inside WSL by the Linux installer/);
  assertReadOnlyCalls(context.calls);
  assert.deepEqual(readdirSync(home), []);
});

test('arm64 Windows targets wsl2-arm64 even when Node runs under x64 emulation; 32-bit is refused', () => {
  const arm = inspectWindows(windowsContext({ machine: 'arm64', arch: 'x64' }));
  assert.equal(arm.linuxArch, 'arm64');
  assert.equal(arm.artifactTarget, 'wsl2-arm64');
  assert.equal(arm.ready, true);
  const emulated = inspectWindows(windowsContext({ machine: 'x86_64', env: { PROCESSOR_IDENTIFIER: 'ARMv8 (64-bit) Family 8 Model 1' } }));
  assert.equal(emulated.linuxArch, 'arm64');
  const ia32 = windowsContext({ machine: 'i686', arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86' } });
  const result = run(['check', '--json'], manifest, ia32);
  assert.equal(result.result.platform.supported, false);
  assert.ok(result.result.issues.some(x => x.id === 'platform' && /x64 or Arm64/.test(x.reason)));
  assert.deepEqual(ia32.calls, []);
});

test('old Windows builds are refused with an update step', () => {
  const platform = inspectWindows(windowsContext({ osRelease: '10.0.18363' }));
  assert.equal(platform.supported, false);
  assert.equal(prereq(platform, 'windows-build').status, 'fail');
  assert.equal(platform.steps[0].id, 'update-windows');
});

test('handoff command construction keeps Linux paths, pins the kit commit and quotes for PowerShell', () => {
  const argv = handoffArgv({ distro: 'Ubuntu', commit, installRoot: '~/.agent-kit', firstmateHome: '/home/me/firstmate', harness: 'claude', withFigma: true });
  assert.deepEqual(argv, ['-d', 'Ubuntu', '--exec', 'bash', '-l', '-c', handoffScript, 'agent-kit-handoff', commit, '~/.agent-kit', '/home/me/firstmate', '--harness', 'claude', '--with-figma']);
  // The printed command must read back, under PowerShell single-quote rules, as exactly this argv, on one
  // pasteable line, with `~` quoted and no double quotes, which Windows PowerShell 5.1 mangles for native commands.
  const command = powershellCommand(argv);
  const psTokens = [...command.matchAll(/'((?:[^']|'')*)'|(\S+)/g)].map(m => m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]);
  assert.deepEqual(psTokens, ['wsl.exe', ...argv]);
  assert.equal(command.split('\n').length, 1);
  assert.ok(!command.includes('"'));
  assert.ok(command.includes(" '~/.agent-kit' "));
  for (const bad of ['C:\\Users\\me\\kit', '/mnt/c/Users/me/kit', '//mnt/c/kit', '//mnt/c/Users/me/kit', '/mnt//c/kit', '~//mnt', '/home//me/kit', '~/a b', '/home/me/../kit', 'relative/kit', '~/kit/', '~/$(id)', '/home/me/kit;rm']) {
    assert.throws(() => linuxPath(bad, '--install-root'), /Linux path|Linux filesystem/, bad);
  }
  for (const good of ['~/.agent-kit', '/home/me/firstmate']) assert.equal(linuxPath(good, '--install-root'), good);
  assert.throws(() => handoffArgv({ distro: 'Ubuntu; calc', commit, installRoot: '~/k', firstmateHome: '~/f' }), /distribution/);
  assert.throws(() => handoffArgv({ distro: 'Ubuntu', commit: 'main', installRoot: '~/k', firstmateHome: '~/f' }), /SHA-1/);
  assert.throws(() => handoffArgv({ distro: 'Ubuntu', commit, installRoot: '~/k', firstmateHome: '~/k' }), /differ/);
});

test('handoff script fetches the pinned kit once inside a Linux HOME and execs the Linux install', { skip: process.platform === 'win32' }, t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-kit-handoff-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), gitOnly = join(dir, 'git-only');
  for (const path of [home, bin, gitOnly]) mkdirSync(path);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$*" >> "$HOME/git.log"\ncase "$*" in *" init -q") mkdir -p "$2/.git";; *"rev-parse HEAD") echo ${commit};; esac\n`, { mode: 0o755 });
  writeFileSync(join(gitOnly, 'git'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(bin, 'node'), '#!/bin/sh\necho "$*" > "$HOME/node.args"\n', { mode: 0o755 });
  const argv = handoffArgv({ distro: 'Ubuntu', commit, installRoot: '~/.agent-kit', firstmateHome: '~/firstmate', harness: 'codex' });
  const script = argv.slice(argv.indexOf('-c') + 1);
  const runScript = () => spawnSync('/bin/bash', ['-c', ...script], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' });
  const first = runScript();
  assert.equal(first.status, 0, first.stderr);
  const src = join(home, '.agent-kit', 'kit', commit);
  assert.equal(readFileSync(join(home, 'node.args'), 'utf8').trim(),
    `${src}/bin/agent-kit.mjs install --install-root ${home}/.agent-kit --firstmate-home ${home}/firstmate --harness codex`);
  assert.match(readFileSync(join(home, 'git.log'), 'utf8'), new RegExp(`fetch -q --depth 1 ${kitUpstream.replace(/\./g, '\\.')} ${commit}`));
  const second = runScript();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(join(home, 'git.log'), 'utf8').split('\n').filter(x => x.includes(' fetch ')).length, 1);
  const noNode = spawnSync('/bin/bash', ['-c', ...script], { env: { HOME: home, PATH: gitOnly }, encoding: 'utf8' });
  assert.equal(noNode.status, 1);
  assert.match(noNode.stderr, /install Node\.js 24\.15\.0 or newer inside this WSL distribution/);
});

test('windows install: needs-setup and unpinned refuse; --handoff spawns only wsl.exe with the built argv', () => {
  const options = { installRoot: '~/.agent-kit', firstmateHome: '~/firstmate', harness: 'claude' };
  const spawned = [];
  const spawn = (command, args) => { spawned.push([command, args]); return { status: 0 }; };
  const notReady = windowsHandoff({ ...options, handoff: true }, { ...windowsContext({ services: [] }), spawn });
  assert.equal(notReady.status, 'needs-setup');
  assert.equal(notReady.exitCode, 1);
  assert.match(formatWindows(notReady), /Steps you run yourself \(.*\):\n- wsl --install -d Ubuntu \(administrator PowerShell\), then restart Windows: open PowerShell/);
  const dirty = windowsHandoff({ ...options, handoff: true }, { ...windowsContext(), spawn, kitCommit: () => ({ commit, reason: 'this kit checkout has changed tracked files' }) });
  assert.equal(dirty.status, 'unpinned');
  assert.equal(spawned.length, 0);
  const preview = windowsHandoff(options, { ...windowsContext(), spawn });
  assert.equal(preview.status, 'handoff-ready');
  assert.equal(spawned.length, 0);
  const handed = windowsHandoff({ ...options, handoff: true }, { ...windowsContext(), spawn: (command, args) => { spawned.push([command, args]); return { status: 1 }; } });
  assert.equal(handed.status, 'handed-off');
  assert.equal(handed.exitCode, 1);
  assert.deepEqual(spawned, [['C:\\Windows\\System32\\wsl.exe', preview.argv]]);
  assert.throws(() => windowsHandoff({ ...options, installRoot: 'C:\\kit' }, windowsContext()), /Linux path/);
  const refused = { ...windowsContext(), spawn };
  assert.throws(() => windowsHandoff({ installRoot: '//mnt/c/kit', firstmateHome: '~/firstmate', handoff: true }, refused), /Linux path/);
  assert.ok(!refused.calls.some(call => call[0] === 'wsl.exe'), refused.calls.join('; '));
  assert.equal(spawned.length, 1);
});

test('Windows arguments: --handoff and --distro are Windows-only, paths must be Linux-side', () => {
  assert.equal(parseArgs(['install', '--install-root', '~/.agent-kit', '--firstmate-home', '~/firstmate', '--handoff', '--distro', 'Ubuntu'], 'win32').handoff, true);
  assert.throws(() => parseArgs(['plan', '--handoff'], 'win32'), /only to install/);
  assert.throws(() => parseArgs(['install', '--dry-run', '--handoff'], 'win32'), /only to install/);
  assert.throws(() => parseArgs(['check', '--distro', 'Ubuntu'], 'linux'), /only on Windows/);
  assert.throws(() => parseArgs(['plan', '--install-root', 'C:\\kit'], 'win32'), /Linux path/);
  assert.throws(() => parseArgs(['install', '--install-root', '~/.agent-kit', '--firstmate-home', '//mnt/c/fm'], 'win32'), /--firstmate-home on Windows must be a Linux path/);
  assert.throws(() => parseArgs(['install', '--install-root', '//mnt/c/kit', '--firstmate-home', '~/firstmate', '--handoff'], 'win32'), /--install-root on Windows must be a Linux path/);
  assert.throws(() => parseArgs(['plan', '--install-root', '~/kit'], 'darwin'), /absolute/);
  const distro = inspectWindows(windowsContext({ distros: [ubuntu, { name: 'Debian', state: 'Stopped', version: 2, default: false }] }), { distro: 'Debian' });
  assert.equal(distro.wsl.target.name, 'Debian');
  const missing = inspectWindows(windowsContext(), { distro: 'Fedora' });
  assert.equal(prereq(missing, 'wsl-distro').status, 'fail');
  assert.equal(missing.steps[0].command, 'wsl --install -d Fedora');
});

test('windows setup: preflight first, then a pinned handoff into install.sh inside WSL with the setup flags', () => {
  const spawned = [];
  const spawn = (command, args) => { spawned.push([command, args]); return { status: 0 }; };
  const notReady = windowsSetup(['--handoff'], { ...windowsContext({ services: [] }), spawn });
  assert.equal(notReady.status, 'needs-setup');
  assert.equal(spawned.length, 0);
  const dirty = windowsSetup(['--handoff'], { ...windowsContext(), spawn, kitCommit: () => ({ commit, reason: 'this kit checkout has changed tracked files' }) });
  assert.equal(dirty.status, 'unpinned');
  const args = ['--root', '~/Agentic', '--harness', 'claude,codex', '--starter-scope', 'docs and notes', '--distro', 'Ubuntu'];
  const preview = windowsSetup(args, { ...windowsContext(), spawn });
  assert.equal(preview.status, 'handoff-ready');
  assert.deepEqual(preview.argv, ['-d', 'Ubuntu', '--exec', 'bash', '-l', '-c', setupHandoffScript, 'agent-kit-setup', commit, '--root', '~/Agentic', '--harness', 'claude,codex', '--starter-scope', 'docs and notes']);
  assert.match(formatWindows(preview), /questions are asked inside WSL[\s\S]*wsl\.exe -d Ubuntu --exec bash -l -c '.*' agent-kit-setup c{40} --root '~\/Agentic'/);
  assert.equal(spawned.length, 0);
  const handed = windowsSetup([...args, '--handoff'], { ...windowsContext(), spawn });
  assert.equal(handed.status, 'handed-off');
  assert.deepEqual(spawned, [['C:\\Windows\\System32\\wsl.exe', preview.argv]]);
  for (const bad of [['--root', '/mnt/c/Agentic'], ['--root', 'C:\\Agentic'], ['--install-root', '//mnt/c/kit']]) assert.throws(() => windowsSetup(bad, windowsContext()), /Linux path|Windows drive/);
  assert.throws(() => windowsSetup(['--kit-dir', 'C:\\kit'], windowsContext()), /set by install\.sh/);
  assert.equal(setupHandoffScript.includes("'"), false, 'pastes inside PowerShell single quotes');
});

test('setup handoff script fetches install.sh at the pinned commit with gh and keeps arguments intact', { skip: process.platform === 'win32' }, t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-setup-handoff-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, 'bin'), home = join(base, 'home'), log = join(base, 'log');
  mkdirSync(bin); mkdirSync(home);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf 'gh %s\\n' "$*" >> '${log}'\nprintf '%s\\n' 'for a in "$@"; do printf "arg:%s\\\\n" "$a" >> ${log}; done; printf "dir:%s\\\\n" "$(dirname "$0")" >> ${log}; exit 4'\n`, { mode: 0o755 });
  const result = spawnSync('bash', ['-c', setupHandoffScript, 'agent-kit-setup', commit, '--root', '~/Agentic', '--starter-scope', 'two words'],
    { encoding: 'utf8', env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } });
  assert.equal(result.status, 4, result.stderr);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines[0], `gh api -H Accept:application/vnd.github.raw repos/amelie-pierce/agent-kit/contents/install.sh?ref=${commit}`);
  assert.deepEqual(lines.filter(x => x.startsWith('arg:')).map(x => x.slice(4)), ['--commit', commit, '--root', '~/Agentic', '--starter-scope', 'two words']);
  const dir = lines.find(x => x.startsWith('dir:')).slice(4);
  assert.equal(readdirSync(dirname(dir)).includes(basename(dir)), false, 'the fetched install.sh is removed');
  const empty = join(base, 'empty');
  mkdirSync(empty);
  const noGh = spawnSync('/bin/bash', ['-c', setupHandoffScript, 'agent-kit-setup', commit], { encoding: 'utf8', env: { HOME: home, PATH: empty } });
  assert.equal(noGh.status, 1);
  assert.match(noGh.stderr, /install the GitHub CLI inside this WSL distribution/);
});
