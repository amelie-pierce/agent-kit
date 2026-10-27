import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { findOnPath, inspectCommand, inspectInstallRoot, inspectPrerequisite, inspectShell, inspectSource, safeRun } from './macos.mjs';

function readSystem(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function detectLibc() {
  try {
    const version = execFileSync('getconf', ['GNU_LIBC_VERSION'], { encoding: 'utf8', timeout: 1500,
      env: { PATH: '/usr/bin:/bin', HOME: '', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] });
    const match = version.match(/^glibc\s+(\d+\.\d+)/);
    return match ? { libc: 'glibc', glibcVersion: match[1] } : { libc: 'unknown', glibcVersion: null };
  } catch { return { libc: 'unknown', glibcVersion: null }; }
}

export function linuxIdentity(context) {
  const env = context.env || {};
  const version = context.procVersion ?? readSystem('/proc/version');
  const release = context.osRelease ?? readSystem('/etc/os-release');
  const distro = release.match(/^PRETTY_NAME=["']?([^\n"']+)/m)?.[1]
    || release.match(/^ID=["']?([^\n"']+)/m)?.[1] || 'unknown distribution';
  const wsl = Boolean(env.WSL_INTEROP || env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(version));
  const wsl2 = wsl && Boolean(env.WSL_INTEROP || /WSL2|microsoft-standard/i.test(version));
  const kernel = context.procVersion === undefined ? readSystem('/proc/sys/kernel/osrelease') : '';
  const wsl2Kernel = wsl2 && /microsoft-standard-WSL2/i.test(`${version}\n${kernel}`);
  const detected = context.libc === undefined && process.platform === 'linux' ? detectLibc() : {};
  const libc = context.libc ?? detected.libc ?? 'unknown';
  return { distro, libc, glibcVersion: context.glibcVersion ?? detected.glibcVersion ?? null, wsl, wsl2, wsl2Kernel };
}

// Only a WSL2 kernel selects wsl2-<arch> artifacts; tools without one use their linux-<arch> artifact.
export const artifactTarget = (identity, arch) => `${identity.wsl2Kernel ? 'wsl2' : 'linux'}-${arch}`;
export const artifactFor = (tool, target) => tool.artifacts[target] ?? (target.startsWith('wsl2-') ? tool.artifacts[`linux-${target.slice(5)}`] : undefined);

// The WSL2 tower release is built against glibc 2.35 (Ubuntu 22.04).
export function towerGlibcGap(identity) {
  const [major, minor] = (identity.glibcVersion || '').split('.').map(Number);
  if (major > 2 || (major === 2 && minor >= 35)) return null;
  return `the WSL2 tower release needs Ubuntu 22.04 or newer (glibc 2.35 or newer); ${identity.glibcVersion ? `this distribution has glibc ${identity.glibcVersion}` : 'the glibc version could not be read'}. Upgrade the distribution, or rerun setup with --no-tower.`;
}

// Required on every Linux and WSL2 install: the kit's open-firstmate and Codex launchers run on python3, and the
// tower launcher doctor and Firstmate fleet snapshot need it too.
function inspectPython(context) {
  const python = findOnPath('python3', context.env.PATH || '')[0];
  const version = python && safeRun(python, ['--version'], context)?.match(/(\d+)\.(\d+)/);
  const pythonOk = version && (Number(version[1]) > 3 || (Number(version[1]) === 3 && Number(version[2]) >= 9));
  return { id: 'python3', status: pythonOk ? 'pass' : 'fail', detail: pythonOk ? `python3 ${version[1]}.${version[2]} meets 3.9`
    : `${!python ? 'python3 absent from PATH' : version ? `python3 ${version[1]}.${version[2]} is older than 3.9` : 'python3 version could not be read'}; the kit's launchers and the tower need python3 3.9 or newer. Install it yourself (Ubuntu: sudo apt install python3)` };
}
function inspectTowerTools(context) {
  const jq = findOnPath('jq', context.env.PATH || '')[0];
  const need = 'the tower launcher doctor and the Firstmate fleet snapshot need it';
  return [{ id: 'tower-jq', required: false, status: jq ? 'pass' : 'warn', detail: jq || `jq absent from PATH; ${need} (Ubuntu: sudo apt install jq)` }];
}

const browsers = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'firefox'];
const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'wezterm', 'foot', 'tilix', 'xterm'];
const windowsSide = 'Windows side, not checked from Linux';

function inspectTerminal(env, wsl2) {
  if (wsl2) return { id: 'terminal', status: 'unknown', detail: `${windowsSide}; use Windows Terminal to open your WSL2 distro.` };
  const found = terminals.flatMap(name => findOnPath(name, env.PATH || ''));
  const session = env.SSH_CONNECTION || env.SSH_TTY ? 'SSH session; the terminal runs on the client' : 'a TTY or SSH session also works';
  return { id: 'terminal', status: found.length ? 'pass' : 'unknown', detail: found.length ? found[0] : `no terminal emulator on PATH; ${session}` };
}

function inspectBrowser(env, wsl2) {
  if (wsl2) return { id: 'browser', status: 'unknown', detail: `${windowsSide}; use a browser on Windows for chrome-devtools-axi and Lavish.` };
  const found = browsers.flatMap(name => findOnPath(name, env.PATH || ''));
  return { id: 'browser', status: found.length ? 'pass' : 'warn', detail: found[0] || `no ${browsers.join(', ')} on PATH; chrome-devtools-axi and Lavish need a browser` };
}

export function inspectLinux(context, _manifest, selectedTools) {
  const identity = linuxIdentity(context);
  const platform = identity.wsl2 ? 'wsl2' : identity.wsl ? 'wsl1' : 'linux';
  const supported = ['x64', 'arm64'].includes(context.arch) && identity.libc === 'glibc' && (!identity.wsl || identity.wsl2);
  const message = !['x64', 'arm64'].includes(context.arch) ? `Linux ${context.arch} is not supported.`
    : identity.libc !== 'glibc' ? `Linux ${identity.libc} libc is not supported by the reviewed binaries.`
      : identity.wsl && !identity.wsl2 ? 'WSL1 is not supported; use WSL2.' : undefined;
  if (!supported) return { platform, arch: context.arch, supported, message, ...identity, prerequisites: [], tools: [], pathConflicts: [] };
  const path = context.env.PATH || '';
  const home = context.env.HOME || '';
  const prerequisites = [inspectShell(context.env.SHELL), inspectInstallRoot(home, context.installRoot),
    inspectTerminal(context.env, identity.wsl2), inspectBrowser(context.env, identity.wsl2),
    ...['curl', 'tar', 'unzip', 'bash', 'sh', 'sha256sum'].map(name => {
      const found = findOnPath(name, path);
      return { id: name, status: found.length ? 'pass' : 'fail', detail: found[0] || `${name} absent from PATH` };
    }), ...selectedTools.filter(tool => tool.kind === 'prerequisite').map(tool => inspectPrerequisite(tool, context)),
    inspectPython(context),
    ...(identity.wsl2Kernel && selectedTools.some(tool => tool.id === 'zoe-fleet') ? inspectTowerTools(context) : [])];
  const tools = selectedTools.filter(tool => tool.kind !== 'prerequisite').map(tool => tool.detection.kind === 'git-head' ? inspectSource(tool, context) : inspectCommand(tool, context));
  const pathConflicts = tools.filter(tool => tool.paths.length > 1).map(tool => ({ id: tool.id, paths: tool.paths }));
  return { platform, arch: context.arch, supported, ...identity, artifactTarget: artifactTarget(identity, context.arch), prerequisites, tools, pathConflicts,
    message: `${identity.distro}; ${identity.libc}${identity.wsl2 ? '; WSL2. Browser and terminal run on Windows; install tools inside the Linux distro.' : ''}` };
}
