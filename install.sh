#!/usr/bin/env bash
# Agent Kit single installer for macOS and Linux, including Linux inside WSL2 (install.ps1 hands off here).
# It checks the person-installed prerequisites, uses your own GitHub CLI sign-in to fetch the reviewed kit
# at one pinned commit, then runs the kit's guided setup: questions, summary, install, sign-in guide, doctor.
# It never runs sudo or edits shell profiles. The optional typesafe.ai key is entered privately.
#
#   bash install.sh [--dry-run] [--yes] [--root <folder>] [--channel releases|main] [setup flags...]
#
# install.sh options: --commit <sha> uses that reviewed commit; --kit-dir <checkout> uses a local clean kit
# checkout instead of fetching (for kit development and CI). Every other flag goes to the guided setup.
set -euo pipefail
umask 077

REPO=amelie-pierce/agent-kit
# Floors from manifests/pilot-skeleton.json; a test keeps them equal.
NODE_MIN=24.15.0
GIT_MIN=2.20.0
GH_MIN=2.0.0

say() { printf '%s\n' "$*" >&2; }
die() { say "agent-kit: $*"; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash install.sh [--dry-run] [--yes] [--root <folder>] [--channel releases|main] [setup flags...]

  --dry-run          ask, check and print the summary; write nothing
  --yes              unattended: use saved answers, flags and the shown defaults; no questions
  --root <folder>    root folder (default ~/Agentic): firstmate/, .tools/, .treehouse/, .zoe-fleet/
  --channel <name>   releases (default: the newest reviewed release) or main
  --commit <sha>     use this reviewed commit of the kit
  --kit-dir <dir>    use a local clean kit checkout instead of fetching one
  --reconfigure keys  update the optional TYPESAFE_API_KEY in the installed Firstmate home (hidden prompt)

Setup flags: --harness claude|codex|claude,codex, --claude-plan <id>, --codex-plan <id>, --dispatch-mode lean|balanced|full,
  --no-figma, --no-tower, --no-global-hooks,
  --github-owner <name>, --git-name <name>, --git-email <email>, --starter-mate <name>,
  --starter-scope <text>, --reconfigure, --allow-existing-root, --install-root <dir>, --firstmate-home <dir>.
EOF
}

commit='' kit_dir='' channel='' dry_run=0 yes=0 root='' install_root='' reconfigure_keys=0
pass=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --commit) [ "$#" -ge 2 ] || die '--commit needs a value'; commit=$2; shift 2; continue ;;
    --kit-dir) [ "$#" -ge 2 ] || die '--kit-dir needs a value'; kit_dir=$2; shift 2; continue ;;
    --channel) [ "$#" -ge 2 ] || die '--channel needs a value'; channel=$2 ;;
    --root) [ "$#" -ge 2 ] || die '--root needs a value'; root=$2 ;;
    --install-root) [ "$#" -ge 2 ] || die '--install-root needs a value'; install_root=$2 ;;
    --dry-run) dry_run=1 ;;
    --yes) yes=1 ;;
    --reconfigure)
      if [ "${2:-}" = keys ]; then reconfigure_keys=1; shift 2; continue; fi ;;
    --kit-commit) die '--kit-commit is set by install.sh; use --commit' ;;
  esac
  pass+=("$1")
  shift
done
case "$channel" in ''|releases|main) ;; *) die '--channel must be releases or main' ;; esac
if [ -n "$commit" ] && ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then die '--commit must be a full 40-character commit SHA'; fi

if [ "$reconfigure_keys" = 1 ]; then
  say 'Agent Kit key update: opens the installed private key prompt; no kit fetch or vendor sign-in.'
  [ "$dry_run" = 1 ] && say '  --dry-run: shows only whether the key is set; no prompt and nothing is written.'
else
  say 'Agent Kit installer. This script will:'
  say '  1. check Node.js, git and the GitHub CLI (and Homebrew with the Xcode Command Line Tools on macOS);'
  say '     it explains how to install anything missing and never installs it or runs sudo for you;'
  say '  2. check that you are signed in to GitHub with your own gh login (it never reads or prints the token);'
  say '  3. fetch the reviewed kit at one pinned commit and run its guided setup, which asks its questions,'
  say '     shows a summary and writes nothing until you say yes.'
  [ "$dry_run" = 1 ] && say '  --dry-run: nothing is fetched into your root and nothing is written.'
fi

expand_root() {
  case "$1" in
    \~) printf '%s' "$HOME" ;;
    \~/*) printf '%s' "$HOME/${1#\~/}" ;;
    /*) printf '%s' "$1" ;;
    *) return 1 ;;
  esac
}
ask() {  # <question> <default>; the answer is in $reply
  printf '%s [%s]: ' "$1" "$2" >&2
  read -r reply || [ -n "$reply" ] || die 'input ended before every question was answered; pass --yes to accept the shown defaults'
  [ -t 0 ] || printf '\n' >&2
  reply=${reply:-$2}
}
default_root=\~/Agentic root_given=1
if [ -z "$root" ]; then
  root_given=0
  root=$default_root
  if [ "$yes" = 0 ]; then
    for attempt in 1 2 3; do
      ask '1. Root folder for your agent setup (holds firstmate/, .tools/, .treehouse/ and .zoe-fleet/)' "$default_root"
      expand_root "$reply" >/dev/null && break
      say "root folder must be an absolute path or start with ~/ (got $reply)"
      [ "$attempt" = 3 ] && die "no valid answer to: 1. Root folder"
    done
    root=$reply
  fi
fi
root_path=$(expand_root "$root") || die "root folder must be an absolute path or start with ~/ (got $root)"
receipt=${install_root:-$root_path/.tools}/receipt.json
if [ "$reconfigure_keys" = 1 ]; then
  [ -f "$receipt" ] || die "no kit receipt at $receipt; install the kit first"
  kit_commit=$(node -e 'try { const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).setup?.kit?.commit; if (/^[a-f0-9]{40}$/.test(c || "")) process.stdout.write(c); } catch {}' "$receipt")
  [ -n "$kit_commit" ] || die 'receipt has no installed kit commit'
  kit_bin="${install_root:-$root_path/.tools}/kit/$kit_commit/bin/agent-kit.mjs"
  [ -f "$kit_bin" ] || die 'installed kit command is missing; run agent-kit repair'
  [ -f "${kit_bin%/bin/agent-kit.mjs}/src/keys.mjs" ] || die "the installed kit predates the keys command; upgrade it first with: node \"$kit_bin\" upgrade --install-root \"${install_root:-$root_path/.tools}\" (or rerun bash install.sh), then rerun --reconfigure keys"
  key_args=()
  [ "$yes" = 0 ] && [ "$dry_run" = 0 ] || key_args+=(--yes)
  exec node "$kit_bin" keys --install-root "${install_root:-$root_path/.tools}" ${key_args[@]+"${key_args[@]}"}
fi
if [ "$root_given" = 0 ] && [ "$yes" = 0 ] && [ ! -f "$receipt" ]; then
  for attempt in 1 2 3 4; do
    [ "$attempt" = 4 ] && die "no y or n answer to: Use $root_path"
    ask "   Use $root_path (y/n)" y
    case "$reply" in [yY]|[yY][eE][sS]) break ;; [nN]|[nN][oO]) die 'setup cancelled; nothing was written' ;; esac
  done
fi

version_of() { "$@" 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true; }
version_ge() {
  local i a b
  IFS=. read -r -a a <<< "$1"
  IFS=. read -r -a b <<< "$2"
  for i in 0 1 2; do
    if [ "${a[i]:-0}" -gt "${b[i]:-0}" ]; then return 0; fi
    if [ "${a[i]:-0}" -lt "${b[i]:-0}" ]; then return 1; fi
  done
  return 0
}

os=$(uname -s)
case "$os" in
  Darwin|Linux) ;;
  *) die "this installer runs on macOS and Linux. On Windows, run install.ps1 from PowerShell; it hands off to Linux inside WSL2." ;;
esac

missing=()
if [ "$os" = Darwin ]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    missing+=('Xcode Command Line Tools: run  xcode-select --install  and follow Apple'"'"'s dialog (it may ask for your password; this installer never runs it).')
  fi
  if ! command -v brew >/dev/null 2>&1; then
    missing+=('Homebrew: install it from https://brew.sh . Its installer explains each step and asks for your administrator password itself (sudo); this installer never runs it.')
  fi
fi
need() {  # <command> <minimum> <name> <macOS help> <Linux help>
  local found
  if ! command -v "$1" >/dev/null 2>&1; then
    missing+=("$3 $2 or newer is not on PATH. $([ "$os" = Darwin ] && printf '%s' "$4" || printf '%s' "$5")")
    return
  fi
  found=$(version_of "$1" --version)
  if [ -z "$found" ] || ! version_ge "$found" "$2"; then
    missing+=("$3 ${found:-of unknown version} is older than $2. $([ "$os" = Darwin ] && printf '%s' "$4" || printf '%s' "$5")")
  fi
}
need node "$NODE_MIN" Node.js 'Install it with  brew install node  or from https://nodejs.org/en/download .' \
  'Install it from https://nodejs.org/en/download ; a version manager such as nvm needs no sudo.'
need git "$GIT_MIN" git 'Install it with  brew install git  (or the Xcode Command Line Tools).' \
  'Install it with your package manager, for example  sudo apt-get install git ; sudo asks for your administrator password, and this installer never runs it.'
need gh "$GH_MIN" 'GitHub CLI (gh)' 'Install it with  brew install gh .' \
  'Install it by following https://github.com/cli/cli/blob/trunk/docs/install_linux.md ; its package steps use sudo, which asks for your administrator password; this installer never runs them.'
if [ "${#missing[@]}" -gt 0 ]; then
  say ''
  say 'Install these yourself first, then rerun bash install.sh (nothing was changed):'
  for item in "${missing[@]}"; do say "  - $item"; done
  exit 1
fi

signed_in=1
gh auth status --hostname github.com >/dev/null 2>&1 || signed_in=0
if [ "$signed_in" = 0 ]; then
  if [ "$dry_run" = 1 ] && [ -n "$kit_dir" ]; then
    say 'Note: you are not signed in to GitHub yet. Before a real run, sign in with your own account: gh auth login'
  else
    die 'sign in to GitHub with your own account first: gh auth login  (the kit repository is private; the installer never asks for or stores a token)'
  fi
fi

tmp=''
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
cleanup() { if [ -n "$tmp" ]; then rm -rf "$tmp"; fi; }
trap cleanup EXIT
git_clean() { GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 git "$@"; }

if [ -n "$kit_dir" ]; then
  kit_dir=$(cd "$kit_dir" 2>/dev/null && pwd -P) || die '--kit-dir must be an existing folder'
  [ -e "$kit_dir/.git" ] && [ -f "$kit_dir/bin/agent-kit.mjs" ] || die '--kit-dir must be a git checkout of the agent kit'
  head=$(git_clean -C "$kit_dir" rev-parse HEAD) || die "cannot read the commit of $kit_dir"
  [ -z "$(git_clean -C "$kit_dir" status --porcelain --untracked-files=no)" ] || die "$kit_dir has uncommitted changes to tracked files; commit or discard them first"
  [ -z "$commit" ] || [ "$commit" = "$head" ] || die "--commit $commit differs from the --kit-dir checkout ($head)"
  commit=$head
  kit=$kit_dir
  say "Using the local kit checkout $kit at $commit."
else
  if [ -z "$commit" ]; then
    if [ -z "$channel" ]; then
      if [ -f "$receipt" ]; then
        # A rerun keeps the update channel saved in this install's receipt; an explicit --channel wins.
        channel=$(node -e 'try { const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).setup?.answers?.channel; if (c === "releases" || c === "main") process.stdout.write(c); } catch {}' "$receipt" || true)
        [ -z "$channel" ] || say "Using the $channel channel saved in $receipt."
      fi
    fi
    channel=${channel:-releases}
    if [ "$channel" = releases ]; then
      # The owner approves a release by merging the PR that changes the manifest.
      commit=$(gh api "repos/$REPO/commits?sha=main&path=manifests/pilot-skeleton.json&per_page=1" --jq '.[0].sha') || die 'cannot read the newest reviewed release from GitHub'
    else
      commit=$(gh api "repos/$REPO/commits/main" --jq '.sha') || die 'cannot read the main branch from GitHub'
    fi
  fi
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die "GitHub returned an unexpected commit: $commit"
  relation=$(gh api "repos/$REPO/compare/$commit...main" --jq '.status') || die "cannot compare $commit with main on GitHub"
  case "$relation" in ahead|identical) ;; *) die "commit $commit is not on main, so it is not a reviewed kit commit" ;; esac
  say "Fetching the reviewed kit at $commit (${channel:-releases} channel) with your own GitHub CLI sign-in."
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/agent-kit.XXXXXX")
  kit=$tmp/kit
  git_clean init -q "$kit"
  # gh hands git your credentials for this one fetch only; nothing is written to your git configuration.
  git_clean -C "$kit" -c credential.helper= -c 'credential.helper=!gh auth git-credential' fetch -q --depth 1 "https://github.com/$REPO.git" "$commit" \
    || die "could not fetch the kit at $commit; check your network and that your GitHub account can read $REPO"
  git_clean -C "$kit" checkout -q --detach FETCH_HEAD || die 'could not check out the fetched kit'
  [ "$(git_clean -C "$kit" rev-parse HEAD)" = "$commit" ] || die "fetched kit is not at $commit"
  [ -f "$kit/src/setup.mjs" ] || die "the kit at $commit predates this installer; rerun with --channel main, or ask the kit owner for a newer release"
fi

set +e
root_arg=()
[ "$root_given" = 1 ] || root_arg=(--root "$root_path")
node "$kit/bin/agent-kit.mjs" setup --kit-dir "$kit" --kit-commit "$commit" ${root_arg[@]+"${root_arg[@]}"} ${pass[@]+"${pass[@]}"}
status=$?
set -e
exit "$status"
