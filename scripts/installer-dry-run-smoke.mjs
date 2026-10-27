import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Dry run of the single installers against this checkout (--kit-dir), so CI tests the code under review rather
// than fetching main. install.sh runs with a disposable HOME; install.ps1 only checks Windows and prints the handoff.
const kit = fileURLToPath(new URL('..', import.meta.url));
const spawn = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: kit, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  return result;
};

if (process.platform === 'win32') {
  const profile = process.env.USERPROFILE;
  const before = readdirSync(profile).sort();
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const result = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'install.ps1', '-DryRun', '--kit-dir', '.', '--yes', '--root', '~/Agentic']);
    assert.ok([0, 1].includes(result.status), `${shell} install.ps1 -DryRun exited ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, /Agent Kit installer for Windows/);
    assert.match(result.stdout, /Agent Kit install \(Windows\): (handoff-ready|needs-setup)/, result.stdout + result.stderr);
    if (/handoff-ready/.test(result.stdout)) assert.match(result.stdout, /agent-kit-setup [0-9a-f]{40} --yes --root '~\/Agentic' --dry-run/);
    const refused = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'install.ps1', '-DryRun', '--kit-dir', '.', '--root', 'C:\\Agentic']);
    assert.equal(refused.status, 2, `${shell} must refuse a Windows root: ${refused.stdout}${refused.stderr}`);
    assert.match(refused.stderr, /Linux path inside WSL/);
    // The saved-channel receipt path, from install.ps1's own Get-ReceiptPath definition without running the script.
    const receipt = spawn(shell, ['-NoProfile', '-NonInteractive', '-Command', [
      '$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath install.ps1).Path, [ref]$null, [ref]$null)',
      "$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-ReceiptPath' }, $true)",
      '. ([scriptblock]::Create($fn.Extent.Text))',
      "Get-ReceiptPath '~/Agentic' ''; Get-ReceiptPath '' '~/Agentic/.tools'; Get-ReceiptPath '~' ''; Get-ReceiptPath '' '/home/x/.tools'"].join('; ')]);
    assert.equal(receipt.status, 0, `${shell} Get-ReceiptPath: ${receipt.stderr}`);
    assert.deepEqual(receipt.stdout.trim().split(/\r?\n/), ['Agentic/.tools/receipt.json', 'Agentic/.tools/receipt.json', './.tools/receipt.json', '/home/x/.tools/receipt.json']);
  }
  assert.deepEqual(readdirSync(profile).sort(), before, 'USERPROFILE entries changed');
  console.log('install.ps1 -DryRun verified under Windows PowerShell and pwsh; nothing was written');
} else {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-kit-installer-smoke-')));
  try {
    const home = join(base, 'home'), root = join(base, 'Agentic');
    mkdirSync(home);
    // gh 2.102+ records a telemetry device id in ~/.local/state/gh on every call, including the sign-in checks that
    // must use the person's own gh state. That is gh's state, not the kit's, so it is switched off for this check.
    const result = spawn('bash', ['install.sh', '--dry-run', '--yes', '--kit-dir', '.', '--root', root], { ...process.env, HOME: home, XDG_CONFIG_HOME: '', XDG_STATE_HOME: '', GH_TELEMETRY: 'false' });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    assert.ok([0, 1].includes(result.status), `install.sh --dry-run exited ${result.status}`);
    for (const text of ['Agent Kit setup summary. Nothing has been written yet.', `1. Root folder: ${root}`, `Firstmate home: ${join(root, 'firstmate')}`,
      `Treehouse pool: ${join(root, '.treehouse')}`, 'Dry run: nothing was written.']) assert.ok(result.stdout.includes(text), text);
    assert.equal(existsSync(root), false, 'dry run created the root');
    assert.deepEqual(readdirSync(home), [], 'dry run wrote into HOME');
    console.log(`install.sh --dry-run verified on ${process.platform}; exit ${result.status}; nothing was written`);
  } finally { rmSync(base, { recursive: true, force: true }); }
}
