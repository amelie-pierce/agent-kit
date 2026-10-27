import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Read-only smoke of the real CLI and the PowerShell bootstrap on a GitHub Windows runner. Nothing here
// enables WSL, installs a distribution, elevates or hands off; `install` runs only as --dry-run.
if (process.platform !== 'win32') throw new Error('run this smoke only on a Windows CI runner');
const profile = process.env.USERPROFILE;
const before = readdirSync(profile).sort();
const paths = ['--install-root', '~/.agent-kit', '--firstmate-home', '~/firstmate'];
const spawn = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  return result;
};
const json = (result, label) => {
  assert.ok([0, 1].includes(result.status), `${label} exited ${result.status}: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.readOnly, true, label);
  assert.equal(parsed.platform.platform, 'windows', label);
  return parsed;
};

const check = json(spawn(process.execPath, ['bin/agent-kit.mjs', 'check', '--json']), 'check');
const plan = json(spawn(process.execPath, ['bin/agent-kit.mjs', 'plan', '--json', ...paths]), 'plan');
const dryRun = json(spawn(process.execPath, ['bin/agent-kit.mjs', 'install', '--dry-run', '--json', ...paths]), 'install --dry-run');
assert.equal(dryRun.command, 'plan');
for (const result of [check, plan, dryRun]) assert.ok(['windows-build', 'wsl', 'terminal', 'browser'].every(id => result.platform.prerequisites.some(x => x.id === id)));
assert.equal(plan.platform.artifactTarget, `wsl2-${plan.platform.linuxArch}`);
assert.ok(plan.plan.tools.every(x => !/[A-Za-z]:\\/.test(x.installLocation)), 'plan locations must be Linux paths');
assert.match(spawn(process.execPath, ['bin/agent-kit.mjs', 'plan']).stdout, /Agent Kit plan: .*\nPlatform: windows\//);

const systemRoot = process.env.SystemRoot || 'C:\\Windows';
for (const shell of ['powershell.exe', 'pwsh.exe']) {
  const bootstrap = args => spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', 'windows\\agent-kit.ps1', ...args]);
  const viaScript = json(bootstrap(['-DryRun', 'install', '--json', ...paths]), `${shell} -DryRun install`);
  assert.equal(viaScript.command, 'plan');
  const refused = bootstrap(['-DryRun', 'install', '--handoff', ...paths]);
  assert.equal(refused.status, 2, `${shell} must refuse --handoff in dry-run`);
  assert.match(refused.stderr, /never hands off/);
}
// Without Node on PATH the bootstrap prints the official download and winget instructions instead of installing.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
env.Path = [join(systemRoot, 'System32'), join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';');
const noNode = spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', 'windows\\agent-kit.ps1', '-DryRun', 'check'], env);
assert.equal(noNode.status, 1, noNode.stderr);
assert.match(noNode.stderr, /nodejs\.org\/en\/download/);
assert.match(noNode.stderr, /winget install --exact --id OpenJS\.NodeJS\.LTS/);

assert.deepEqual(readdirSync(profile).sort(), before, 'USERPROFILE entries changed');
assert.equal(existsSync(join(profile, '.agent-kit')), false);
const wsl = plan.platform.wsl;
console.log(`Windows ${plan.platform.windowsVersion} ${plan.platform.linuxArch}; WSL ${wsl?.service || 'not installed'}; distros ${wsl?.distros?.map(d => `${d.name}:${d.version}`).join(',') || 'none'}; ready ${plan.platform.ready}`);
console.log('Windows read-only check/plan, install --dry-run and PowerShell bootstrap (Windows PowerShell and pwsh) verified');
