import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyProfile, beginMark, endMark, kitFolders, planProfile, planRemoveProfile, profileTarget, removeProfile, renderProfileBlock, shellHealth, splitProfile } from '../src/shell-profile.mjs';

const posixOnly = { skip: process.platform === 'win32' };
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'ak-profile-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), root = join(home, 'Agentic', '.tools');
  mkdirSync(home, { recursive: true });
  return { home, root, rc: join(home, '.zshrc'), env: { SHELL: '/bin/zsh', HOME: home }, folders: kitFolders(root, 'r1', ['npm', 'npm-codex']) };
}
const plan = (f, extra = {}) => planProfile({ folders: f.folders, env: f.env, home: f.home, platform: 'linux', want: true, ...extra });

test('zsh and bash choose their profile; other shells get none', () => {
  assert.equal(profileTarget({ SHELL: '/bin/zsh' }, '/h', 'darwin').path, '/h/.zshrc');
  assert.equal(profileTarget({ SHELL: '/bin/bash' }, '/h', 'darwin').path, '/h/.bash_profile');
  assert.equal(profileTarget({ SHELL: '/usr/bin/bash' }, '/h', 'linux').path, '/h/.bashrc');
  assert.equal(profileTarget({ SHELL: '/usr/bin/fish' }, '/h', 'linux').path, null);
  assert.equal(profileTarget({}, '/h', 'linux').path, null);
});

test('the block is added once, keeps your lines, backs up first and a rerun changes nothing', posixOnly, async t => {
  const f = fixture(t);
  writeFileSync(f.rc, 'alias a=b\nexport X=1');
  const added = plan(f);
  assert.equal(added.action, 'add');
  const record = await applyProfile(added, f.root);
  const text = readFileSync(f.rc, 'utf8');
  assert.equal(text, `alias a=b\nexport X=1\n\n${renderProfileBlock(f.folders)}\n`);
  assert.match(text, new RegExp(`${beginMark}\\n[^\\n]*\\nexport PATH='[^']*/\\.tools/bin':`));
  assert.equal(existsSync(join(f.root, 'backups', 'shell-profile')), true);
  const again = plan(f, { record });
  assert.equal(again.action, 'verify');
  await applyProfile(again, f.root);
  assert.equal(readFileSync(f.rc, 'utf8'), text);
});

test('a new release refreshes an unchanged block; an edited or removed block is kept', posixOnly, async t => {
  const f = fixture(t);
  const record = await applyProfile(plan(f), f.root);
  const next = kitFolders(f.root, 'r2', ['npm']);
  const refresh = planProfile({ folders: next, env: f.env, home: f.home, platform: 'linux', want: true, record });
  assert.equal(refresh.action, 'refresh');
  await applyProfile(refresh, f.root);
  assert.match(readFileSync(f.rc, 'utf8'), /releases\/r2\/bin/);
  assert.doesNotMatch(readFileSync(f.rc, 'utf8'), /releases\/r1\//);
  const edited = readFileSync(f.rc, 'utf8').replace('Managed by Agent Kit', 'my own words');
  writeFileSync(f.rc, edited);
  const kept = planProfile({ folders: f.folders, env: f.env, home: f.home, platform: 'linux', want: true, record: { ...record, blockSha256: 'x' } });
  assert.equal(kept.action, 'keep');
  writeFileSync(f.rc, '# nothing\n');
  assert.equal(planProfile({ folders: f.folders, env: f.env, home: f.home, platform: 'linux', want: true, record }).action, 'keep');
  assert.equal(planProfile({ folders: f.folders, env: f.env, home: f.home, platform: 'linux', want: true, record, repair: true }).action, 'add');
});

test('symlinked, damaged and unsupported-shell profiles are left alone', posixOnly, async t => {
  const f = fixture(t);
  const real = join(f.home, 'dotfiles-zshrc');
  writeFileSync(real, 'x\n'); symlinkSync(real, f.rc);
  assert.equal(plan(f).action, 'skip');
  rmSync(f.rc); writeFileSync(f.rc, `${beginMark}\nbroken\n`);
  assert.equal(plan(f).action, 'skip');
  assert.equal(splitProfile(`${beginMark}\n${endMark}\n${beginMark}\n${endMark}`).malformed, true);
  const fish = planProfile({ folders: f.folders, env: { SHELL: '/usr/bin/fish' }, home: f.home, want: true });
  assert.equal(fish.action, 'skip');
  assert.match(fish.detail, /not zsh or bash/);
});

test('uninstall removes only an unchanged block and a file the kit created', posixOnly, async t => {
  const f = fixture(t);
  writeFileSync(f.rc, 'alias a=b\n');
  const record = await applyProfile(plan(f), f.root);
  const removal = planRemoveProfile(record);
  assert.equal(removal.action, 'remove the unchanged agent-kit PATH block');
  await removeProfile(f.root, removal);
  assert.equal(readFileSync(f.rc, 'utf8'), 'alias a=b\n');
  const f2 = fixture(t);
  const created = await applyProfile(plan(f2), f2.root);
  assert.equal(created.created, true);
  await removeProfile(f2.root, planRemoveProfile(created));
  assert.equal(existsSync(f2.rc), false);
  const f3 = fixture(t);
  const rec3 = await applyProfile(plan(f3), f3.root);
  writeFileSync(f3.rc, readFileSync(f3.rc, 'utf8').replace('Managed by', 'Mine, managed by'));
  const keep = planRemoveProfile(rec3);
  assert.equal(keep.action, 'keep changed or absent PATH block');
  await removeProfile(f3.root, keep);
  assert.match(readFileSync(f3.rc, 'utf8'), /Mine, managed by/);
});

test('doctor rows fail when the block or this shell lacks the folders', posixOnly, async t => {
  const f = fixture(t);
  const receipt = { release: 'r1', phases: { npm: {}, 'npm-codex': {} }, setup: { answers: { shellProfile: true } } };
  const rows = env => Object.fromEntries(shellHealth(receipt, f.root, { env, platform: 'linux' }).map(r => [r.id, r.status]));
  assert.deepEqual(rows({ PATH: '/usr/bin' }), { 'shell-profile': 'fail', 'shell-path': 'fail' });
  receipt.setup.shellProfile = await applyProfile(plan(f), f.root);
  assert.deepEqual(rows({ PATH: '/usr/bin' }), { 'shell-profile': 'pass', 'shell-path': 'fail' });
  assert.deepEqual(rows({ PATH: [...f.folders, '/usr/bin'].join(':') }), { 'shell-profile': 'pass', 'shell-path': 'pass' });
  writeFileSync(f.rc, `${beginMark}\n# ${renderProfileBlock(f.folders).split('\n')[2]}\n${endMark}\n`);
  assert.deepEqual(rows({ PATH: '/usr/bin' }), { 'shell-profile': 'fail', 'shell-path': 'fail' });
  writeFileSync(f.rc, `${beginMark}\nexport PATH='/somewhere/else':"$PATH"\n${endMark}\n`);
  assert.equal(rows({ PATH: [...f.folders].join(':') })['shell-profile'], 'fail');
  writeFileSync(f.rc, '');
  assert.equal(rows({ PATH: [...f.folders].join(':') })['shell-profile'], 'fail');
  assert.deepEqual(shellHealth({ ...receipt, setup: { answers: {} } }, f.root, { env: {} }), [], 'older installs show no new rows');
  const skipped = { ...receipt, setup: { answers: { shellProfile: false } } };
  assert.deepEqual(shellHealth(skipped, f.root, { env: { PATH: '/usr/bin' }, platform: 'linux' }).map(r => r.status), ['fail']);
  assert.deepEqual(shellHealth(skipped, f.root, { env: { PATH: '/usr/bin' }, platform: 'linux', installing: true }), [], 'setup waits for a new shell before testing its PATH');
});
