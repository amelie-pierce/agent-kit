import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { installPlatform } from '../src/install/macos.mjs';
import { artifactFor } from '../src/platforms/linux.mjs';

// Installs the real wsl2-x64 tower and runtime assets with a WSL2 kernel identity in a disposable HOME.
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('run this smoke only on an Ubuntu x64 CI runner');
const root = mkdtempSync(join(tmpdir(), 'agent-kit-wsl2-tower-smoke-'));
try {
  const home = join(root, 'home'), installRoot = join(root, 'kit'), firstmateHome = join(root, 'firstmate');
  mkdirSync(home);
  const manifest = JSON.parse(readFileSync(new URL('../manifests/pilot-skeleton.json', import.meta.url)));
  const ids = ['firstmate', 'zoe-fleet', 'zoe-fleet-runtime'];
  const subset = { ...manifest, tools: manifest.tools.filter(x => ids.includes(x.id)) };
  const glibcVersion = execFileSync('getconf', ['GNU_LIBC_VERSION'], { encoding: 'utf8' }).match(/(\d+\.\d+)/)[1];
  const options = { platform: 'linux', arch: 'x64', home, installRoot, firstmateHome, libc: 'glibc', glibcVersion,
    procVersion: 'Linux version 6.6.87.2-microsoft-standard-WSL2 (root@build) #1 SMP', env: { HOME: home, PATH: process.env.PATH || '/usr/bin:/bin' } };
  const phases = [...ids, 'zoe-fleet-tower'];
  const first = await installPlatform(subset, options);
  assert.deepEqual(phases.map(id => first.components.find(x => x.id === id)?.status), Array(4).fill('installed'), JSON.stringify(first.components));
  assert.equal(first.status, 'partial');
  assert.equal(first.towerParity, 'installed from verified release; hands-on acceptance pending (Zoetrope Phase B)');
  for (const tool of subset.tools) {
    const expected = artifactFor(tool, 'wsl2-x64').sha256;
    const staged = join(installRoot, 'releases', manifest.release, 'staging', `${tool.id}-${expected}.artifact`);
    assert.equal(createHash('sha256').update(readFileSync(staged)).digest('hex'), expected, `${tool.id} downloaded digest`);
  }
  assert.equal(artifactFor(subset.tools.find(x => x.id === 'zoe-fleet'), 'wsl2-x64').kind, 'release-archive');
  const binary = join(installRoot, 'releases', manifest.release, 'bin', 'zoe-fleet'), body = readFileSync(binary);
  assert.deepEqual([body.readUInt32BE(0), body.readUInt16LE(18)], [0x7f454c46, 0x3e], 'zoe-fleet is a Linux x64 ELF');
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /fc45c4d9ea1d/);
  assert.equal(statSync(join(home, '.config', 'zoe-fleet', 'config')).mode & 0o777, 0o600);
  const second = await installPlatform(subset, options);
  assert.deepEqual(phases.map(id => second.components.find(x => x.id === id)?.status), Array(4).fill('skipped'));
  console.log(`WSL2 tower release install verified (glibc ${glibcVersion}): digests, ELF x64, ${version.stdout.trim()}, config 0600, no-op rerun`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
