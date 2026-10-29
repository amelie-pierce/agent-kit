import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { previewHooks } from './install/hooks.mjs';
import { npmGroup, towerPaths } from './install/macos.mjs';
import { inspectPlatform } from './platforms/index.mjs';
import { artifactFor } from './platforms/linux.mjs';
import { usesProfile } from './harness.mjs';
import { jevReadiness } from './dispatch.mjs';
import { shortcutsHealth } from './shortcuts.mjs';
import { herdrPathHealth } from './herdr-path.mjs';
import { foldersOf, shellHealth } from './shell-profile.mjs';
// The only Firstmate the kit installs and updates from: the owner's fork.
export const firstmateFork = 'https://github.com/pikenguyen227/firstmate';

const sha = data => createHash('sha256').update(data).digest('hex');
const status = (id, state, detail) => ({ id, status: state, detail });
const safeFile = path => {
  try { const st = lstatSync(path); return st.isFile() && !st.isSymbolicLink() ? st : null; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
function treeDigest(root) {
  const parts = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), st = lstatSync(path), rel = relative(root, path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) parts.push(`${rel}\0${sha(readFileSync(path))}`);
      else if (st.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (!resolve(dirname(path), target).startsWith(`${resolve(root)}${sep}`)) throw new Error('owned tree has escaping symlink');
        parts.push(`${rel}\0link:${target}`);
      } else throw new Error('owned tree has unsupported file');
    }
  }
  walk(root);
  return sha(parts.join('\n'));
}
function gitIn(path, ...command) {
  const args = ['--no-optional-locks', '--git-dir', join(path, '.git'), '--work-tree', path];
  const env = { HOME: dirname(path), PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  return spawnSync('git', [...args, ...command], { encoding: 'utf8', env, timeout: 30000 });
}
export function gitCheck(path, pin, origin) {
  const head = gitIn(path, 'rev-parse', 'HEAD');
  if (head.status !== 0 || head.stdout.trim() !== pin) return false;
  const changed = gitIn(path, 'status', '--porcelain', '--untracked-files=no');
  if (changed.status !== 0 || changed.stdout.trim()) return false;
  const remote = gitIn(path, 'remote', 'get-url', 'origin');
  return remote.status === 0 && remote.stdout.trim() === origin;
}
export function firstmateIssue(path, pin, origin, next = pin) {
  const st = typeof path === 'string' && existsSync(path) ? lstatSync(path) : null;
  const pins = [...new Set([pin, next].filter(Boolean))];
  if (!pin || !st?.isDirectory() || st.isSymbolicLink() || pins.some(accepted => gitCheck(path, accepted, origin))) return null;
  const tail = 'The kit will not reset the Firstmate home itself; rerun agent-kit upgrade afterwards.';
  const changed = gitIn(path, 'status', '--porcelain', '--untracked-files=no');
  if (changed.status === 0 && changed.stdout.trim())
    return `Firstmate home ${path} has uncommitted changes to tracked files. Save them elsewhere if you want to keep them, then discard them so the home is clean. ${tail}`;
  const head = gitIn(path, 'rev-parse', 'HEAD');
  if (head.status === 0 && !pins.includes(head.stdout.trim()))
    return `Firstmate home ${path} is not on the kit's pinned Firstmate commit ${pins.join(' or ')}. Return the home to commit ${pin}; Firstmate updates go through Firstmate's own /updatefirstmate path. ${tail}`;
  return `Firstmate home ${path} has an origin remote other than the approved upstream ${origin}, or its Git state cannot be read. Set origin back to ${origin} and make sure git status works in the home. ${tail}`;
}
function phasePath(root, id, entry) {
  if (typeof entry.path !== 'string') return null;
  if (id === 'firstmate' || id === 'zoe-fleet-tower') return isAbsolute(entry.path) ? entry.path : null;
  if (typeof entry.path !== 'string' || isAbsolute(entry.path) || entry.path.split(/[\\/]/).some(x => x === '..' || x === '.')) return null;
  const path = resolve(root, entry.path);
  if (!path.startsWith(`${root}${sep}`)) return null;
  let parent = root;
  for (const part of relative(root, dirname(path)).split(sep).filter(Boolean)) {
    parent = join(parent, part);
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) return null;
  }
  return path;
}
function versionAtLeast(actual, minimum) {
  const a = actual.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
export function doctor(manifest, { installRoot, home, env = process.env, herdrPath = {}, installing = false, nodeVersion = process.versions.node, platform: platformName = process.platform, arch = process.arch } = {}) {
  if (!installRoot || !isAbsolute(installRoot)) throw new Error('doctor requires an absolute --install-root');
  const root = resolve(installRoot), checks = [];
  if (existsSync(root) && (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())) throw new Error('doctor requires a plain kit root directory');
  checks.push(status('node', versionAtLeast(nodeVersion, manifest.nodeMinimum) ? 'pass' : 'fail', `requires Node ${manifest.nodeMinimum} or newer; install it yourself: ${manifest.tools.find(x => x.id === 'node')?.installDocs || 'https://nodejs.org/en/download'}`));
  const receiptPath = join(root, 'receipt.json'), receiptFile = safeFile(receiptPath);
  let recordedHarness = 'claude';
  if (receiptFile) {
    try {
      const recorded = JSON.parse(readFileSync(receiptPath, 'utf8'));
      recordedHarness = recorded.setup?.answers?.harness || (recorded.phases?.['npm-codex'] ? 'codex' : 'claude');
    }
    catch { /* The receipt validation below reports malformed JSON. */ }
  }
  const platform = inspectPlatform({ env, platform: platformName, arch, nodeVersion, installRoot: root }, manifest,
    manifest.tools.filter(tool => tool.kind === 'prerequisite' && (tool.profile === 'core' || usesProfile(recordedHarness, tool.profile) || tool.profile === 'figma')));
  for (const prerequisite of platform.prerequisites || []) if (!['terminal', 'browser', 'virtualization'].includes(prerequisite.id))
    checks.push(status(`prerequisite-${prerequisite.id}`, prerequisite.required === false && prerequisite.status !== 'pass' ? 'warn' : prerequisite.status, prerequisite.detail));
  if (!receiptFile) {
    checks.push(status('receipt', 'fail', 'kit receipt missing or not a plain file'));
    return doctorResult(checks, null, manifest, null, root);
  }
  checks.push(status('receipt-mode', (receiptFile.mode & 0o777) === 0o600 ? 'pass' : 'fail', 'receipt must be private (0600)'));
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); }
  catch { checks.push(status('receipt', 'fail', 'kit receipt is not valid JSON')); return doctorResult(checks, null, manifest, null, root); }
  if (receipt.schemaVersion !== 1 || !receipt.phases || Array.isArray(receipt.phases)) {
    checks.push(status('receipt', 'fail', 'incompatible kit receipt')); return doctorResult(checks, null, manifest, null, root);
  }
  checks.push(status('receipt', 'pass', `release ${receipt.release}`));
  if (receipt.rollback) {
    const previous = receipt.rollback;
    const path = /^[a-f0-9]{40}$/.test(previous.commit || '') ? join(root, 'kit', previous.commit, 'manifests', 'pilot-skeleton.json') : null;
    let ready = false;
    if (path && safeFile(path) && /^[a-f0-9]{40}$/.test(previous.firstmatePin || '')) try {
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      ready = manifest.release === previous.release && manifest.tools?.find(t => t.id === 'firstmate')?.version.value === previous.firstmatePin
        && previous.phases && Object.keys(previous.phases).length > 0 && Object.entries(previous.phases).every(([id, entry]) => {
          if (entry?.state !== 'complete' || !entry.path?.startsWith(`releases/${previous.release}/`) || !/^[a-f0-9]{64}$/.test(entry.ownedSha256 || '')) return false;
          const owned = phasePath(root, id, entry), st = owned && (safeFile(owned) || (existsSync(owned) ? lstatSync(owned) : null));
          return !!st && !st.isSymbolicLink() && (st.isFile() ? sha(readFileSync(owned)) : st.isDirectory() ? treeDigest(owned) : null) === entry.ownedSha256;
        });
    } catch { ready = false; }
    const fmHome = receipt.phases.firstmate?.path, currentPin = receipt.phases.firstmate?.version, origin = manifest.tools.find(t => t.id === 'firstmate')?.approvedUpstream;
    ready = ready && typeof fmHome === 'string' && gitCheck(fmHome, currentPin, origin) && gitIn(fmHome, 'symbolic-ref', '-q', 'HEAD').status !== 0
      && gitIn(fmHome, 'cat-file', '-e', `${previous.firstmatePin}^{commit}`).status === 0
      && gitIn(fmHome, 'merge-base', '--is-ancestor', previous.firstmatePin, currentPin).status === 0;
    checks.push(status('rollback-release', ready ? 'pass' : 'warn', ready ? `recorded ${previous.release} files and clean detached Firstmate checkout are ready for guarded rollback` : 'recorded prior kit files or clean detached Firstmate checkout are unavailable for rollback'));
  }
  const byId = new Map(manifest.tools.map(t => [t.id, t]));
  for (const [id, entry] of Object.entries(receipt.phases)) {
    if (id === 'hooks') continue;
    if (!byId.has(id) && !['npm', 'npm-codex', 'npm-figma', 'zoe-fleet-tower', 'treehouse-root'].includes(id)) { checks.push(status(id, 'fail', 'unknown receipt phase')); continue; }
    const path = phasePath(root, id, entry);
    if (!path) { checks.push(status(id, 'fail', 'unsafe receipt path')); continue; }
    if (id === 'zoe-fleet-tower') {
      const firstmateHome = receipt.phases.firstmate?.path;
      if (!firstmateHome || path !== towerPaths(env, home || env.HOME, firstmateHome).config) { checks.push(status(id, 'fail', 'launcher config path is not the expected kit location')); continue; }
    }
    const st = safeFile(path) || (existsSync(path) ? lstatSync(path) : null);
    if (!st || st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) { checks.push(status(id, 'fail', 'kit-owned location missing or unsafe')); continue; }
    if (id === 'firstmate') {
      const pin = byId.get(id)?.version.value;
      const matched = pin && entry.version === pin && gitCheck(path, pin, byId.get(id)?.approvedUpstream);
      checks.push(status(id, matched ? 'pass' : 'fail', matched ? 'pinned HEAD, origin and tracked source verified' : 'Firstmate commit, origin or tracked source differs from pin'));
      for (const dir of ['bin', 'data', 'state', 'config', 'projects']) checks.push(status(`firstmate-layout-${dir}`, existsSync(join(path, dir)) && lstatSync(join(path, dir)).isDirectory() ? 'pass' : 'fail', `Firstmate ${dir}/ directory`));
      continue;
    }
    let digest;
    try { digest = st.isFile() ? sha(readFileSync(path)) : treeDigest(path); }
    catch { checks.push(status(id, 'fail', 'kit-owned content cannot be verified')); continue; }
    checks.push(status(id, digest === entry.ownedSha256 ? 'pass' : 'fail', digest === entry.ownedSha256 ? `installed ${entry.version || ''}; owned digest verified` : 'kit-owned digest differs from receipt'));
    const tool = byId.get(id);
    if (tool?.kind !== 'prerequisite' && tool && tool.version.value !== entry.version) checks.push(status(`${id}-pin`, 'unknown', `installed ${entry.version}; reviewed checkout pins ${tool.version.value || 'unverified'}`));
    if (tool?.kind !== 'prerequisite' && tool) checks.push(status(`${id}-origin`, entry.artifactSha256 === artifactFor(tool, platform.artifactTarget || `${platformName}-${arch}`)?.sha256 ? 'pass' : 'unknown', 'artifact digest compared with reviewed manifest origin'));
    if (id === 'npm' || id === 'npm-codex' || id === 'npm-figma') {
      const lock = readFileSync(new URL(`../manifests/${id}/package-lock.json`, import.meta.url));
      checks.push(status(`${id}-origin`, entry.artifactSha256 === sha(lock) ? 'pass' : 'unknown', 'npm lock digest compared with reviewed registry origin'));
    }
    if (id === 'zoe-fleet-tower') checks.push(status('launcher-mode', (st.mode & 0o777) === 0o600 ? 'pass' : 'fail', 'launcher config must be private (0600)'));
    if (st.isFile() && ['herdr', 'treehouse', 'no-mistakes', 'shellcheck', 'actionlint', 'zoe-fleet'].includes(id)) {
      const found = (env.PATH || '').split(delimiter).map(dir => join(dir, basename(path))).find(p => existsSync(p));
      // The kit's Treehouse wrapper, which pins the pool under the setup root, counts as the kit binary.
      const wrapper = id === 'treehouse' && receipt.phases['treehouse-root'] ? phasePath(root, 'treehouse-root', receipt.phases['treehouse-root']) : null;
      let same = false;
      try { same = !!found && [path, wrapper].filter(Boolean).some(owned => existsSync(owned) && realpathSync(found) === realpathSync(owned)); } catch { /* broken path fails precedence */ }
      checks.push(status(`${id}-path`, !found ? 'unknown' : same ? 'pass' : 'fail', !found ? 'not on PATH' : same ? 'kit binary has PATH precedence' : 'another binary has PATH precedence'));
    }
  }
  for (const tool of manifest.tools) {
    const group = npmGroup(tool.id);
    if (!group || !receipt.phases[group]) continue;
    const base = phasePath(root, group, receipt.phases[group]);
    if (!base) continue;
    const expected = join(base, 'node_modules', '.bin', tool.id);
    if (!existsSync(expected)) { checks.push(status(`${tool.id}-path`, 'fail', 'kit npm binary missing')); continue; }
    const found = (env.PATH || '').split(delimiter).map(dir => join(dir, tool.id)).find(p => existsSync(p));
    let same = false;
    try { same = !!found && realpathSync(found) === realpathSync(expected); } catch { /* broken path is a failed precedence check */ }
    // The kit's own launcher for that tool (the full-access codex) wraps the pinned binary, so it may come first.
    const kitLauncher = !!found && found === join(root, 'bin', tool.id) && !!receipt.setup?.shortcuts?.files?.[`bin/${tool.id}`];
    checks.push(status(`${tool.id}-path`, !found ? 'unknown' : same || kitLauncher ? 'pass' : 'fail', !found ? 'not on PATH' : same ? 'kit npm binary has PATH precedence'
      : kitLauncher ? 'the kit launcher in front of the pinned binary has PATH precedence' : 'another binary has PATH precedence'));
  }
  if (receipt.phases.hooks) {
    try {
      const preview = previewHooks({ ...manifest, release: receipt.release }, { home: home || env.HOME, installRoot: root });
      const changed = preview.files.some(f => f.changes.length) || preview.skills.length || preview.scripts.length;
      checks.push(status('hooks', changed ? 'fail' : 'pass', changed ? 'kit hook markers or skill targets differ' : 'kit hook markers and skill targets intact'));
    } catch { checks.push(status('hooks', 'fail', 'hook ownership cannot be verified')); }
  } else checks.push(status('hooks', 'unknown', 'global hooks not recorded in receipt'));
  const jevHome = receipt.setup?.paths?.firstmateHome || receipt.phases.firstmate?.path;
  if (typeof jevHome === 'string' && isAbsolute(jevHome)) {
    // Optional Jev routing: a warning, never a failure, and only set / not set about the key.
    const jev = jevReadiness(jevHome, env);
    checks.push(status('jev', jev.ready ? 'pass' : 'warn', jev.ready ? 'ready (key set, rules present)' : `not ready: ${jev.reasons.join('; ')}`));
  }
  const firstmateTool = manifest.tools.find(t => t.id === 'firstmate'), fmHome = receipt.phases.firstmate?.path;
  if (firstmateTool && typeof fmHome === 'string' && isAbsolute(fmHome) && existsSync(join(fmHome, '.git'))) {
    // Updates come from the home's origin (Firstmate's /updatefirstmate fast-forwards from it): it must be the approved fork.
    const origin = gitIn(fmHome, 'remote', 'get-url', 'origin').stdout?.trim();
    const fork = origin === firstmateTool.approvedUpstream && firstmateTool.approvedUpstream === firstmateFork;
    checks.push(status('firstmate-fork', fork ? 'pass' : 'warn', fork ? `firstmate origin: ${origin} (approved fork)` : `firstmate origin: ${origin || 'unreadable'}; expected the approved fork ${firstmateFork}`));
  }
  checks.push(...shortcutsHealth(receipt, root));
  checks.push(...shellHealth(receipt, root, { env, platform: platformName, installing }));
  checks.push(herdrPathHealth(foldersOf(receipt, root), { platform: platformName, ...herdrPath }));
  for (const path of receipt.phases['npm-figma']?.skills || []) {
    let owner = null;
    try { owner = JSON.parse(readFileSync(join(path, '.figma-cli-skill.json'), 'utf8')).owner; } catch { /* reported */ }
    checks.push(status(`figma-skill-${path.split('/').slice(-3).join('-')}`, owner === 'amelie-pierce/figma-cli' ? 'pass' : 'warn',
      owner === 'amelie-pierce/figma-cli' ? `${path} registered by figma-cli` : `${path} missing or not figma-cli's; agent-kit repair registers it again`));
  }
  checks.push(status('authenticated', 'unknown', 'sign-in belongs to this teammate; no auth store queried'));
  checks.push(status('live-tested', 'unknown', 'live fleet was not probed'));
  return doctorResult(checks, receipt.release, manifest, receipt, root);
}
function doctorResult(checks, release, manifest, receipt, root) {
  const find = id => checks.find(x => x.id === id)?.status || 'unknown';
  const components = manifest.tools.filter(t => t.kind !== 'prerequisite' && t.classification !== 'never-ship').map(tool => {
    const phaseId = npmGroup(tool.id) || tool.id;
    const entry = receipt?.phases?.[phaseId], path = entry && phasePath(root, phaseId, entry);
    const installed = path && existsSync(path) ? 'pass' : 'unknown';
    const verifiedDigest = find(phaseId);
    const configured = tool.id === 'firstmate' ? ['bin', 'data', 'state', 'config', 'projects'].every(dir => find(`firstmate-layout-${dir}`) === 'pass') ? 'pass' : 'fail'
      : ['herdr', 'gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'tasks-axi'].includes(tool.id) ? find('hooks') : 'unknown';
    return { id: tool.id, installed, verifiedDigest, configured, authenticated: 'unknown', liveTested: 'unknown' };
  });
  return { command: 'doctor', release, checks, components, exitCode: checks.some(x => x.status === 'fail') ? 1 : 0, readOnly: true };
}
export function formatDoctor(result) {
  return [`Agent Kit doctor: ${result.exitCode ? 'fail' : 'pass'}${result.release ? ` (${result.release})` : ''}`,
    ...result.components.map(x => `- ${x.id}: installed ${x.installed}; verified digest ${x.verifiedDigest}; configured ${x.configured}; authenticated unknown; live tested unknown`),
    ...result.checks.map(x => `${x.status.toUpperCase()} ${x.id}: ${x.detail}`)].join('\n') + '\n';
}
