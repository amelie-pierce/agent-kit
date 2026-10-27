import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor, firstmateIssue, gitCheck } from './doctor.mjs';
import { atomicJson, installPlatform, npmGroup, selected } from './install/macos.mjs';
import { placeKitExtras } from './shortcuts.mjs';
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
  // kit from its own installed copy; a problem with them never fails the update.
  let shortcuts = null;
  if (!result.components.some(x => ['conflict', 'deferred'].includes(x.status))) {
    const root = resolve(options.installRoot), receiptPath = join(root, 'receipt.json'), kitPath = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
    try {
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      const extras = await placeKitExtras(receipt, root, { env: options.env || process.env, home: options.home, check: options.herdrCheck,
        kitPath: kitPath.startsWith(join(root, 'kit') + sep) ? kitPath : null, isRunning: options.isRunning || (id => processRunning(id, plan.noMistakesBin)) });
      if (extras.action !== 'not-selected') {
        const current = JSON.parse(readFileSync(receiptPath, 'utf8'));
        current.setup ||= {}; current.setup.shortcuts = extras.record;
        await atomicJson(receiptPath, current);
      }
      shortcuts = extras.lines;
    } catch (error) { shortcuts = [`Herdr shortcuts: not updated; ${error.message}`]; }
  }
  return { ...plan, apply: true, status: result.status, exitCode: result.exitCode, components: result.components, shortcuts,
    previousRelease: plan.fromRelease, nextSteps: result.components.filter(x => ['conflict', 'deferred'].includes(x.status)).map(x => `${x.id}: ${x.reason}`),
    note: 'Previous release binaries remain in their versioned directory. User state rollback is not promised.' };
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
