# Agent Kit single installer for Windows. The full stack runs inside WSL2: this script fetches the reviewed kit at
# one pinned commit with your own GitHub CLI sign-in, then runs the kit's Windows bootstrap (windows\agent-kit.ps1),
# which checks Node.js and WSL2 and hands off to install.sh inside your WSL2 distribution at that same commit.
# The guided questions, summary, install and health check then run inside WSL. It never installs Windows software,
# enables Windows features, asks for elevation, restarts Windows, or reads, prints or stores a token.
#
# From a normal (not administrator) PowerShell window; Bypass applies to this one PowerShell process only:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 [-DryRun] [--channel releases|main] [setup flags...]
# -DryRun checks Windows and WSL2 and prints the handoff command without running it.
# --commit <sha> uses that reviewed commit; --kit-dir <checkout> uses a local clean kit checkout instead of fetching.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Repo = 'amelie-pierce/agent-kit'

function Say([string]$Message) { [Console]::Error.WriteLine($Message) }
function Stop-Kit([string]$Message) { Say "agent-kit: $Message"; exit 1 }
# Windows PowerShell 5.1 turns redirected native stderr into errors under 'Stop', so native calls run under 'Continue'.
function Invoke-Native([string]$File, [string[]]$Arguments) {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $File @Arguments 2>$null
    return @{ Code = $LASTEXITCODE; Out = ((@($out) | ForEach-Object { "$_" }) -join "`n").Trim() }
  } finally { $ErrorActionPreference = $saved }
}

if ([Environment]::OSVersion.Platform -ne 'Win32NT') { Stop-Kit 'install.ps1 is for Windows. On macOS or Linux run: bash install.sh' }

$dryRun = $false; $yes = $false; $channel = ''; $commit = ''; $kitDir = ''; $root = ''; $installRoot = ''; $distro = ''
$pass = @()
for ($i = 0; $i -lt $args.Count; $i++) {
  $arg = "$($args[$i])"
  if ($arg -ieq '-DryRun' -or $arg -eq '--dry-run') { $dryRun = $true; continue }
  if ($arg -in @('--commit', '--kit-dir', '--channel')) {
    if ($i + 1 -ge $args.Count) { Stop-Kit "$arg needs a value" }
    $value = "$($args[++$i])"
    if ($arg -eq '--commit') { $commit = $value; continue }
    if ($arg -eq '--kit-dir') { $kitDir = $value; continue }
    $channel = $value
    $pass += @($arg, $value)
    continue
  }
  if ($arg -in @('--root', '--install-root', '--distro') -and $i + 1 -lt $args.Count) {
    $value = "$($args[$i + 1])"
    if ($arg -eq '--root') { $root = $value } elseif ($arg -eq '--install-root') { $installRoot = $value } else { $distro = $value }
  }
  if ($arg -eq '--kit-commit') { Stop-Kit '--kit-commit is set by the installer; use --commit' }
  if ($arg -eq '--handoff') { continue }
  if ($arg -eq '--yes') { $yes = $true }
  $pass += $arg
}
if ($channel -notin @('', 'releases', 'main')) { Stop-Kit '--channel must be releases or main' }
if ($commit -and $commit -notmatch '^[0-9a-f]{40}$') { Stop-Kit '--commit must be a full 40-character commit SHA' }

Say 'Agent Kit installer for Windows. This script will:'
Say '  1. check that git, the GitHub CLI and Node.js are on the Windows PATH (it never installs them);'
Say '  2. check that you are signed in with your own gh login (it never reads or prints the token);'
Say '  3. fetch the reviewed kit at one pinned commit into a temporary folder and run windows\agent-kit.ps1, which checks'
Say '     WSL2 and hands off to install.sh inside your WSL2 distribution; the questions and the install happen there.'
Say '  Steps that need administrator rights or a restart are printed for you to run yourself.'
if ($dryRun) { Say '  -DryRun: Windows and WSL2 are checked and the handoff command is printed; nothing is handed off or installed.' }

$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$saved = $null
# Reads the receipt at the chosen root inside WSL; $null when there is none.
function Read-Receipt {
  if (-not (Test-Path -LiteralPath $wsl)) { return $null }
  $base = if ($installRoot) { $installRoot } elseif ($root -eq '~') { '.' } elseif ($root.StartsWith('~/')) { $root.Substring(2) } else { $root }
  $path = if ($installRoot) { "$base/receipt.json" } else { "$base/.tools/receipt.json" }
  $target = if ($distro) { @('-d', $distro) } else { @() }
  $read = Invoke-Native $wsl ($target + @('--exec', 'sh', '-c', 'set -f; IFS=; cd || exit 1; cat -- $1', 'agent-kit', $path))
  if ($read.Code -ne 0) { return $null }
  try { $savedChannel = "$(($read.Out | ConvertFrom-Json).setup.answers.channel)" } catch { $savedChannel = '' }
  return @{ Path = $path; Channel = $savedChannel }
}
if (-not $root) {
  $root = '~/Agentic'
  if (-not $yes) {
    for ($attempt = 1; ; $attempt++) {
      $answer = Read-Host '1. Root folder for your agent setup inside WSL (holds firstmate/, .tools/, .treehouse/ and .zoe-fleet/) [~/Agentic]'
      if ($null -eq $answer) { Stop-Kit 'input ended before every question was answered; pass --yes to accept the shown defaults' }
      if (-not $answer.Trim()) { $answer = '~/Agentic' }
      $answer = $answer.Trim()
      if ($answer -match '^(/|~/)[A-Za-z0-9._/-]*[A-Za-z0-9._-]$' -and @($answer.Split('/') | Select-Object -Skip 1 | Where-Object { $_ -in @('', '.', '..') }).Count -eq 0 -and $answer -notmatch '^/mnt(/|$)') { break }
      Say "The root folder must be a Linux path inside WSL, such as ~/Agentic or /home/<you>/Agentic, using letters, digits, ., _, - and /, and not a Windows drive under /mnt (got $answer)"
      if ($attempt -ge 3) { Stop-Kit 'no valid answer to: 1. Root folder' }
    }
    $root = $answer
    $saved = Read-Receipt
    if (-not $saved) {
      for ($attempt = 1; ; $attempt++) {
        $confirm = Read-Host "   Use $root inside WSL (y/n) [y]"
        if ($null -eq $confirm) { Stop-Kit 'input ended before every question was answered; pass --yes to accept the shown defaults' }
        if ($confirm.Trim() -in @('', 'y', 'yes')) { break }
        if ($confirm.Trim() -in @('n', 'no')) { Stop-Kit 'setup cancelled; nothing was written' }
        if ($attempt -ge 3) { Stop-Kit "no y or n answer to: Use $root" }
      }
    }
  }
  $pass = @('--root', $root) + $pass
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say 'Note: this window is elevated. Agent Kit does not need administrator rights; a normal PowerShell window is enough.'
}

$missing = @()
foreach ($tool in @(
    @{ Name = 'git'; Help = 'Git for Windows: https://git-scm.com/download/win or winget install --exact --id Git.Git' },
    @{ Name = 'gh'; Help = 'GitHub CLI: https://cli.github.com or winget install --exact --id GitHub.cli' },
    @{ Name = 'node'; Help = 'Node.js: https://nodejs.org/en/download or winget install --exact --id OpenJS.NodeJS.LTS' })) {
  if (-not (Get-Command $tool.Name -CommandType Application -ErrorAction SilentlyContinue)) { $missing += $tool.Help }
}
if ($missing.Count) {
  Say 'Install these yourself on Windows first, open a new PowerShell window, then rerun install.ps1 (nothing was changed):'
  $missing | ForEach-Object { Say "  - $_" }
  exit 1
}

$signedIn = (Invoke-Native 'gh' @('auth', 'status', '--hostname', 'github.com')).Code -eq 0
if (-not $signedIn) {
  if ($dryRun -and $kitDir) { Say 'Note: you are not signed in to GitHub yet. Before a real run, sign in with your own account: gh auth login' }
  else { Stop-Kit 'sign in to GitHub with your own account first: gh auth login  (the kit repository is private; the installer never asks for or stores a token)' }
}

$tmp = $null
try {
  if ($kitDir) {
    $kit = (Resolve-Path -LiteralPath $kitDir).Path
    if (-not (Test-Path -LiteralPath (Join-Path $kit 'windows\agent-kit.ps1'))) { Stop-Kit '--kit-dir must be a checkout of the agent kit' }
    Say "Using the local kit checkout $kit."
  } else {
    if (-not $commit) {
      if (-not $channel) {
        # A rerun keeps the update channel saved in the receipt inside WSL; an explicit --channel wins.
        if (-not $saved) { $saved = Read-Receipt }
        if ($saved -and $saved.Channel -in @('releases', 'main')) { $channel = $saved.Channel; Say "Using the $channel channel saved in $($saved.Path) inside WSL." }
      }
      if (-not $channel) { $channel = 'releases' }
      $query = if ($channel -eq 'releases') { @('api', "repos/$Repo/commits?sha=main&path=manifests/pilot-skeleton.json&per_page=1", '--jq', '.[0].sha') }
        else { @('api', "repos/$Repo/commits/main", '--jq', '.sha') }
      $commit = (Invoke-Native 'gh' $query).Out
    }
    if ($commit -notmatch '^[0-9a-f]{40}$') { Stop-Kit "cannot read the reviewed kit commit from GitHub (got '$commit')" }
    $relation = (Invoke-Native 'gh' @('api', "repos/$Repo/compare/$commit...main", '--jq', '.status')).Out
    if ($relation -notin @('ahead', 'identical')) { Stop-Kit "commit $commit is not on main, so it is not a reviewed kit commit" }
    Say "Fetching the reviewed kit at $commit ($(if ($channel) { $channel } else { 'releases' }) channel) with your own GitHub CLI sign-in."
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("agent-kit-" + [Guid]::NewGuid().ToString('N'))
    $kit = Join-Path $tmp 'kit'
    $env:GIT_TERMINAL_PROMPT = '0'
    # gh hands git your credentials for this one fetch only; nothing is written to your git configuration.
    foreach ($step in @(
        @('init', '-q', $kit),
        @('-C', $kit, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'fetch', '-q', '--depth', '1', "https://github.com/$Repo.git", $commit),
        @('-C', $kit, '-c', 'core.autocrlf=false', 'checkout', '-q', '--detach', 'FETCH_HEAD'))) {
      if ((Invoke-Native 'git' $step).Code -ne 0) { Stop-Kit "could not fetch the kit at $commit; check your network and that your GitHub account can read $Repo" }
    }
    if ((Invoke-Native 'git' @('-C', $kit, 'rev-parse', 'HEAD')).Out -ne $commit) { Stop-Kit "fetched kit is not at $commit" }
    if (-not (Test-Path -LiteralPath (Join-Path $kit 'src\setup.mjs'))) { Stop-Kit "the kit at $commit predates this installer; rerun with --channel main, or ask the kit owner for a newer release" }
  }
  $bootstrap = @()
  if ($dryRun) { $bootstrap += '-DryRun' }
  $bootstrap += 'setup'
  $bootstrap += $pass
  if (-not $dryRun) { $bootstrap += '--handoff' }
  & (Join-Path $kit 'windows\agent-kit.ps1') @bootstrap
  $code = $LASTEXITCODE
} finally {
  if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
exit $code
