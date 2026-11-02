import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { libraryCommand, libraryReport, runCommand } from './libraries.mjs';
import { linuxIdentity } from './platforms/linux.mjs';

// chrome-devtools-axi drives Chromium-family browsers only. The kit prefers a browser the person already has and never installs one.
const families = [
  { id: 'chrome', name: 'Google Chrome', linux: ['google-chrome-stable', 'google-chrome'], macos: 'Google Chrome', windows: ['Google', 'Chrome', 'Application', 'chrome.exe'] },
  { id: 'edge', name: 'Microsoft Edge', linux: ['microsoft-edge-stable', 'microsoft-edge'], macos: 'Microsoft Edge', windows: ['Microsoft', 'Edge', 'Application', 'msedge.exe'] },
  { id: 'brave', name: 'Brave', linux: ['brave-browser-stable', 'brave-browser', 'brave'], macos: 'Brave Browser', windows: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'] },
];
const sides = { native: 'this computer', windows: 'Windows side' };
const page = `data:text/html,${encodeURIComponent('<title>agent-kit browser-check</title><h1>agent-kit browser-check: the browser opened and answered</h1>')}`;
const session = 'agent-kit-browser-check';

export function parseOsRelease(text = '') {
  const values = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return values;
}

export function detectEnvironment(context) {
  if (context.platform === 'darwin') return { os: 'macos', label: 'macOS', wsl: false, wsl2: false, distro: null };
  if (context.platform === 'win32') return { os: 'windows', label: 'Windows', wsl: false, wsl2: false, distro: null };
  if (context.platform !== 'linux') return { os: context.platform, label: context.platform, unsupported: true, wsl: false, wsl2: false, distro: null };
  const identity = linuxIdentity({ ...context, libc: 'unknown' });
  let text = context.osRelease;
  if (text === undefined) try { text = readFileSync('/etc/os-release', 'utf8'); } catch { text = ''; }
  const release = parseOsRelease(text);
  const distro = { id: release.ID || '', idLike: (release.ID_LIKE || '').split(/\s+/).filter(Boolean), versionId: release.VERSION_ID || '',
    codename: release.VERSION_CODENAME || '', ubuntuCodename: release.UBUNTU_CODENAME || '', name: identity.distro };
  const kind = identity.wsl2 ? 'WSL2' : identity.wsl ? 'WSL1' : 'Linux';
  return { os: identity.wsl ? 'wsl' : 'linux', label: `${kind}, ${distro.name}`, wsl: identity.wsl, wsl2: identity.wsl2, distro };
}

const findOnPath = (context, name) => (context.env?.PATH || '').split(':').filter(Boolean).map(dir => posix.join(dir, name)).find(context.exists || existsSync) || null;
const envValue = (env = {}, name) => env[Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase())];

function windowsRoots(context, environment) {
  const run = context.run;
  if (environment.os === 'windows') return ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map(name => envValue(context.env, name)).filter(Boolean);
  const roots = ['/mnt/c/Program Files', '/mnt/c/Program Files (x86)'];
  const local = run('cmd.exe', ['/c', 'echo %LOCALAPPDATA%'], { cwd: '/mnt/c' });
  const windowsPath = local.status === 0 ? local.stdout.trim() : '';
  if (/^[A-Za-z]:\\/.test(windowsPath)) {
    const linux = run('wslpath', ['-u', windowsPath]);
    if (linux.status === 0 && linux.stdout.trim()) roots.push(linux.stdout.trim());
  }
  return roots;
}

// Browsers on this computer come first: from WSL they need no Windows networking, then the Windows side. Order within a side is Chrome, Edge, Brave.
export function detectBrowsers(context, environment) {
  const exists = context.exists, found = [];
  const add = (family, side, path) => { if (!found.some(x => x.id === family.id && x.side === side)) found.push({ id: family.id, name: family.name, side, path }); };
  if (environment.unsupported) return found;
  if (environment.os === 'macos') {
    const home = context.env?.HOME;
    for (const family of families) for (const base of ['/Applications', home && posix.join(home, 'Applications')].filter(Boolean)) {
      const path = posix.join(base, `${family.macos}.app`, 'Contents', 'MacOS', family.macos);
      if (exists(path)) add(family, 'native', path);
    }
  } else if (environment.os === 'windows') {
    for (const family of families) for (const root of windowsRoots(context, environment)) {
      const path = win32.join(root, ...family.windows);
      if (exists(path)) add(family, 'native', path);
    }
  } else {
    const dirs = (context.env?.PATH || '').split(':').filter(Boolean);
    for (const family of families) {
      const path = family.linux.flatMap(name => dirs.map(dir => posix.join(dir, name))).find(exists);
      if (path) add(family, 'native', path);
    }
    if (environment.wsl) for (const family of families) {
      const path = windowsRoots(context, environment).map(root => posix.join(root, ...family.windows)).find(exists);
      if (path) add(family, 'windows', path);
    }
  }
  return found.sort((a, b) => (a.side === b.side ? 0 : a.side === 'native' ? -1 : 1));
}

// Which terminal this is and whether it draws kitty graphics (what terminal-browser needs), from environment variables alone.
// A terminal that cannot draw them shows a blank screen. Multiplexers are "unknown" because they swallow the protocol unless passthrough is set.
export function detectTerminal(env = {}) {
  const has = prefix => Object.keys(env).some(key => key.startsWith(prefix));
  const term = (name, kitty, note) => ({ name, kitty, note });
  if (env.TMUX || env.STY) return term(env.TMUX ? 'tmux' : 'screen', 'unknown', 'a multiplexer passes kitty graphics through only when passthrough is on, so the outer terminal decides; unverified');
  if (env.TERM === 'xterm-kitty' || env.KITTY_WINDOW_ID) return term('kitty', 'yes', 'draws kitty graphics');
  if (env.TERM === 'xterm-ghostty' || env.TERM_PROGRAM === 'ghostty' || has('GHOSTTY_')) return term('Ghostty', 'yes', 'draws kitty graphics');
  if (env.TERM_PROGRAM === 'WezTerm' || has('WEZTERM_')) return term('WezTerm', 'yes', 'draws kitty graphics');
  if (env.TERM_PROGRAM === 'vscode' || has('VSCODE_')) return term('VS Code terminal', 'no', 'blank screen on WSL2 Ubuntu 24.04; other systems unverified');
  if (env.WT_SESSION) return term('Windows Terminal', 'no', 'does not draw kitty graphics');
  return term(env.TERM_PROGRAM || env.TERM || 'unknown terminal', 'unknown', 'not recognised; if a page shows a blank screen, the terminal cannot draw kitty graphics');
}

// browser-check's one extra line: only for a terminal that draws kitty graphics, pointing at the terminal-browser setup command.
export function terminalBrowserOffer(context) {
  const terminal = detectTerminal(context.env);
  if (terminal.kitty !== 'yes') return { offered: false };
  const installed = findOnPath(context, 'terminal-browser');
  return { offered: true, terminal: terminal.name, tool: 'terminal-browser', installed,
    note: `${terminal.name} draws kitty graphics, so terminal-browser can run in it${installed ? ` (already installed at ${installed})` : ''}. It is separate from chrome-devtools-axi; run agent-kit terminal-browser for its steps.` };
}

function axiSettings(browser, environment) {
  if (!browser || environment.os === 'windows') return [];
  const port = 'CHROME_DEVTOOLS_AXI_BROWSER_URL=http://127.0.0.1:9222';
  if (browser.id === 'chrome' && browser.side === 'native' && environment.os !== 'windows')
    return ['chrome-devtools-axi finds Google Chrome itself and runs it hidden; set CHROME_DEVTOOLS_AXI_HEADED=1 to see the window (CHROME_DEVTOOLS_AXI_CHANNEL picks beta, dev or canary).'];
  const exe = `"${browser.path}" --remote-debugging-port=9222 --user-data-dir=<a folder only for this browser>`;
  return [`${browser.name} is not launched by chrome-devtools-axi: start it yourself (${exe}) and set ${port} before using chrome-devtools-axi.`];
}

const installHelp = environment => ({
  macos: 'Install Google Chrome, Microsoft Edge or Brave yourself, for example: brew install --cask google-chrome',
  windows: 'Install Google Chrome, Microsoft Edge or Brave yourself, for example: winget install --exact --id Google.Chrome',
  wsl: 'Install Google Chrome, Microsoft Edge or Brave on Windows (for example winget install --exact --id Google.Chrome in PowerShell), or install a Linux browser inside this distribution from https://www.google.com/chrome/',
  linux: 'Install Google Chrome, Microsoft Edge or Brave yourself from the vendor download page, for example https://www.google.com/chrome/',
})[environment.os];

function withDefaults(context) {
  const c = { env: process.env, platform: process.platform, exists: existsSync, timeoutMs: 20000, holdMs: 3000, ...context };
  c.run ||= runCommand;
  c.sleep ||= ms => new Promise(resolve => setTimeout(resolve, ms));
  c.freePort ||= () => new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
  c.probe ||= async url => {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); return response.ok ? await response.json() : null; } catch { return null; }
  };
  c.launch ||= (command, args, options = {}) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', error = null, done = false;
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    const exited = new Promise(resolve => {
      child.once('error', e => { error = e; done = true; resolve({ code: null, error: e }); });
      child.once('exit', code => { done = true; resolve({ code }); });
    });
    return { exited, stderr: () => stderr, error: () => error, running: () => !done, kill: () => { try { child.kill(); } catch { /* already gone */ } } };
  };
  c.closeBrowser ||= async (webSocketUrl, handle) => {
    if (webSocketUrl && typeof WebSocket !== 'undefined') await new Promise(resolve => {
      let opened = false;
      const socket = new WebSocket(webSocketUrl), timer = setTimeout(() => finish(), 2000);
      const finish = () => { clearTimeout(timer); try { socket.close(); } catch { /* closed */ } resolve(); };
      socket.onopen = () => { opened = true; socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })); };
      socket.onmessage = finish; socket.onerror = finish; socket.onclose = () => opened && finish();
    });
    await Promise.race([handle.exited, c.sleep(3000)]);
    if (handle.running()) handle.kill();
  };
  c.profile ||= async browser => {
    const name = `agent-kit-browser-${randomBytes(4).toString('hex')}`;
    if (browser.side === 'windows') {
      const temp = c.run('cmd.exe', ['/c', 'echo %TEMP%'], { cwd: '/mnt/c' });
      const dir = temp.status === 0 ? temp.stdout.trim() : '';
      if (!/^[A-Za-z]:\\/.test(dir)) throw new Error(`could not read the Windows temp folder through cmd.exe (${temp.error?.message || 'WSL interop may be off'})`);
      const path = `${dir}\\${name}`;
      return { name, path, remove: () => {
        const linux = c.run('wslpath', ['-u', path]);
        if (linux.status === 0) rmSync(linux.stdout.trim(), { recursive: true, force: true });
      } };
    }
    const path = mkdtempSync(join(tmpdir(), `${name}-`));
    return { name, path, remove: () => rmSync(path, { recursive: true, force: true }) };
  };
  return c;
}

const tail = (text, lines = 6, size = 500) => text.trim().split('\n').slice(-lines).join('\n').slice(-size);
const missingLibrary = text => text.match(/error while loading shared libraries: (\S+?):/)?.[1] || null;

function wslNetworkingMode(context) {
  const result = context.run('wslinfo', ['--networking-mode']);
  return result.status === 0 ? result.stdout.trim() : null;
}

// One command: detect, print the library step, open the browser visibly with remote debugging, then drive it with chrome-devtools-axi.
// Each step records what happened, and the first failing step names the cause and the fix; the browser and its temporary profile are always cleaned up.
export async function browserCheck(context = {}) {
  const c = withDefaults(context);
  const environment = detectEnvironment(c), steps = [];
  const record = (id, status, detail, fix) => { steps.push({ id, status, detail, ...(fix ? { fix } : {}) }); return status; };
  const result = { command: 'browser-check', environment: { os: environment.os, label: environment.label, wsl: environment.wsl, wsl2: environment.wsl2 },
    browsers: [], selected: null, libraries: null, settings: [], terminalBrowser: terminalBrowserOffer(c), steps };
  const finish = () => { result.status = steps.some(x => x.status === 'fail') ? 'fail' : 'pass'; result.exitCode = result.status === 'pass' ? 0 : 1; return result; };
  if (environment.unsupported) { record('platform', 'fail', `${context.platform || process.platform} is not supported; the kit checks macOS, Linux, WSL and Windows`); return finish(); }
  record('platform', 'pass', environment.label);

  result.browsers = detectBrowsers(c, environment);
  const selected = result.selected = result.browsers[0] || null;
  result.settings = axiSettings(selected, environment);
  if (!selected) { record('browser', 'fail', 'no Google Chrome, Microsoft Edge or Brave found', installHelp(environment)); return finish(); }
  const others = result.browsers.slice(1).map(x => `${x.name} (${sides[x.side]})`);
  record('browser', 'pass', `${selected.name} (${sides[selected.side]}) at ${selected.path}${others.length ? `; also found ${others.join(', ')}` : ''}`);

  const native = selected.side === 'native' && ['linux', 'wsl'].includes(environment.os);
  const libs = result.libraries = native ? libraryReport(c, environment, selected.path) : null;
  if (native) {
    if (libs.status === 'missing') record('libraries', 'warn', `ldd reports ${libs.missing.join(', ')} not found for ${libs.binary}`, libs.command || libs.fallback);
    else if (libs.status === 'present') record('libraries', 'pass', `ldd finds every shared library ${libs.binary} loads`);
    else record('libraries', 'warn', `could not check the shared libraries of ${selected.path} (${libs.detail}); the kit prints no install command, see the per-distro commands in the README "Browser check" section and the library section of docs/user-guide.md`);
    if (!c.env.DISPLAY && !c.env.WAYLAND_DISPLAY) {
      record('display', 'fail', 'neither DISPLAY nor WAYLAND_DISPLAY is set, so a visible window has nowhere to open',
        environment.wsl ? 'WSLg provides the display on current Windows 10 and 11: run "wsl --update" in PowerShell and restart WSL, or use a browser on the Windows side.'
          : 'Run this from a desktop session; over SSH, forward X11 (ssh -X) or run it on the machine itself.');
      return finish();
    }
    record('display', 'pass', c.env.WAYLAND_DISPLAY ? `WAYLAND_DISPLAY=${c.env.WAYLAND_DISPLAY}` : `DISPLAY=${c.env.DISPLAY}`);
  }

  let profile = null, handle = null, webSocketUrl = null, endpoint = null;
  try {
    try { profile = await c.profile(selected); }
    catch (error) { record('launch', 'fail', error.message, 'Windows interop must be on so WSL can start Windows programs (wsl.conf [interop] enabled=true).'); return finish(); }
    const port = await c.freePort();
    endpoint = `http://127.0.0.1:${port}`;
    handle = c.launch(selected.path, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile.path}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
      { cwd: selected.side === 'windows' ? '/mnt/c' : undefined });
    let info = null;
    const deadline = Date.now() + c.timeoutMs;
    while (!info && Date.now() < deadline) {
      info = await c.probe(`${endpoint}/json/version`);
      if (!info && !handle.running()) break;
      if (!info) await c.sleep(250);
    }
    if (!info) {
      const stderr = handle.stderr(), error = handle.error();
      const lib = missingLibrary(stderr);
      if (error) record('launch', 'fail', `could not start ${selected.path}: ${error.message}`, error.code === 'EACCES' ? 'Check that the file is executable.' : 'Check that the path still exists; reinstall the browser if it was removed.');
      else if (!handle.running()) record('launch', 'fail', `${selected.name} exited before its DevTools endpoint was ready${lib ? `: it needs ${lib}` : ''}${stderr.trim() ? `\n${tail(stderr)}` : ''}`,
        lib ? libraryCommand(environment, [lib])?.command || libs?.command || libs?.fallback || `Install the package that provides ${lib}.` : undefined);
      else if (environment.wsl && selected.side === 'windows') {
        const mode = wslNetworkingMode(c);
        record('devtools', 'fail', `${selected.name} on Windows started, but ${endpoint} does not answer from WSL (WSL networking mode: ${mode || 'unknown'})`,
          mode === 'nat' ? 'In NAT mode WSL cannot reach the Windows localhost, and the kit does not change WSL networking. Use a browser installed inside this distribution (the library step above), or switch WSL to mirrored networking yourself.'
            : 'Check that Windows did not block the browser (firewall or policy) and that no other browser holds the same port.');
      } else record('devtools', 'fail', `${selected.name} started, but ${endpoint} did not answer within ${Math.round(c.timeoutMs / 1000)} seconds${stderr.trim() ? `\n${tail(stderr)}` : ''}`,
        'Close other windows of this browser, then retry; policies can disable remote debugging.');
      return finish();
    }
    webSocketUrl = info.webSocketDebuggerUrl;
    record('devtools', 'pass', `${selected.name} answered at ${endpoint}${info.Browser ? ` (${info.Browser})` : ''}`);

    const axi = environment.os === 'windows' ? null : findOnPath(c, 'chrome-devtools-axi');
    if (environment.os === 'windows') record('axi', 'skip', 'chrome-devtools-axi runs inside WSL2; run agent-kit browser-check there to drive a Windows browser from it');
    else if (!axi) record('axi', 'fail', 'chrome-devtools-axi is not on PATH', 'Open a new terminal so the kit\'s PATH setup applies, or run agent-kit setup to install it.');
    else {
      const env = { ...c.env, CHROME_DEVTOOLS_AXI_BROWSER_URL: endpoint, CHROME_DEVTOOLS_AXI_SESSION: session, CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '', CHROME_DEVTOOLS_AXI_MCP_SERVER_URL: '' };
      const opened = c.run(axi, ['open', page], { env, timeout: 90000 });
      const output = `${opened.stdout}\n${opened.stderr}`;
      if (opened.error || opened.status !== 0 || !output.includes('agent-kit browser-check')) {
        record('axi', 'fail', `chrome-devtools-axi could not open a page in ${selected.name}${opened.error ? `: ${opened.error.message}` : ` (exit ${opened.status})`}${output.trim() ? `\n${tail(output)}` : ''}`,
          'chrome-devtools-axi starts chrome-devtools-mcp through npx, which needs network access the first time; read its output above.');
      } else {
        record('axi', 'pass', `chrome-devtools-axi opened the test page in the visible ${selected.name} window`);
        await c.sleep(c.holdMs);
      }
      c.run(axi, ['stop'], { env, timeout: 15000 });
    }
    return finish();
  } finally {
    if (handle) await c.closeBrowser(webSocketUrl, handle);
    // Closing the interop process does not close a Windows browser, so sweep the one that carries this run's profile folder.
    if (profile && selected.side === 'windows') c.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${profile.name}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { timeout: 15000 });
    try { profile?.remove(); } catch { /* a profile folder still in use is removed with the temp folder later */ }
  }
}

export function formatBrowserCheck(result) {
  const lines = [`Agent Kit browser-check: ${result.status}`, `Environment: ${result.environment.label}`];
  lines.push(result.browsers.length ? 'Browsers found (the first is used; the kit never installs one):' : 'Browsers found: none');
  for (const [index, browser] of result.browsers.entries()) lines.push(`- ${browser.name} (${sides[browser.side]}): ${browser.path}${index === 0 ? ' [used]' : ''}`);
  const libs = result.libraries;
  if (libs) {
    lines.push(`Shared libraries of the browser (ldd): ${libs.status}${libs.missing.length ? ` (not found: ${libs.missing.join(', ')})` : ''}`);
    if (libs.command) lines.push(`  Run this yourself (the kit never runs sudo): ${libs.command}`);
    if (libs.fallback) lines.push(`  ${libs.fallback}`);
  }
  lines.push('Steps:');
  for (const step of result.steps) {
    lines.push(`${step.status.toUpperCase()} ${step.id}: ${step.detail}`);
    if (step.fix) lines.push(`  Fix: ${step.fix}`);
  }
  for (const setting of result.settings) lines.push(`Setting: ${setting}`);
  if (result.terminalBrowser.offered) lines.push(`Optional: ${result.terminalBrowser.note}`);
  return `${lines.join('\n')}\n`;
}
