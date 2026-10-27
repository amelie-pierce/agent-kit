import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { doctor } from './doctor.mjs';
import { installPlatform } from './install/macos.mjs';
import { validateManifest } from './kit.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const npmGroup = id => id === 'codex' ? 'npm-codex' : ['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'].includes(id) ? 'npm' : null;
const selected = (manifest, harness, withFigma) => manifest.tools.filter(t => t.classification !== 'never-ship' && (t.profile === 'core' || t.profile === harness || (withFigma && t.profile === 'figma')));
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
  const effectiveHarness = receipt.phases['npm-codex'] ? 'codex' : harness;
  const oldManifest = structuredClone(manifest);
  for (const tool of oldManifest.tools) if (receipt.phases[tool.id]?.version) tool.version.value = receipt.phases[tool.id].version;
  const health = doctor(oldManifest, { installRoot: root, home, env, nodeVersion, platform, arch });
  const unsafe = health.checks.filter(x => x.status === 'fail' && x.id !== 'hooks' && !x.id.startsWith('prerequisite-') && !x.id.endsWith('-path') && !x.id.endsWith('-pin'));
  if (unsafe.length) throw new Error(`owned installation fails verification: ${unsafe.map(x => x.id).join(', ')}`);
  const target = `${platform}-${arch}`;
  const changes = selected(manifest, effectiveHarness, withFigma).map(tool => {
    const group = npmGroup(tool.id), entry = receipt.phases[group || tool.id];
    const beforeVersion = group ? entry?.packages?.[tool.id === 'codex' ? '@openai/codex' : tool.id] || null : entry?.version || null;
    const beforeSha256 = group ? entry?.artifactSha256 || null : entry?.artifactSha256 || null;
    const lock = group ? readFileSync(new URL(`../manifests/${group}/package-lock.json`, import.meta.url)) : null;
    const afterSha256 = group ? sha(lock) : tool.artifacts[target]?.sha256 || null;
    const afterVersion = tool.version.value;
    return { id: tool.id, from: { version: beforeVersion, sha256: beforeSha256 }, to: { version: afterVersion, sha256: afterSha256 },
      action: beforeVersion === afterVersion && beforeSha256 === afterSha256 ? 'retain or stage in new release' : tool.version.status === 'verified' && afterSha256 ? 'stage and verify' : 'unverified' };
  });
  if (receipt.release === manifest.release && changes.some(x => x.action === 'stage and verify')) throw new Error('changed pins require a new manifest release name');
  return { command: 'update', fromRelease: receipt.release, toRelease: manifest.release, harness: effectiveHarness, changes,
    firstmateHome: receipt.phases.firstmate?.path || null, apply: false,
    note: 'Plan only. --yes stages and activates reviewed artifacts. Previous release binaries remain for rollback; user state rollback is not promised.' };
}
export async function applyUpdate(manifest, options) {
  const plan = planUpdate(manifest, options);
  if (!plan.firstmateHome) throw new Error('Firstmate home is absent from receipt');
  const result = await installPlatform(manifest, { ...options, harness: plan.harness, update: true, firstmateHome: plan.firstmateHome,
    isRunning: options.isRunning || processRunning });
  return { ...plan, apply: true, status: result.status, exitCode: result.exitCode, components: result.components,
    previousRelease: plan.fromRelease, nextSteps: result.components.filter(x => ['conflict', 'deferred'].includes(x.status)).map(x => `${x.id}: ${x.reason}`),
    note: 'Previous release binaries remain in their versioned directory. User state rollback is not promised.' };
}
function processRunning(id) {
  if (id === 'no-mistakes') {
    const daemon = spawnSync('no-mistakes', ['daemon', 'status'], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 });
    if (daemon.status !== 0) return true;
    if (/daemon running/i.test(daemon.stdout)) return true;
    if (!/daemon (?:stopped|not running)/i.test(daemon.stdout)) return true;
  }
  const result = spawnSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return true;
  return result.stdout.split('\n').some(line => line.trim().split('/').at(-1) === id);
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
