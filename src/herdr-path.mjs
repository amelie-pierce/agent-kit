import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter } from 'node:path';

// Read-only look at a running Herdr server: does its PATH hold the kit's tool folder? Only the yes/no
// leaves this module; no environment value is ever printed.
export function herdrServers(run = spawnSync) {
  const r = run('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map(line => /^\s*(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    // The default server only: `herdr server`, not a named `--session` one.
    .filter(([, , args]) => /^(?:\S*\/)?herdr server(?:\s|$)/.test(args) && !/--session/.test(args)).map(([, pid]) => Number(pid));
}
// The server's PATH from its process environment, or null when it cannot be read.
export function herdrServerPath(pid, platform = process.platform, run = spawnSync) {
  if (platform === 'linux') {
    try { return readFileSync(`/proc/${pid}/environ`, 'latin1').split('\0').find(x => x.startsWith('PATH='))?.slice(5) ?? ''; } catch { return null; }
  }
  if (platform !== 'darwin') return null;
  const r = run('ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  return /(?:^|\s)PATH=(\S*)/.exec(r.stdout)?.[1] ?? null;
}
export function herdrPathHealth(folders, { servers = herdrServers, serverPath = herdrServerPath, platform = process.platform } = {}) {
  const id = 'herdr-path-env';
  let pids;
  try { pids = servers(); } catch { pids = null; }
  if (pids === null) return { id, status: 'pass', detail: 'not checked: the running processes cannot be listed here' };
  if (!pids.length) return { id, status: 'pass', detail: 'not running, not checked' };
  let blind = false;
  for (const pid of pids) {
    let path = null;
    try { path = serverPath(pid, platform); } catch { /* unreadable */ }
    if (path === null) { blind = true; continue; }
    const seen = new Set(path.split(delimiter)), missing = folders.filter(f => !seen.has(f));
    if (missing.length) return { id, status: 'warn', stale: true, detail: `the running Herdr server cannot see ${missing.length} of the kit tool folders (it started before they were on your PATH); ${herdrRestartHint}` };
  }
  return blind ? { id, status: 'pass', detail: 'running; its environment cannot be read here, not checked' }
    : { id, status: 'pass', detail: 'the running Herdr server sees the kit tool folders' };
}
export const herdrRestartHint = 'quit your agents, run herdr server stop, open a new terminal, then start herdr there (inside Ubuntu on Windows)';
