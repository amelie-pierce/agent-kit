import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('run this smoke only on an Ubuntu x64 CI runner');
const root = mkdtempSync(join(tmpdir(), 'agent-kit-linux-smoke-'));
try {
  const home = join(root, 'home'), installRoot = join(root, 'kit'), firstmateHome = join(root, 'firstmate');
  mkdirSync(home);
  writeFileSync(join(home, 'unrelated.txt'), 'untouched\n');
  const manifest = JSON.parse(readFileSync(new URL('../manifests/pilot-skeleton.json', import.meta.url)));
  const args = ['bin/agent-kit.mjs', 'install', '--json', '--install-root', installRoot, '--firstmate-home', firstmateHome];
  const env = { HOME: home, PATH: process.env.PATH || '/usr/bin:/bin', SHELL: '/bin/bash' };
  const install = () => {
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 35 * 60_000, maxBuffer: 2 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) throw new Error(`install exited ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  const first = install();
  assert.equal(first.status, 'partial');
  for (const id of ['firstmate', 'herdr', 'treehouse', 'no-mistakes', 'shellcheck', 'actionlint', 'npm']) {
    assert.equal(first.components.find(x => x.id === id)?.status, 'installed', `${id} must install`);
  }
  const receipt = JSON.parse(readFileSync(join(installRoot, 'receipt.json')));
  for (const [id, phase] of Object.entries(receipt.phases)) {
    const tool = manifest.tools.find(x => x.id === id);
    if (tool) assert.equal(phase.artifactSha256, tool.artifacts['linux-x64'].sha256, `${id} receipt pin`);
  }
  for (const tool of manifest.tools.filter(x => receipt.phases[x.id])) {
    const expected = tool.artifacts['linux-x64'].sha256;
    const staged = join(installRoot, 'releases', manifest.release, 'staging', `${tool.id}-${expected}.artifact`);
    assert.equal(createHash('sha256').update(readFileSync(staged)).digest('hex'), expected, `${tool.id} downloaded digest`);
  }
  const second = install();
  assert.deepEqual(second.components.filter(x => ['firstmate', 'herdr', 'treehouse', 'no-mistakes', 'shellcheck', 'actionlint', 'npm'].includes(x.id)).map(x => x.status),
    Array(7).fill('skipped'));
  assert.equal(readFileSync(join(home, 'unrelated.txt'), 'utf8'), 'untouched\n');
  assert.deepEqual(readdirSync(home).filter(x => x === 'unrelated.txt'), ['unrelated.txt']);
  console.log('Linux real-download install, hashes, no-op rerun and unrelated HOME file verified');
} finally {
  rmSync(root, { recursive: true, force: true });
}
