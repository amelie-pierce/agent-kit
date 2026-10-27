import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { chmod, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export const keyName = 'TYPESAFE_API_KEY';
const assignment = /^\s*(?:export\s+)?TYPESAFE_API_KEY=/;
const safeFile = path => {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (st && (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1)) throw new Error(`${path}: expected a plain, unlinked file`);
  return st;
};

export function validateTypesafeKey(value) {
  // The vendor has no documented fixed prefix. Accept printable token characters,
  // but refuse whitespace and .env metacharacters that could change parsing.
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~+\/=:-]{8,512}$/.test(value))
    throw new Error('TYPESAFE_API_KEY must be an 8–512 character token without whitespace or .env syntax');
  return value;
}

export function envManaged(firstmateHome) {
  try { safeFile(join(firstmateHome, '.env')); return true; } catch { return false; }
}

export function keyStatus(firstmateHome) {
  const path = join(firstmateHome, '.env');
  if (!safeFile(path)) return false;
  let value = '';
  for (const line of readFileSync(path, 'utf8').split(/\n/)) if (assignment.test(line)) {
    value = line.slice(line.indexOf('=') + 1).trim().replace(/^(?:"([^"]*)"|'([^']*)')$/, (_m, a, b) => a ?? b);
  }
  return value.length > 0;
}

function ignored(firstmateHome) {
  const home = lstatSync(firstmateHome, { throwIfNoEntry: false });
  if (!home?.isDirectory() || home.isSymbolicLink()) return false;
  const gitignore = join(firstmateHome, '.gitignore');
  if (!safeFile(gitignore) || !readFileSync(gitignore, 'utf8').split(/\r?\n/).some(line => line.trim() === '.env')) return false;
  const result = spawnSync('git', ['check-ignore', '-q', '--no-index', '.env'], {
    cwd: firstmateHome, env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) return false;
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '.env'], {
    cwd: firstmateHome, env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8', timeout: 10000 });
  return tracked.status !== 0;
}

export async function writeKey(firstmateHome, action, value) {
  if (!['set', 'remove'].includes(action)) throw new Error('invalid key action');
  if (action === 'set') validateTypesafeKey(value);
  if (!ignored(firstmateHome)) throw new Error('Firstmate home must gitignore .env before changing its key');
  const path = join(firstmateHome, '.env');
  const st = safeFile(path);
  const old = st ? readFileSync(path, 'utf8') : '';
  const lines = old ? old.split('\n') : [];
  const kept = lines.filter(line => !assignment.test(line));
  if (action === 'set') kept.push(`${keyName}=${value}`);
  const body = kept.join('\n').replace(/\n*$/, '\n');
  if (body === old) return action === 'set';
  const temp = join(firstmateHome, `.env.agent-kit-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temp, 'wx', 0o600);
    await file.chmod(0o600);
    await file.writeFile(body);
    await file.sync();
    await file.close(); file = null;
    // Refuse a path swap that occurred after the initial read.
    const now = safeFile(path);
    if (!!st !== !!now || (st && (st.ino !== now.ino || st.dev !== now.dev))) throw new Error('.env changed while updating; retry');
    await rename(temp, path);
    await chmod(path, 0o600);
  } finally {
    if (file) await file.close();
    await rm(temp, { force: true });
  }
  return action === 'set';
}

export async function hiddenKey(input, output) {
  if (!input?.isTTY) throw new Error('hidden key entry requires a terminal');
  output.write('TYPESAFE_API_KEY (hidden; press Enter to cancel): ');
  const sink = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input, output: sink, terminal: true });
  try {
    const value = await rl.question('');
    output.write('\n');
    return value ? validateTypesafeKey(value) : null;
  } finally { rl.close(); }
}
