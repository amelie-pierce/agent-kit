import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { atomicJson } from './install/macos.mjs';

// The kit's PATH line, as one marked block in the teammate's zsh or bash profile. Never any other shell, never
// any content outside the block, never a secret.
export const beginMark = '# >>> agent-kit PATH >>>';
export const endMark = '# <<< agent-kit PATH <<<';
const sha = data => createHash('sha256').update(data).digest('hex');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const stat = path => lstatSync(path, { throwIfNoEntry: false });
const plainFile = path => { const s = stat(path); return !!s && s.isFile() && !s.isSymbolicLink() && s.nlink === 1; };
// The profile's identity for compare-and-replace: the sha256 of its bytes, 'absent', or 'other' for a non-plain file.
export const profileState = path => !stat(path) ? 'absent' : plainFile(path) ? sha(readFileSync(path)) : 'other';
// Raised when the profile no longer holds what the kit read; nothing was written.
export class ProfileChanged extends Error {
  constructor(path) { super(`${path} changed while the kit was updating its PATH block; left unchanged. Save the file, then re-run the command.`); this.path = path; }
}

// installRoot is <root>/.tools; groups are the npm phases the release holds.
export function kitFolders(installRoot, release, groups = ['npm']) {
  const npm = group => posix.join(installRoot, 'releases', release, group, 'node_modules', '.bin');
  return [posix.join(installRoot, 'bin'), posix.join(installRoot, 'releases', release, 'bin'), ...['npm', 'npm-codex', 'npm-figma'].filter(g => groups.includes(g)).map(npm)];
}
export const groupsOf = receipt => ['npm', 'npm-codex', 'npm-figma'].filter(g => receipt?.phases?.[g]);
export const foldersOf = (receipt, installRoot) => kitFolders(installRoot, receipt.release, groupsOf(receipt));
export const renderProfileBlock = folders => [beginMark, '# Managed by Agent Kit: puts the kit\'s tools first on your PATH. agent-kit uninstall removes this block.',
  `export PATH=${folders.map(quote).join(':')}:"$PATH"`, endMark].join('\n');

// zsh -> ~/.zshrc; bash -> ~/.bashrc, or ~/.bash_profile on a Mac (the file bash reads there). Anything else: no target.
export function profileTarget(env, home, platform = process.platform) {
  const shell = posix.basename(env.SHELL || '');
  if (shell === 'zsh') return { shell, path: posix.join(home, '.zshrc') };
  if (shell === 'bash') return { shell, path: posix.join(home, platform === 'darwin' ? '.bash_profile' : '.bashrc') };
  return { shell: shell || 'unknown', path: null };
}

// Exactly one well-formed block, or none; anything else is malformed and left alone.
export function splitProfile(text) {
  const lines = text.split('\n'), begins = lines.flatMap((l, i) => l === beginMark ? [i] : []), ends = lines.flatMap((l, i) => l === endMark ? [i] : []);
  if (!begins.length && !ends.length) return { block: null, malformed: false };
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) return { block: null, malformed: true };
  const [b] = begins, [e] = ends;
  return { block: lines.slice(b, e + 1).join('\n'), beforeLines: lines.slice(0, b), afterLines: lines.slice(e + 1), malformed: false };
}
const withBlock = (text, block) => {
  const s = splitProfile(text);
  if (s.block !== null) return [...s.beforeLines, block, ...s.afterLines].join('\n');
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}\n`;
};
// The blank separator line the kit added above the block goes with it.
const withoutBlock = text => {
  const s = splitProfile(text), above = [...s.beforeLines];
  if (above.length && above[above.length - 1] === '') above.pop();
  return [...above, ...s.afterLines].join('\n');
};

// action: none | skip | add | refresh | verify | keep | remove. Read-only.
export function planProfile({ folders, env, home, platform = process.platform, want, record = null, repair = false }) {
  const target = profileTarget(env, home, platform), block = renderProfileBlock(folders);
  if (!target.path) return { action: want ? 'skip' : 'none', shell: target.shell, block, detail: `your login shell (${target.shell}) is not zsh or bash, so the kit leaves it alone; add this line to your own profile: ${block.split('\n')[2]}` };
  const path = record?.path || target.path, exists = !!stat(path);
  if (exists && !plainFile(path)) return { action: want ? 'skip' : 'none', path, shell: target.shell, block, detail: `${path} is a symlink, hard link or other non-plain file; left unchanged` };
  const bytes = exists ? readFileSync(path) : null, text = bytes ? bytes.toString('utf8') : '', found = splitProfile(text);
  if (found.malformed) return { action: want ? 'skip' : 'none', path, shell: target.shell, block, detail: `${path} has a damaged agent-kit marker; left unchanged` };
  const owned = found.block !== null && record?.blockSha256 === sha(found.block);
  let action;
  if (!want) action = owned ? 'remove' : 'none';
  else if (found.block === null) action = record && !repair ? 'keep' : 'add';
  else if (found.block === block) action = 'verify';
  else action = owned ? 'refresh' : 'keep';
  return { action, path, shell: target.shell, block, text, state: bytes ? sha(bytes) : 'absent', created: !exists || !!record?.created,
    detail: action === 'keep' ? (found.block === null ? 'the block was removed; not added again (agent-kit repair restores it)' : 'you changed the block; left as you edited it') : null };
}

// beforeReplace(path) runs between the last write preparation and the compare; tests use it to edit the file there.
export async function applyProfile(plan, root, { beforeReplace } = {}) {
  if (['none', 'skip', 'keep'].includes(plan.action)) return plan.action === 'keep' ? 'keep' : null;
  if (plan.action === 'verify') return { path: plan.path, shell: plan.shell, blockSha256: sha(plan.block), created: plan.created };
  if (plan.text !== '') await backup(root, plan.path);
  const next = plan.action === 'remove' ? withoutBlock(plan.text) : withBlock(plan.text, plan.block);
  await replaceProfile(plan.path, plan.state, plan.action === 'remove' && plan.created && next.trim() === '' ? null : next, beforeReplace);
  return plan.action === 'remove' ? null : { path: plan.path, shell: plan.shell, blockSha256: sha(plan.block), created: plan.created };
}
// Compare-and-replace: the new text goes to a temp file beside the profile, and only replaces it (or, for null,
// removes it) while the profile still holds the bytes the plan read. Otherwise ProfileChanged and no change.
async function replaceProfile(path, expected, next, beforeReplace) {
  const tmp = next === null ? null : `${path}.${randomUUID()}.tmp`;
  try {
    if (tmp) {
      const mode = stat(path)?.mode & 0o7777 || 0o644;
      await writeFile(tmp, next, { mode, flag: 'wx' });
      await chmod(tmp, mode);
    }
    await beforeReplace?.(path);
    if (profileState(path) !== expected) throw new ProfileChanged(path);
    if (tmp) await rename(tmp, path); else await rm(path, { force: true });
  } finally { if (tmp) await rm(tmp, { force: true }); }
}
async function backup(root, path) {
  const dir = join(root, 'backups', 'shell-profile');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}-${basename(path)}`), readFileSync(path), { mode: 0o600, flag: 'wx' });
}

export function describeProfile(plan) {
  if (plan.action === 'none') return null;
  if (plan.action === 'skip' || plan.action === 'keep') return `Shell profile: ${plan.detail}`;
  return `Shell profile (${plan.path}): ${{ add: 'added the PATH block', refresh: 'refreshed the PATH block', verify: 'PATH block present', remove: 'removed the PATH block' }[plan.action]}`;
}

// Setup step, repair and upgrade: keep the block current for an install that chose it. Returns lines, or null.
// A profile that changes under the kit throws ProfileChanged, so the command exits nonzero; any other
// problem is reported as a line.
export async function reconcileProfile(receipt, root, { env = process.env, home = env.HOME, platform = process.platform, repair = false, beforeReplace } = {}) {
  if (platform === 'win32' || receipt.setup?.answers?.shellProfile !== true) return null;
  const prior = receipt.setup?.shellProfile || null;
  let plan, record;
  try {
    plan = planProfile({ folders: foldersOf(receipt, root), env, home, platform, want: true, record: prior, repair });
    record = await applyProfile(plan, root, { beforeReplace });
  } catch (error) {
    if (error instanceof ProfileChanged) throw error;
    return { lines: [`Shell profile: not updated; ${error.message}`], plan, record: prior };
  }
  return { lines: [describeProfile(plan)].filter(Boolean), plan, record: record === 'keep' || record === null ? (plan.action === 'remove' ? null : prior) : record };
}
export async function saveProfileRecord(root, record) {
  const path = join(root, 'receipt.json'), receipt = JSON.parse(readFileSync(path, 'utf8'));
  receipt.setup ||= {};
  if (record) receipt.setup.shellProfile = record; else delete receipt.setup.shellProfile;
  await atomicJson(path, receipt);
}

// Uninstall: only an unchanged block goes; an edited one stays and is reported.
export function planRemoveProfile(record) {
  if (!record?.path) return null;
  const bytes = plainFile(record.path) ? readFileSync(record.path) : null, text = bytes?.toString('utf8') ?? null, found = text === null ? null : splitProfile(text);
  const unchanged = !!found?.block && record.blockSha256 === sha(found.block);
  return { path: record.path, action: unchanged ? 'remove the unchanged agent-kit PATH block' : 'keep changed or absent PATH block', text, state: bytes ? sha(bytes) : profileState(record.path), created: !!record.created };
}
export async function removeProfile(root, plan, { beforeReplace } = {}) {
  if (plan?.action !== 'remove the unchanged agent-kit PATH block') return;
  await applyProfile({ action: 'remove', path: plan.path, text: plan.text, state: plan.state, created: plan.created }, root, { beforeReplace });
}

// Upgrade rollback: the bytes captured before the upgrade (null: absent) go back only while the profile differs
// from them by nothing but the block the kit wrote since (record). Returns a line when the profile stays as it is.
export async function restoreProfile(path, before, record, { beforeReplace } = {}) {
  const old = before === null ? 'absent' : sha(before), bytes = plainFile(path) ? readFileSync(path) : null, now = bytes ? sha(bytes) : profileState(path);
  if (now === old) return null;
  const text = bytes?.toString('utf8') ?? null, block = text === null ? null : splitProfile(text).block;
  const stays = `${path} changed during the upgrade, so the rollback left it as it is now. Save the file, then re-run the command.`;
  if (block === null || sha(block) !== record?.blockSha256 || text !== withBlock(before?.toString('utf8') ?? '', block)) return stays;
  try { await replaceProfile(path, now, before, beforeReplace); } catch (error) { if (error instanceof ProfileChanged) return stays; throw error; }
  return null;
}

// Doctor rows. `installing` is the setup run: the terminal that started the installer has not seen the block yet.
export function shellHealth(receipt, root, { env, platform = process.platform, installing = false } = {}) {
  if (platform === 'win32') return [];
  const folders = foldersOf(receipt, root), rows = [], record = receipt.setup?.shellProfile;
  const onPath = new Set((env.PATH || '').split(posix.delimiter)), missing = folders.filter(f => !onPath.has(f));
  const text = record?.path && plainFile(record.path) ? readFileSync(record.path, 'utf8') : '', block = splitProfile(text).block;
  const activeLines = block?.split('\n').slice(1, -1).filter(line => line.trim() && !line.trimStart().startsWith('#'));
  let blockPath = null;
  for (const line of activeLines || []) {
    const assignment = /^\s*(?:export\s+)?PATH=(.*)$/.exec(line);
    if (!assignment) continue;
    const next = new Set();
    for (const entry of assignment[1].trim().split(':')) {
      if (entry === '"$PATH"' || entry === '$PATH' || entry === '"${PATH}"' || entry === '${PATH}') {
        for (const folder of blockPath || []) next.add(folder);
      } else if (/^'(?:[^']|'\\'')*'$/.test(entry)) next.add(entry.slice(1, -1).replaceAll("'\\''", "'"));
      else if (/^"[^"$`\\]*"$/.test(entry)) next.add(entry.slice(1, -1));
      else if (/^[^'"`\s$\\;|&(){}<>]+$/.test(entry)) next.add(entry);
    }
    blockPath = next;
  }
  const blockHas = blockPath !== null && folders.every(folder => blockPath.has(folder));
  if (receipt.setup?.answers?.shellProfile || record) rows.push({ id: 'shell-profile', status: blockHas ? 'pass' : 'fail',
    detail: blockHas ? `${record.path} holds the kit's PATH block` : `${record?.path || 'your shell profile'} lacks the kit's PATH block or it misses a kit folder; agent-kit repair puts it back` });
  if (!installing) rows.push({ id: 'shell-path', status: !missing.length ? 'pass' : 'fail',
    detail: !missing.length ? 'this shell sees every kit tool folder' : `this shell does not see ${missing.length} kit tool folder${missing.length > 1 ? 's' : ''}${blockHas ? '; open a new terminal so it reads the profile' : '; add the PATH line from the guide or run agent-kit repair'}` });
  return rows;
}
