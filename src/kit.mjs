import { join, isAbsolute } from 'node:path';
import { inspectPlatform } from './platforms/index.mjs';
import { previewHooks, publicHookChanges } from './install/hooks.mjs';

function compareVersions(actual, minimum) {
  const a = actual.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.tools) || !/^\d+\.\d+\.\d+$/.test(manifest.nodeMinimum || '')) throw new Error('invalid v1 manifest');
  const ids = new Set();
  for (const tool of manifest.tools) {
    if (!/^[a-z][a-z0-9-]*$/.test(tool.id || '') || ids.has(tool.id)) throw new Error('invalid or duplicate tool id');
    ids.add(tool.id);
    if (!['core', 'claude', 'codex', 'figma'].includes(tool.profile) || !['shareable', 'per-user-login', 'never-ship'].includes(tool.classification)) throw new Error(`invalid profile or classification for ${tool.id}`);
    if (!tool.approvedUpstream?.startsWith('https://') || !tool.license?.reference?.startsWith('https://')) throw new Error(`invalid upstream or license for ${tool.id}`);
    if (!['release', 'git-commit'].includes(tool.version?.kind) || !['verified', 'unverified'].includes(tool.version?.status)) throw new Error(`invalid version for ${tool.id}`);
    if (tool.version.value !== null && typeof tool.version.value !== 'string') throw new Error(`invalid version for ${tool.id}`);
    if (tool.version.status === 'verified' && !tool.version.value) throw new Error(`verified version missing for ${tool.id}`);
    if (tool.version.kind === 'git-commit' && tool.version.value && !/^[a-f0-9]{40}$/.test(tool.version.value)) throw new Error(`invalid commit for ${tool.id}`);
    const relativePath = tool.installLocation?.relativePath;
    if (!relativePath || !/^[A-Za-z0-9._/-]+$/.test(relativePath) || isAbsolute(relativePath) || relativePath.split('/').some(part => !part || part === '..' || part === '.')) throw new Error(`unsafe install location for ${tool.id}`);
    if (!tool.artifacts || !Object.keys(tool.artifacts).length) throw new Error(`missing artifacts for ${tool.id}`);
    for (const [target, artifact] of Object.entries(tool.artifacts)) {
      if (!/^(darwin|linux|wsl2|windows)-(arm64|x64)$/.test(target)) throw new Error(`invalid target for ${tool.id}`);
      if (!['verified', 'unverified'].includes(artifact.status) || (artifact.url !== null && !artifact.url?.startsWith('https://')) || (artifact.sha256 !== null && !/^[a-f0-9]{64}$/i.test(artifact.sha256 || ''))) throw new Error(`invalid artifact for ${tool.id}`);
      if (artifact.status === 'verified' && (!artifact.url || !artifact.sha256)) throw new Error(`verified artifact incomplete for ${tool.id}`);
    }
    const d = tool.detection;
    const validDetection = d?.kind === 'git-head' ? d.command === 'git' && JSON.stringify(d.args) === '["rev-parse","HEAD"]' : d?.kind === 'command' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(d.command || '') && (JSON.stringify(d.args) === '["--version"]' || JSON.stringify(d.args) === '["-version"]')
      || d?.kind === 'presence' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(d.command || '') && JSON.stringify(d.args) === '[]';
    if (!validDetection) throw new Error(`unsafe detection command for ${tool.id}`);
  }
  return manifest;
}

export function parseArgs(argv) {
  let command, json = false, harness = 'claude', withFigma = false, dryRun = false, installRoot, firstmateHome;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['check', '--check', 'plan', 'install'].includes(arg) && !command) command = arg === '--check' ? 'check' : arg;
    else if (arg === '--json') json = true;
    else if (arg === '--harness' && ['claude', 'codex'].includes(argv[i + 1])) harness = argv[++i];
    else if (arg === '--with-figma') withFigma = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--install-root' && argv[i + 1]) installRoot = argv[++i];
    else if (arg === '--firstmate-home' && argv[i + 1]) firstmateHome = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!command) throw new Error('usage: agent-kit <check|plan|install> [--json] [--harness claude|codex] [--with-figma]');
  if (dryRun && command !== 'install') throw new Error('--dry-run applies only to install');
  if (firstmateHome && !installRoot) throw new Error('--firstmate-home requires --install-root');
  if (installRoot && !isAbsolute(installRoot)) throw new Error('--install-root must be absolute');
  if (firstmateHome && !isAbsolute(firstmateHome)) throw new Error('--firstmate-home must be absolute');
  return { command: dryRun ? 'plan' : command, json, harness, withFigma, installRoot, firstmateHome, dryRun };
}

const loginSteps = {
  'github-cli': 'Sign in yourself with GitHub CLI after installation; the kit never runs or captures login.',
  'gh-axi': 'Use your own GitHub CLI sign-in for gh-axi.',
  'chrome-devtools-axi': 'Sign in to sites in your own browser when needed.',
  'quota-axi': 'Sign in directly with each provider before using quota-axi.',
  'no-mistakes': 'Sign in directly with your selected agent and GitHub provider.',
  'claude': 'Sign in directly with Claude Code.',
  'codex': 'Sign in directly with Codex CLI.',
  'figma-cli': 'Sign in directly with Figma and grant OS permissions yourself.',
};

function evaluate(manifest, context, options) {
  const selected = manifest.tools.filter(tool => tool.classification !== 'never-ship' && (tool.profile === 'core' || tool.profile === options.harness || (options.withFigma && tool.profile === 'figma')));
  const platform = inspectPlatform(context, manifest, selected);
  const issues = [];
  if (compareVersions(context.nodeVersion, manifest.nodeMinimum) < 0) issues.push({ status: 'fail', id: 'node-runtime', reason: `Node ${manifest.nodeMinimum} or newer required` });
  if (!platform.supported) issues.push({ status: 'fail', id: 'platform', reason: platform.message });
  for (const prereq of platform.prerequisites) if (prereq.status !== 'pass') issues.push({ status: prereq.status, id: prereq.id, reason: prereq.detail });
  for (const result of platform.tools) if (result.status !== 'pass') issues.push({ status: result.status, id: result.id, reason: result.reason });
  for (const conflict of platform.pathConflicts) issues.push({ status: 'fail', id: conflict.id, reason: 'multiple executable paths; PATH precedence needs review' });
  const target = `${platform.platform === 'wsl2' ? 'linux' : platform.platform}-${context.arch}`;
  for (const tool of selected) {
    if (tool.version.status !== 'verified' && !issues.some(x => x.id === tool.id && x.reason === tool.version.reason)) issues.push({ status: 'unknown', id: tool.id, reason: tool.version.reason });
    const artifact = tool.artifacts[target];
    if (!artifact || artifact.status !== 'verified') issues.push({ status: 'unknown', id: tool.id, reason: artifact?.reason || `artifact for ${target} is not reviewed` });
  }
  const optional = manifest.tools.filter(tool => tool.classification !== 'never-ship' && !selected.includes(tool));
  return { selected, optional, platform, issues, target };
}

function human(result) {
  const lines = [`Agent Kit ${result.command}: ${result.summary}`, `Platform: ${result.platform.platform}/${result.platform.arch}; harness: ${result.harness}`];
  if (result.platform.message) lines.push(result.platform.message);
  if (result.command === 'plan') {
    lines.push('Proposed locations and origins (no changes made):');
    for (const item of result.plan.tools) lines.push(`- ${item.name}: ${item.version || 'UNVERIFIED COMMIT'} from ${item.origin}; ${item.installLocation}; artifact ${item.artifactUrl || 'UNVERIFIED'}; SHA-256 ${item.sha256 || 'UNVERIFIED'}`);
    lines.push('Optional components (not selected):');
    for (const item of result.plan.optionalComponents) lines.push(`- ${item.name}: ${item.status}; ${item.version || 'UNVERIFIED COMMIT'} from ${item.origin}`);
    lines.push('Proposed source-owned hook files (no changes made):');
    for (const change of result.plan.hookChanges) lines.push(`- ${change.action}: ${change.path}`);
    lines.push('Global hook and skill changes (kit-owned entries only):');
    for (const change of result.plan.globalHookChanges) lines.push(`- ${change.path}: ${JSON.stringify(change.changes)}`);
    if (!result.plan.globalHookChanges.length) lines.push(result.issues.some(x => x.id === 'hooks') ? '- refused; see the hooks conflict below' : '- none');
    lines.push('Codex reviews new or changed hooks interactively; approve them yourself after installation.');
    lines.push('Personal login steps:');
    for (const step of result.plan.loginSteps) lines.push(`- ${step}`);
  } else {
    for (const prereq of result.platform.prerequisites) lines.push(`${prereq.status.toUpperCase()} ${prereq.id}: ${prereq.detail}`);
    for (const tool of result.platform.tools) lines.push(`${tool.status.toUpperCase()} ${tool.id}: ${tool.reason}${tool.detected ? ` (${tool.detected})` : ''}`);
  }
  for (const issue of result.issues) lines.push(`${issue.status.toUpperCase()} ${issue.id}: ${issue.reason}`);
  return lines.join('\n') + '\n';
}

const firstmateLocation = (context, options) => options.firstmateHome || join(context.env.HOME, 'firstmate');

function plannedLocation(tool, context, options, release) {
  const root = options.installRoot || join(context.env.HOME, '.agent-kit');
  const versioned = join(root, 'releases', release);
  if (tool.id === 'firstmate') return firstmateLocation(context, options);
  if (tool.id === 'zoe-fleet') return join(versioned, 'zoetrope', 'bin', 'zoe-fleet');
  if (['herdr', 'treehouse', 'no-mistakes', 'shellcheck', 'actionlint'].includes(tool.id)) return join(versioned, 'bin', tool.id);
  if (['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'quota-axi', 'tasks-axi'].includes(tool.id)) return join(versioned, 'npm', 'node_modules', '.bin', tool.id);
  if (tool.id === 'codex') return join(versioned, 'npm-codex', 'node_modules', '.bin', 'codex');
  return 'UNVERIFIED: no install adapter';
}

export function run(argv, manifest, context) {
  validateManifest(manifest);
  const options = parseArgs(argv);
  if (options.command === 'install') throw new Error('install is asynchronous; use the CLI install entry point');
  if (!context.env.HOME) throw new Error('HOME must be set');
  const evaluation = evaluate(manifest, { ...context, installRoot: options.installRoot }, options);
  let globalHookChanges = [];
  if (options.command === 'plan' && ['darwin', 'linux', 'wsl2'].includes(evaluation.platform.platform)) {
    try {
      globalHookChanges = publicHookChanges(previewHooks(manifest, { home: context.env.HOME, installRoot: options.installRoot || join(context.env.HOME, '.agent-kit') }));
    } catch (error) {
      evaluation.issues.push({ status: 'conflict', id: 'hooks', reason: error.message });
    }
  }
  const plan = options.command === 'plan' ? {
    tools: evaluation.selected.map(tool => {
      const artifact = tool.artifacts[evaluation.target];
      return { id: tool.id, name: tool.name, version: tool.version.value, versionStatus: tool.version.status,
        origin: tool.approvedUpstream, installLocation: plannedLocation(tool, context, options, manifest.release),
        artifactUrl: artifact?.url || null, sha256: artifact?.sha256 || null, classification: tool.classification };
    }),
    optionalComponents: evaluation.optional.map(tool => ({ id: tool.id, name: tool.name, status: 'optional, not selected',
      version: tool.version.value, versionStatus: tool.version.status, origin: tool.approvedUpstream })),
    hookChanges: [
      { owner: 'firstmate', action: 'include Claude hooks with pinned source', path: join(firstmateLocation(context, options), '.claude/settings.json') },
      { owner: 'firstmate', action: 'include Codex hooks with pinned source', path: join(firstmateLocation(context, options), '.codex/hooks.json') },
    ],
    globalHookChanges,
    loginSteps: evaluation.selected.filter(tool => tool.classification === 'per-user-login').map(tool => loginSteps[tool.id]).filter(Boolean),
  } : undefined;
  const result = { command: options.command, release: manifest.release, harness: options.harness, withFigma: options.withFigma,
    platform: evaluation.platform, plan, issues: evaluation.issues,
    summary: evaluation.issues.length ? `${evaluation.issues.length} gaps or unknowns` : 'ready', readOnly: true };
  return { output: options.json ? JSON.stringify(result, null, 2) + '\n' : human(result), exitCode: evaluation.issues.length ? 1 : 0, result };
}
