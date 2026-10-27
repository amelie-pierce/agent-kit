import { lstatSync } from 'node:fs';
import { machine, release } from 'node:os';
import { win32 } from 'node:path';
import { execFileSync } from 'node:child_process';

export const minimumBuild = 19041;
const services = ['WslService', 'LxssManager'];

// Case-insensitive lookup: Windows variables arrive as Path, SystemRoot, LOCALAPPDATA, and so on.
export function envValue(env = {}, name) {
  const key = Object.keys(env).find(x => x.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

// wsl.exe writes UTF-16LE unless WSL_UTF8=1; decode either without trusting the console code page.
export function decodeOutput(output) {
  if (output === null || output === undefined) return '';
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(String(output), 'utf8');
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.subarray(2).toString('utf16le');
  else {
    let oddZeros = 0;
    for (let i = 1; i < buffer.length; i += 2) if (buffer[i] === 0) oddZeros++;
    text = buffer.length > 1 && oddZeros >= Math.floor(buffer.length / 2) * 0.4 ? buffer.toString('utf16le') : buffer.toString('utf8');
  }
  return text.replace(/^\uFEFF/, '').replace(/\0/g, '').replace(/\r/g, '');
}

export function parseWslStatus(text) {
  const defaultVersion = Number(text.match(/^\s*Default Version:\s*([12])\s*$/mi)?.[1]) || null;
  const defaultDistro = text.match(/^\s*Default Distribution:\s*([A-Za-z0-9._-]+)\s*$/mi)?.[1] || null;
  return { defaultVersion, defaultDistro, vmPlatformMissing: /Virtual Machine Platform/i.test(text) };
}

// `wsl --list --quiet` prints one distribution name per line and nothing else.
export function parseWslNames(text) {
  return [...new Set(text.split('\n').map(line => line.trim()).filter(line => /^[A-Za-z0-9._-]+$/.test(line)))];
}

// Headers and state words in `wsl --list --verbose` are localized and may contain spaces, so a row is
// recognised only by a known name after the optional `*` default marker and the version digit at its end.
export function parseWslDistros({ quiet = '', running = '', verbose = '' }) {
  const names = parseWslNames(quiet), active = new Set(parseWslNames(running)), rows = new Map();
  for (const line of verbose.split('\n')) {
    const row = line.match(/^\s*(\*)?\s*(\S+)\s+(?:.*\s)?([12])\s*$/);
    if (row && names.includes(row[2]) && !rows.has(row[2])) rows.set(row[2], { version: Number(row[3]), default: Boolean(row[1]) });
  }
  return names.map(name => ({ name, state: active.has(name) ? 'Running' : 'Stopped', version: rows.get(name)?.version ?? null, default: rows.get(name)?.default ?? false }));
}

function defaultRun(command, args, env, timeout = 10000) {
  try {
    return { status: 0, stdout: execFileSync(command, args, { env, timeout, maxBuffer: 64 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ETIMEDOUT' || error.signal) return null;
    return { status: typeof error.status === 'number' ? error.status : 1, stdout: error.stdout || Buffer.alloc(0) };
  }
}

function present(path, context) {
  if (context.fileExists) return context.fileExists(path);
  try { lstatSync(path); return true; } catch { return false; }
}

export function windowsBuild(context) {
  const version = context.osRelease ?? release();
  const build = Number(version.split('.')[2]);
  return { version, build: Number.isInteger(build) ? build : null };
}

// Node may run as x64 under emulation on an Arm64 PC; WSL2 still runs the native Linux architecture.
export function nativeArch(context) {
  const env = context.env || {};
  const hint = `${context.machine ?? machine()} ${envValue(env, 'PROCESSOR_ARCHITEW6432') || ''} ${envValue(env, 'PROCESSOR_ARCHITECTURE') || ''}`;
  if (/arm64|aarch64/i.test(hint) || /^ARMv8/i.test(envValue(env, 'PROCESSOR_IDENTIFIER') || '')) return 'arm64';
  if (/x86_64|amd64|x64/i.test(hint)) return 'x64';
  return context.arch;
}

function inspectVirtualization(context, run, systemRoot) {
  const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = run(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    '$c = Get-CimInstance Win32_ComputerSystem; $p = Get-CimInstance Win32_Processor | Select-Object -First 1; "$($c.HypervisorPresent) $($p.VirtualizationFirmwareEnabled)"']);
  const [hypervisor, firmware] = decodeOutput(result?.stdout).trim().split(/\s+/);
  if (hypervisor === 'True' || firmware === 'True') return { id: 'virtualization', status: 'pass', detail: hypervisor === 'True' ? 'a hypervisor is already running' : 'virtualization is enabled in firmware' };
  if (firmware === 'False') return { id: 'virtualization', status: 'warn', detail: 'virtualization appears disabled in firmware; enable Intel VT-x or AMD-V/SVM in your PC UEFI/BIOS settings before installing WSL2' };
  return { id: 'virtualization', status: 'unknown', detail: 'virtualization state could not be read; WSL2 needs CPU virtualization enabled in firmware' };
}

function inspectTerminal(context, localAppData) {
  const alias = localAppData && win32.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe');
  const onPath = (envValue(context.env, 'PATH') || '').split(';').filter(Boolean).map(dir => win32.join(dir, 'wt.exe')).find(path => present(path, context));
  const found = onPath || (alias && present(alias, context) ? alias : null);
  return { id: 'terminal', status: found ? 'pass' : 'unknown',
    detail: found ? `Windows Terminal ${found}; open your WSL distro profile there` : 'Windows Terminal not found; install it from Microsoft Store or winget (winget install --exact --id Microsoft.WindowsTerminal) to host your WSL shell' };
}

function inspectBrowser(context) {
  const env = context.env || {};
  const bases = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map(name => envValue(env, name)).filter(Boolean);
  const find = parts => bases.map(base => win32.join(base, ...parts)).find(path => present(path, context));
  const chrome = find(['Google', 'Chrome', 'Application', 'chrome.exe']);
  if (chrome) return { id: 'browser', status: 'pass', detail: `${chrome}; chrome-devtools-axi and Lavish open the Windows browser` };
  const other = find(['Microsoft', 'Edge', 'Application', 'msedge.exe']) || find(['Mozilla Firefox', 'firefox.exe']);
  return { id: 'browser', status: other ? 'unknown' : 'warn',
    detail: other ? `Google Chrome absent; found ${other}` : 'no Windows browser found; chrome-devtools-axi and Lavish need one on the Windows side' };
}

const installStep = { id: 'install-wsl', command: 'wsl --install -d Ubuntu', admin: true, reboot: true,
  note: 'open PowerShell with Run as administrator; after the restart, open Ubuntu once to create your Linux user.' };

// Read-only: queries the service registry, `wsl --status` and `wsl --list` (--quiet, --running, --verbose). It never enables
// features, installs distributions, starts a distribution or asks for elevation.
export function inspectWindows(context, options = {}) {
  const env = context.env || {};
  const run = context.runCommand || ((command, args) => defaultRun(command, args, env));
  const systemRoot = envValue(env, 'SystemRoot') || envValue(env, 'windir') || 'C:\\Windows';
  const { version, build } = windowsBuild(context);
  const linuxArch = nativeArch(context);
  const base = { platform: 'windows', arch: context.arch, linuxArch, windowsVersion: version, build, tools: [], pathConflicts: [] };
  if (!['x64', 'arm64'].includes(linuxArch)) return { ...base, supported: false, message: `Windows ${linuxArch} is not supported; WSL2 needs an x64 or Arm64 PC.`, prerequisites: [], steps: [] };

  const prerequisites = [], steps = [];
  const buildOk = build !== null && build >= minimumBuild;
  prerequisites.push({ id: 'windows-build', status: buildOk ? 'pass' : 'fail',
    detail: buildOk ? `Windows ${version}${build >= 22000 ? ' (Windows 11)' : ''}` : `Windows ${version}; WSL2 needs Windows 10 version 2004 (build ${minimumBuild}) or newer, or Windows 11` });
  if (!buildOk) steps.push({ id: 'update-windows', command: null, admin: false, reboot: true, note: `Update Windows through Settings > Windows Update to build ${minimumBuild} or newer.` });

  const wslPath = win32.join(systemRoot, 'System32', 'wsl.exe');
  const reg = win32.join(systemRoot, 'System32', 'reg.exe');
  const service = services.find(name => run(reg, ['query', `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${name}`])?.status === 0) || null;
  const wsl = { path: present(wslPath, context) ? wslPath : null, service, defaultVersion: null, defaultDistro: null, distros: [], target: null };
  if (!wsl.path || !service) {
    prerequisites.push({ id: 'wsl', status: 'fail', detail: `WSL is not installed; run ${installStep.command} in an administrator PowerShell, then restart Windows` });
    prerequisites.push(inspectVirtualization(context, run, systemRoot));
    if (buildOk) steps.push(installStep);
  } else {
    prerequisites.push({ id: 'wsl', status: 'pass', detail: `${wslPath} (${service})` });
    const status = parseWslStatus(decodeOutput(run(wslPath, ['--status'])?.stdout));
    // Each list command exits nonzero when it has nothing to report (no distributions, none running).
    const list = args => { const result = run(wslPath, ['--list', ...args]); return result?.status === 0 ? decodeOutput(result.stdout) : ''; };
    const all = parseWslDistros({ quiet: list(['--quiet']), running: list(['--running', '--quiet']), verbose: list(['--verbose']) });
    const ignored = all.filter(d => /^docker-desktop/i.test(d.name));
    Object.assign(wsl, status, { distros: all.filter(d => !ignored.includes(d)), ignored: ignored.map(d => d.name) });
    const fallbackDefault = wsl.distros.find(d => d.default) || wsl.distros.find(d => d.name === wsl.defaultDistro) || (wsl.distros.length === 1 ? wsl.distros[0] : null);
    wsl.target = options.distro ? all.find(d => d.name === options.distro) || null : fallbackDefault;
    const target = wsl.target;

    if (wsl.vmPlatformMissing) {
      prerequisites.push({ id: 'wsl2-default', status: 'fail', detail: 'the Virtual Machine Platform component WSL2 needs is not enabled' });
      steps.push({ id: 'enable-wsl2', command: 'wsl --install --no-distribution', admin: true, reboot: true, note: 'enables the Virtual Machine Platform that WSL2 needs.' });
    } else if (target?.version === 2) {
      prerequisites.push({ id: 'wsl2-default', status: 'pass', detail: wsl.defaultVersion === 1 ? `${target.name} uses WSL2; new distributions would default to WSL1 (optional: wsl --set-default-version 2)` : `${target.name} uses WSL2` });
    } else if (wsl.defaultVersion === 1) {
      prerequisites.push({ id: 'wsl2-default', status: 'fail', detail: 'WSL1 is the default version; run wsl --set-default-version 2' });
      steps.push({ id: 'default-wsl2', command: 'wsl --set-default-version 2', admin: false, reboot: false, note: 'if it reports that WSL2 needs the Virtual Machine Platform, run wsl --install --no-distribution in an administrator PowerShell and restart Windows.' });
    } else {
      prerequisites.push({ id: 'wsl2-default', status: wsl.defaultVersion === 2 ? 'pass' : 'unknown', detail: wsl.defaultVersion === 2 ? 'WSL2 is the default version' : 'default WSL version not reported by wsl --status' });
    }

    if (options.distro && !target) {
      prerequisites.push({ id: 'wsl-distro', status: 'fail', detail: `distribution ${options.distro} is not installed` });
      steps.push({ id: 'install-distro', command: `wsl --install -d ${options.distro}`, admin: false, reboot: false, note: 'open it once afterwards to create your Linux user.' });
    } else if (!target) {
      const why = wsl.distros.length ? `no default distribution among ${wsl.distros.map(d => d.name).join(', ')}; pass --distro <name>` : 'no Linux distribution is installed';
      prerequisites.push({ id: 'wsl-distro', status: 'fail', detail: why });
      if (!wsl.distros.length) steps.push({ id: 'install-distro', command: 'wsl --install -d Ubuntu', admin: false, reboot: false, note: 'open Ubuntu once afterwards to create your Linux user.' });
    } else if (target.version === null) {
      prerequisites.push({ id: 'wsl-distro', status: 'unknown', detail: `WSL version of ${target.name} could not be read from wsl --list --verbose` });
    } else if (target.version !== 2) {
      prerequisites.push({ id: 'wsl-distro', status: 'fail', detail: `${target.name} uses WSL1; the kit needs WSL2` });
      steps.push({ id: 'convert-distro', command: `wsl --set-version ${target.name} 2`, admin: false, reboot: false, note: 'conversion can take several minutes and keeps the distribution files.' });
    } else {
      prerequisites.push({ id: 'wsl-distro', status: 'pass', detail: `${target.name} (WSL2, ${target.state})` });
    }
  }

  const localAppData = envValue(env, 'LOCALAPPDATA');
  prerequisites.push(inspectTerminal(context, localAppData), inspectBrowser(context));
  const ready = prerequisites.every(p => p.status === 'pass' || ['terminal', 'browser', 'virtualization'].includes(p.id));
  const message = ready
    ? `Windows ${version}; WSL2 distribution ${wsl.target.name} is ready. The full stack installs inside it through the Linux installer (wsl2-${linuxArch}, otherwise linux-${linuxArch} artifacts).`
    : `Windows ${version}; the full stack installs inside WSL2 through the Linux installer. Run the listed steps yourself; the kit never enables features, elevates or restarts Windows.`;
  return { ...base, supported: buildOk, ready, wsl, prerequisites, steps, artifactTarget: `wsl2-${linuxArch}`, message };
}
