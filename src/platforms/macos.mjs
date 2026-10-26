import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { execFileSync } from 'node:child_process';

function isExecutable(path) {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}

export function findOnPath(name, path = '') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return [];
  return [...new Set(path.split(delimiter).filter(Boolean).map(dir => join(dir, name)).filter(isExecutable))];
}

function safeRun(command, args, context, cwd) {
  try {
    if (context.runCommand) return context.runCommand(command, args, cwd);
    return execFileSync(command, args, {
      cwd, encoding: 'utf8', timeout: 1500, maxBuffer: 16 * 1024,
      env: { HOME: context.env.HOME || '', PATH: context.env.PATH || '', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

function inspectCommand(tool, context) {
  const { command, args } = tool.detection;
  const paths = findOnPath(command, context.env.PATH);
  if (!paths.length) return { id: tool.id, status: 'fail', reason: `${command} absent from PATH`, paths: [] };
  const output = safeRun(paths[0], args, context);
  if (output === null) return { id: tool.id, status: 'unknown', reason: 'version command failed or timed out', paths };
  const version = tool.version.value;
  const detected = output.match(/\b\d+\.\d+\.\d+\b/)?.[0] || null;
  if (!version) return { id: tool.id, status: 'unknown', reason: tool.version.reason, paths, detected };
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = new RegExp(`(?:^|[^0-9])v?${escaped}(?:$|[^0-9])`).test(output);
  return { id: tool.id, status: matches ? 'pass' : 'fail', reason: matches ? 'version matches' : `expected ${version}`, paths, detected };
}

function inspectSource(tool, context) {
  const directory = join(context.env.HOME || '', tool.installLocation.relativePath);
  const git = findOnPath('git', context.env.PATH)[0];
  if (!git) return { id: tool.id, status: 'unknown', reason: 'git absent from PATH', paths: [] };
  try { accessSync(directory); } catch { return { id: tool.id, status: 'fail', reason: 'source checkout absent', paths: [directory] }; }
  const output = safeRun(git, tool.detection.args, context, directory);
  if (!output) return { id: tool.id, status: 'unknown', reason: 'source commit could not be read', paths: [directory] };
  if (!tool.version.value) return { id: tool.id, status: 'unknown', reason: tool.version.reason, paths: [directory], detected: /^[a-f0-9]{40}$/.test(output) ? output : null };
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
  const prerequisites = [
    { id: 'homebrew', status: brew.length ? 'pass' : 'fail', detail: brew.length ? brew[0] : 'brew absent from PATH' },
    { id: 'xcode-clt', status: cltPath ? 'pass' : 'unknown', detail: cltPath || 'Xcode CLT presence unverified' },
    ...['bash', 'curl', 'jq', 'python3', 'tar', 'shasum'].map(name => {
      const found = findOnPath(name, path);
      return { id: name, status: found.length ? 'pass' : 'fail', detail: found[0] || `${name} absent from PATH` };
    }),
  ];
  const tools = selectedTools.map(tool => tool.detection.kind === 'git-head' ? inspectSource(tool, context) : inspectCommand(tool, context));
  const pathConflicts = tools.filter(tool => tool.paths.length > 1).map(tool => ({ id: tool.id, paths: tool.paths }));
  return { platform: 'darwin', arch: context.arch, supported: true, prerequisites, tools, pathConflicts };
}
