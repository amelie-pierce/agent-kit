import assert from 'node:assert/strict';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProfileChanged, applyProfile, beginMark, endMark, kitFolders, planProfile, planRemoveProfile, profileTarget, reconcileProfile, removeProfile, renderProfileBlock, restoreProfile, shellHealth, splitProfile } from '../src/shell-profile.mjs';

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

test('Unix kit folders and current-shell PATH use Unix separators on every host', () => {
  const root = '/h/Agentic/.tools';
  const folders = kitFolders(root, 'r1', ['npm']);
  assert.deepEqual(folders, [
    `${root}/bin`, `${root}/releases/r1/bin`, `${root}/releases/r1/npm/node_modules/.bin`,
  ]);
  const receipt = { release: 'r1', phases: { npm: {} }, setup: { answers: {} } };
  assert.deepEqual(shellHealth(receipt, root, { env: { PATH: folders.join(':') }, platform: 'linux' }).map(r => [r.id, r.status]), [['shell-path', 'pass']]);
  assert.deepEqual(shellHealth(receipt, root, { env: { PATH: folders[0] }, platform: 'linux' }).map(r => [r.id, r.status]), [['shell-path', 'fail']]);
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
  const edited = renderProfileBlock(f.folders).replace(':"$PATH"', `:'/opt/custom/bin':"$PATH"`);
  writeFileSync(f.rc, `${edited}\n`);
  assert.equal(rows({ PATH: f.folders.join(':') })['shell-profile'], 'pass', 'an added PATH entry keeps the kit folders effective');
  writeFileSync(f.rc, `${edited.replace(`'${f.folders[1]}'`, `"${f.folders[1]}"`)}\n`);
  assert.equal(rows({ PATH: f.folders.join(':') })['shell-profile'], 'pass', 'a literal double-quoted kit folder is effective');
  writeFileSync(f.rc, `${edited.replace(`'${f.folders[1]}':`, '')}\n`);
  assert.equal(rows({ PATH: f.folders.join(':') })['shell-profile'], 'fail', 'dropping one kit folder fails');
  writeFileSync(f.rc, `${renderProfileBlock(f.folders).replace(endMark, `export PATH=/usr/bin\n${endMark}`)}\n`);
  assert.equal(rows({ PATH: [...f.folders].join(':') })['shell-profile'], 'fail', 'a later PATH assignment makes the block ineffective');
  writeFileSync(f.rc, `${beginMark}\n# ${renderProfileBlock(f.folders).split('\n')[2]}\n${endMark}\n`);
  assert.deepEqual(rows({ PATH: '/usr/bin' }), { 'shell-profile': 'fail', 'shell-path': 'fail' });
  writeFileSync(f.rc, `${beginMark}\nexport PATH='/somewhere/else':"$PATH"\n${endMark}\n`);
  assert.equal(rows({ PATH: [...f.folders].join(':') })['shell-profile'], 'fail');
  writeFileSync(f.rc, '');
  assert.equal(rows({ PATH: [...f.folders].join(':') })['shell-profile'], 'fail');
  const older = { ...receipt, setup: { answers: {} } };
  assert.deepEqual(shellHealth(older, f.root, { env: { PATH: '/usr/bin' }, platform: 'linux' }).map(r => [r.id, r.status]), [['shell-path', 'fail']]);
  assert.deepEqual(shellHealth(older, f.root, { env: { PATH: f.folders.join(':') }, platform: 'linux' }).map(r => [r.id, r.status]), [['shell-path', 'pass']]);
  assert.deepEqual(shellHealth({ ...receipt, setup: undefined }, f.root, { env: { PATH: '/usr/bin' }, platform: 'linux' }).map(r => [r.id, r.status]), [['shell-path', 'fail']]);
  assert.deepEqual(shellHealth(older, f.root, { env: { PATH: '/usr/bin' }, platform: 'linux', installing: true }), []);
  const skipped = { ...receipt, setup: { answers: { shellProfile: false } } };
  assert.deepEqual(shellHealth(skipped, f.root, { env: { PATH: '/usr/bin' }, platform: 'linux' }).map(r => r.status), ['fail']);
  assert.deepEqual(shellHealth(skipped, f.root, { env: { PATH: '/usr/bin' }, platform: 'linux', installing: true }), [], 'setup waits for a new shell before testing its PATH');
});

// Concurrent edits: the hook runs between the kit's read and its replace, the way an editor saving the file would.
const profileReceipt = { release: 'r1', phases: { npm: {}, 'npm-codex': {} }, setup: { answers: { shellProfile: true } } };
const reconcile = (f, beforeReplace, record = null) => reconcileProfile({ ...profileReceipt, setup: { ...profileReceipt.setup, shellProfile: record } }, f.root,
  { env: f.env, home: f.home, platform: 'linux', beforeReplace });
const editsOnCall = (...calls) => { let n = 0; return path => { n += 1; if (calls.includes(n)) appendFileSync(path, `export EDIT_${n}=1\n`); }; };
const leftovers = f => readdirSync(f.home).filter(name => name.endsWith('.tmp'));

test('an edit between the read and the write stops the add and leaves the new text', posixOnly, async t => {
  const f = fixture(t);
  writeFileSync(f.rc, 'alias a=b\n');
  await assert.rejects(reconcile(f, editsOnCall(1)), error => error instanceof ProfileChanged && error.message.includes(f.rc) && error.message.includes('re-run the command'));
  const text = readFileSync(f.rc, 'utf8');
  assert.equal(text, 'alias a=b\nexport EDIT_1=1\n');
  assert.deepEqual(leftovers(f), []);
  assert.ok(readdirSync(join(f.root, 'backups', 'shell-profile')).length >= 1, 'the backup still comes before the modification attempt');
});

test('an edit to an absent profile stops the add without replacing the new file', posixOnly, async t => {
  const f = fixture(t);
  await assert.rejects(reconcile(f, path => writeFileSync(path, 'export MINE=1\n')), ProfileChanged);
  assert.equal(readFileSync(f.rc, 'utf8'), 'export MINE=1\n');
  assert.deepEqual(leftovers(f), []);
});

test('a concurrent block edit or symlink stops refresh without replacing the profile', posixOnly, async t => {
  const f = fixture(t);
  const record = (await reconcile(f)).record;
  const next = { ...profileReceipt, release: 'r2' };
  const editBlock = path => writeFileSync(path, readFileSync(path, 'utf8').replace('Managed by', 'Mine, managed by'));
  await assert.rejects(reconcileProfile({ ...next, setup: { ...next.setup, shellProfile: record } }, f.root, { env: f.env, home: f.home, platform: 'linux', beforeReplace: editBlock }), ProfileChanged);
  assert.match(readFileSync(f.rc, 'utf8'), /Mine, managed by/);
  assert.match(readFileSync(f.rc, 'utf8'), /releases\/r1\//);
  const g = fixture(t), real = join(g.home, 'dotfiles-zshrc');
  writeFileSync(g.rc, 'alias a=b\n');
  await assert.rejects(reconcile(g, path => { writeFileSync(real, 'mine\n'); rmSync(path); symlinkSync(real, path); }), ProfileChanged);
  assert.equal(lstatSync(g.rc).isSymbolicLink(), true);
  assert.equal(readFileSync(real, 'utf8'), 'mine\n');
  assert.deepEqual([...leftovers(f), ...leftovers(g)], []);
});

test('uninstall stops on the first edit and leaves each profile untouched', posixOnly, async t => {
  const f = fixture(t);
  writeFileSync(f.rc, 'alias a=b\n');
  const record = await applyProfile(plan(f), f.root);
  const before = readFileSync(f.rc, 'utf8');
  await assert.rejects(removeProfile(f.root, planRemoveProfile(record), { beforeReplace: editsOnCall(1) }), ProfileChanged);
  assert.equal(readFileSync(f.rc, 'utf8'), `${before}export EDIT_1=1\n`);
  const g = fixture(t);
  writeFileSync(g.rc, 'alias a=b\n');
  const rec = await applyProfile(plan(g), g.root), gBefore = readFileSync(g.rc, 'utf8');
  await assert.rejects(removeProfile(g.root, planRemoveProfile(rec), { beforeReplace: editsOnCall(1) }), ProfileChanged);
  assert.equal(readFileSync(g.rc, 'utf8'), `${gBefore}export EDIT_1=1\n`);
  const h = fixture(t);
  const created = await applyProfile(plan(h), h.root);
  await assert.rejects(removeProfile(h.root, planRemoveProfile(created), { beforeReplace: editsOnCall(1) }), ProfileChanged);
  assert.match(readFileSync(h.rc, 'utf8'), /EDIT_1/, 'a file the kit created is not deleted once the person wrote to it');
  assert.deepEqual([...leftovers(f), ...leftovers(g), ...leftovers(h)], []);
});

test('an unchanged CRLF profile keeps its bytes around the added block and keeps its mode', posixOnly, async t => {
  const f = fixture(t);
  writeFileSync(f.rc, 'alias a=b\r\nexport X=1\r\n', { mode: 0o600 });
  const done = await reconcile(f);
  assert.equal(readFileSync(f.rc, 'utf8'), `alias a=b\r\nexport X=1\r\n\n${renderProfileBlock(f.folders)}\n`);
  assert.equal(lstatSync(f.rc).mode & 0o777, 0o600);
  assert.equal((await reconcile(f, editsOnCall(1, 2), done.record)).plan.action, 'verify', 'an unchanged block writes nothing, so no edit can be lost');
});

test('upgrade rollback restores the profile only when the kit block is its one change', posixOnly, async t => {
  const f = fixture(t);
  writeFileSync(f.rc, 'alias a=b\n');
  const before = readFileSync(f.rc), record = await applyProfile(plan(f), f.root);
  assert.equal(await restoreProfile(f.rc, before, record), null);
  assert.equal(readFileSync(f.rc, 'utf8'), 'alias a=b\n');
  await applyProfile(plan(f), f.root);
  appendFileSync(f.rc, 'export MINE=1\n');
  assert.match(await restoreProfile(f.rc, before, record), /changed during the upgrade, so the rollback left it as it is now/);
  assert.match(readFileSync(f.rc, 'utf8'), /MINE=1/);
  const g = fixture(t), created = await applyProfile(plan(g), g.root);
  assert.equal(await restoreProfile(g.rc, null, created), null);
  assert.equal(existsSync(g.rc), false, 'a profile the upgrade created goes away again');
  const h = fixture(t);
  writeFileSync(h.rc, 'alias a=b\n');
  const hb = readFileSync(h.rc), hr = await applyProfile(plan(h), h.root);
  assert.match(await restoreProfile(h.rc, hb, hr, { beforeReplace: path => appendFileSync(path, 'export LATE=1\n') }), /left it as it is now/);
  assert.match(readFileSync(h.rc, 'utf8'), /LATE=1/);
  assert.deepEqual([...leftovers(f), ...leftovers(g), ...leftovers(h)], []);
});
