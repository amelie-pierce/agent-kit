import { accessSync, constants, mkdtempSync, rmSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

function isExecutable(path) {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}

export function findOnPath(name, path = '') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return [];
  return [...new Set(path.split(delimiter).filter(Boolean).map(dir => join(dir, name)).filter(isExecutable))];
}

function safeRun(command, args, context, cwd, extraEnv = {}) {
  try {
    if (context.runCommand) return context.runCommand(command, args, cwd);
    return execFileSync(command, args, {
      cwd, encoding: 'utf8', timeout: 1500, maxBuffer: 16 * 1024,
      env: { HOME: context.env.HOME || '', PATH: context.env.PATH || '', LC_ALL: 'C', ...extraEnv },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

function exists(path) {
  try { statSync(path); return true; } catch { return false; }
}

export function inspectShell(shell) {
  if (!shell) return { id: 'shell', status: 'unknown', detail: 'SHELL is not set' };
  if (!isExecutable(shell)) return { id: 'shell', status: 'fail', detail: `${shell} is not executable` };
  const supported = ['bash', 'zsh'].includes(basename(shell));
  return { id: 'shell', status: supported ? 'pass' : 'unknown', detail: supported ? shell : `${shell} is not bash or zsh` };
}

export function inspectInstallRoot(home, requestedRoot) {
  const root = requestedRoot || join(home, '.agent-kit');
  let existing = root;
  while (!exists(existing) && dirname(existing) !== existing) existing = dirname(existing);
  let writable;
  try { accessSync(existing, constants.W_OK); writable = statSync(existing).isDirectory(); } catch { writable = false; }
  const where = existing === root ? root : `${root} absent; nearest existing ancestor ${existing}`;
  return { id: 'install-root', status: writable ? 'pass' : 'fail', detail: `${where} is ${writable ? 'writable' : 'not a writable directory'}` };
}

function findApps(names, dirs) {
  return names.flatMap(name => dirs.map(dir => join(dir, name)).filter(exists));
}

function inspectTerminal(dirs) {
  const found = findApps(['Terminal.app', 'iTerm.app'], dirs);
  return { id: 'terminal', status: found.length ? 'pass' : 'unknown', detail: found[0] || 'Terminal.app and iTerm.app not found' };
}

function inspectBrowser(dirs) {
  const chrome = findApps(['Google Chrome.app'], dirs);
  if (chrome.length) return { id: 'browser', status: 'pass', detail: chrome[0] };
  const other = findApps(['Safari.app', 'Firefox.app', 'Arc.app'], dirs);
  return { id: 'browser', status: other.length ? 'unknown' : 'fail', detail: other.length ? `Google Chrome absent; found ${other[0]}` : 'no browser found' };
}

// Version commands may write into HOME (figma-cli initializes it, Codex can leave ~/.codex/tmp behind, gh 2.102+
// records a device id in ~/.local/state/gh). Every probe gets disposable state so check and plan never write into
// the teammate HOME.
function probeHome(tool, context, probe) {
  const home = context.runCommand ? null : mkdtempSync(join(tmpdir(), `agent-kit-${tool.id}-version-`));
  try { probe(home); } finally { if (home) rmSync(home, { recursive: true, force: true }); }
}

export function inspectCommand(tool, context) {
  const { command, args } = tool.detection;
  const paths = findOnPath(command, context.env.PATH);
  if (!paths.length) return { id: tool.id, status: 'fail', reason: `${command} absent from PATH`, paths: [] };
  if (tool.detection.kind === 'presence') return { id: tool.id, status: 'unknown', reason: 'present; version not read because its command writes into HOME', paths };
  let output;
  probeHome(tool, context, home => { output = safeRun(paths[0], args, context, undefined, home ? { HOME: home } : {}); });
  if (output === null) return { id: tool.id, status: 'unknown', reason: 'version command failed or timed out', paths };
  const version = tool.version.value;
  const detected = output.match(/\d+\.\d+\.\d+/)?.[0] || null;
  if (tool.version.status !== 'verified') return { id: tool.id, status: 'unknown', reason: tool.version.reason, paths, detected };
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = new RegExp(`(?:^|[^0-9])v?${escaped}(?:$|[^0-9])`).test(output);
  return { id: tool.id, status: matches ? 'pass' : 'fail', reason: matches ? 'version matches' : `expected ${version}`, paths, detected };
}

export function inspectPrerequisite(tool, context) {
  const { command, args } = tool.detection;
  const paths = findOnPath(command, context.env.PATH);
  const prefix = `requires ${command} ${tool.minVersion} or newer; install it yourself: ${tool.installDocs}`;
  if (!paths.length) return { id: tool.id, kind: 'prerequisite', required: tool.required, status: 'fail', detail: `${command} absent from PATH; ${prefix}`, paths: [] };
  let output;
  probeHome(tool, context, home => { output = safeRun(paths[0], args, context, undefined, home ? { HOME: home } : {}); });
  const detected = typeof output === 'string' ? output.match(/\d+\.\d+\.\d+/)?.[0] : null;
  const meets = detected && (() => {
    const actual = detected.split('.').map(Number), minimum = tool.minVersion.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
    return true;
  })();
  return { id: tool.id, kind: 'prerequisite', required: tool.required, status: meets ? 'pass' : 'fail',
    detail: meets ? `${command} ${detected} meets ${tool.minVersion}` : `${detected ? `${command} ${detected} is too old` : `${command} version could not be read`}; ${prefix}`,
    detected, paths };
}

export function inspectSource(tool, context) {
  const directory = join(context.env.HOME || '', tool.installLocation.relativePath);
  const git = findOnPath('git', context.env.PATH)[0];
  if (!git) return { id: tool.id, status: 'unknown', reason: 'git absent from PATH', paths: [] };
  try { accessSync(directory); } catch { return { id: tool.id, status: 'fail', reason: 'source checkout absent', paths: [directory] }; }
  if (!exists(join(directory, '.git'))) return { id: tool.id, status: 'unknown', reason: 'source commit could not be read', paths: [directory] };
  const output = safeRun(git, tool.detection.args, context, directory, { GIT_CEILING_DIRECTORIES: dirname(directory) });
  if (!output) return { id: tool.id, status: 'unknown', reason: 'source commit could not be read', paths: [directory] };
  if (tool.version.status !== 'verified') return { id: tool.id, status: 'unknown', reason: tool.version.reason, paths: [directory], detected: /^[a-f0-9]{40}$/.test(output) ? output : null };
  const matches = output === tool.version.value;
  return { id: tool.id, status: matches ? 'pass' : 'fail', reason: matches ? 'commit matches' : `expected ${tool.version.value}`, paths: [directory], detected: /^[a-f0-9]{40}$/.test(output) ? output : null };
}

export function inspectMacOS(context, manifest, selectedTools) {
  if (!['arm64', 'x64'].includes(context.arch)) return {
    platform: 'darwin', arch: context.arch, supported: false,
    message: `macOS ${context.arch} is not yet supported.`, prerequisites: [], tools: [], pathConflicts: [],
  };
  const path = context.env.PATH || '';
  const brew = findOnPath('brew', path);
  const xcodeSelect = findOnPath('xcode-select', path);
  const cltPath = xcodeSelect.length ? safeRun(xcodeSelect[0], ['-p'], context) : null;
  const home = context.env.HOME || '';
  const appDirs = context.applicationDirs || ['/System/Applications', '/System/Applications/Utilities', '/Applications', '/Applications/Utilities', join(home, 'Applications')];
  const prerequisites = [
    { id: 'homebrew', status: brew.length ? 'pass' : 'fail', detail: brew.length ? brew[0] : 'brew absent from PATH' },
    { id: 'xcode-clt', status: cltPath ? 'pass' : 'unknown', detail: cltPath || 'Xcode CLT presence unverified' },
    inspectShell(context.env.SHELL),
    inspectInstallRoot(home, context.installRoot),
    inspectTerminal(appDirs),
    inspectBrowser(appDirs),
    ...['bash', 'zsh', 'curl', 'jq', 'python3', 'tar', 'unzip', 'shasum'].map(name => {
      const found = findOnPath(name, path);
      return { id: name, status: found.length ? 'pass' : 'fail', detail: found[0] || `${name} absent from PATH` };
    }),
    ...selectedTools.filter(tool => tool.kind === 'prerequisite').map(tool => inspectPrerequisite(tool, context)),
  ];
  const tools = selectedTools.filter(tool => tool.kind !== 'prerequisite').map(tool => tool.detection.kind === 'git-head' ? inspectSource(tool, context) : inspectCommand(tool, context));
  const pathConflicts = tools.filter(tool => tool.paths.length > 1).map(tool => ({ id: tool.id, paths: tool.paths }));
  return { platform: 'darwin', arch: context.arch, supported: true, prerequisites, tools, pathConflicts };
}
