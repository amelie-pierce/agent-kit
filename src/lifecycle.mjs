import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { doctor, firstmateIssue, gitCheck } from './doctor.mjs';
import { installPlatform, atomicJson, towerPaths, systemDirs, within } from './install/macos.mjs';
import { applyUnregister, previewHooks, previewUnregister } from './install/hooks.mjs';
import { processRunning } from './update.mjs';
import { wrapperScript } from './setup.mjs';
import { envManaged, keyStatus } from './keys.mjs';
import { applyStarter, harnessOf, modeOf, planStarter, plansOf, starterRemovable } from './dispatch.mjs';
import { herdrConfigPath, placeKitExtras, planRemoveShortcuts, removeShortcuts } from './shortcuts.mjs';
import { planRemovePlugin, removePlugin } from './herdr-plugin.mjs';
import { removeClaudePlugins } from './claude-plugins.mjs';
import { ProfileChanged, planRemoveProfile, profileTarget, reconcileProfile, removeProfile, restoreProfile, saveProfileRecord } from './shell-profile.mjs';

const repo = 'amelie-pierce/agent-kit';
const sha = data => createHash('sha256').update(data).digest('hex');
const stat = path => lstatSync(path, { throwIfNoEntry: false });
const plain = path => { const s = stat(path); return s && !s.isSymbolicLink() && (s.isFile() || s.isDirectory()); };
const gitEnv = env => ({ ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
function command(file, args, { env = process.env, cwd } = {}) {
  const r = spawnSync(file, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${file} ${args[0]} failed: ${(r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`}`);
  return r.stdout.trim();
}
function rootOf(root) {
  if (!root || !isAbsolute(root)) throw new Error('use --root <absolute-root> or --install-root <absolute-kit-root>');
  const resolved = resolve(root);
  if (!stat(resolved)?.isDirectory() || stat(resolved).isSymbolicLink()) throw new Error('kit root must be a plain directory');
  return resolved;
}
function receiptAt(root) {
  const path = join(root, 'receipt.json');
  if (!stat(path)?.isFile() || stat(path).isSymbolicLink()) throw new Error('kit receipt must be a plain file');
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  if (receipt.schemaVersion !== 1 || !receipt.phases || Array.isArray(receipt.phases)) throw new Error('incompatible kit receipt');
  return { receipt, path };
}
function owned(root, entry) {
  if (typeof entry?.path !== 'string' || isAbsolute(entry.path) || entry.path.split(/[\\/]/).some(x => !x || x === '.' || x === '..')) throw new Error('unsafe owned receipt path');
  const path = resolve(root, entry.path);
  if (!path.startsWith(root + sep)) throw new Error('owned receipt path escapes kit root');
  for (let parent = dirname(path); parent !== root; parent = dirname(parent)) if (stat(parent)?.isSymbolicLink()) throw new Error(`symlink parent in kit root: ${parent}`);
  return path;
}
function phaseOwned(root, id, entry) {
  if (id === 'treehouse-root') {
    if (entry.path !== 'bin/treehouse') throw new Error('unsafe Treehouse wrapper path in receipt');
  } else if (!entry.path?.startsWith('releases/')) throw new Error(`unsafe ${id} path in receipt`);
  return owned(root, entry);
}
function towerConfig(receipt, env, home, firstmate) {
  const entry = receipt.phases['zoe-fleet-tower'];
  if (!entry) return null;
  const expected = towerPaths(env, home, firstmate, receipt.setup?.paths?.towerState).config;
  if (entry.path !== expected) throw new Error('tower config path differs from the recorded kit layout');
  return entry;
}
function digest(path) {
  const s = stat(path);
  if (!s || s.isSymbolicLink()) return null;
  if (s.isFile()) return sha(readFileSync(path));
  if (!s.isDirectory()) return null;
  const parts = [];
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const child = join(dir, name), st = stat(child), rel = relative(path, child);
      if (st.isDirectory()) walk(child);
      else if (st.isFile()) parts.push(`${rel}\0${sha(readFileSync(child))}`);
      else if (st.isSymbolicLink()) {
        const target = resolve(dirname(child), readlinkSync(child));
        if (!target.startsWith(resolve(path) + sep)) throw new Error(`escaping symlink in ${path}`);
        parts.push(`${rel}\0link:${readlinkSync(child)}`);
      } else throw new Error(`unsupported file in ${path}`);
    }
  };
  walk(path);
  return sha(parts.join('\n'));
}
function servicePlan(receipt, root, isRunning) {
  const entry = receipt.phases['no-mistakes'];
  const path = entry?.path ? phaseOwned(root, 'no-mistakes', entry) : null;
  const bin = path && digest(path) === entry.ownedSha256 ? path : null;
  const first = 'finish or stop running agents and validation runs first, because stopping Herdr or the daemon ends them; then', never = 'the kit never runs this itself';
  const checks = [['herdr', `${first} run \`herdr server stop\`; ${never}`], ['no-mistakes', `${first} run \`no-mistakes daemon stop\`; ${never}`],
    ['zoe-fleet-tower', `${first} close the Fleet pane in the Herdr Team tab (\`herdr pane close <pane-id>\`); the tower launcher has no stop command; ${never}`]];
  return checks.filter(([id]) => isRunning(id, bin)).map(([id, step]) => ({ id, step }));
}
function unresolved(components, manifest, platform, arch, reportFirstmate) {
  const key = `${platform}-${arch}`;
  const unreviewed = id => { const tool = manifest.tools.find(x => x.id === id); return !!tool && (tool.version.status !== 'verified' || tool.artifacts?.[key]?.status !== 'verified'); };
  const firstmateOk = components.some(x => x.id === 'firstmate' && ['installed', 'skipped'].includes(x.status));
  const reported = x => reportFirstmate && (x.id === 'firstmate' || (!firstmateOk && ((x.id === 'zoe-fleet-tower' && x.status === 'unverified') || (x.id === 'hooks' && x.status === 'deferred'))));
  const open = components.filter(x => ['conflict', 'deferred', 'unverified'].includes(x.status) && !(x.status === 'unverified' && unreviewed(x.id)));
  return { failed: open.filter(x => !reported(x)), nextSteps: open.filter(reported).map(x => `${x.id}: ${x.reason}`) };
}
function assertFirstmateClean(receipt, manifest) {
  const tool = manifest.tools.find(x => x.id === 'firstmate'), path = receipt.phases.firstmate?.path;
  if (!tool || typeof path !== 'string' || !isAbsolute(path)) return;
  const issue = firstmateIssue(path, receipt.phases.firstmate.version, tool.approvedUpstream, tool.version.value);
  if (issue) throw new Error(issue);
}
function assertStopped(running) {
  if (running.length) throw new Error(`kit services are running: ${running.map(x => `${x.id}: ${x.step}`).join('; ')}`);
}
function homeOf(receipt) {
  const path = receipt.setup?.paths?.firstmateHome || receipt.phases.firstmate?.path;
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Firstmate home is absent or unsafe in receipt');
  if (receipt.phases.firstmate?.path && receipt.phases.firstmate.path !== path) throw new Error('Firstmate home paths disagree in receipt');
  return resolve(path);
}
// Kit-written starter dispatch rules: repair restores them only while the key is set and nobody changed
// them, upgrade only refreshes unchanged ones, and rules the person or a strategy changed are left alone.
function starterPlan(receipt, firstmate, mode) {
  const keySet = envManaged(firstmate) && keyStatus(firstmate);
  return planStarter(firstmate, { harness: harnessOf(receipt), plans: plansOf(receipt), mode: receipt.setup?.dispatch?.template || modeOf(receipt), record: receipt.setup?.dispatch || null, restore: mode === 'repair' && (keySet || receipt.setup?.dispatch?.via === 'fm-strategy') });
}
const starterSummary = plan => plan.action === 'none' ? null : { path: plan.path, action: plan.action, ...(plan.detail ? { detail: plan.detail } : {}) };
async function reconcileStarter(root, firstmate, mode) {
  const { receipt } = receiptAt(root);
  if (!receipt.setup?.dispatch) return null;
  let result;
  // Starter rules are a convenience; a problem with them never rolls back a repair or upgrade.
  try { result = await applyStarter(starterPlan(receipt, firstmate, mode)); }
  catch (error) { return { path: join(firstmate, receipt.setup.dispatch.file || 'config/crew-dispatch.json'), action: 'skip', detail: error.message }; }
  if (result.action === 'none' || result.action === 'skip') return starterSummary(result);
  if (result.record) receipt.setup.dispatch = result.record; else delete receipt.setup.dispatch;
  await atomicJson(join(root, 'receipt.json'), receipt);
  return starterSummary(result);
}
// The figma-cli skills the kit registered that figma-cli itself reports unchanged ('up-to-date').
function figmaRemovable(root, receipt, options = {}) {
  const phase = receipt.phases['npm-figma'], paths = phase?.skills || [];
  if (!paths.length || !phase.path) return [];
  const entry = join(root, phase.path, 'node_modules', '@amelie-pierce', 'figma-cli', 'src', 'index.js');
  if (!stat(entry)) return [];
  const unchanged = new Set();
  for (const agent of ['claude', 'codex']) {
    const r = spawnSync(process.execPath, [entry, 'skills', 'status', '--agent', agent], { encoding: 'utf8', timeout: 60000, env: { HOME: options.home || process.env.HOME, PATH: process.env.PATH || '' } });
    try { for (const item of JSON.parse(r.stdout).results) if (item.status === 'up-to-date') unchanged.add(item.path); } catch { /* nothing proven unchanged */ }
  }
  return paths.filter(path => unchanged.has(path));
}
// The open-firstmate launcher and Herdr keys block follow the global registrations answer. Repair restores a
// removed block and replaces a changed launcher; upgrade refreshes both while unchanged. Like the starter
// rules, a problem here never rolls back a repair or upgrade.
async function reconcileShortcuts(root, options, repair) {
  const { receipt } = receiptAt(root);
  const env = options.env || process.env, home = options.home || env.HOME;
  let result;
  try { result = await placeKitExtras(receipt, root, { env, home, repair, check: options.herdrCheck, isRunning: () => false }); }
  catch (error) { return [`Herdr shortcuts: not updated; ${error.message}`]; }
  const lines = [];
  if (result.action !== 'not-selected') {
    const updated = receiptAt(root).receipt;
    updated.setup ||= {}; updated.setup.shortcuts = result.record;
    await atomicJson(join(root, 'receipt.json'), updated);
    lines.push(...result.lines);
  }
  const profile = await reconcileShellProfile(root, options, repair);
  lines.push(...profile);
  return profile.profileChanged ? Object.assign(lines, { profileChanged: true }) : lines.length ? lines : null;
}
// The PATH block follows the shell profile answer; like the shortcuts, a problem here never rolls back. A profile
// that changed under the kit stays untouched and is flagged so the command exits nonzero.
async function reconcileShellProfile(root, options, repair) {
  const { receipt } = receiptAt(root), env = options.env || process.env;
  let done;
  try { done = await reconcileProfile(receipt, root, { env, home: options.home || env.HOME, platform: options.platform || process.platform, repair, beforeReplace: options.beforeProfileReplace }); } catch (error) {
    if (!(error instanceof ProfileChanged)) throw error;
    return Object.assign([`Shell profile: ${error.message}`], { profileChanged: true });
  }
  if (!done) return [];
  await saveProfileRecord(root, done.record);
  return done.lines;
}
function gitState(path, env, pin) {
  if (!stat(join(path, '.git'))) return { dirty: true, reason: 'Firstmate home is not a git checkout' };
  const git = args => command('git', ['-C', path, ...args], { env: gitEnv(env) });
  try {
    const changed = git(['status', '--porcelain', '--untracked-files=all']);
    if (changed) return { dirty: true, reason: 'uncommitted or untracked Firstmate work' };
    let upstream = null;
    try { upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']); } catch { /* Initial pinned checkout has no tracking branch. */ }
    if (upstream) {
      if (Number(git(['rev-list', '--count', '@{upstream}..HEAD'])) > 0) return { dirty: true, reason: 'unpushed Firstmate commits' };
    } else if (!pin || git(['rev-parse', 'HEAD']) !== pin) return { dirty: true, reason: 'Firstmate commits differ from the reviewed pinned checkout and no upstream proves them pushed' };
    return { dirty: false };
  } catch { return { dirty: true, reason: 'cannot prove Firstmate work is landed' }; }
}
function nestedProjectWork(firstmate, env) {
  const projects = join(firstmate, 'projects');
  if (!stat(projects)) return null;
  const inspect = (dir, depth = 0) => {
    if (depth > 8) return `cannot inspect deeply nested project work in ${dir}`;
    if (stat(join(dir, '.git'))) {
      const state = gitState(dir, env, null);
      return state.dirty ? `${dir}: ${state.reason}` : null;
    }
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), st = stat(path);
      if (st?.isSymbolicLink()) return `project symlink ${path} needs manual review`;
      if (st?.isDirectory()) { const issue = inspect(path, depth + 1); if (issue) return issue; }
      else return `untracked project file ${path}`;
    }
    return null;
  };
  return inspect(projects);
}
function liveMates(path, env, detect) {
  if (detect) return detect(path);
  const r = spawnSync('ps', ['-A', '-o', 'args='], { env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  if (r.status !== 0) return true;
  return r.stdout.split('\n').some(line => line.includes(path) && /fm-spawn|--secondmate/.test(line));
}

export function planRepair(manifest, { installRoot, home, env = process.env, isRunning = processRunning } = {}) {
  const root = rootOf(installRoot), { receipt } = receiptAt(root);
  if (!home || !isAbsolute(home)) throw new Error('HOME must be absolute');
  if (receipt.pendingUpdate) throw new Error('upgrade is pending; finish or resolve it before repair');
  if (manifest.release !== receipt.release) throw new Error('repair needs the current installed release; use upgrade for a new release');
  const files = [];
  for (const [id, entry] of Object.entries(receipt.phases)) {
    if (!entry?.ownedSha256 || id === 'firstmate' || id === 'zoe-fleet-tower') continue;
    const path = phaseOwned(root, id, entry), actual = digest(path);
    files.push({ id, path, action: actual === entry.ownedSha256 ? 'verify' : actual === null ? 'restore missing' : 'backup and replace changed' });
  }
  for (const script of receipt.phases.hooks?.scripts || []) if (script.action === 'add') {
    const path = resolve(script.path);
    if (!path.startsWith(root + sep)) throw new Error('unsafe hook script path in receipt');
    const actual = digest(path);
    files.push({ id: `hook-script:${script.owner}`, path, action: actual === script.sha256 ? 'verify' : actual === null ? 'restore missing' : 'backup and replace changed' });
  }
  const kit = receipt.setup?.kit;
  if (kit?.commit) {
    const path = join(root, 'kit', kit.commit);
    let clean = false;
    if (plain(path)) try { clean = command('git', ['-C', path, 'rev-parse', 'HEAD'], { env: gitEnv(env) }) === kit.commit &&
      !command('git', ['-C', path, 'status', '--porcelain', '--untracked-files=all'], { env: gitEnv(env) }); } catch { /* report it */ }
    files.push({ id: 'kit-source', path, action: clean ? 'verify' : plain(path) ? 'backup and replace changed' : 'restore missing' });
  }
  const firstmate = homeOf(receipt);
  const fm = doctor(manifest, { installRoot: root, home, env }).checks.find(x => x.id === 'firstmate');
  let hooks = null, hookError = null;
  if (receipt.setup?.answers?.globalHooks !== false) try { hooks = previewHooks(manifest, { home, installRoot: root }); }
  catch (error) { hookError = error.message; }
  const tower = towerConfig(receipt, env, home, firstmate);
  const towerAction = !tower ? 'not installed' : !stat(tower.path) ? 'restore missing' : digest(tower.path) === tower.ownedSha256 ? 'verify' : 'backup and replace changed';
  return { command: 'repair', root, release: receipt.release, files, firstmate: { path: firstmate, status: fm?.status || 'unknown', action: 'report only' },
    hooks: hooks ? { changed: hooks.changed } : { changed: false, ...(hookError ? { note: hookError } : {}) }, tower: towerAction, running: servicePlan(receipt, root, isRunning),
    dispatch: receipt.setup?.dispatch ? starterSummary(starterPlan(receipt, firstmate, 'repair')) : null,
    note: 'Plan only. Confirmation verifies the reviewed release, privately backs up changed kit files, and restores kit registrations. Firstmate data, state, config and projects remain in place.' };
}

export async function applyRepair(manifest, options = {}) {
  const plan = planRepair(manifest, options);
  assertStopped(plan.running);
  const { receipt } = receiptAt(plan.root), backup = join(plan.root, 'backups', 'repair', randomUUID());
  for (const path of [join(plan.root, 'backups'), join(plan.root, 'backups', 'repair')]) if (stat(path) && (!stat(path).isDirectory() || stat(path).isSymbolicLink()))
    throw new Error(`${path}: expected a plain private backup directory`);
  const current = structuredClone(receipt);
  const copied = [];
  try {
    for (const file of plan.files.filter(x => x.id !== 'kit-source' && x.id !== 'treehouse-root')) {
      if (stat(file.path)) {
        const destination = join(backup, relative(plan.root, file.path));
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await rename(file.path, destination);
        copied.push({ original: file.path, backup: destination });
      }
      if (!file.id.startsWith('hook-script:')) delete receipt.phases[file.id];
    }
    const staging = join(plan.root, 'releases', plan.release, 'staging');
    if (stat(staging)) {
      const destination = join(backup, 'staging');
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await rename(staging, destination);
      copied.push({ original: staging, backup: destination });
    }
    const npmCache = join(plan.root, 'npm-cache');
    if (stat(npmCache)) {
      const destination = join(backup, 'npm-cache');
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await rename(npmCache, destination);
      copied.push({ original: npmCache, backup: destination });
    }
    const source = plan.files.find(x => x.id === 'kit-source');
    if (source) {
      if (stat(source.path)) {
        const destination = join(backup, relative(plan.root, source.path));
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await rename(source.path, destination);
        copied.push({ original: source.path, backup: destination });
      }
      const stage = await mkdtemp(join(tmpdir(), 'agent-kit-repair-'));
      try {
        const kit = join(stage, 'kit');
        await (options.fetchKit || fetchReviewed)(current.setup.kit.commit, options.env || process.env, kit);
        await mkdir(dirname(source.path), { recursive: true, mode: 0o700 });
        await rename(kit, source.path);
      } finally { await rm(stage, { recursive: true, force: true }); }
    }
    const tower = towerConfig(current, options.env || process.env, options.home, homeOf(current));
    if (tower && digest(tower.path) !== tower.ownedSha256 && stat(tower.path)) {
      const destination = join(backup, 'tower-config');
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await rename(tower.path, destination);
      copied.push({ original: tower.path, backup: destination });
    }
    await atomicJson(join(plan.root, 'receipt.json'), receipt);
    const answer = receipt.setup?.answers || {};
    const result = await installPlatform(manifest, { ...options, home: options.home, installRoot: plan.root, firstmateHome: homeOf(current),
      harness: answer.harness || 'claude', withFigma: answer.figma || false, withTower: answer.tower !== false, globalHooks: answer.globalHooks !== false,
      towerState: receipt.setup?.paths?.towerState });
    const { failed, nextSteps } = unresolved(result.components, manifest, options.platform || process.platform, options.arch || process.arch, true);
    if (failed.length) throw new Error('repair has unresolved kit components');
    const wrapper = current.phases['treehouse-root'];
    if (wrapper) {
      const path = phaseOwned(plan.root, 'treehouse-root', wrapper), actual = digest(path);
      if (actual !== wrapper.ownedSha256 && stat(path)) {
        const destination = join(backup, 'treehouse-wrapper');
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await rename(path, destination);
        copied.push({ original: path, backup: destination });
      }
      const updated = receiptAt(plan.root).receipt;
      const treehouse = updated.phases.treehouse;
      if (treehouse) {
        const body = wrapperScript(updated.setup?.paths?.treehouseRoot || dirname(plan.root), join(plan.root, treehouse.path));
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, body, { mode: 0o755 });
        updated.phases['treehouse-root'] = { ...wrapper, ownedSha256: sha(body) };
        await atomicJson(join(plan.root, 'receipt.json'), updated);
      }
    }
    for (const item of copied) {
      const file = plan.files.find(x => x.path === item.original);
      if (file?.action === 'verify' || item.original === staging || item.original === npmCache) await rm(item.backup, { recursive: true, force: true });
    }
    const dispatch = await reconcileStarter(plan.root, plan.firstmate.path, 'repair');
    const shortcuts = await reconcileShortcuts(plan.root, options, true);
    return { ...plan, apply: true, status: shortcuts?.profileChanged ? 'partial' : 'repaired', backup, components: result.components, nextSteps, dispatch, shortcuts };
  } catch (error) {
    await atomicJson(join(plan.root, 'receipt.json'), current);
    for (const item of copied.reverse()) { await rm(item.original, { recursive: true, force: true }); await rename(item.backup, item.original); }
    throw error;
  }
}

export function planUninstall({ installRoot, home, env = process.env, isRunning = processRunning, removeFirstmateHome = false, confirmHome, removeEnv = false, confirmEnv, matesRunning } = {}) {
  const root = rootOf(installRoot), { receipt } = receiptAt(root);
  if (!home || !isAbsolute(home)) throw new Error('HOME must be absolute');
  const firstmate = homeOf(receipt), registration = previewUnregister({ home, installRoot: root, receipt });
  const envPath = join(firstmate, '.env'), envFile = stat(envPath);
  if (removeEnv && !removeFirstmateHome && (confirmEnv !== envPath || (envFile && (!envFile.isFile() || envFile.isSymbolicLink() || envFile.nlink !== 1))))
    throw new Error(confirmEnv !== envPath ? `type the exact Firstmate .env path to confirm: ${envPath}` : 'unsafe .env file; refusing removal');
  const running = servicePlan(receipt, root, isRunning);
  if (removeFirstmateHome) {
    if (!receipt.phases.firstmate?.path) throw new Error('cannot prove kit ownership of the Firstmate home');
    const homeDir = resolve(home);
    if (firstmate === homeDir || firstmate === sep || within(homeDir, firstmate) || within(firstmate, root) || within(root, firstmate)
      || (systemDirs[process.platform] || systemDirs.linux)(homeDir).some(dir => within(firstmate, dir)))
      throw new Error('unsafe Firstmate home path; refusing removal');
  }
  const work = removeFirstmateHome ? gitState(firstmate, env, receipt.phases.firstmate?.version) : null;
  const projectIssue = removeFirstmateHome && !work.dirty ? nestedProjectWork(firstmate, env) : null;
  const mates = removeFirstmateHome ? liveMates(firstmate, env, matesRunning) : false;
  if (removeFirstmateHome && (confirmHome !== firstmate || work.dirty || projectIssue || mates)) throw new Error(
    confirmHome !== firstmate ? `type the exact Firstmate home path to confirm: ${firstmate}` : work.dirty ? `refusing to remove Firstmate home: ${work.reason}` : projectIssue ? `refusing to remove Firstmate home: ${projectIssue}` : 'refusing to remove Firstmate home: live second mates');
  const tower = towerConfig(receipt, env, home, firstmate);
  const wrapper = receipt.phases['treehouse-root'];
  const shellProfile = planRemoveProfile(receipt.setup?.shellProfile);
  const wrapperPath = wrapper ? phaseOwned(root, 'treehouse-root', wrapper) : null;
  return { command: 'uninstall', root, firstmate, removeFirstmateHome, removeEnv, envPath, running,
    kitPaths: ['kit', 'releases', 'npm-cache', 'cargo-home', 'empty-user.npmrc', 'empty-global.npmrc', 'receipt.json'].map(name => join(root, name)).filter(path => !!stat(path)),
    registration: { files: registration.files.filter(x => x.changes.length).map(x => x.path), skills: registration.skills.map(x => x.path),
      kept: registration.files.filter(x => x.note).map(x => `${x.path}: ${x.note}`) },
    tower: tower?.path && digest(tower.path) === tower.ownedSha256 ? { path: tower.path, action: 'remove unchanged kit config' } : { path: tower?.path || null, action: 'keep changed or absent config' },
    wrapper: wrapperPath ? { path: wrapperPath, action: digest(wrapperPath) === wrapper.ownedSha256 ? 'remove unchanged wrapper' : 'keep changed or absent wrapper' } : null,
    shortcuts: (({ launchers, keys }) => ({ launchers, keys: keys && { path: keys.path, action: keys.action } }))(planRemoveShortcuts(root, receipt.setup?.shortcuts, firstmate) || { launchers: [], keys: null }),
    shellProfile: shellProfile && { path: shellProfile.path, action: shellProfile.action },
    plugin: (p => p && { zoe: p.zoe, registry: { path: p.registry, action: p.register.action }, keys: p.keys })(planRemovePlugin(root, receipt.setup?.shortcuts?.plugin, receipt.setup?.shortcuts?.keys?.path || null)),
    dispatch: receipt.setup?.dispatch && !removeFirstmateHome ? { path: join(firstmate, receipt.setup.dispatch.file || 'config/crew-dispatch.json'),
      action: starterRemovable(firstmate, receipt.setup.dispatch) ? 'remove unchanged kit starter rules'
        : receipt.setup.dispatch.via === 'fm-strategy' ? 'keep the Firstmate strategy the kit selected; Firstmate owns its files' : 'keep rules you or a strategy changed' } : null,
    note: removeFirstmateHome ? 'Plan only. Exact path confirmation and clean-work checks authorize removing the Firstmate home, including its .env; the root, fleet state, private backups and final record stay.'
      : removeEnv ? 'Plan only. Exact path confirmation authorizes removing the Firstmate home .env; the home and other personal files stay.'
        : 'Plan only. The root, Firstmate home and its .env, projects, fleet state, private backups and final uninstall record stay. Personal prerequisites and credentials are untouched, and so is your shell profile except for the kit\'s own unchanged PATH block.' };
}

export async function applyUninstall(options = {}) {
  const plan = planUninstall(options);
  assertStopped(plan.running);
  const root = plan.root, { receipt } = receiptAt(root), preview = previewUnregister({ home: options.home, installRoot: root, receipt });
  const recordDir = join(dirname(root), 'agent-kit-uninstall'), backup = join(recordDir, 'backups', randomUUID());
  for (const path of [recordDir, join(recordDir, 'backups')]) if (stat(path) && (!stat(path).isDirectory() || stat(path).isSymbolicLink()))
    throw new Error(`${path}: expected a plain backup directory`);
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await applyUnregister(preview, join(backup, 'registration'));
  if (plan.tower.action === 'remove unchanged kit config') await rm(plan.tower.path);
  if (stat(join(root, 'backups'))) await rename(join(root, 'backups'), join(backup, 'prior-backups'));
  const wrapper = receipt.phases['treehouse-root'];
  if (wrapper) {
    const path = phaseOwned(root, 'treehouse-root', wrapper);
    if (digest(path) === wrapper.ownedSha256) await rm(path);
  }
  // Before the release moves: figma-cli's own status says which of its skills are unchanged, and only those go.
  for (const path of figmaRemovable(root, receipt, options)) await rm(path, { recursive: true, force: true });
  // Before the release moves: the plugin's own remove-keys lives there.
  const shortcuts = receipt.setup?.shortcuts;
  await removePlugin(planRemovePlugin(root, shortcuts?.plugin, shortcuts?.keys?.path || herdrConfigPath(options.env || process.env, options.home)), {
    env: { ...(options.env || process.env), HOME: options.home }, herdr: receipt.phases.herdr?.path ? join(root, receipt.phases.herdr.path) : null });
  await removeShortcuts(root, planRemoveShortcuts(root, shortcuts, plan.removeFirstmateHome ? null : plan.firstmate));
  // A profile that changes under the kit stays exactly as it is; the rest of the uninstall goes on.
  let profileKept = null;
  try { await removeProfile(root, planRemoveProfile(receipt.setup?.shellProfile), { beforeReplace: options.beforeProfileReplace }); } catch (error) {
    if (!(error instanceof ProfileChanged)) throw error;
    profileKept = { path: error.path, action: 'left untouched because it changed while the kit was removing its PATH block; save the file, then re-run the command; if uninstall has finished, remove the block yourself' };
  }
  removeClaudePlugins(shortcuts?.claudePlugins, { claude: shortcuts?.realClaude, env: options.env || process.env, home: options.home, run: options.runClaude });
  for (const name of ['kit', 'releases', 'npm-cache', 'cargo-home', 'empty-user.npmrc', 'empty-global.npmrc']) {
    const path = join(root, name);
    if (stat(path)) await rename(path, join(backup, name));
  }
  const rules = plan.removeFirstmateHome ? null : starterRemovable(plan.firstmate, receipt.setup?.dispatch);
  await rm(join(root, 'receipt.json'));
  await writeFile(join(recordDir, 'uninstall.json'), `${JSON.stringify({ at: new Date().toISOString(), release: receipt.release, root, firstmate: plan.firstmate,
    removedFirstmateHome: plan.removeFirstmateHome, removedEnv: plan.removeEnv || plan.removeFirstmateHome, removedStarterRules: !!rules, backup }, null, 2)}\n`, { mode: 0o600 });
  for (const path of [join(root, 'bin'), root]) if (stat(path)?.isDirectory() && readdirSync(path).length === 0) await rm(path, { recursive: true });
  if (plan.removeFirstmateHome) await rm(plan.firstmate, { recursive: true });
  else if (plan.removeEnv && stat(plan.envPath)) await rm(plan.envPath);
  if (rules) await rm(rules);
  return { ...plan, ...(profileKept ? { status: 'partial', shellProfile: profileKept } : {}), apply: true, backup, record: join(recordDir, 'uninstall.json') };
}

export function resolveReviewedCommit(channel, { env = process.env, gh = command } = {}) {
  if (!['releases', 'main'].includes(channel)) throw new Error('saved update channel must be releases or main');
  const endpoint = channel === 'releases' ? `repos/${repo}/commits?sha=main&path=manifests/pilot-skeleton.json&per_page=1` : `repos/${repo}/commits/main`;
  const commit = gh('gh', ['api', endpoint, '--jq', channel === 'releases' ? '.[0].sha' : '.sha'], { env });
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('GitHub returned an invalid reviewed commit');
  const relation = gh('gh', ['api', `repos/${repo}/compare/${commit}...main`, '--jq', '.status'], { env });
  if (!['ahead', 'identical'].includes(relation)) throw new Error('reviewed commit is not on main');
  return commit;
}

async function fetchReviewed(commit, env, destination) {
  const git = args => command('git', args, { env: gitEnv(env) });
  git(['init', '-q', destination]);
  git(['-C', destination, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'fetch', '-q', '--depth', '1', `https://github.com/${repo}.git`, commit]);
  git(['-C', destination, 'checkout', '-q', '--detach', 'FETCH_HEAD']);
  if (git(['-C', destination, 'rev-parse', 'HEAD']) !== commit) throw new Error('fetched kit commit mismatch');
}

export async function planUpgrade({ installRoot, home, env = process.env, platform = process.platform, arch = process.arch, nodeVersion = process.versions.node, isRunning = processRunning,
  resolveCommit = resolveReviewedCommit, fetchKit = fetchReviewed } = {}) {
  const root = rootOf(installRoot), { receipt } = receiptAt(root);
  const channel = receipt.setup?.answers?.channel || 'releases';
  const commit = resolveCommit(channel, { env });
  const stage = await mkdtemp(join(tmpdir(), 'agent-kit-upgrade-'));
  try {
    const kit = join(stage, 'kit');
    await fetchKit(commit, env, kit);
    const manifest = JSON.parse(readFileSync(join(kit, 'manifests', 'pilot-skeleton.json'), 'utf8'));
    const target = await import(pathToFileURL(join(kit, 'src', 'update.mjs')).href);
    const targetSetup = await import(pathToFileURL(join(kit, 'src', 'setup.mjs')).href);
    assertFirstmateClean(receipt, manifest);
    const diff = target.planUpdate(manifest, { installRoot: root, home, env, platform, arch, nodeVersion, reviewed: true });
    const firstmateTool = manifest.tools.find(x => x.id === 'firstmate');
    const firstmatePinChange = !!firstmateTool && firstmateTool.version.value !== receipt.phases.firstmate?.version;
    const firstmateReady = !firstmatePinChange || gitCheck(homeOf(receipt), firstmateTool.version.value, firstmateTool.approvedUpstream);
    const towerTool = manifest.tools.find(x => x.id === 'zoe-fleet');
    return { command: 'upgrade', root, channel, commit, fromCommit: receipt.setup?.kit?.commit || null, manifest, kit, stage,
      fromRelease: receipt.release, toRelease: manifest.release, changes: diff.changes, firstmate: diff.firstmateHome,
      firstmatePinChange, firstmateReady,
      towerRelease: towerTool ? { from: receipt.phases['zoe-fleet']?.version || null, to: towerTool.version.value } : null,
      newPrompts: (targetSetup.setupAnswerKeys || []).filter(key => receipt.setup?.answers?.[key] === undefined),
      running: servicePlan(receipt, root, isRunning), note: 'Plan only. After confirmation the reviewed kit and installer are staged. Kit files roll back on failure; data and state migrations do not.' };
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}

export async function applyUpgrade(plan, options = {}) {
  assertStopped(plan.running);
  const firstmateTool = plan.manifest.tools.find(x => x.id === 'firstmate');
  if (plan.firstmatePinChange && (!plan.firstmateReady || !gitCheck(plan.firstmate, firstmateTool.version.value, firstmateTool.approvedUpstream)))
    throw new Error(`Firstmate pin changed; run /updatefirstmate from ${plan.firstmate}, then rerun agent-kit upgrade`);
  const root = plan.root, { receipt } = receiptAt(root), old = structuredClone(receipt), kitTarget = join(root, 'kit', plan.commit);
  assertStopped(servicePlan(receipt, root, options.isRunning || processRunning));
  assertFirstmateClean(receipt, plan.manifest);
  if (receipt.release !== plan.fromRelease || (receipt.setup?.kit?.commit || null) !== plan.fromCommit || (receipt.setup?.answers?.channel || 'releases') !== plan.channel)
    throw new Error('kit receipt changed since the upgrade plan; rerun upgrade');
  if (plan.answers) { receipt.setup ||= {}; receipt.setup.answers = plan.answers; }
  const releaseTarget = join(root, 'releases', plan.toRelease);
  const hadRelease = !!stat(releaseTarget);
  const oldGlobal = [];
  const capture = path => {
    if (oldGlobal.some(item => item.path === path)) return;
    const st = stat(path);
    oldGlobal.push({ path, type: !st ? 'absent' : st.isSymbolicLink() ? 'link' : st.isFile() ? 'file' : 'other',
      data: st?.isFile() ? readFileSync(path) : st?.isSymbolicLink() ? readlinkSync(path) : null, mode: st?.isFile() ? st.mode & 0o7777 : null });
  };
  try {
    if (plan.answers) await atomicJson(join(root, 'receipt.json'), receipt);
    const preview = previewHooks(plan.manifest, { home: options.home, installRoot: root });
    for (const file of preview.files) capture(file.path);
    for (const skill of preview.skills) capture(skill.path);
    const tower = towerConfig(receipt, options.env || process.env, options.home, homeOf(receipt)); if (tower?.path) capture(tower.path);
    if (receipt.setup?.answers?.tower !== false) capture(towerPaths(options.env || process.env, options.home, homeOf(receipt), receipt.setup?.paths?.towerState).config);
    const wrapper = receipt.phases['treehouse-root']; if (wrapper) capture(phaseOwned(root, 'treehouse-root', wrapper));
    if (!stat(kitTarget)) { await mkdir(dirname(kitTarget), { recursive: true, mode: 0o700 }); await rename(plan.kit, kitTarget); }
    const target = await import(pathToFileURL(join(kitTarget, 'src', 'update.mjs')).href);
    for (const path of target.extrasPaths({ ...options, installRoot: root }, receipt)) capture(path);
    const result = await target.applyUpdate(plan.manifest, { ...options, installRoot: root, home: options.home, platform: options.platform || process.platform,
      arch: options.arch || process.arch, reviewed: true, isRunning: () => false, deferExtras: true });
    if (unresolved(result.components, plan.manifest, options.platform || process.platform, options.arch || process.arch, false).failed.length) throw new Error('upgrade has unresolved components; prior kit files restored');
    const updated = receiptAt(root).receipt;
    const updatedWrapper = updated.phases['treehouse-root'];
    if (updatedWrapper && updated.phases.treehouse) {
      const path = phaseOwned(root, 'treehouse-root', updatedWrapper), before = old.phases['treehouse-root'];
      if (before && digest(path) !== before.ownedSha256) throw new Error('Treehouse wrapper changed outside the kit');
      const body = wrapperScript(updated.setup?.paths?.treehouseRoot || dirname(root), join(root, updated.phases.treehouse.path));
      await writeFile(path, body, { mode: 0o755 });
      updatedWrapper.ownedSha256 = sha(body); updatedWrapper.version = plan.toRelease;
    }
    updated.setup ||= {}; updated.setup.kit = { commit: plan.commit, path: kitTarget };
    await atomicJson(join(root, 'receipt.json'), updated);
    // Past every check that rolls back: what the new kit places from here stays tracked in the receipt.
    const shortcuts = await target.placeUpdateExtras({ ...options, installRoot: root, isRunning: () => false }, homeOf(updated));
    const dispatch = await reconcileStarter(root, homeOf(updated), 'upgrade');
    return { ...plan, apply: true, status: shortcuts?.profileChanged ? 'partial' : 'upgraded', components: result.components, dispatch, shortcuts };
  } catch (error) {
    // The PATH block the new kit wrote, so the rollback can tell it from the person's own profile edits.
    let written = null;
    try { written = receiptAt(root).receipt.setup?.shellProfile || null; } catch { /* No readable receipt: any profile change counts as the person's. */ }
    const env = options.env || process.env, profile = old.setup?.shellProfile?.path || profileTarget(env, options.home || env.HOME).path, kept = [];
    await atomicJson(join(root, 'receipt.json'), old);
    for (const item of oldGlobal.reverse()) {
      if (item.type === 'other') continue;
      if (item.path === profile && item.type !== 'link') {
        const line = await restoreProfile(item.path, item.data, written, { beforeReplace: options.beforeProfileReplace });
        if (line) kept.push(line);
        continue;
      }
      await rm(item.path, { force: true });
      if (item.type === 'file') { await mkdir(dirname(item.path), { recursive: true, mode: 0o700 }); await writeFile(item.path, item.data, { mode: item.mode }); await chmod(item.path, item.mode); }
      if (item.type === 'link') await symlink(item.data, item.path);
    }
    if (!hadRelease) await rm(releaseTarget, { recursive: true, force: true });
    if (plan.commit !== old.setup?.kit?.commit) await rm(kitTarget, { recursive: true, force: true });
    if (kept.length && error instanceof Error) error.message += `; ${kept.join('; ')}`;
    throw error;
  } finally { await rm(plan.stage, { recursive: true, force: true }); }
}

export function formatLifecycle(result) {
  const lines = [`Agent Kit ${result.command}: ${result.apply ? result.status || 'complete' : 'plan only'}`];
  if (result.channel) lines.push(`Channel: ${result.channel}; reviewed kit: ${result.fromCommit || 'unknown'} -> ${result.commit}`);
  if (result.fromRelease) lines.push(`Release: ${result.fromRelease} -> ${result.toRelease}`);
  if (result.towerRelease) lines.push(`Tower release: ${result.towerRelease.from || 'absent'} -> ${result.towerRelease.to || 'unverified'}`);
  if (result.newPrompts?.length) lines.push(`New questions: ${result.newPrompts.join(', ')}`);
  for (const file of result.files || []) lines.push(`- ${file.id}: ${file.action}; ${file.path}`);
  for (const change of result.changes || []) lines.push(`- ${change.id}: ${change.from.version || 'absent'} -> ${change.to.version || 'absent'}; ${change.action}`);
  if (result.hooks) lines.push(`Hooks and skills: ${result.hooks.note || (result.hooks.changed ? 'kit registration will be refreshed' : 'already registered or not selected')}`);
  for (const path of result.registration?.files || []) lines.push(`Remove kit registration from ${path}`);
  for (const path of result.registration?.skills || []) lines.push(`Remove kit skill link ${path}`);
  for (const item of result.registration?.kept || []) lines.push(`Keep ${item}`);
  for (const path of result.kitPaths || []) lines.push(`Remove kit path (keep private backup where applicable): ${path}`);
  if (result.firstmate) lines.push(`Firstmate: ${typeof result.firstmate === 'string' ? result.firstmate : `${result.firstmate.status}; ${result.firstmate.action}; ${result.firstmate.path}`}`);
  if (result.firstmatePinChange) lines.push(`Firstmate pin: ${result.firstmateReady ? 'guarded update already verified' : 'run /updatefirstmate in the Firstmate home before applying'}`);
  if (result.tower) lines.push(`Tower config: ${typeof result.tower === 'string' ? result.tower : result.tower.action}`);
  if (result.wrapper) lines.push(`Treehouse wrapper: ${result.wrapper.action}; ${result.wrapper.path}`);
  if (result.dispatch) lines.push(`Starter dispatch rules: ${result.dispatch.action}${result.dispatch.detail ? ` (${result.dispatch.detail})` : ''}; ${result.dispatch.path}`);
  if (Array.isArray(result.shortcuts)) lines.push(...result.shortcuts);
  else if (result.shortcuts?.launchers) lines.push(...result.shortcuts.launchers.map(l => `Kit launcher: ${l.action}; ${l.path}`),
    ...(result.shortcuts.keys ? [`Herdr keys block: ${result.shortcuts.keys.action}; ${result.shortcuts.keys.path}`] : []));
  if (result.shellProfile) lines.push(`Shell profile PATH block: ${result.shellProfile.action}; ${result.shellProfile.path}`);
  if (result.plugin) lines.push(`Zoetrope plugin entry: ${result.plugin.registry.action}; ${result.plugin.registry.path}`, `Zoetrope keys: ${result.plugin.keys.action}`, `zoe wrapper: ${result.plugin.zoe.action}; ${result.plugin.zoe.path}`);
  for (const item of result.running || []) lines.push(`Running ${item.id}: ${item.step}`);
  for (const step of result.nextSteps || []) lines.push(`Next step: ${step}`);
  if (result.note) lines.push(result.note);
  if (!result.apply) lines.push(`Confirm with agent-kit ${result.command} --yes using the same root.`);
  return lines.join('\n') + '\n';
}
