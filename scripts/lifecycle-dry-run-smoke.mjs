import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRepair, planUninstall, planUpgrade } from '../src/lifecycle.mjs';
import { windowsLifecycle } from '../src/install/windows.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const base = mkdtempSync(join(tmpdir(), 'agent-kit-lifecycle-smoke-'));
try {
  const home = join(base, 'home'), root = join(home, 'Agentic', '.tools'), firstmate = join(home, 'Agentic', 'firstmate');
  mkdirSync(root, { recursive: true }); mkdirSync(firstmate); mkdirSync(home, { recursive: true });
  const release = JSON.parse(readFileSync(join(source, 'manifests', 'pilot-skeleton.json'))).release;
  const receipt = { schemaVersion: 1, release, phases: {}, setup: { answers: { channel: 'releases', globalHooks: false },
    paths: { root: join(home, 'Agentic'), installRoot: root, firstmateHome: firstmate } } };
  const receiptPath = join(root, 'receipt.json');
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const before = readFileSync(receiptPath, 'utf8');
  if (process.platform === 'win32') {
    const inspected = { supported: true, ready: true, build: 'smoke', linuxArch: 'x64', prerequisites: [], steps: [], wsl: { target: { name: 'Ubuntu' } } };
    for (const command of ['repair', 'upgrade', 'uninstall']) {
      const result = windowsLifecycle({ command, root: '~/Agentic', installRoot: '~/Agentic/.tools' }, {}, inspected);
      assert.equal(result.status, 'handoff-ready');
      assert.equal(result.argv.includes(command), true);
    }
    for (const command of ['repair', 'upgrade', 'uninstall']) {
      const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'windows/agent-kit.ps1', command, '--root', '~/Agentic'],
        { cwd: source, encoding: 'utf8', timeout: 30000 });
      assert.ok([0, 1].includes(run.status), `${command}: ${run.stderr}`);
      assert.match(run.stdout, /handoff-ready|needs-setup/);
    }
  } else {
    const options = { installRoot: root, home, env: { HOME: home, PATH: '/usr/bin:/bin' }, platform: process.platform, arch: process.arch,
      nodeVersion: '24.21.0', isRunning: () => false };
    const manifest = JSON.parse(readFileSync(join(source, 'manifests', 'pilot-skeleton.json')));
    assert.equal(planRepair(manifest, options).command, 'repair');
    assert.equal(planUninstall(options).command, 'uninstall');
    const plan = await planUpgrade({ ...options, resolveCommit: () => 'a'.repeat(40), fetchKit: async (_commit, _env, destination) => {
      mkdirSync(destination, { recursive: true });
      cpSync(join(source, 'src'), join(destination, 'src'), { recursive: true });
      cpSync(join(source, 'manifests'), join(destination, 'manifests'), { recursive: true });
      writeFileSync(join(destination, 'manifests', 'pilot-skeleton.json'), `${JSON.stringify({ ...manifest, release: 'smoke-next', tools: [] })}\n`);
    } });
    assert.equal(plan.command, 'upgrade');
    assert.equal(plan.channel, 'releases');
    rmSync(plan.stage, { recursive: true, force: true });
  }
  assert.equal(readFileSync(receiptPath, 'utf8'), before);
  assert.ok(existsSync(firstmate));
  console.log(`repair, upgrade and uninstall dry-run smoke passed on ${process.platform}`);
} finally { rmSync(base, { recursive: true, force: true }); }
