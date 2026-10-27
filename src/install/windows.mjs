import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectWindows } from '../platforms/windows.mjs';

export const kitUpstream = 'https://github.com/amelie-pierce/agent-kit.git';
export const defaultLinuxRoot = '~/.agent-kit';
export const defaultLinuxFirstmateHome = '~/firstmate';

// Linux-side paths only: absolute or `~/` (expanded by bash inside WSL), plain characters, and never a
// Windows drive mount, so Windows and Linux files and credential stores stay separate.
export function linuxPath(value, flag) {
  if (!/^(\/|~\/)[A-Za-z0-9._/-]*[A-Za-z0-9._-]$/.test(value || '') || value.split('/').some(part => part === '..' || part === '.')) {
    throw new Error(`${flag} on Windows must be a Linux path inside WSL, such as ~/.agent-kit or /home/<you>/firstmate, using letters, digits, ., _, - and /`);
  }
  if (/^\/mnt(\/|$)/.test(value)) throw new Error(`${flag} must stay on the Linux filesystem, not a Windows drive under /mnt`);
  return value;
}

// One line, no quote characters: it pastes into PowerShell inside single quotes, and Node passes it to
// wsl.exe as a single argument. Positional values are validated plain paths and flags.
export const handoffScript = [
  'set -eu', 'umask 077',
  'commit=$1', 'root=${2/#\\~/$HOME}', 'home=${3/#\\~/$HOME}', 'shift 3',
  'command -v git >/dev/null || { echo agent-kit: install git inside this WSL distribution first >&2; exit 1; }',
  'command -v node >/dev/null || { echo agent-kit: install Node.js 24.15.0 or newer inside this WSL distribution so node is on PATH for login shells: https://nodejs.org/en/download >&2; exit 1; }',
  'src=$root/kit/$commit',
  `if [ ! -d $src/.git ]; then rm -rf $src.partial; mkdir -p $src.partial; git -C $src.partial init -q; git -C $src.partial fetch -q --depth 1 ${kitUpstream} $commit; git -C $src.partial checkout -q --detach FETCH_HEAD; mv $src.partial $src; fi`,
  'test $(git -C $src rev-parse HEAD) = $commit || { echo agent-kit: kit source at $src is not at $commit >&2; exit 1; }',
  'exec node $src/bin/agent-kit.mjs install --install-root $root --firstmate-home $home $@',
].join('; ');

export function handoffArgv({ distro, commit, installRoot, firstmateHome, harness = 'claude', withFigma = false, json = false }) {
  if (!/^[A-Za-z0-9._-]+$/.test(distro || '')) throw new Error('unsafe WSL distribution name');
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('kit commit must be a full SHA-1');
  if (!['claude', 'codex'].includes(harness)) throw new Error('unsupported harness');
  const root = linuxPath(installRoot, '--install-root'), home = linuxPath(firstmateHome, '--firstmate-home');
  if (root === home) throw new Error('--firstmate-home must differ from --install-root');
  return ['-d', distro, '--exec', 'bash', '-l', '-c', handoffScript, 'agent-kit-handoff', commit, root, home,
    '--harness', harness, ...(withFigma ? ['--with-figma'] : []), ...(json ? ['--json'] : [])];
}

// Quote anything beyond plain characters; `~` stays quoted because newer PowerShell expands a bare `~` to the Windows profile.
const psQuote = value => /^[A-Za-z0-9._/:=-]+$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`;
export const powershellCommand = argv => ['wsl.exe', ...argv].map(psQuote).join(' ');

// The handoff fetches exactly the commit of this checkout, so the Linux side runs the same reviewed kit.
export function kitCommit(context = {}) {
  const dir = context.kitDir || fileURLToPath(new URL('../..', import.meta.url));
  const git = context.runGit || (args => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
  try {
    const commit = git(['rev-parse', 'HEAD']).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) return { commit: null, reason: 'this kit copy is not a git checkout' };
    if (git(['status', '--porcelain', '--untracked-files=no']).trim()) return { commit, reason: 'this kit checkout has changed tracked files; WSL would fetch the committed version, not your changes' };
    return { commit };
  } catch {
    return { commit: null, reason: 'this kit copy is not a git checkout, or git is not on the Windows PATH' };
  }
}

export const describeStep = step => `${step.command ? `${step.command}${step.admin ? ' (administrator PowerShell)' : ''}${step.reboot ? ', then restart Windows' : ''}: ` : ''}${step.note}`;

export const beforeHandoff = 'Inside WSL first: install git and Node.js 24.15.0 or newer, and sign in to GitHub yourself so git can fetch the private kit repository.';

export const windowsNextSteps = distro => [
  `Open Windows Terminal and choose the ${distro || 'WSL distribution'} profile; run Herdr, the tower and agent CLIs in that WSL shell.`,
  'Sign in to GitHub, Claude or Codex inside WSL yourself, following each vendor guide; the kit does not share Windows credentials with Linux.',
  'chrome-devtools-axi and Lavish open the browser on the Windows side.',
];

export function windowsHandoff(options, context, platform = inspectWindows(context, { distro: options.distro })) {
  const installRoot = options.installRoot || defaultLinuxRoot, firstmateHome = options.firstmateHome || defaultLinuxFirstmateHome;
  linuxPath(installRoot, '--install-root');
  linuxPath(firstmateHome, '--firstmate-home');
  const base = { platform: 'windows', build: platform.build, linuxArch: platform.linuxArch, prerequisites: platform.prerequisites, steps: platform.steps,
    nextSteps: windowsNextSteps(platform.wsl?.target?.name) };
  if (!platform.supported || !platform.ready) return { ...base, status: 'needs-setup', exitCode: 1, message: platform.message, command: null };
  const kit = (context.kitCommit || kitCommit)(context);
  if (!kit.commit || kit.reason) return { ...base, status: 'unpinned', exitCode: 2, message: `Cannot pin the kit for the WSL handoff: ${kit.reason}. Use a clean git clone of ${kitUpstream}.`, command: null };
  const argv = handoffArgv({ distro: platform.wsl.target.name, commit: kit.commit, installRoot, firstmateHome, harness: options.harness, withFigma: options.withFigma, json: options.json });
  const command = powershellCommand(argv);
  if (!options.handoff) return { ...base, status: 'handoff-ready', exitCode: 0, commit: kit.commit, command, argv,
    message: `WSL2 distribution ${platform.wsl.target.name} is ready. ${beforeHandoff} Then run this command, or rerun with --handoff to run it now:` };
  const result = (context.spawn || ((cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', windowsHide: false })))(platform.wsl.path, argv);
  if (result.error) throw result.error;
  return { ...base, status: 'handed-off', exitCode: typeof result.status === 'number' ? result.status : 1, commit: kit.commit, command, argv,
    message: `Linux install inside ${platform.wsl.target.name} exited with ${result.status}.` };
}

export function formatWindows(result) {
  const lines = [`Agent Kit install (Windows): ${result.status}`, result.message];
  if (result.command) lines.push(`  ${result.command}`);
  for (const p of result.prerequisites.filter(p => p.status !== 'pass')) lines.push(`${p.status.toUpperCase()} ${p.id}: ${p.detail}`);
  if (result.steps.length) lines.push('Steps you run yourself (the kit never enables features, elevates or restarts Windows):');
  for (const step of result.steps) lines.push(`- ${describeStep(step)}`);
  lines.push(...result.nextSteps.map(x => `Next step: ${x}`));
  return lines.join('\n') + '\n';
}
