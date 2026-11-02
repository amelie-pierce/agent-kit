import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: options.timeout ?? 5000, cwd: options.cwd, env: options.env, maxBuffer: 1 << 20 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
}

// Shared libraries a Chromium or Electron build loads, as `ldd` prints them, with the package that provides each on apt, dnf and pacman systems.
// `t64` marks apt packages that gained a t64 suffix on Ubuntu 24.04 and Debian 13.
const lib = (apt, dnf, pacman, t64 = false) => ({ apt, dnf, pacman, t64 });
const nspr = lib('libnspr4', 'nspr', 'nspr'), nss = lib('libnss3', 'nss', 'nss'), atspi = lib('libatspi2.0-0', 'at-spi2-core', 'at-spi2-core', true);
const gtk = lib('libgtk-3-0', 'gtk3', 'gtk3', true), glib = lib('libglib2.0-0', 'glib2', 'glib2', true);
const packages = {
  'libnspr4.so': nspr, 'libplc4.so': nspr, 'libplds4.so': nspr,
  'libnss3.so': nss, 'libnssutil3.so': nss, 'libsmime3.so': nss, 'libssl3.so': nss,
  'libasound.so.2': lib('libasound2', 'alsa-lib', 'alsa-lib', true),
  'libatk-1.0.so.0': lib('libatk1.0-0', 'atk', 'at-spi2-core', true),
  'libatk-bridge-2.0.so.0': lib('libatk-bridge2.0-0', 'at-spi2-atk', 'at-spi2-core', true),
  'libatspi.so.0': atspi,
  'libcups.so.2': lib('libcups2', 'cups-libs', 'libcups', true),
  'libdrm.so.2': lib('libdrm2', 'libdrm', 'libdrm'),
  'libgbm.so.1': lib('libgbm1', 'mesa-libgbm', 'mesa'),
  'libxkbcommon.so.0': lib('libxkbcommon0', 'libxkbcommon', 'libxkbcommon'),
  'libX11.so.6': lib('libx11-6', 'libX11', 'libx11'),
  'libXcomposite.so.1': lib('libxcomposite1', 'libXcomposite', 'libxcomposite'),
  'libXdamage.so.1': lib('libxdamage1', 'libXdamage', 'libxdamage'),
  'libXext.so.6': lib('libxext6', 'libXext', 'libxext'),
  'libXfixes.so.3': lib('libxfixes3', 'libXfixes', 'libxfixes'),
  'libXrandr.so.2': lib('libxrandr2', 'libXrandr', 'libxrandr'),
  'libxcb.so.1': lib('libxcb1', 'libxcb', 'libxcb'),
  'libpango-1.0.so.0': lib('libpango-1.0-0', 'pango', 'pango'),
  'libcairo.so.2': lib('libcairo2', 'cairo', 'cairo'),
  'libgtk-3.so.0': gtk, 'libgdk-3.so.0': gtk,
  'libglib-2.0.so.0': glib, 'libgobject-2.0.so.0': glib, 'libgio-2.0.so.0': glib,
  'libdbus-1.so.3': lib('libdbus-1-3', 'dbus-libs', 'dbus'),
  'libexpat.so.1': lib('libexpat1', 'expat', 'expat'),
};

const aptT64 = new Set(['noble', 'oracular', 'plucky', 'questing', 'resolute', 'trixie', 'forky', 'sid']);
// Ubuntu 24.04 and Debian 13 added the t64 suffix (libasound2 became libasound2t64); derivatives such as Linux Mint name their Ubuntu base.
function usesT64(distro) {
  const codename = distro.ubuntuCodename || distro.codename;
  if (codename) return aptT64.has(codename);
  const version = parseFloat(distro.versionId);
  if (Number.isNaN(version)) return true;
  return version >= (distro.id === 'ubuntu' ? 24.04 : 13);
}

// The package manager of a distribution family and the command prefix that installs a package with it; null for a distribution the kit has no mapping for.
export function packageManager(environment) {
  const distro = environment.distro;
  if (!distro) return null;
  const ids = [distro.id, ...distro.idLike];
  if (ids.some(id => ['debian', 'ubuntu'].includes(id))) return { manager: 'apt', install: 'sudo apt-get update && sudo apt-get install -y' };
  if (ids.some(id => ['fedora', 'rhel', 'centos'].includes(id))) return { manager: 'dnf', install: 'sudo dnf install -y' };
  if (ids.includes('arch')) return { manager: 'pacman', install: 'sudo pacman -S --needed' };
  return null;
}

// The kit only prints this command; it never runs sudo. Returns null for a distribution it has no mapping for.
export function libraryCommand(environment, sonames) {
  const manager = packageManager(environment);
  if (!manager) return null;
  const names = [], unmapped = [];
  for (const soname of sonames) {
    const entry = packages[soname];
    if (!entry) { unmapped.push(soname); continue; }
    const name = manager.manager === 'apt' ? `${entry.apt}${entry.t64 && usesT64(environment.distro) ? 't64' : ''}` : entry[manager.manager];
    if (!names.includes(name)) names.push(name);
  }
  return { manager: manager.manager, packages: names, unmapped, command: names.length ? `${manager.install} ${names.join(' ')}` : null };
}

// The sonames `ldd` reports as "not found".
export function parseLddMissing(text = '') {
  return [...new Set(text.split('\n').map(line => line.match(/^\s*(\S+)\s*=>\s*not found/)?.[1]).filter(Boolean))].sort();
}

// Vendor wrappers (google-chrome, microsoft-edge, brave-browser) are shell scripts; the binary sits beside them under another name.
function lddCandidates(context, path) {
  const exists = context.exists || existsSync;
  let real = path;
  try { real = (context.realpath || realpathSync)(path); } catch { /* keep the path as given */ }
  const directory = posix.dirname(real);
  return [real, ...['chrome', 'msedge', 'brave'].map(name => posix.join(directory, name))].filter((candidate, index, all) => all.indexOf(candidate) === index && (index === 0 || exists(candidate)));
}

// Linux and WSL only: run ldd on a binary inside this distribution and list only the shared libraries it cannot find.
export function libraryReport(context, environment, path) {
  if (!['linux', 'wsl'].includes(environment.os)) return null;
  const run = context.run || runCommand;
  let output = null, binary = null, detail = 'ldd could not inspect it';
  for (const candidate of lddCandidates(context, path)) {
    const result = run('ldd', [candidate]);
    if (result.status === 0) { output = result.stdout; binary = candidate; break; }
    detail = result.error?.code === 'ENOENT' ? 'ldd is not installed' : (`${result.stderr}${result.stdout}`.trim().split('\n')[0] || detail);
  }
  if (output === null) return { status: 'unknown', binary: path, missing: [], manager: null, packages: [], unmapped: [], command: null, fallback: null, detail };
  const missing = parseLddMissing(output);
  const plan = missing.length ? libraryCommand(environment, missing) : null;
  const fallback = !missing.length || plan?.command && !plan.unmapped.length ? null
    : plan?.unmapped.length ? `No package name is known here for ${plan.unmapped.join(', ')}; find the package that provides it with apt-file search, dnf provides or pacman -F.`
      : `Install the packages that provide ${missing.join(', ')} with your distribution's package manager.`;
  return { status: missing.length ? 'missing' : 'present', binary, missing, manager: plan?.manager || null, packages: plan?.packages || [], unmapped: plan?.unmapped || [],
    command: plan?.command || null, fallback, detail: null };
}
