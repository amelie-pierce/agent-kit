import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { findOnPath, inspectCommand, inspectInstallRoot, inspectShell, inspectSource } from './macos.mjs';

function readSystem(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function detectLibc() {
  try {
    const version = execFileSync('getconf', ['GNU_LIBC_VERSION'], { encoding: 'utf8', timeout: 1500,
      env: { PATH: '/usr/bin:/bin', HOME: '', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] });
    return /^glibc\s+\d/.test(version) ? 'glibc' : 'unknown';
  } catch { return 'unknown'; }
}

export function linuxIdentity(context) {
  const env = context.env || {};
  const version = context.procVersion ?? readSystem('/proc/version');
  const release = context.osRelease ?? readSystem('/etc/os-release');
  const distro = release.match(/^PRETTY_NAME=["']?([^\n"']+)/m)?.[1]
    || release.match(/^ID=["']?([^\n"']+)/m)?.[1] || 'unknown distribution';
  const wsl = Boolean(env.WSL_INTEROP || env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(version));
  const wsl2 = wsl && Boolean(env.WSL_INTEROP || /WSL2|microsoft-standard/i.test(version));
  const libc = context.libc ?? (process.platform === 'linux' ? detectLibc() : 'unknown');
  return { distro, libc, wsl, wsl2 };
}

export function inspectLinux(context, _manifest, selectedTools) {
  const identity = linuxIdentity(context);
  const platform = identity.wsl ? 'wsl2' : 'linux';
  const supported = ['x64', 'arm64'].includes(context.arch) && identity.libc === 'glibc' && (!identity.wsl || identity.wsl2);
  const message = !['x64', 'arm64'].includes(context.arch) ? `Linux ${context.arch} is not supported.`
    : identity.libc !== 'glibc' ? `Linux ${identity.libc} libc is not supported by the reviewed binaries.`
      : identity.wsl && !identity.wsl2 ? 'WSL1 is not supported; use WSL2.' : undefined;
  if (!supported) return { platform, arch: context.arch, supported, message, ...identity, prerequisites: [], tools: [], pathConflicts: [] };
  const path = context.env.PATH || '';
  const home = context.env.HOME || '';
  const prerequisites = [inspectShell(context.env.SHELL), inspectInstallRoot(home, context.installRoot),
    ...['git', 'curl', 'tar', 'unzip', 'bash', 'sh', 'sha256sum'].map(name => {
      const found = findOnPath(name, path);
      return { id: name, status: found.length ? 'pass' : 'fail', detail: found[0] || `${name} absent from PATH` };
    })];
  const tools = selectedTools.map(tool => tool.detection.kind === 'git-head' ? inspectSource(tool, context) : inspectCommand(tool, context));
  const pathConflicts = tools.filter(tool => tool.paths.length > 1).map(tool => ({ id: tool.id, paths: tool.paths }));
  return { platform, arch: context.arch, supported, ...identity, prerequisites, tools, pathConflicts,
    message: `${identity.distro}; ${identity.libc}${identity.wsl2 ? '; WSL2. Browser and terminal run on Windows; install tools inside the Linux distro.' : ''}` };
}
