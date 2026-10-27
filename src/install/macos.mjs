import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, open, rename, rm, lstat, readdir, chmod, readlink, realpath } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { applyHooks, previewHooks, publicHookChanges } from './hooks.mjs';
import { linuxIdentity } from '../platforms/linux.mjs';

const exec = promisify(execFile);
const npmIds = new Set(['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi', 'codex']);
export const npmGroup = id => id === 'codex' ? 'npm-codex' : npmIds.has(id) ? 'npm' : null;
const binaryIds = new Set(['herdr', 'treehouse', 'no-mistakes', 'shellcheck', 'actionlint']);
const sourceIds = new Set(['firstmate', 'zoe-fleet']);
const runtimeIds = new Set(['zoe-fleet-runtime']);
// Files the Zoetrope runtime's launcher contract needs (its docs/FLEET-PACKAGING.md).
const runtimeLayout = ['bin/zoe-fleet-tower', 'scripts/fleet-config.sh', 'scripts/firstmate-fleet.py', 'fleet-plugin/herdr-plugin.toml', 'fleet-plugin/open.sh', 'docs/FLEET-PACKAGING.md', 'LICENSE'];
const towerRelease = (tool, artifact) => tool.id === 'zoe-fleet' && artifact.kind === 'release-archive';
const login = {
  'github-cli': 'Run gh auth login (https://cli.github.com/manual/gh_auth_login).',
  'gh-axi': 'Use your own GitHub CLI sign-in: gh auth login (https://cli.github.com/manual/gh_auth_login).',
  'chrome-devtools-axi': 'Sign in to sites in your own browser when needed.',
  'quota-axi': 'Sign in directly with each provider before using quota-axi.',
  'no-mistakes': 'Use your own selected agent and GitHub sign-ins before running no-mistakes.',
  claude: 'Run claude and follow its sign-in flow (https://code.claude.com/docs/en/setup).',
  codex: 'Run codex login (https://developers.openai.com/codex/auth).',
  'figma-cli': 'Use the Figma CLI sign-in instructions for your own account.',
};

const sha = data => createHash('sha256').update(data).digest('hex');
const toolEnv = (home, root) => ({ HOME: home, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}`, TMPDIR: process.env.TMPDIR || '/tmp', LC_ALL: 'C',
  npm_config_cache: join(root, 'npm-cache'), npm_config_ignore_scripts: 'true',
  npm_config_userconfig: join(root, 'empty-user.npmrc'), npm_config_globalconfig: join(root, 'empty-global.npmrc'),
  npm_config_registry: 'https://registry.npmjs.org/' });
const safePart = value => /^[a-zA-Z0-9._-]+$/.test(value) && value !== '.' && value !== '..';
const ownedPath = (root, ...parts) => {
  if (!parts.every(safePart)) throw new Error('unsafe owned path');
  return join(root, ...parts);
};
const exists = async path => { try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
async function atomicJson(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(tmp, path);
}
async function hashFile(path) { return sha(await readFile(path)); }
async function hashTree(path) {
  const parts = [];
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const file = join(dir, name), st = await lstat(file), rel = relative(path, file);
      if (st.isDirectory()) await walk(file);
      else if (st.isFile()) parts.push(`${rel}\0${await hashFile(file)}`);
      else if (st.isSymbolicLink()) {
        const target = await readlink(file);
        if (!resolve(dirname(file), target).startsWith(`${resolve(path)}${sep}`)) throw new Error(`escaping symlink in owned npm tree: ${rel}`);
        parts.push(`${rel}\0link:${target}`);
      }
      else throw new Error(`unsupported file in owned npm tree: ${rel}`);
    }
  }
  await walk(path);
  return sha(parts.join('\n'));
}
async function lock(root) {
  const path = join(root, '.install.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return async () => { await rm(path, { force: true }); };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number((await readFile(path, 'utf8')).trim());
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('install lock is invalid; inspect it manually');
      try { process.kill(pid, 0); } catch (error) {
        if (error.code === 'ESRCH') { await rm(path); continue; }
      }
      throw new Error(`another install holds ${path}`);
    }
  }
  throw new Error('could not acquire install lock');
}
async function download(url, output) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 200 * 1024 * 1024) throw new Error('artifact exceeds 200 MiB limit');
    chunks.push(chunk);
  }
  await writeFile(output, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
}
function tarBinary(buffer, binary) {
  const tar = gunzipSync(buffer, { maxOutputLength: 300 * 1024 * 1024 });
  let offset = 0, match = null;
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512);
    if (h.every(byte => byte === 0)) break;
    const name = h.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = Number.parseInt(h.subarray(124, 136).toString().replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('invalid tar member');
    if (name.split('/').includes('..') || name.startsWith('/')) throw new Error('unsafe tar member');
    if (basename(name) === binary && (type === '0' || type === '\0')) {
      if (match) throw new Error(`ambiguous ${binary} in archive`);
      match = Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!match) throw new Error(`${binary} absent from archive`);
  return match;
}
function tarTree(buffer) {
  const tar = gunzipSync(buffer, { maxOutputLength: 300 * 1024 * 1024 });
  const members = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512);
    if (h.every(byte => byte === 0)) break;
    const field = (start, end) => h.subarray(start, end).toString().replace(/\0.*$/s, '');
    const size = Number.parseInt(field(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('invalid tar member');
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      if (/^\d+ (path|linkpath|size)=/m.test(body.toString('latin1'))) throw new Error('runtime archive overrides a member path');
      continue;
    }
    const name = [field(345, 500), field(0, 100)].filter(Boolean).join('/').replace(/^\.\//, '').replace(/\/$/, '');
    if (type === '5' && (name === '' || name === '.')) continue;
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('unsafe runtime archive member');
    if (type === '5') members.push({ name, directory: true });
    else if (type === '0' || type === '\0') members.push({ name, mode: Number.parseInt(field(100, 108).trim() || '0', 8) & 0o111 ? 0o755 : 0o644, data: Buffer.from(body) });
    else throw new Error(`unsupported runtime archive member: ${name}`);
  }
  return members;
}
async function unpackRuntime(archive, destination) {
  for (const member of tarTree(await readFile(archive))) {
    const path = join(destination, ...member.name.split('/'));
    if (member.directory) { await mkdir(path, { recursive: true, mode: 0o700 }); continue; }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, member.data, { mode: member.mode, flag: 'wx' });
    await chmod(path, member.mode);
  }
  for (const file of runtimeLayout) {
    if (!(await exists(join(destination, ...file.split('/'))))?.isFile()) throw new Error(`fleet runtime archive lacks ${file}; its launcher contract is not met`);
  }
}
async function unpackTrackedSource(archive, destination, freshHome = false) {
  const { stdout } = await exec('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  for (const name of stdout.split('\n').filter(Boolean)) {
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('unsafe source archive path');
    if (freshHome) {
      const parts = name.split('/').slice(1).filter(Boolean);
      if (parts.length > 1 && ['data', 'state', 'config', 'projects'].includes(parts[0])) throw new Error('source archive contains runtime home content');
      if (parts.some(part => part === '.env' || part.startsWith('.env.') || part === 'settings.local.json')) throw new Error('source archive contains local configuration');
    }
  }
  await exec('tar', ['-xzf', archive, '-C', destination, '--strip-components=1'], { maxBuffer: 65536, timeout: 120000 });
  if (!(await exists(join(destination, 'README.md')))) throw new Error('source archive has no README');
}
const gitEnv = options => ({ ...toolEnv(options.home, options.installRoot), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
const systemDirs = {
  darwin: home => ['/Applications', '/Library', '/System', '/bin', '/sbin', '/usr', '/etc', '/private/etc', '/dev', '/opt', '/cores', join(home, 'Library')],
  linux: () => ['/bin', '/sbin', '/usr', '/etc', '/dev', '/opt', '/var/lib', '/var/log', '/var/cache', '/var/spool', '/var/tmp', '/var/opt', '/proc', '/sys', '/run', '/srv', '/boot', '/lib', '/lib64'],
};
const within = (path, parent) => path === parent || path.startsWith(parent === sep ? parent : `${parent}${sep}`);
const newDirectory = async path => {
  const st = await exists(path);
  return !st || (st.isDirectory() && !st.isSymbolicLink() && (await readdir(path)).length === 0);
};
async function checkFirstmateHome(path, root, home, platform) {
  if (!path || !isAbsolute(path)) throw new Error('--firstmate-home must be an absolute path');
  const target = resolve(path);
  if (target === resolve(home)) throw new Error('--firstmate-home must not be your home directory');
  if (target === sep || systemDirs[platform](resolve(home)).some(dir => within(target, dir))) throw new Error('--firstmate-home must not be a system location');
  if (within(target, root) || within(root, target)) throw new Error('--firstmate-home must be outside --install-root');
  for (let dir = dirname(target); ; dir = dirname(dir)) {
    if (await exists(join(dir, '.git')) || await exists(join(dir, 'fm-bootstrap.sh'))) throw new Error('--firstmate-home must not be inside an existing Firstmate home or git checkout');
    if (dir === dirname(dir)) break;
  }
  return target;
}
async function checkFirstmate(entry, version, options) {
  if (typeof entry.path !== 'string' || !isAbsolute(entry.path)) throw new Error('unsafe receipt path for firstmate');
  if (!(await exists(entry.path))) return false;
  const git = async args => (await exec('git', ['--no-optional-locks', '--git-dir', join(entry.path, '.git'), '--work-tree', entry.path, ...args],
    { env: gitEnv(options), timeout: 30000, maxBuffer: 16 * 1024 * 1024 })).stdout;
  try {
    if ((await git(['rev-parse', 'HEAD'])).trim() !== version) return { conflict: `Firstmate home ${entry.path} is not at pinned commit ${version}; left unchanged` };
    const changed = (await git(['status', '--porcelain', '--untracked-files=no'])).split('\n').filter(Boolean).map(line => line.slice(3));
    if (changed.length) return { conflict: `tracked Firstmate files changed in ${entry.path}: ${changed.join(', ')}; left unchanged` };
  } catch (error) {
    return { conflict: `cannot verify Firstmate checkout in ${entry.path}: ${error.message.split('\n')[0]}; left unchanged` };
  }
  return true;
}
async function attachPinnedGit(destination, tool, options) {
  const env = gitEnv(options);
  for (const args of [
    ['init', '-q', destination],
    ['-C', destination, 'remote', 'add', 'origin', tool.approvedUpstream],
    ['-C', destination, '-c', 'credential.helper=', 'fetch', '--depth=1', 'origin', tool.version.value],
    ['-C', destination, 'checkout', '--force', '--detach', tool.version.value],
  ]) await exec('git', args, { env, timeout: 120000, maxBuffer: 65536 });
  const { stdout } = await exec('git', ['-C', destination, 'rev-parse', 'HEAD'], { env, timeout: 10000 });
  if (stdout.trim() !== tool.version.value) throw new Error('source commit mismatch');
}
async function checkReceipt(root, receipt, id, version, artifactSha, options = {}) {
  const entry = receipt.phases[id];
  if (!entry || entry.version !== version || entry.artifactSha256 !== artifactSha) return false;
  if (id === 'firstmate') return checkFirstmate(entry, version, options);
  if (options.update && !entry.path?.startsWith(`releases/${receipt.pendingUpdate || receipt.release}/`)) return false;
  const path = join(root, entry.path);
  if (!resolve(path).startsWith(`${resolve(root)}${sep}`) || entry.path.split(sep).includes('..')) throw new Error(`unsafe receipt path for ${id}`);
  const st = await exists(path);
  if (!st) return false;
  const digest = st.isDirectory() ? await hashTree(path) : st.isFile() ? await hashFile(path) : null;
  if (digest !== entry.ownedSha256) throw new Error(`kit-owned ${id} changed; refusing overwrite`);
  return true;
}
function selected(manifest, harness, withFigma) {
  return manifest.tools.filter(t => t.classification !== 'never-ship' && (t.profile === 'core' || t.profile === harness || (withFigma && t.profile === 'figma')));
}
async function npmPhase(root, release, group, manifest, receipt, save, options) {
  const base = fileURLToPath(new URL(`../../manifests/${group}/`, import.meta.url));
  const lockData = await readFile(join(base, 'package-lock.json'));
  const pkgData = await readFile(join(base, 'package.json'));
  const locked = JSON.parse(lockData);
  const packages = JSON.parse(pkgData).dependencies;
  for (const [name, value] of Object.entries(packages)) {
    const id = name === '@openai/codex' ? 'codex' : name;
    const tool = manifest.tools.find(x => x.id === id);
    if (tool?.version.value !== value) throw new Error(`manifest and npm lock disagree for ${id}`);
    if (tool.version.status !== 'verified') return { id: group, status: 'unverified', reason: `${id}: ${tool.version.reason}` };
    const item = locked.packages[`node_modules/${name}`];
    if (!item || item.version !== value || !item.integrity) throw new Error(`unlocked npm dependency: ${name}`);
  }
  for (const [name, item] of Object.entries(locked.packages)) {
    if (name && (!item.integrity || !item.resolved?.startsWith('https://registry.npmjs.org/'))) throw new Error(`unreviewed npm lock entry: ${name}`);
  }
  const id = group, lockSha = sha(lockData), target = ownedPath(root, 'releases', release, group);
  if (await checkReceipt(root, receipt, id, locked.version, lockSha, options)) {
    if (receipt.phases[id].state === 'pending') { receipt.phases[id].state = 'complete'; await save(); }
    return { id, status: 'skipped', reason: 'receipt and owned files match', packages };
  }
  if (await exists(target)) throw new Error(`${group} exists without a matching receipt`);
  const stage = ownedPath(root, 'releases', release, 'staging', `${group}-${randomUUID()}`);
  await mkdir(stage, { recursive: true, mode: 0o700 });
  await writeFile(join(stage, 'package.json'), pkgData);
  await writeFile(join(stage, 'package-lock.json'), lockData);
  const npm = options.npmCommand || 'npm';
  for (const name of ['empty-user.npmrc', 'empty-global.npmrc']) {
    const npmrc = join(root, name), npmrcState = await exists(npmrc);
    if (npmrcState && (!npmrcState.isFile() || (await readFile(npmrc)).length)) throw new Error('kit npm configuration is not an empty owned file');
    if (!npmrcState) await writeFile(npmrc, '', { flag: 'wx', mode: 0o600 });
  }
  const cacheState = await exists(join(root, 'npm-cache'));
  if (cacheState && !cacheState.isDirectory()) throw new Error('kit npm cache is not a directory');
  await (options.runNpm || (async () => exec(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: stage,
    env: toolEnv(options.home, root),
    timeout: 300000, maxBuffer: 65536,
  })))(stage, group);
  const digest = await hashTree(stage);
  receipt.phases[id] = { state: 'pending', version: locked.version, packages, artifactSha256: lockSha, path: relative(root, target), ownedSha256: digest };
  await save();
  await rename(stage, target);
  receipt.phases[id].state = 'complete';
  await save();
  return { id, status: 'installed', reason: 'npm ci from committed integrity lock; scripts disabled', packages };
}

// Mirrors the runtime launcher's lookup: XDG config and a per-home state directory named by the
// first 12 hex digits of SHA-256 over the resolved Firstmate home path.
export function towerPaths(env, home, firstmateHome) {
  const base = (key, ...fallback) => {
    if (!env[key]) return join(home, ...fallback);
    if (!isAbsolute(env[key])) throw new Error(`${key} must be an absolute path`);
    return env[key];
  };
  return { config: join(base('XDG_CONFIG_HOME', '.config'), 'zoe-fleet', 'config'),
    state: join(base('XDG_STATE_HOME', '.local', 'state'), 'zoe-fleet', sha(firstmateHome).slice(0, 12)) };
}
// The shipped launcher's own setup writes the config into a kit staging directory; the kit then
// checks that it names only this person's Firstmate home, kit-owned binaries and fresh fleet state.
async function towerPhase(root, release, firstmateHome, receipt, save, options) {
  const id = 'zoe-fleet-tower', entry = receipt.phases[id];
  const home = await realpath(firstmateHome);
  if (!(await exists(join(home, 'bin', 'fm-fleet-snapshot.sh')))?.isFile()) return { id, status: 'conflict', reason: 'Firstmate home lacks bin/fm-fleet-snapshot.sh; launcher not configured' };
  const { config, state } = towerPaths(options.env || {}, options.home, home);
  const current = await exists(config);
  if (current) {
    if (entry?.path === config && current.isFile() && await hashFile(config) === entry.ownedSha256) {
      if (!options.update || !receipt.pendingUpdate) {
        if (entry.state === 'pending') { entry.state = 'complete'; await save(); }
        return { id, status: 'skipped', reason: 'receipt and owned launcher config match' };
      }
    } else {
      return { id, status: 'conflict', reason: `${config} exists and is not the kit-owned launcher config; left unchanged` };
    }
  }
  if (entry?.fleetState !== state && !(await newDirectory(state))) return { id, status: 'conflict', reason: `fleet state ${state} is not a new empty directory; left unchanged` };
  const bin = ownedPath(root, 'releases', release, 'bin', 'zoe-fleet'), noMistakes = ownedPath(root, 'releases', release, 'bin', 'no-mistakes');
  const launcher = ownedPath(root, 'releases', release, 'zoe-fleet-runtime', 'bin', 'zoe-fleet-tower');
  const stage = ownedPath(root, 'releases', release, 'staging', `zoe-fleet-config-${randomUUID()}`);
  const created = !(await exists(state));
  let recorded = false;
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    const args = [launcher, 'setup', '--home', home, '--bin', bin, '--state', state, ...(await exists(noMistakes) ? ['--no-mistakes', noMistakes] : [])];
    await exec('bash', args, { env: { ...toolEnv(options.home, root), XDG_CONFIG_HOME: stage }, timeout: 30000, maxBuffer: 65536 });
    const body = await readFile(join(stage, 'zoe-fleet', 'config'));
    const realState = await realpath(state);
    const allowed = { FM_HOME: [home], ZOE_FLEET_BIN: [bin], ZOE_FLEET_STATE_DIR: [realState], ZOE_NO_MISTAKES_BIN: ['', noMistakes] };
    const lines = body.toString('utf8').split('\n').filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]);
    if (!lines.length || lines.some(([key, value]) => !allowed[key]?.includes(value)) || !lines.some(([key]) => key === 'FM_HOME')) throw new Error('launcher setup wrote an unexpected config');
    receipt.phases[id] = { state: 'pending', version: receipt.phases['zoe-fleet-runtime']?.version, path: config, ownedSha256: sha(body), fleetState: state };
    await save();
    recorded = true;
    await mkdir(dirname(config), { recursive: true, mode: 0o700 });
    const staged = `${config}.${randomUUID()}.tmp`;
    await writeFile(staged, body, { mode: 0o600, flag: 'wx' });
    await rename(staged, config);
    receipt.phases[id].state = 'complete';
    await save();
    return { id, status: 'installed', reason: `launcher configured for ${home} with private fleet state ${realState}` };
  } finally {
    await rm(stage, { recursive: true, force: true });
    if (created && !recorded && (await exists(state))?.isDirectory() && (await readdir(state, { recursive: true, withFileTypes: true })).every(x => x.isDirectory())) await rm(state, { recursive: true });
  }
}

export async function installPlatform(manifest, options = {}) {
  const platform = options.platform || process.platform, arch = options.arch || process.arch;
  const linux = platform === 'linux' ? linuxIdentity({ env: options.env || process.env, procVersion: options.procVersion, osRelease: options.osRelease, libc: options.libc }) : null;
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch) || (linux && (linux.libc !== 'glibc' || (linux.wsl && !linux.wsl2)))) return { status: 'unsupported', exitCode: 2, components: [], message: `unsupported install target ${platform}/${arch}${linux ? ` (${linux.libc}${linux.wsl && !linux.wsl2 ? ', WSL1' : ''})` : ''}`,
    bin: null, npmBin: null, codexBin: null, firstmateHome: null, towerParity: 'unavailable', towerLauncher: null, loginSteps: [] };
  const nodeVersion = options.nodeVersion || process.versions.node;
  const actual = nodeVersion.split('.').map(Number), minimum = manifest.nodeMinimum.split('.').map(Number);
  if (actual.some((part, index) => part !== minimum[index] && actual.slice(0, index).every((x, i) => x === minimum[i]) && part < minimum[index])) throw new Error(`Node ${manifest.nodeMinimum} or newer required`);
  if (!options.installRoot || !isAbsolute(options.installRoot)) throw new Error('--install-root must be an absolute path');
  if (!options.home || !isAbsolute(options.home)) throw new Error('HOME must be an absolute path');
  const root = resolve(options.installRoot), release = manifest.release;
  const firstmateHome = await checkFirstmateHome(options.firstmateHome, root, options.home, platform);
  if (!safePart(release)) throw new Error('unsafe release name');
  const rootState = await exists(root);
  if (rootState && (!rootState.isDirectory() || rootState.isSymbolicLink())) throw new Error('install root is not a plain directory');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const unlock = await lock(root);
  try {
    const receiptPath = join(root, 'receipt.json');
    let receipt = await exists(receiptPath) ? JSON.parse(await readFile(receiptPath, 'utf8')) : { schemaVersion: 1, release, phases: {} };
    if (receipt.schemaVersion !== 1 || (!options.update && (receipt.release !== release || receipt.pendingUpdate)) || (options.update && receipt.pendingUpdate && receipt.pendingUpdate !== release) || !receipt.phases || Array.isArray(receipt.phases)) throw new Error('incompatible receipt; refusing overwrite');
    const recordedHome = receipt.phases.firstmate?.path;
    if (recordedHome && recordedHome !== firstmateHome) throw new Error(`--firstmate-home differs from the Firstmate home recorded in the receipt (${recordedHome}); refusing to move it`);
    if (!recordedHome && !(await newDirectory(firstmateHome))) throw new Error('--firstmate-home must be a new or empty directory; refusing to inherit it');
    const save = () => atomicJson(receiptPath, receipt);
    if (options.update && receipt.release !== release) { receipt.pendingUpdate = release; await save(); }
    const components = [], targetKey = `${platform}-${arch}`;
    await mkdir(join(root, 'releases', release, 'staging'), { recursive: true, mode: 0o700 });
    for (const tool of selected(manifest, options.harness || 'claude', !!options.withFigma)) {
      if (npmIds.has(tool.id)) continue;
      const a = tool.artifacts[targetKey];
      if (tool.version.status !== 'verified' || a?.status !== 'verified') {
        components.push({ id: tool.id, status: 'unverified', reason: a?.reason || tool.version.reason || `no verified ${platform} artifact` });
        continue;
      }
      if (!binaryIds.has(tool.id) && !sourceIds.has(tool.id) && !runtimeIds.has(tool.id)) {
        components.push({ id: tool.id, status: 'unverified', reason: 'no reviewed install adapter' });
        continue;
      }
      if (options.update && tool.id === 'firstmate' && receipt.phases.firstmate?.version !== tool.version.value) {
        const verified = await checkFirstmate({ path: firstmateHome }, tool.version.value, options);
        if (verified === true) {
          receipt.phases.firstmate = { ...receipt.phases.firstmate, state: 'complete', version: tool.version.value, artifactSha256: a.sha256 };
          await save();
          components.push({ id: tool.id, status: 'skipped', reason: 'guarded Firstmate update already reached reviewed commit' });
        } else components.push({ id: tool.id, status: 'conflict', reason: `run /updatefirstmate from ${firstmateHome}, then rerun agent-kit update --yes; Firstmate must reach ${tool.version.value} without dirty or diverged tracked files` });
        continue;
      }
      const match = await checkReceipt(root, receipt, tool.id, tool.version.value, a.sha256, options);
      if (match.conflict) {
        components.push({ id: tool.id, status: 'conflict', reason: match.conflict });
        continue;
      }
      if (match) {
        if (receipt.phases[tool.id].state === 'pending') { receipt.phases[tool.id].state = 'complete'; await save(); }
        components.push({ id: tool.id, status: 'skipped', reason: 'receipt and owned files match' });
        continue;
      }
      if (options.update && (binaryIds.has(tool.id) || tool.id === 'zoe-fleet') && await options.isRunning?.(tool.id)) {
        components.push({ id: tool.id, status: 'deferred', reason: `${tool.id} is running; stop it through its own operator workflow, then rerun agent-kit update --yes` });
        continue;
      }
      const sourceTower = ownedPath(root, 'releases', release, 'zoetrope');
      if (tool.id === 'zoe-fleet' && !towerRelease(tool, a) && await exists(sourceTower)) {
        const older = receipt.phases[tool.id]?.path === relative(root, sourceTower) && receipt.phases[tool.id].version !== tool.version.value;
        components.push({ id: tool.id, status: 'conflict', reason: older ? 'older tower build present; an explicit update is needed (planned)' : 'zoetrope build exists without matching receipt; left unchanged' });
        continue;
      }
      const filename = `${tool.id}-${a.sha256}.artifact`;
      const artifactPath = ownedPath(root, 'releases', release, 'staging', filename);
      if (await exists(artifactPath)) {
        if (await hashFile(artifactPath) !== a.sha256) throw new Error(`SHA-256 mismatch for staged ${tool.id}`);
      } else {
        const pending = `${artifactPath}.${randomUUID()}.part`;
        try { await (options.fetchArtifact || download)(a.url, pending); } catch (error) {
          await rm(pending, { force: true });
          if (!['zoe-fleet', 'zoe-fleet-runtime'].includes(tool.id)) throw error;
          components.push({ id: tool.id, status: 'unverified', reason: `tower download unavailable: ${error.code || error.message}` });
          continue;
        }
        if (await hashFile(pending) !== a.sha256) { await rm(pending, { force: true }); throw new Error(`SHA-256 mismatch for ${tool.id}`); }
        await rename(pending, artifactPath);
      }
      if (binaryIds.has(tool.id) || towerRelease(tool, a)) {
        const destination = ownedPath(root, 'releases', release, 'bin', tool.id);
        if (await exists(destination)) throw new Error(`${tool.id} exists without a matching receipt`);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const body = a.url.endsWith('.tar.gz') ? tarBinary(await readFile(artifactPath), tool.id) : await readFile(artifactPath);
        const staged = `${destination}.${randomUUID()}.tmp`;
        await writeFile(staged, body, { mode: 0o755, flag: 'wx' });
        await chmod(staged, 0o755);
        receipt.phases[tool.id] = { state: 'pending', version: tool.version.value, artifactSha256: a.sha256, path: relative(root, destination), ownedSha256: sha(body) };
        await save();
        await rename(staged, destination);
        receipt.phases[tool.id].state = 'complete';
        await save();
        components.push({ id: tool.id, status: 'installed', reason: towerRelease(tool, a) ? 'verified release binary activated; no source build' : 'verified artifact activated' });
      } else if (runtimeIds.has(tool.id)) {
        const destination = ownedPath(root, 'releases', release, tool.id);
        if (await exists(destination)) throw new Error(`${tool.id} exists without a matching receipt`);
        const stage = ownedPath(root, 'releases', release, 'staging', `${tool.id}-${randomUUID()}`);
        await mkdir(stage, { recursive: true, mode: 0o700 });
        try { await unpackRuntime(artifactPath, stage); } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
        receipt.phases[tool.id] = { state: 'pending', version: tool.version.value, artifactSha256: a.sha256, path: relative(root, destination), ownedSha256: await hashTree(stage) };
        await save();
        await rename(stage, destination);
        receipt.phases[tool.id].state = 'complete';
        await save();
        components.push({ id: tool.id, status: 'installed', reason: 'verified fleet runtime archive activated' });
      } else if (tool.id === 'firstmate') {
        const destination = firstmateHome;
        if (!(await newDirectory(destination))) throw new Error('Firstmate home already exists without a matching receipt; refusing to inherit it');
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const stage = join(dirname(destination), `.${basename(destination)}.agent-kit-staging`);
        await rm(stage, { recursive: true, force: true });
        await mkdir(stage, { mode: 0o700 });
        try {
          await unpackTrackedSource(artifactPath, stage, true);
          await attachPinnedGit(stage, tool, options);
          for (const dir of ['data', 'state', 'config', 'projects']) await mkdir(join(stage, dir), { mode: 0o700 });
        } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
        receipt.phases[tool.id] = { state: 'pending', version: tool.version.value, artifactSha256: a.sha256, path: destination };
        await save();
        await rename(stage, destination);
        receipt.phases[tool.id].state = 'complete';
        await save();
        components.push({ id: tool.id, status: 'installed', reason: 'pinned tracked source and empty private runtime directories' });
      } else {
        const cargo = options.cargoCommand || 'cargo';
        const stage = ownedPath(root, 'releases', release, 'staging', `zoetrope-${randomUUID()}`);
        const target = ownedPath(root, 'releases', release, 'staging', `cargo-target-${randomUUID()}`);
        let built = false;
        try {
          await mkdir(stage, { recursive: true, mode: 0o700 });
          await unpackTrackedSource(artifactPath, stage);
          const cargoHomeState = await exists(join(root, 'cargo-home'));
          if (cargoHomeState && !cargoHomeState.isDirectory()) throw new Error('kit cargo home is not a directory');
          await (options.runCargo || (async () => exec(cargo, ['build', '--locked', '--release', '--bin', 'zoe'], {
            cwd: stage, env: { ...toolEnv(options.home, root), CARGO_HOME: join(root, 'cargo-home'), CARGO_TARGET_DIR: target },
            timeout: 900000, maxBuffer: 65536,
          })))(stage, target);
          const binary = await readFile(join(target, 'release', 'zoe'));
          const stagedBinary = join(stage, 'bin', 'zoe-fleet');
          await mkdir(dirname(stagedBinary), { recursive: true, mode: 0o700 });
          await writeFile(stagedBinary, binary, { mode: 0o755 });
          await mkdir(dirname(sourceTower), { recursive: true, mode: 0o700 });
          const digest = await hashTree(stage);
          receipt.phases[tool.id] = { state: 'pending', version: tool.version.value, artifactSha256: a.sha256, path: relative(root, sourceTower), ownedSha256: digest };
          await save();
          await rename(stage, sourceTower);
          receipt.phases[tool.id].state = 'complete';
          await save();
          components.push({ id: tool.id, status: 'installed', reason: 'pinned source built with cargo --locked' });
          built = true;
        } catch (error) {
          components.push({ id: tool.id, status: 'unverified', reason: `tower build unavailable: ${error.code || error.message}` });
        } finally { await rm(target, { recursive: true, force: true }); if (!built) await rm(stage, { recursive: true, force: true }); }
      }
      await options.afterPhase?.(tool.id);
    }
    const ok = id => components.some(x => x.id === id && ['installed', 'skipped'].includes(x.status));
    const towerBinary = ownedPath(root, 'releases', release, 'bin', 'zoe-fleet');
    const towerReleased = ok('zoe-fleet') && receipt.phases['zoe-fleet']?.path === relative(root, towerBinary);
    if (options.update && receipt.pendingUpdate && components.some(x => x.id === 'zoe-fleet' && x.status === 'deferred')) {
      components.push({ id: 'zoe-fleet-tower', status: 'deferred', reason: 'tower launcher config waits for the running tower to stop; rerun agent-kit update --yes' });
    } else if (ok('zoe-fleet-runtime')) {
      if (!towerReleased || !ok('firstmate')) components.push({ id: 'zoe-fleet-tower', status: 'unverified', reason: 'launcher not configured: needs the Firstmate home and the zoe-fleet release binary installed' });
      else {
        try { components.push(await towerPhase(root, release, firstmateHome, receipt, save, options)); } catch (error) {
          components.push({ id: 'zoe-fleet-tower', status: 'conflict', reason: `launcher not configured: ${error.message.split('\n')[0]}` });
        }
      }
    }
    const coreNpm = selected(manifest, options.harness || 'claude', !!options.withFigma).some(t => npmIds.has(t.id) && t.id !== 'codex');
    if (coreNpm) components.push(await npmPhase(root, release, 'npm', manifest, receipt, save, options));
    if ((options.harness || 'claude') === 'codex') components.push(await npmPhase(root, release, 'npm-codex', manifest, receipt, save, options));
    const shouldRegister = selected(manifest, options.harness || 'claude', !!options.withFigma).some(t => npmIds.has(t.id) && t.id !== 'codex') || receipt.phases.hooks;
    let hookChanges = [];
    if (options.update && components.some(x => x.status === 'deferred' || x.status === 'conflict')) {
      components.push({ id: 'hooks', status: 'deferred', reason: 'kit hook activation waits for all dependent components; rerun agent-kit update --yes after conflicts clear' });
    } else if (shouldRegister && (components.some(x => x.id === 'npm' && ['installed', 'skipped'].includes(x.status)) || (!coreNpm && receipt.phases.hooks))) {
      try {
        const preview = previewHooks(manifest, { home: options.home, installRoot: root });
        hookChanges = publicHookChanges(preview);
        await options.onHooksPreview?.(hookChanges);
        components.push(await applyHooks(preview, { installRoot: root, receipt, save }));
      } catch (error) {
        components.push({ id: 'hooks', status: 'conflict', reason: error.message });
      }
    }
    const towerLauncher = ok('zoe-fleet-tower') ? ownedPath(root, 'releases', release, 'zoe-fleet-runtime', 'bin', 'zoe-fleet-tower') : null;
    const towerConflict = components.find(x => x.id === 'zoe-fleet' && x.status === 'conflict');
    const towerParity = towerConflict ? `conflict: ${towerConflict.reason}` : towerReleased && towerLauncher ? 'installed from verified release; hands-on acceptance pending (Zoetrope Phase B)'
      : towerReleased ? 'release binary installed; fleet runtime or launcher configuration incomplete'
        : ok('zoe-fleet') ? 'packaged but fleet manifest and launcher unverified' : 'unavailable';
    // A selected tower keeps the result partial until hands-on acceptance establishes full parity.
    if (options.update && !components.some(x => ['conflict', 'deferred'].includes(x.status))) {
      receipt.release = release;
      delete receipt.pendingUpdate;
      await save();
    }
    const incomplete = components.some(x => ['unverified', 'conflict', 'deferred'].includes(x.status)) || selected(manifest, options.harness || 'claude', !!options.withFigma).some(x => x.id === 'zoe-fleet');
    return { status: incomplete ? 'partial' : 'installed', exitCode: incomplete ? 1 : 0, components,
      receipt: receiptPath, bin: join(root, 'releases', release, 'bin'),
      npmBin: coreNpm ? join(root, 'releases', release, 'npm', 'node_modules', '.bin') : null,
      codexBin: (options.harness || 'claude') === 'codex' ? join(root, 'releases', release, 'npm-codex', 'node_modules', '.bin') : null,
      firstmateHome: components.some(x => x.id === 'firstmate' && ['installed', 'skipped'].includes(x.status)) ? firstmateHome : null,
      towerParity, towerLauncher, hookChanges,
      loginSteps: selected(manifest, options.harness || 'claude', !!options.withFigma).map(t => login[t.id]).filter(Boolean),
      nextSteps: [
        'Codex reviews new or changed hooks interactively; review and approve them yourself when prompted.',
        'no-mistakes init installs its user-level skill when you initialize your own repository.',
        ...(towerLauncher ? [`Run ${towerLauncher} doctor, then open from a Herdr pane; open links the Herdr plugin. The kit does neither.`] : []),
        ...(linux?.wsl2 ? ['Use Windows Terminal and a browser on the Windows side; run agent tools inside your WSL2 Linux distro.'] : [])] };
  } finally { await unlock(); }
}


export function formatInstall(result) {
  return [
    `Agent Kit install: ${result.status}`, ...(result.message ? [result.message] : []), ...result.components.map(x => `- ${x.id}: ${x.status}; ${x.reason}`),
    `Kit binaries: ${result.bin || 'none'}`, ...(result.npmBin ? [`npm binaries: ${result.npmBin}`] : []),
    ...(result.codexBin ? [`Codex binaries: ${result.codexBin}`] : []),
    ...(result.firstmateHome ? [`Fresh Firstmate home: ${result.firstmateHome}`] : []),
    `Tower parity: ${result.towerParity}`, ...(result.towerLauncher ? [`Tower launcher: ${result.towerLauncher}`] : []), ...result.loginSteps.map(x => `Sign in yourself: ${x}`), ...(result.nextSteps || []).map(x => `Next step: ${x}`),
  ].join('\n') + '\n';
}
