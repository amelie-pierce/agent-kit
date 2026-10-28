import assert from 'node:assert/strict';
import test from 'node:test';
import { herdrPathHealth, herdrServerPath, herdrServers } from '../src/herdr-path.mjs';

const root = '/home/me/Agentic/.tools', folders = [`${root}/bin`, `${root}/releases/r1/bin`], health = (servers, serverPath) => herdrPathHealth(folders, { servers, serverPath, platform: 'linux' });

test('herdr-path-env warns only when a readable running server lacks the kit folder', () => {
  const warn = health(() => [7], () => `/usr/bin:/bin`);
  assert.equal(warn.status, 'warn');
  assert.match(warn.detail, /herdr server stop/);
  assert.equal(health(() => [7], () => `${root}/bin:/usr/bin`).status, 'warn', 'one missing folder is enough');
  assert.equal(health(() => [7], () => `${folders.join(':')}:/usr/bin`).status, 'pass');
  assert.match(health(() => [7], () => `${folders.join(':')}:/usr/bin`).detail, /sees the kit tool folder/);
});

test('herdr-path-env never fails: not running, unlistable or unreadable all pass', () => {
  assert.deepEqual(health(() => [], () => 'x'), { id: 'herdr-path-env', status: 'pass', detail: 'not running, not checked' });
  assert.match(health(() => null, () => 'x').detail, /not checked/);
  assert.match(health(() => { throw new Error('no ps'); }, () => 'x').detail, /not checked/);
  assert.match(health(() => [7], () => null).detail, /cannot be read/);
  assert.match(health(() => [7], () => { throw new Error('denied'); }).detail, /cannot be read/);
});

test('herdr-path-env prints no environment value', () => {
  const secret = 'SECRET-TOKEN-123';
  const out = JSON.stringify(health(() => [7], () => `/usr/bin:/${secret}`));
  assert.equal(out.includes(secret), false);
});

test('process source finds default and named servers, including paths with spaces', () => {
  const ps = (cmd, args) => ({ status: 0, stdout: args[0] === 'eww'
    ? 'herdr server HOME=/h TOKEN=abc PATH=/Users/Teammate Name/Agentic/.tools/bin:/a:/b SHELL=/bin/zsh\n'
    : ' 10 /x/bin/herdr server\n 11 herdr server --session lab\n 12 /Users/Teammate Name/Agentic/.tools/bin/herdr server --session team\n 13 /usr/bin/python3 herdr-sync.py\n 14 -/x/bin/herdr\n' });
  assert.deepEqual(herdrServers(ps), [10, 11, 12]);
  assert.equal(herdrServerPath(10, 'darwin', ps), '/Users/Teammate Name/Agentic/.tools/bin:/a:/b');
  assert.equal(herdrPathHealth(['/Users/Teammate Name/Agentic/.tools/bin'], { servers: () => [12], serverPath: pid => herdrServerPath(pid, 'darwin', ps), platform: 'darwin' }).status, 'pass');
  assert.equal(herdrServerPath(10, 'win32', ps), null);
  assert.equal(herdrServers(() => ({ status: 1, stdout: '' })), null);
});
