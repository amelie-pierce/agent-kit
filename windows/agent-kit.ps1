# Agent Kit Windows entry. It checks for Node.js at the kit's engines floor, then runs the Node CLI,
# whose Windows preflight checks WSL2 and hands the full install off to Linux inside WSL2.
# It never installs Node, enables Windows features, asks for elevation or restarts Windows.
#
# Usage, from a normal (not administrator) PowerShell window in the kit checkout:
#   powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\windows\agent-kit.ps1 [-DryRun] [check|plan|install ...]
# -DryRun keeps everything read-only: install becomes install --dry-run and --handoff is refused.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Say([string]$Message) { [Console]::Error.WriteLine($Message) }

if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
  Say 'agent-kit: this entry is for Windows. On macOS or Linux run: node bin/agent-kit.mjs <check|plan|install>'
  exit 2
}

$dryRun = $false
$cliArgs = @()
foreach ($arg in $args) {
  if ("$arg" -ieq '-DryRun') { $dryRun = $true } else { $cliArgs += "$arg" }
}
if ($cliArgs.Count -eq 0) { $cliArgs = @('check') }
if ($dryRun) {
  if ($cliArgs -contains '--handoff') { Say 'agent-kit: -DryRun is read-only and never hands off; remove --handoff.'; exit 2 }
  if ($cliArgs[0] -eq 'install' -and -not ($cliArgs -contains '--dry-run')) { $cliArgs += '--dry-run' }
}

$kitRoot = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $kitRoot 'bin\agent-kit.mjs'
$package = Get-Content -Raw -LiteralPath (Join-Path $kitRoot 'package.json') | ConvertFrom-Json
$floor = [version](($package.engines.node -replace '^\s*>=\s*', '').Trim())

Say 'Agent Kit Windows entry. This script will:'
Say "  1. check that Node.js $floor or newer is on PATH (it never installs Node);"
Say "  2. run: node bin\agent-kit.mjs $($cliArgs -join ' ')"
Say '  The full stack installs inside WSL2. Steps that need administrator rights or a restart are printed for you to run yourself.'
if ($dryRun) { Say '  -DryRun: read-only; nothing is installed or handed off.' }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say 'Note: this window is elevated. Agent Kit does not need administrator rights; a normal PowerShell window is enough.'
}

$nodeHelp = @(
  "Install Node.js $floor or newer yourself, then open a new PowerShell window and rerun this script:",
  '  Official installer: https://nodejs.org/en/download',
  '  Or with winget:     winget install --exact --id OpenJS.NodeJS.LTS'
)
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) {
  Say 'Node.js was not found on PATH.'
  $nodeHelp | ForEach-Object { Say $_ }
  exit 1
}
$reported = "$(& $node.Source --version)".Trim()
$parsed = $null
if (-not [version]::TryParse(($reported -replace '^v', ''), [ref]$parsed) -or $parsed -lt $floor) {
  Say "Node.js $reported at $($node.Source) is older than $floor."
  $nodeHelp | ForEach-Object { Say $_ }
  exit 1
}
Say "Node.js $reported at $($node.Source)"

& $node.Source $cli @cliArgs
exit $LASTEXITCODE
