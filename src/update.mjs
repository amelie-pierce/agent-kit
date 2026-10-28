import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor, firstmateIssue, gitCheck } from './doctor.mjs';
import { atomicJson, installPlatform, npmGroup, selected } from './install/macos.mjs';
import { herdrConfigPath, ownedFiles, placeKitExtras, shortcutInputs } from './shortcuts.mjs';
import { pluginsPath, zoeFile } from './herdr-plugin.mjs';
import { ProfileChanged, profileTarget, reconcileProfile, saveProfileRecord } from './shell-profile.mjs';
import { applyStarter, describeStarter, harnessOf, modeOf, planStarter, plansOf, strategyTakesPlans } from './dispatch.mjs';
import { validateManifest } from './kit.mjs';
import { artifactFor, artifactTarget, linuxIdentity } from './platforms/linux.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
export function reviewedCheckout() {
  const cwd = new URL('..', import.meta.url);
  const git = args => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10000, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
  const clean = git(['status', '--porcelain', '--untracked-files=normal']);
  return clean.status === 0 && !clean.stdout.trim() &&
    git(['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main']).status === 0;
}
export function planUpdate(manifest, { installRoot, home, env = process.env, platform = process.platform, arch = process.arch, harness = 'claude', withFigma = false, nodeVersion = process.versions.node, reviewed = true } = {}) {
  validateManifest(manifest);
  if (!installRoot || !isAbsolute(installRoot)) throw new Error('update requires an absolute --install-root');
  if (!home || !isAbsolute(home)) throw new Error('update requires an absolute HOME');
  if (!reviewed) throw new Error('kit checkout is not a clean commit reachable from origin/main; fetch and check out a reviewed release');
  const root = resolve(installRoot), receiptPath = join(root, 'receipt.json');
  if (!existsSync(receiptPath)) throw new Error('update requires an existing kit receipt');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.schemaVersion !== 1 || !receipt.phases || receipt.pendingUpdate && receipt.pendingUpdate !== manifest.release) throw new Error('incompatible receipt or another update is pending');
  const answers = receipt.setup?.answers || {};
  const effectiveHarness = answers.harness || (receipt.phases['npm-codex'] ? 'codex' : harness);
  const oldManifest = structuredClone(manifest);
  for (const tool of oldManifest.tools) if (tool.kind !== 'prerequisite' && receipt.phases[tool.id]?.version) tool.version.value = receipt.phases[tool.id].version;
  const health = doctor(oldManifest, { installRoot: root, home, env, nodeVersion, platform, arch });
  const firstmate = manifest.tools.find(t => t.id === 'firstmate'), firstmateEntry = receipt.phases.firstmate;
  const handedOff = !!firstmate && firstmateEntry?.version !== firstmate.version.value && typeof firstmateEntry?.path === 'string' && isAbsolute(firstmateEntry.path) &&
    gitCheck(firstmateEntry.path, firstmate.version.value, firstmate.approvedUpstream);
  const unsafe = health.checks.filter(x => x.status === 'fail' && !(handedOff && x.id === 'firstmate') && x.id !== 'hooks' && !x.id.startsWith('prerequisite-') && !x.id.endsWith('-path') && !x.id.endsWith('-pin'));
  if (unsafe.length) throw new Error((unsafe.some(x => x.id === 'firstmate') && firstmate && firstmateIssue(firstmateEntry?.path, firstmateEntry?.version, firstmate.approvedUpstream, firstmate.version.value))
    || `owned installation fails verification: ${unsafe.map(x => x.id).join(', ')}`);
  const target = platform === 'linux' ? artifactTarget(linuxIdentity({ env }), arch) : `${platform}-${arch}`;
  const changes = selected(manifest, effectiveHarness, answers.figma ?? withFigma, answers.tower ?? true).map(tool => {
    const group = npmGroup(tool.id), entry = receipt.phases[group || tool.id];
    const beforeVersion = group ? entry?.packages?.[tool.id === 'codex' ? '@openai/codex' : tool.id] || null : entry?.version || null;
    const beforeSha256 = entry?.artifactSha256 || null;
    const lock = group ? readFileSync(new URL(`../manifests/${group}/package-lock.json`, import.meta.url)) : null;
    const afterSha256 = group ? sha(lock) : artifactFor(tool, target)?.sha256 || null;
    const afterVersion = tool.version.value;
    return { id: tool.id, from: { version: beforeVersion, sha256: beforeSha256 }, to: { version: afterVersion, sha256: afterSha256 },
      action: beforeVersion === afterVersion && beforeSha256 === afterSha256 ? 'retain or stage in new release' : tool.version.status === 'verified' && afterSha256 ? 'stage and verify' : 'unverified' };
  });
  if (receipt.release === manifest.release && changes.some(x => x.action === 'stage and verify')) throw new Error('changed pins require a new manifest release name');
  return { command: 'update', fromRelease: receipt.release, toRelease: manifest.release, harness: effectiveHarness, changes,
    firstmateHome: receipt.phases.firstmate?.path || null, setup: receipt.setup || null, noMistakesBin: receipt.phases['no-mistakes']?.path ? join(root, receipt.phases['no-mistakes'].path) : null, apply: false,
    note: 'Plan only. --yes stages and activates reviewed artifacts. Previous release binaries remain for rollback; user state rollback is not promised.' };
}
export async function applyUpdate(manifest, options) {
  const plan = planUpdate(manifest, options);
  if (!plan.firstmateHome) throw new Error('Firstmate home is absent from receipt');
  const answers = plan.setup?.answers || {};
  const result = await installPlatform(manifest, { ...options, harness: plan.harness, update: true, firstmateHome: plan.firstmateHome,
    withFigma: answers.figma ?? options.withFigma, withTower: answers.tower ?? true, globalHooks: answers.globalHooks ?? true, towerState: plan.setup?.paths?.towerState,
    isRunning: options.isRunning || (id => processRunning(id, plan.noMistakesBin)) });
  // The kit's launchers, Herdr keys and session-graph plugin arrive with an upgrade too, placed by this (the new)
  // kit from its own installed copy. An upgrade defers them until it can no longer roll back.
  const shortcuts = options.deferExtras || result.components.some(x => ['conflict', 'deferred'].includes(x.status)) ? null
    : await placeUpdateExtras(options, plan.firstmateHome, plan.noMistakesBin);
  return { ...plan, apply: true, status: result.status, exitCode: shortcuts?.profileChanged ? 1 : result.exitCode, components: result.components, shortcuts,
    previousRelease: plan.fromRelease, nextSteps: result.components.filter(x => ['conflict', 'deferred'].includes(x.status)).map(x => `${x.id}: ${x.reason}`),
    note: 'Previous release binaries remain in their versioned directory. User state rollback is not promised.' };
}
const ownKit = () => fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// Every file placeUpdateExtras may write, so an upgrade that rolls back restores their previous bytes.
export function extrasPaths(options, receipt) {
  const root = resolve(options.installRoot), env = options.env || process.env, home = options.home || env.HOME, prior = receipt.setup?.shortcuts || null;
  const inputs = shortcutInputs(receipt, root, env, prior, ownKit()), firstmate = inputs.firstmateHome;
  return [...new Set([...ownedFiles(inputs, root).map(f => f.file), ...Object.keys(prior?.files || {}), zoeFile])].map(file => join(root, file))
    .concat(receipt.setup?.shellProfile?.path || profileTarget(env, home).path || [], prior?.keys?.path || herdrConfigPath(env, home), prior?.plugin?.registry || pluginsPath(env, home),
      firstmate ? [join(firstmate, '.claude', 'settings.local.json'), join(firstmate, '.git', 'info', 'exclude'), join(firstmate, 'data', 'captain-help.md')] : []);
}
// The kit extras and, for a home that now takes fm-strategy.sh --plans, the person's strategy; a problem with
// them never fails the update. Returns the lines to report, flagged profileChanged when the shell profile changed
// under the kit twice and was left untouched, which makes the command exit nonzero.
export async function placeUpdateExtras(options, firstmateHome, noMistakesBin = null) {
  const root = resolve(options.installRoot), receiptPath = join(root, 'receipt.json'), kitPath = ownKit();
  let shortcuts = null, profileChanged = null;
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const extras = await placeKitExtras(receipt, root, { env: options.env || process.env, home: options.home, check: options.herdrCheck,
      kitPath: kitPath.startsWith(join(root, 'kit') + sep) ? kitPath : null, isRunning: options.isRunning || (id => processRunning(id, noMistakesBin)) });
    if (extras.action !== 'not-selected') {
      const current = JSON.parse(readFileSync(receiptPath, 'utf8'));
      current.setup ||= {}; current.setup.shortcuts = extras.record;
      await atomicJson(receiptPath, current);
    }
    shortcuts = extras.lines;
    let profile = null;
    try {
      profile = await reconcileProfile(JSON.parse(readFileSync(receiptPath, 'utf8')), root, { env: options.env || process.env, home: options.home, platform: options.platform || process.platform, beforeReplace: options.beforeProfileReplace });
    } catch (error) {
      if (!(error instanceof ProfileChanged)) throw error;
      profileChanged = `Shell profile: ${error.message}`; shortcuts.push(profileChanged);
    }
    if (profile) { await saveProfileRecord(root, profile.record); shortcuts.push(...profile.lines); }
    // A home that now takes fm-strategy.sh --plans gets the person's strategy, as a new install does.
    const current = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (!current.setup?.dispatch && firstmateHome && strategyTakesPlans(firstmateHome)) {
      const selected = await applyStarter(planStarter(firstmateHome, { harness: harnessOf(current), plans: plansOf(current), mode: modeOf(current), create: true }));
      if (selected.record) { current.setup ||= {}; current.setup.dispatch = selected.record; await atomicJson(receiptPath, current); }
      const line = describeStarter(selected); if (line) shortcuts.push(line);
    }
  } catch (error) { shortcuts = [`Herdr shortcuts: not updated; ${error.message}`, ...(profileChanged ? [profileChanged] : [])]; }
  return profileChanged ? Object.assign(shortcuts, { profileChanged: true }) : shortcuts;
}
export function processRunning(id, noMistakesBin) {
  if (id === 'no-mistakes' && noMistakesBin) {
    const daemon = spawnSync(noMistakesBin, ['daemon', 'status'], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 });
    if (daemon.status !== 0) return true;
    if (/daemon running/i.test(daemon.stdout)) return true;
    if (!/daemon (?:stopped|not running)/i.test(daemon.stdout)) return true;
  }
  const result = spawnSync('ps', ['-A', '-o', 'args='], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return true;
  const pattern = id === 'zoe-fleet-tower' ? /(?:^|[\s/])zoe-fleet-tower(?:\s|$)/ : new RegExp(`(?:^|[\\s/])${id}(?:\\s|$)`);
  return result.stdout.split('\n').some(line => pattern.test(line.trim()));
}
export function formatUpdate(result) {
  const lines = [`Agent Kit update: ${result.fromRelease} -> ${result.toRelease}${result.apply ? ` (${result.status})` : ' (plan only)'}`];
  for (const change of result.changes) lines.push(`- ${change.id}: ${change.from.version || 'absent'} / ${change.from.sha256 || 'unknown'} -> ${change.to.version || 'unverified'} / ${change.to.sha256 || 'unverified'}; ${change.action}`);
  for (const component of result.components || []) lines.push(`- ${component.id}: ${component.status}; ${component.reason}`);
  lines.push(result.note);
  if (!result.apply) lines.push('Next step: review this diff, then run agent-kit update --yes --install-root <kit-root>.');
  for (const step of result.nextSteps || []) lines.push(`Next step: ${step}`);
  return lines.join('\n') + '\n';
}
