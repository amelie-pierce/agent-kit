# Agent Kit

Agent Kit is a per-person setup for Firstmate, Herdr, the custom Zoe fleet tower, Treehouse, agent CLIs, and source-owned skills. One installer sets it all up: `install.sh` on macOS and Linux, and `install.ps1` on Windows, which hands off to the same installer inside WSL2. It reports a partial result until every selected component is verified and the tower has passed hands-on acceptance. It never starts services or signs in for anyone.

## Install

Each person signs in to GitHub with their own account first. The kit repository is private, so the installer is fetched through your own `gh` login, never with an anonymous download.

macOS and Linux (and Linux inside WSL2):

```sh
gh auth login && gh api -H "Accept: application/vnd.github.raw" "repos/amelie-pierce/agent-kit/contents/install.sh?ref=main" > install.sh && bash install.sh
```

Windows, from a normal (not administrator) PowerShell window:

```powershell
gh auth login
gh api -H "Accept: application/vnd.github.raw" "repos/amelie-pierce/agent-kit/contents/install.ps1?ref=main" > install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

`gh api` has no output-file option, so the download uses `>` redirection. `-ExecutionPolicy Bypass` applies to that one PowerShell process only; your machine's execution policy is unchanged. Add `--dry-run` to `bash install.sh` to see every question and the summary without writing anything. On Windows, `-DryRun` on `install.ps1` asks only the root folder question, checks the Windows prerequisites and WSL2, and prints the `wsl.exe` handoff command without running it. That printed command carries `--dry-run`; paste it into the same PowerShell window to see every question and the summary inside WSL, still without writing anything.

The installer runs these steps in order and stops with a clear message at the first failure. A rerun is safe: it resumes (see [Resume](#resume-after-a-failed-install)).

1. **Prerequisites.** It checks Node.js 24.15.0+, git 2.20.0+ and the GitHub CLI 2.0.0+, plus Homebrew and the Xcode Command Line Tools on macOS. If one is missing it prints how to install it and stops. It never installs them and never runs `sudo`: an admin step such as `sudo apt-get install git` or the Homebrew installer is explained for you to run yourself.
2. **Your GitHub sign-in.** It checks `gh auth status` by exit code only. It never reads, prints or stores a token.
3. **The reviewed kit at one pinned commit.** It resolves the channel to a full commit SHA, checks with GitHub that the commit is on `main`, and fetches exactly that commit into a temporary folder. `git` gets your credentials from `gh auth git-credential` for that one fetch, and nothing is written to your git configuration.
4. **Guided setup** (`node bin/agent-kit.mjs setup`): the questions below, the read-only check and plan, and a summary screen. Nothing is written until you answer yes.
5. **Install**, **guided personal sign-ins** and **doctor**, recorded step by step in the private receipt.

On Windows, `install.ps1` checks that git, the GitHub CLI and Node.js are on the Windows PATH and that you are signed in. It then fetches the reviewed kit at the pinned commit into a temporary folder and runs `windows\agent-kit.ps1 setup --handoff`. That checks WSL2 ([Windows personal devices](#windows-personal-devices)) and runs `install.sh --commit <same commit>` inside your WSL2 distribution, where the questions are asked. Windows and WSL each need their own tools and their own GitHub sign-in; see [Windows prerequisites](#windows-prerequisites).

### Windows prerequisites

Install these yourself before running `install.ps1`; the installer checks them and prints what is missing, but never installs them:

- **On Windows:** git, the GitHub CLI (`gh`) and Node.js 24.15.0 or newer on the Windows PATH, for example `winget install --exact --id Git.Git`, `winget install --exact --id GitHub.cli` and `winget install --exact --id OpenJS.NodeJS.LTS` (check `node --version`). Open a new PowerShell window afterwards and sign in with your own account: `gh auth login`.
- **WSL2 with Ubuntu 22.04 or newer** as the distribution the kit hands off to (`wsl -l -v` shows VERSION 2). The kit does not read the Ubuntu version; inside WSL it checks for glibc 2.35 or newer (Ubuntu 22.04) before installing the tower. Without WSL, run `wsl --install -d Ubuntu` in an administrator PowerShell, restart Windows and open Ubuntu once to create your Linux user.
- **Inside Ubuntu:** Node.js 24.15.0 or newer from [nvm](https://github.com/nvm-sh/nvm) or [NodeSource](https://github.com/nodesource/distributions), not `apt install nodejs`, whose Ubuntu package is far older, so that `node` is on PATH for login shells (the handoff runs `bash -l`; check with `wsl -e bash -l -c 'node --version'`); git (`sudo apt-get install git`); and the GitHub CLI from its [Linux install instructions](https://github.com/cli/cli/blob/trunk/docs/install_linux.md). Then sign in again inside Ubuntu with `gh auth login`: it is a separate sign-in from Windows, and Windows and Linux credentials stay separate.

The hands-on Windows check, which teammates run on their own Windows PC, is in [docs/windows-pilot-check.md](docs/windows-pilot-check.md).

### Root folder

The first question is one root folder for your agent setup. The default is `~/Agentic` (on Windows, inside WSL). Everything is derived from it:

| Path | Holds |
| --- | --- |
| `<root>/firstmate` | your new Firstmate home and its projects |
| `<root>/.tools` | the kit install root: pinned binaries under `releases/<release>/`, the private `receipt.json`, backups, and the kit source at `kit/<commit>` |
| `<root>/.tools/bin/treehouse` | a kit-owned Treehouse wrapper that sets `TREEHOUSE_ROOT=<root>`, so your Treehouse pool is `<root>/.treehouse` (an explicit `treehouse --root` still wins) |
| `<root>/.treehouse` | the Treehouse worktree pool for your Firstmate home |
| `<root>/.zoe-fleet` | the fleet tower state, passed to the launcher with `setup --state` |
| `<root>/secondmates/<name>` | the starter second mate's home, when you ask for one |

The root must be an absolute path or start with `~/`. It is always refused when it is your home directory itself, a folder that contains your home directory, or a system location, or when it sits inside an existing Firstmate home or a git checkout. Inside WSL it is also refused on a Windows drive under `/mnt`. A root that already holds another Firstmate home or other files needs your confirmation; unattended runs need `--allow-existing-root`. An existing non-empty `<root>/firstmate`, or a non-empty `<root>/.tools` without a kit receipt, is always refused: the kit never touches an existing Firstmate home. The root and its derived paths are recorded in the receipt, so doctor and update reuse them and a rerun cannot move them.

Two locations stay outside the root by their own design, and the summary says so. The tower launcher reads its config only from `${XDG_CONFIG_HOME:-~/.config}/zoe-fleet/config`, since it has no config override; the kit writes that file (0600) and points it at `<root>/.zoe-fleet`. Firstmate gives each second mate its own crew pool under `${XDG_STATE_HOME:-~/.local/state}/firstmate/treehouse-pools/` (`bin/fm-wake-lib.sh`), and the kit does not change that. The kit never edits shell profiles: at the end it prints the folders to add to the start of your PATH, with `<root>/.tools/bin` first so the Treehouse wrapper wins.

### Questions

Every question shows its default and, except the key, has a matching flag. The sole optional secret question uses hidden terminal input. The installer never asks for vendor login credentials, version pins, timezone or locale.

| # | Question | Default | Flag |
| --- | --- | --- | --- |
| 1 | Root folder | `~/Agentic` | `--root <folder>` |
| 2 | Agent CLIs: Codex, Claude or both (Claude is offered when its CLI is installed) | Codex | `--harness codex`, `claude` or `claude,codex` |
| 2a, 2b | Subscription plan for each chosen agent CLI; shapes the [starter dispatch rules](#starter-dispatch-rules-and-jev). Claude: `pro`, `max5x`, `max20x`, `team-standard`, `team-premium`, `enterprise-standard`, `enterprise-premium`, `api`. Codex: `plus`, `pro`, `business-standard`, `business-premium`, `enterprise-edu`, `api` | skip | `--claude-plan <id>`, `--codex-plan <id>` (`skip` keeps Firstmate's template) |
| 2c | Starter routing mode, used once the key is set: `lean`, `balanced` or `full`. Warns before `full` on Pro, Team Standard, Enterprise standard, Plus and Business Standard | `lean` for those plans and API keys, otherwise `balanced` | `--dispatch-mode <mode>` |
| 3 | Figma support: checks `figma-cli` with its install link and guides Figma Desktop sign-in; never patches or restarts Figma | on | `--no-figma` (`--with-figma` still accepted) |
| 4 | Fleet tower | on | `--no-tower` (`--with-tower`) |
| 5 | Register global hooks and skills; lists every file and link, each backed up first | on | `--no-global-hooks` (`--global-hooks`) |
| 6 | GitHub account or organization for your projects; recorded only, nothing is created on GitHub | your signed-in `gh` login | `--github-owner <name>` |
| 7 | Git name and email; an existing value changes only after an explicit yes, with `git config --global` | keep | `--git-name <name>`, `--git-email <email>` |
| 8 | Starter second mate, with a name and a one-line scope | no | `--starter-mate <name>`, `--starter-scope <text>` (`--no-starter-mate`) |
| 9 | Update channel | reviewed releases | `--channel releases` or `main` |
| 10 | Optional typesafe.ai dispatch key, typed at a hidden prompt | skip | none; the value is never a flag (later: `--reconfigure keys`) |

With `both` agent CLIs, the kit installs the Codex CLI, checks the Claude CLI, and registers hooks for both. `--yes` runs unattended: no questions, saved answers and flags first, then the defaults. Without a terminal and without `--yes`, answers are read line by line from standard input.

### Optional dispatch key

The kit requires **no `.env` keys** for basic Firstmate dispatch. `TYPESAFE_API_KEY` is the only optional key it offers to configure. Get your own key from the [TypeSafe API keys page](https://console.typesafe.ai/keys). It belongs in `<root>/firstmate/.env` (or the chosen `--firstmate-home`), which the pinned Firstmate home ignores in Git. Enabling it sends each job's screened task text to typesafe.ai for Jev typed dispatch. Without it, Jev routing is off and Firstmate uses its normal dispatch rules. The kit does not test the key against the vendor: the vendor does not document a zero-cost validation call. Invalid-looking or empty keys are rejected locally.

At question 10, the default is **skip**. Input in a terminal is hidden; the summary and receipt show only `set`, `not set` or `will set`. The hidden prompt is the only way to enter the key: there is no flag, file or environment variable for it, so the value never appears in a command argument or shell history. With `--yes`, `--dry-run` or without a terminal, the key is left unchanged and the summary says how to add it later. If the Firstmate home's `.env` is a symlink, hard link or other non-plain file, setup continues without reading or changing it: the summary shows the key as `not checked` with a warning, and the receipt drops its key-set flag. A rerun keeps an existing key; change it with the key-update command below. The kit writes `.env` with an atomic rename and mode 0600, preserving unrelated lines and comments.

Add, change or remove the key later by running `bash install.sh --reconfigure keys --root /your/Agentic` (or `node bin/agent-kit.mjs keys --root /your/Agentic`) from your own terminal. If you installed before this key command existed, upgrade first with `node /your/Agentic/.tools/kit/<commit>/bin/agent-kit.mjs upgrade --root /your/Agentic` or rerun `bash install.sh`; `--reconfigure keys` says so when the installed kit is too old. An agent can guide you through that command; type the key in your own terminal. Pasting it into agent chat exposes it to the agent session and transcript. The command shows `set` or `not set`, asks before replacement or removal, and changes only this key and the receipt's key-set flag. Relay (`FMX_PAIRING_TOKEN`, `FMX_RELAY_URL`) and mail (`FM_MAIL_*`) are advanced Firstmate facilities that the kit does not set up. Claude, Codex and GitHub credentials remain in their vendor sign-in flows, never in this `.env`.

### Starter dispatch rules and Jev

Entering the key, at question 10 or with `--reconfigure keys`, is the only step. Once the key is set, the kit also writes starter worker routing to `<root>/firstmate/config/crew-dispatch.json`, which is what Jev chooses from. Firstmate's typed resolver (`bin/fm-dispatch-resolve.sh`) needs the key and at least one rule there. Without rules it never asks Jev.

- **Which rules.** The rules follow Firstmate's own strategy template for your mode (`lean`, `balanced` or `full`). They are read from the pinned home's `bin/strategies/<mode>.json` and narrowed to your agent CLIs exactly as `bin/fm-strategy.sh` renders them: four requested-worker rules, then light, standard and hard tiers. With `skip` for every plan the result is byte-identical to Firstmate's.
- **Plans.** `manifests/plan-models.json` holds the owner-approved plan profiles. For each plan and mode it lists the model and effort for the coordinator, light, standard and hard work, requested workers, validation and second mates, plus Claude floors.
  - Each harness with a plan takes its profile's model and effort in every rule slot. An exact-model request runs at high, and the Claude rule notes how Fable is billed on that plan.
  - Small plans get cheaper tiers. For example, Claude Pro routes light work to Haiku 5.5 and standard work to Sonnet 5.5. Codex Plus routes standard work to GPT-6.1 Terra and light work to Luna at high.
  - Hard work and validation stay on Opus 5.5 high or GPT-6.1 Sol high on every plan.
  - Floors appear only on Claude subscriptions. API keys get none, and Codex gets none until its quota-axi scope is confirmed.
  - Enterprise/Edu routes GPT-6 Sol where other Codex plans use GPT-6.1 Sol.
  - Coordinator, validation and second-mate settings are printed for you to apply by hand, as Firstmate prints them. The kit never edits launchers or no-mistakes settings.
- **Who writes them.** A Firstmate whose `bin/fm-strategy.sh --help` documents `--plans` gets `fm-strategy.sh set <mode> --providers <set> --plans claude=<plan>,codex=<plan> --yes`, and Firstmate owns its routing files from then on. The pinned Firstmate (`976c3ba7`) has no `--plans` yet. Until it does, the kit bridges: it renders the same rules from its data file and writes only `config/crew-dispatch.json`. It never writes `config/strategy`, `config/secondmate-harness` or `config/fresh-start.json`, so no autonomy setting changes.
- **Only when the key is set.** When `crew-dispatch.json` exists, Firstmate reads it for every dispatch and requires an explicit harness for each spawn. The kit therefore leaves routing untouched for anyone who has not opted into Jev.
- **Never overwritten.** The kit writes the file only when there is no `crew-dispatch.json` and no `config/strategy`. The receipt records `setup.dispatch` (template, agent CLIs, plan names and a SHA-256 digest of the file the kit wrote). Repair restores a missing kit file while the key is still set. Upgrade, and a rerun after a plan change, refresh the file only while it still matches that digest. Uninstall removes it only while unchanged. A file you or a strategy changed is left alone, and the kit stops tracking it.
- **Changing it later.** Ask Firstmate, run `bin/fm-strategy.sh set <full|balanced|lean>` in the Firstmate home, or edit `config/crew-dispatch.json` yourself. Removing the key with `--reconfigure keys` keeps the rules; Firstmate's normal intake still reads them.
- **Sign-in.** Jev routing gives a clear answer only when you are signed in to the agent CLI, so `quota-axi` can read its quota. Until then the resolver escalates, and Firstmate decides as it does without the key. Sign-ins stay in each vendor's own flow.

Doctor shows `jev: ready (key set, rules present)`, or `not ready: <reason>` as a warning, never the key. After merge, with your own key set, this live check prints nothing secret. It sends only the sample task text to typesafe.ai:

```sh
node ~/Agentic/.tools/kit/<commit>/bin/agent-kit.mjs doctor | grep ' jev:'
printf '# Task\nAdd a unit test for an existing date formatter.\n' > /tmp/jev-sample.md
(cd ~/Agentic/firstmate && bin/fm-dispatch-resolve.sh /tmp/jev-sample.md --project sample); rm -f /tmp/jev-sample.md
```

Expect `status: clear` and a `profile:` line from your rules. `escalate` with `unmeasured` means quota-axi cannot yet see your sign-in.

### Summary screen

Before anything is written, the summary shows every answer, the derived paths, the exact files outside the root that will change, and what will be installed:

```text
Agent Kit setup summary. Nothing has been written yet.
Answers:
  1. Root folder: /Users/you/Agentic
  2. Agent CLIs: codex (plan: codex not-sure)
  3. Figma support: on
  ...
  9. Update channel: releases
  10. Optional TYPESAFE_API_KEY: not set (Firstmate home .env; without it Jev routing is off and normal dispatch rules apply)
      ...
      Starter dispatch rules: not written; the kit writes them only once TYPESAFE_API_KEY is set
Derived paths:
  Firstmate home: /Users/you/Agentic/firstmate
  Kit install root: /Users/you/Agentic/.tools (private receipt /Users/you/Agentic/.tools/receipt.json)
  Kit source: /Users/you/Agentic/.tools/kit/<commit> at <commit>
  Treehouse pool: /Users/you/Agentic/.treehouse through the kit wrapper /Users/you/Agentic/.tools/bin/treehouse
  Tower state: /Users/you/Agentic/.zoe-fleet
Files outside the root that will be touched:
  /Users/you/.claude/settings.json: add agent-kit:gh-axi, ... (an existing file or link is backed up first)
  ...
  /Users/you/.config/zoe-fleet/config: tower launcher config, private 0600 (the launcher has no config override, so it stays in this XDG location)
Will install (pinned and verified; nothing is downloaded until you say yes):
  - Firstmate 976c3ba7... -> /Users/you/Agentic/firstmate
  ...
Person-installed prerequisites (checked, never installed):
  ...
Write these changes now (y/n) [n]:
```

### Saved answers

Answers are recorded in the private receipt (`<root>/.tools/receipt.json`, mode 0600) with the derived paths and the kit commit. The receipt's `setup.keys.TYPESAFE_API_KEY` is only a set/not-set boolean; secrets are never recorded. A rerun asks the root folder, then reuses the saved answers and asks only questions added since. `--reconfigure` asks everything again. A saved git name and email is applied again only while git's global value is unset or still matches it; if you changed it since, the question is asked again, and `--yes` keeps your current value and says so in the summary. `doctor` and `upgrade` read the same answers, so the agent CLIs, Figma, tower and hooks choices carry over.

### Resume after a failed install

Setup records each of its seven steps in the receipt: kit source, tools, Treehouse wrapper, git identity, starter second mate, sign-ins and doctor. Rerunning the installer prints, for example:

```text
Resuming from step 2 of 7 (pinned tools, Firstmate home, tower and global hooks).
  1. kit source at its pinned commit: complete (...)
  2. pinned tools, Firstmate home, tower and global hooks: failed (download failed: HTTP 503)
  3. Treehouse wrapper for the pool under the root: not started
  ...
Completed steps are re-verified against the receipt; only failed or missing steps are redone.
```

Completed steps are re-verified rather than redone. Tool phases check their owned digests, the kit copy checks its commit, the wrapper checks its digest, and the git identity checks its values. Verified artifacts are not downloaded again. A tools step that ends partial (for example, a Linux tower build without Rust) is retried on the next run. Use `repair` for a damaged completed release and `upgrade` for a newer reviewed release.

### Channels and the pinned commit

`releases` (the default) uses the newest commit on `main` that changed `manifests/pilot-skeleton.json`, because the owner approves a release by merging the PR that changes the manifest. `main` uses the current `main` commit. `--commit <sha>` uses one exact commit; it must be on `main`. Each choice resolves to a full SHA before anything is fetched. The installer asks the root folder first, before it resolves the commit, so a rerun without `--channel` uses the channel saved in that root's receipt. An explicit `--channel` wins, and the summary notes when it differs from the saved answer. Kit releases rely on squash merges to `main`: the release resolver takes the newest commit that changed the manifest, so a non-squash merge would resolve to the PR-side manifest commit and the resolver would need to be revisited. The kit copy is kept at `<root>/.tools/kit/<commit>`, and the commit is recorded in the receipt. A rerun with a different kit release than the receipt records stops and points to `agent-kit upgrade`.

### Starter second mate

When you ask for one, setup fills the inert starter charter (`templates/secondmate/charter.md`) with your one-line scope. It then runs Firstmate's own scaffold and seed commands in your new home: `FM_SECONDMATE_CHARTER=... FM_SECONDMATE_SCOPE=... bin/fm-brief.sh <name> --secondmate --no-projects`, then `bin/fm-home-seed.sh <name> <root>/secondmates/<name> --no-projects`. It never launches the mate. Run `bin/fm-spawn.sh <name> --secondmate` yourself when you are ready.

### Advanced flags

| Flag | Effect |
| --- | --- |
| `--dry-run` | ask, check and print the summary; write nothing |
| `--yes` | unattended; no questions |
| `--reconfigure` | ask every question again |
| `--reconfigure keys` (install.sh) | run only the installed key-update command, without a fresh kit fetch; with `--dry-run` it shows only `set` or `not set` and writes nothing |
| `--allow-existing-root` | accept a root that holds other files or another Firstmate home, after you checked it |
| `--install-root <dir>`, `--firstmate-home <dir>` | override one derived path; each is checked against `--root` (it cannot be the root itself, overlap `.treehouse` or `.zoe-fleet`, or contain the other) and against the paths recorded in the receipt |
| `--commit <sha>` | use this reviewed commit (install.sh and install.ps1) |
| `--kit-dir <checkout>` | use a local clean kit checkout instead of fetching (kit development and CI) |
| `--distro <name>` | Windows: hand off to this WSL distribution instead of the default |

## Read-only commands

Use Node.js 24.15.0 or newer. The CLI itself has no runtime dependencies.

```sh
node bin/agent-kit.mjs check
node bin/agent-kit.mjs plan --harness codex --with-figma
node bin/agent-kit.mjs install --dry-run --install-root /your/new/kit-root --firstmate-home /your/new/firstmate
```

`install --dry-run` is exactly `plan`: it makes no changes. `check` and `plan` only inspect and print. They do not probe authentication, run Firstmate bootstrap, or invoke Herdr lifecycle commands. `--json` is available for all commands. `check` is still the initial read-only presence check, not an installed-state doctor for an arbitrary custom root. Linux checks report distro, libc, WSL2, required commands, shell, writable root, PATH conflicts, and a terminal emulator and browser found on PATH (`google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser` or `firefox`). A missing browser is a warning because chrome-devtools-axi and Lavish need one; a missing terminal emulator is unknown because a TTY or SSH session also works. Under WSL2 both are reported unknown: they are on the Windows side and not checked from Linux. Nothing is launched. On every platform, terminal and browser results are advisories: `check` and `plan` list them separately (`advisories` in `--json`) and they do not count toward the gap count or exit code, so a WSL2 or headless SSH host can report ready when every required item passes. Windows checks are described under [Windows personal devices](#windows-personal-devices).

## Doctor

After an install, run `node <root>/.tools/kit/<commit>/bin/agent-kit.mjs doctor`. Run from the kit copy that setup placed, doctor finds its own receipt. From any other checkout, pass `--root <root>` or `--install-root /your/kit-root` (add `--json` for machine-readable results). Doctor reads the kit receipt and owned paths, checks the pinned Firstmate commit and tracked files, kit file digests, launcher and receipt permissions, hook ownership markers, required platform prerequisites, Node floor, and whether another executable shadows a kit binary on PATH. It resolves PATH entries by file path and never runs them. Each component reports installed, verified digest, configured, authenticated, and live-tested states. The `jev` row reports whether typed dispatch is ready (key line set, well-formed rules, resolver tools on PATH); it is a warning when not ready and shows only set / not set for the key. Authentication and live testing remain **unknown**: doctor does not inspect sign-in stores, start services, or probe a live fleet. A failed check exits nonzero. This command changes no files.

## Repair, upgrade and uninstall

Run these from the kit copy at `<root>/.tools/kit/<commit>`; it finds the receipt. From another checkout, pass `--root <root>` or `--install-root <root>/.tools`. Each prints its plan before any installed file changes. In a terminal, answer `y` to apply; `--yes` applies after printing the same plan without a prompt. Without a terminal or `--yes`, only the plan is printed. Each refuses to apply while kit-installed Herdr, the no-mistakes daemon or the tower is running and names the step to stop it: first finish or stop running agents and validation runs, because stopping Herdr or the daemon ends them; then run `herdr server stop` for Herdr, run `no-mistakes daemon stop` for the daemon, and close the Fleet pane in the Herdr Team tab (`herdr pane close <pane-id>`) for the tower, whose launcher has no stop command. The kit never runs these steps itself and never starts, stops or restarts them.

```sh
node bin/agent-kit.mjs repair --root /your/Agentic
node bin/agent-kit.mjs upgrade --root /your/Agentic
node bin/agent-kit.mjs uninstall --root /your/Agentic
```

`repair` (alias `reinstall`) re-verifies the receipt's current release and re-downloads its selected kit artifacts into that release. It privately backs up changed owned files before replacing them, refreshes the pinned kit copy, Treehouse wrapper, kit-tagged hooks and skill links, and kit-written tower config. A locally changed Firstmate home is reported and left in place, including its data, state, config and projects. The kit does not change unmarked hooks or personal settings.

`upgrade` (alias `update`, with the same flags) uses the receipt's saved `releases` or reviewed `main` channel. It asks your signed-in GitHub CLI for the newest owner-merged commit on that channel, fetches that exact kit commit (including `install.sh` and `install.ps1`), compares tool versions, tower release, Firstmate pin and new setup questions, reuses saved answers and asks only the new questions. It stages and verifies a versioned release before activation. On a failed step it restores the prior receipt, active kit files and global registration; the prior release remains available. **Data and state migrations are not rolled back.** A changed Firstmate pin must first reach the reviewed commit through Firstmate's guarded `/updatefirstmate` path. The kit never forces that checkout. While the Firstmate home has uncommitted changes to tracked files, is on neither the current nor the new pinned Firstmate commit, or has an `origin` other than the approved upstream (or unreadable Git state), `upgrade` and `update` refuse before changing anything and say which case applies: save and discard the changes, return the home to the pinned commit (Firstmate updates go through `/updatefirstmate`), or set `origin` back to the approved upstream, then rerun. The kit never resets the home itself. The `releases` channel is the newest `main` commit touching `manifests/pilot-skeleton.json`; that rule relies on squash merges.

The `macos-pilot-6` manifest re-pins Firstmate to `976c3ba730b9dafefc159b12a97a084c8c633e8f`; every other pin and digest is unchanged from `macos-pilot-5`. An install made with `macos-pilot-5` moves to it with `upgrade`: the plan prints `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`, and applying refuses with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` until the home has reached the new commit through `/updatefirstmate`. The rerun then prints `Firstmate pin: guarded update already verified` and records the new pin without changing the home. The `macos-pilot-4` manifest re-pins the Zoe fleet tower and its runtime to `fleet-v0.2.0-fc45c4d9ea1d`; every other pin and digest is unchanged from `macos-pilot-3`, which had the same kit-installed pins as `macos-pilot-2` and `macos-pilot-1`. An install made with `macos-pilot-3` moves to it with `update`, which stages the new tower binary and runtime under the new release directory, leaves the previous release in place and rewrites the kit-owned launcher config to name the new paths. The `macos-pilot-2` release directory let a receipt-recorded older Linux tower build be staged from the reviewed source commit, retaining the older build for rollback. `macos-pilot-3` marks the first reviewed release that carries the single installer, so an install made with `macos-pilot-2` moves to it with `update`.

`pilot-7` changes the release label from `macos-pilot-6`, the Codex CLI pin and lock, and the Claude Code minimum (below). The shorter label does not change the upgrade path for an existing `macos-pilot-6` install. The new user-level writes are the optional Firstmate-home `.env` assignment, the receipt's boolean `setup.keys.TYPESAFE_API_KEY` flag, the starter `<root>/firstmate/config/crew-dispatch.json` once the key is set, the receipt's `setup.dispatch` record, and the saved plan names and routing mode in `setup.answers.plans` and `setup.answers.dispatchMode`. `manifests/plan-models.json` is the new owner-approved plan-to-model table. The Codex CLI pin moves from 0.155.1 to 0.164.0 (GPT-6.1 Terra needs 0.159.0 or later), with a regenerated lock. The Claude Code minimum moves from 2.0.0 to 2.1.293, which Haiku 5.5 needs. The key-update command changes the key, the flag and, when it sets the key, the starter rules. Uninstall removes `.env` only with explicit typed confirmation and removes the starter rules only while unchanged.

`uninstall` removes kit-tagged hooks in `~/.claude/settings.json` and `~/.codex/hooks.json`, kit-owned skill links in `~/.claude/skills/` and `~/.agents/skills/`, an unchanged kit-written tower config, an unchanged Treehouse wrapper, and unchanged kit-written starter dispatch rules. It restores Codex's `features.hooks` setting only when the kit enabled it. It moves kit programs, releases, npm prefixes and existing private backups out of `<root>/.tools` into `<root>/agent-kit-uninstall/backups/`, preserving changed or additional files privately, and writes `<root>/agent-kit-uninstall/uninstall.json`. A changed Treehouse wrapper is left for manual review. The root folder, Firstmate home, projects and tower fleet state remain. `--remove-firstmate-home` additionally asks you to type that home's exact path and refuses if it finds uncommitted or unpushed work, unsafe project contents or live second mates. This typed confirmation is required even with `--yes`.

Repair and upgrade keep the Firstmate home's `.env` unchanged. Uninstall also keeps it by default. `uninstall --remove-env` removes that file only after you type its exact path; `--remove-firstmate-home` includes `.env` in the confirmed home removal.

Repair and upgrade do not touch credentials. Uninstall keeps `.env` unless you request its removal. These commands do not sign anyone out, remove person-installed Node, git, GitHub CLI, Claude CLI or Xcode tools, or edit shell profiles. On Windows, use `windows/agent-kit.ps1` with the command and `--root ~/Agentic`; it checks WSL2 and prints the handoff, and `--handoff` runs it inside the selected WSL2 distribution.

## Create your first second mate

`node bin/agent-kit.mjs secondmate-template --print` prints an inert charter with responsibility and scope placeholders and the exact local Firstmate scaffold, seed, and spawn commands. Review and fill the charter in your own Firstmate checkout. The example uses `--no-projects`; substitute your own registered projects when appropriate. The kit only prints this material: it never clones projects, selects an account pin, seeds a home, or launches a mate.

## The install command (advanced)

The guided setup above runs this command with the derived paths. You can also run it directly. Choose a new kit root and a Firstmate home path of your own, **outside** that root (for example `~/.agent-kit` and `~/firstmate`). The Firstmate home must be a new or empty directory. The installer refuses your home directory itself, system locations, a path inside an existing Firstmate home or git checkout, and an existing non-empty directory. The chosen path is recorded in the receipt, and a rerun with a different `--firstmate-home` is refused. Firstmate is staged in a hidden `.<name>.agent-kit-staging` sibling of that path so activation is an atomic rename; an interrupted stage is replaced on the next run.

```sh
node bin/agent-kit.mjs install --install-root /your/new/kit-root --firstmate-home /your/new/firstmate --harness codex
```

The default harness for this direct command is Claude; `--harness codex` selects Codex and `--harness claude,codex` selects both. Figma remains optional with `--with-figma`. The installer requires macOS or glibc Linux on arm64 or x64 and Node 24.15.0 or newer. WSL2 uses the Linux installer inside its distro. It takes a tool's `wsl2-<arch>` artifact when the manifest has one (today only the Zoe fleet tower and its runtime) and its `linux-<arch>` artifact otherwise. Only a WSL2 kernel (`microsoft-standard-WSL2` in `/proc/version` or `/proc/sys/kernel/osrelease`) selects `wsl2-<arch>` entries; WSL environment variables alone still count as WSL2 for the Windows-side notes but use `linux-<arch>`, as standalone Linux does. Its browser and terminal are on the Windows side. WSL1 and musl Linux are refused until their complete binary sets are reviewed. It stages exact artifacts under `releases/<release>/staging`, checks SHA-256 before extraction or execution, and activates kit-owned paths by rename. A private `receipt.json` records completed phases, versions, artifact digests, and owned paths without credentials or project names. A narrow lock prevents concurrent installs. On rerun it checks owned file digests and skips matching phases; changed files and unknown existing destinations cause refusal. Integrity and ownership failures stop the whole install for every tool: any SHA-256 mismatch, an existing destination without a matching receipt, a changed kit-owned file, and a refused npm lock. Only a network failure while downloading a tower artifact (`zoe-fleet` or its fleet runtime) is reported as a partial tower result, like a failed tower build, and its partial download is removed so the other phases finish. The Firstmate home is verified by its pinned commit and git-tracked files only, so untracked or ignored files created by normal use (such as `.claude/settings.local.json`) do not block a rerun. A changed tracked Firstmate file is reported as a conflict for that phase, left untouched, and the other phases continue. An interrupted phase can resume from a verified staged artifact or a pending receipt.

The manifest pins the approved `pikenguyen227/firstmate` and `pikenguyen227/zoetrope` commits. Firstmate and the standalone Linux tower fallback use SHA-256 hashes computed from their pinned GitHub source archives; the macOS and WSL2 towers use release assets. Firstmate is checked out at the pinned commit into the new home, on a local `main` branch. Firstmate takes the primary home's commit from its default branch when it seeds and syncs second mates (`bin/fm-ff-lib.sh`). The installer creates empty private `data/`, `state/`, `config/`, and `projects/` directories; it never imports an existing home or runs `fm-bootstrap.sh`. Repository-owned Claude/Codex hooks and relative skills stay with that checkout.

**Global hooks and skills.** `plan` and `install --dry-run` show the exact kit-owned operations for each global file and skill path. During `install`, the hooks phase prints that preview before applying it. Four pinned AXI packages and Herdr register `SessionStart` hooks in `~/.claude/settings.json` and `~/.codex/hooks.json`; all five pinned AXI packages link their published skills into `~/.claude/skills/` and `~/.agents/skills/` (Codex's documented user location). Herdr's pinned binary generates its agent-state scripts inside a disposable HOME; the kit verifies the reviewed script hashes and stores the scripts under the versioned kit root. The phase enables `[features] hooks = true` in `~/.codex/config.toml`. Hook commands carry `# agent-kit:<tool>` ownership markers. Existing unmarked hooks and other settings remain present, and an existing skill with another owner causes refusal. Edited files are backed up privately under the kit root, written atomically, and recorded in the receipt. Malformed files stop the phase. [Registration evidence and details](docs/global-hooks.md) list the upstream sources.

Codex asks each person to review new or changed hooks through `/hooks`; the kit does not pre-accept them. `no-mistakes init` installs its user-level skill when that person initializes their repository. Firstmate's own hooks and skills remain in its source checkout and are not registered globally.

**Zoe fleet tower.** The tower is pinned to the Zoetrope pre-release `fleet-v0.2.0-fc45c4d9ea1d` (commit `fc45c4d9ea1de0af27092f26eaa8f5008881f01e`). On macOS the installer uses its verified release archives and does not build from source. The arm64 or x64 `zoe-fleet` binary goes into the kit `bin/`. The fleet runtime archive is unpacked into `releases/<release>/zoe-fleet-runtime/` with the same staging, SHA-256, receipt and rerun rules as other artifacts. Its extractor accepts only regular files and directories. The runtime's own `bin/zoe-fleet-tower setup` is then run with `--home <your Firstmate home> --bin <kit zoe-fleet> --state <fresh state>`, plus `--no-mistakes <kit no-mistakes>` when that phase is installed. It writes the config into kit staging. The kit checks that the config names only those paths, then installs it atomically at `${XDG_CONFIG_HOME:-~/.config}/zoe-fleet/config` (mode 0600). The fleet state directory is the launcher's per-home default, `${XDG_STATE_HOME:-~/.local/state}/zoe-fleet/<first 12 hex of SHA-256 of the Firstmate home path>`, and it must be new or empty. An existing config the kit did not write, a changed kit-owned config, or non-empty state is reported as a conflict and left unchanged. A matching rerun is skipped. A kit root installed with the earlier source pin gets the release binary on rerun, and its old `zoetrope/` build directory is left in place. If setup or the config check fails before the receipt records the config, a state directory this run created and that holds only empty directories is removed, so a rerun is not blocked; a pre-existing or used state directory is never removed. `plan` shows the config and state paths, using the real path of the Firstmate home's nearest existing parent as install does. The installer never runs `doctor` or `open`, never links the Herdr plugin, and never launches the tower; the result prints the launcher path for you to run yourself. The tower then reports `installed from verified release; hands-on acceptance pending (Zoetrope Phase B)`. This is not full parity, so the install stays partial until the maintainers' hands-on acceptance passes.

**Zoe fleet tower on WSL2.** Inside WSL2 the tower installs the same way as on macOS, from the `fleet-v0.2.0-fc45c4d9ea1d-linux` release (`zoe-fleet` for `aarch64-unknown-linux-gnu` or `x86_64-unknown-linux-gnu`) and the same fleet runtime archive, with the same launcher `setup`, config check, state rules and result: `installed from verified release; hands-on acceptance pending (Zoetrope Phase B)`, so the install stays partial. Run the printed launcher's `doctor`, then `open` from a Herdr pane in your WSL shell yourself. Before activation the extracted `zoe-fleet` must be a Linux ELF executable for this machine's architecture (x64 or arm64); anything else, such as a mis-pinned macOS or wrong-architecture asset, is refused and never activated. Those binaries need glibc 2.35 or newer (Ubuntu 22.04 or newer). `check` and `plan` report an older or unreadable glibc as a failure, and `install` refuses the tower before downloading it (`refused: the WSL2 tower release needs Ubuntu 22.04 or newer ...`) and still completes the other phases. With the tower selected, WSL2 `check` and `plan` also list python3 3.9 or newer and `jq` as advisories (on Ubuntu, `sudo apt install python3 jq`), because the launcher's `doctor` and the Firstmate fleet snapshot need them; they do not block the install. Nothing has run on a real Windows PC yet: x64 and Arm64 both stay not hands-on confirmed until the first teammates run [docs/windows-pilot-check.md](docs/windows-pilot-check.md) on their own Windows PCs.

Standalone Linux has no tower release asset, so it keeps the previous behaviour: if Cargo and a compatible Rust toolchain are available, the installer runs `cargo build --locked --release --bin zoe` from the verified source archive at the same commit, with its own Cargo home and target directory. The fleet runtime is not pinned for standalone Linux, so no launcher is configured there, and a successful build reports the tower as `source build; no Linux tower release this round`. A missing toolchain or failed build is reported as partial. A standalone Linux kit root that already holds a tower built from the earlier source pin keeps that build: rerun reports the tower phase as a conflict (`older tower build present; an explicit update is needed (planned)`), leaves the build and its receipt entry unchanged, and still completes Firstmate, npm, hooks and the other tool phases.

Herdr 0.9.3, Treehouse 2.3.0, no-mistakes 1.79.0, ShellCheck 0.11.0, and actionlint 1.7.12 use upstream macOS and Linux release assets with published SHA-256 digests in the manifest. The axi tools and optional Codex CLI use committed npm lockfiles with registry integrity data, including Codex Linux arm64/x64 optional packages. `npm ci` runs in a kit-owned prefix with `--ignore-scripts`, an empty kit npm configuration, a kit cache, and the public registry. No global npm installation occurs. Node, Git, GitHub CLI, Claude CLI and the optional Figma CLI are person-installed prerequisites: the kit checks their minimum versions and never installs them (see [Pins and approval](#pins-and-approval)). Other components without a verified adapter or artifact are reported as unverified and skipped. No floating `latest` pin or remote install script is used.

After installation, each person uses the printed vendor commands and documentation to sign in themselves. The kit does not run or capture logins and does not read or store their credentials; its only secret is the optional key in [Optional dispatch key](#optional-dispatch-key). A partial install is not a ready Control Tower.

The result prints kit and npm binary directories; add them to your own shell PATH if you want their commands available by name. The installer does not edit shell startup files or launch the fresh Firstmate home.

## Windows personal devices

On Windows the full stack runs inside WSL2 through the Linux installer above. `install.ps1` ([Install](#install)) is the usual entry; the commands below are the lower-level bootstrap it uses. There is no native Windows or Git Bash installation. The Windows side only checks readiness, prints the steps you run yourself, and hands off into your WSL2 distribution. It never enables Windows features, asks for administrator rights, restarts Windows, or installs Node.

From a normal (not administrator) PowerShell window in a git clone of this repository:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\windows\agent-kit.ps1 check
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\windows\agent-kit.ps1 install --install-root '~/.agent-kit' --firstmate-home '~/firstmate'
```

`-ExecutionPolicy RemoteSigned` applies only to that PowerShell process; it lets your local clone run and still blocks unsigned scripts marked as downloaded from the internet. `windows\agent-kit.ps1` prints what it will do, checks for Node.js at the `engines` floor in `package.json` and, if Node is missing or older, prints the [official download](https://nodejs.org/en/download) and `winget install --exact --id OpenJS.NodeJS.LTS` instead of installing it. It then runs `node bin\agent-kit.mjs` with your arguments (`check` when none are given). `-DryRun` is the bootstrap's no-change preview: it turns `install` into `install --dry-run` and refuses `--handoff`.

`check` and `plan` on Windows report the Windows version and build (WSL2 needs Windows 10 version 2004, build 19041, or Windows 11), the native architecture (x64 or Arm64; Node running under x64 emulation on an Arm64 PC still plans `wsl2-arm64`, which uses `linux-arm64` artifacts for tools without a WSL2 entry), and WSL state. They query the WSL service registration, then `wsl --status` and `wsl --list` (`--quiet` for names, `--running --quiet` for running ones, `--verbose` for each distribution's WSL version and the `*` default marker), decoding their UTF-16 or UTF-8 output. Localized headers and state words are never parsed, so the result is the same in any Windows display language. `wsl.exe` is not run at all when the WSL service is absent. `docker-desktop` distributions are ignored, and `--distro <name>` picks a distribution other than the default. Windows Terminal (`wt.exe`) and a Windows browser (Chrome passes; Edge or Firefox are reported unknown) are advisories, and a missing WSL adds a firmware virtualization hint. Each missing step is printed with the exact command:

| State | Command you run yourself |
| --- | --- |
| No WSL | `wsl --install -d Ubuntu` in an administrator PowerShell, then restart Windows and open Ubuntu once to create your Linux user |
| WSL2 platform missing | `wsl --install --no-distribution` in an administrator PowerShell, then restart Windows |
| WSL1 default | `wsl --set-default-version 2` |
| WSL1 distribution | `wsl --set-version <distro> 2` |
| No distribution | `wsl --install -d Ubuntu`, then open it once |
| Windows too old | Update through Settings > Windows Update |

`plan` lists the `linux-<arch>` artifacts and Linux-side paths that will be used inside WSL. Global hook and skill changes are previewed by the Linux installer inside WSL before it applies them.

**Handoff.** On Windows, `--install-root` and `--firstmate-home` are Linux paths inside WSL: absolute, or starting with `~/`, using letters, digits, `.`, `_`, `-` and `/`. Windows paths and `/mnt/...` drive mounts are refused so Windows and Linux files and credential stores stay separate. Quote `~` paths in PowerShell. When WSL2 and a distribution are ready, `install` prints one `wsl.exe -d <distro> --exec bash -l -c '...'` command; `install --handoff` runs it. The command fetches this checkout's exact commit of `github.com/amelie-pierce/agent-kit` into `<install-root>/kit/<commit>` inside WSL, checks that commit, and runs the Linux `install` with your harness and Figma choice. The handoff therefore needs a clean git checkout on Windows. Inside WSL, install git and Node.js 24.15.0 or newer so `node` is on PATH for login shells, and sign in to GitHub yourself so git can fetch the private repository. Logins happen inside WSL, or in the Windows browser when a vendor's sign-in flow opens it.

Afterwards, open Windows Terminal with your distribution's profile and run Herdr, the tower and the agent CLIs in that WSL shell. chrome-devtools-axi and Lavish open the browser on the Windows side.

**Needs a real Windows machine (teammate hands-on check).** The steps for that check are in [docs/windows-pilot-check.md](docs/windows-pilot-check.md). CI covers mocked `wsl.exe` fixtures and a read-only `check`/`plan`/`install --dry-run` and bootstrap smoke on the GitHub `windows-latest` runner. It never enables WSL. These remain untested until a person runs them on a real device:

- on a PC without WSL, `check` printing the administrator `wsl --install -d Ubuntu` and restart steps without running them; then enabling WSL2 with that command, the restart, and first-run Linux user creation;
- `wsl --set-default-version 2` and `wsl --set-version` on a WSL1 setup, and non-English `wsl --status` output (the default version then reads as unknown);
- with a running WSL2 Ubuntu and non-English (for example German) `wsl.exe` output, `check` and `plan` reporting ready and `install` printing the pinned `wsl.exe` handoff command with Linux paths;
- `install` refusing `--install-root /mnt/c/kit` and `C:\kit`, so Windows and Linux files stay separate;
- on a real Windows PC with WSL2, a repeated-slash `/mnt` install root such as `//mnt/c/kit` being refused, with nothing written to C:;
- the preflight under Windows PowerShell 5.1 and pwsh leaving your user profile folder unchanged (CI checks this on the `windows-latest` runner only);
- `install --handoff` end to end on a real WSL2 distribution: argument passing through `wsl.exe --exec`, fetching the pinned kit commit of the private repository inside WSL, and the Linux install;
- `install.ps1` end to end on a real PC: the `gh` and `git` fetch on Windows, the `setup --handoff` into `install.sh` inside WSL, questions answered over `wsl.exe --exec`, and flag values with spaces;
- the Windows browser opened from WSL by chrome-devtools-axi, Lavish and vendor sign-in flows;
- the WSL2 tower release installing from its real assets, launcher `doctor`, and `open` from a Herdr pane under Windows Terminal in the WSL shell (x64 and Arm64 both not hands-on confirmed until the first teammates report);
- a clean Windows 11 first run through Windows PowerShell 5.1, and an Arm64 PC.

## Pins and approval

In the manifest, `verified` means the artifact's identity and integrity were checked against the approved upstream: a source commit, a published SHA-256 digest, or registry integrity in a committed npm lock. It does not mean owner approval, and no pin field claims it. The owner approves a release by merging the PR that changes the manifest. `install` installs only `verified` pins. Unverified pins are reported and skipped. Person-installed `kind: "prerequisite"` entries have a minimum version and vendor install link instead of a kit pin or artifact; `install` and `update` never stage them. `check`, `plan` and `doctor` test their `--version` on PATH, and a missing or old optional Figma CLI is advisory. The Figma CLI and Codex version probes use disposable HOME state, because Figma can initialize its own settings even for `--version` and Codex can leave `~/.codex/tmp` behind when the probe times out.

Versions for owner approval in the `pilot-8` release (`pilot-7` -> `pilot-8`): the release label, and new WSL2-only `wsl2-arm64` and `wsl2-x64` entries for the Zoe fleet tower and its runtime. Every other kit-installed pin and digest is unchanged from `pilot-7`, which moved the Codex CLI pin `0.155.1` -> `0.164.0` with its regenerated npm lock and the Claude Code minimum `2.0.0` -> `2.1.293`; `macos-pilot-6` changed the Firstmate pin and its source-archive digest from `macos-pilot-5`:

| Person-installed prerequisite | Minimum | Basis and install instructions |
| --- | --- | --- |
| Node.js | `24.15.0` | This is the kit's existing `engines.node` and `nodeMinimum` floor; [Node download](https://nodejs.org/en/download). |
| Git | `2.20.0` | The kit uses `--no-optional-locks` during source verification; the [Git 2.20 manual](https://git-scm.com/docs/git/2.20.0) documents it. [Git download](https://git-scm.com/downloads). |
| GitHub CLI | `2.0.0` | The kit's GitHub workflow needs `gh auth login` and CLI extension support; [GitHub CLI 2.0.0](https://github.com/cli/cli/releases/tag/v2.0.0) includes extensions. [Install instructions](https://github.com/cli/cli#installation). |
| Claude Code (Claude harness) | `2.1.293` | The kit installs `SessionStart` command hooks, and the starter dispatch rules route Opus 5.5, Sonnet 5.5 and Haiku 5.5, which need Claude Code 2.1.280, 2.1.284 and 2.1.293 respectively. Install with the [official native installer](https://code.claude.com/docs/en/setup), then sign in yourself. |
| Figma CLI (optional) | `2.0.0` | The kit only checks the CLI's presence and version; it does not call a Figma API. [Figma CLI install instructions](https://github.com/amelie-pierce/figma-cli#readme). |

The former exact-version placeholders and their unverified artifact entries are removed: Node `24.15.0`, Git `2.48.1`, GitHub CLI `2.83.2`, Claude Code `2.1.310`, and Figma CLI `2.2.5-make.2`. These values were not approved kit-distributed pins. Other target-specific unverified artifacts still appear for their own targets; the standalone Linux fleet runtime remains reported as an advisory because standalone Linux uses the source-built tower without that runtime.

The release label is `pilot-8` (was `pilot-7`). The only new pins are the WSL2 tower and runtime entries in the table below; no other pin, digest, lock or prerequisite floor changes. Inside WSL2 the tower and its launcher config are installed as on macOS, so a WSL2 install now also writes the launcher config and fleet state listed below; the Windows readiness fixes add no other user-level file or setting, and the user-level writes are otherwise unchanged from `pilot-7`. `pilot-7` moved the Codex CLI pin to `0.164.0` (lock regenerated from registry.npmjs.org, each integrity checked against the registry) and the Claude Code minimum to `2.1.293`. The Firstmate pin and digest changes shown in the table below came with `macos-pilot-6`. The guided setup writes only these user-level files and settings: the private `receipt.json` (0600) with `setup.answers` (no secrets), `setup.paths`, `setup.kit` and `setup.steps`; the kit copy at `<root>/.tools/kit/<commit>`; the kit-owned Treehouse wrapper `<root>/.tools/bin/treehouse` (recorded as the `treehouse-root` receipt phase); tower state under `<root>/.zoe-fleet`, with the launcher config still at `${XDG_CONFIG_HOME:-~/.config}/zoe-fleet/config` (0600); the previously approved global hook and skill files; git `user.name` and `user.email` through `git config --global`, only when you choose new values; and the starter second mate's Firstmate files, only when you ask for one. From `pilot-7` it may also write the optional Firstmate-home `.env` key ([Optional dispatch key](#optional-dispatch-key)) and, once that key is set, `<root>/firstmate/config/crew-dispatch.json` with the receipt's `setup.dispatch` record ([Starter dispatch rules](#starter-dispatch-rules-and-jev)). No new tool or account pin is added beyond the WSL2 tower and runtime entries.

| Tool | Version | Source |
| --- | --- | --- |
| Firstmate | `976c3ba730b9dafefc159b12a97a084c8c633e8f` (changed from `3cebfb5e809f7e87cea296a59fe14e2f1e47b7b6`) | github.com/pikenguyen227/firstmate source archive (SHA-256 `fef93f35e68cf0cc05edd0e95f4852a94c342946f9ee998eb43d5a9d21842d6f`, changed from `845d2faeee9b8248f4924023226f4f3c7a273e1c637b814f83c0d14ce2d323ac`) |
| Zoe fleet (Zoetrope), macOS | `fleet-v0.2.0-fc45c4d9ea1d` at `fc45c4d9ea1de0af27092f26eaa8f5008881f01e` | github.com/pikenguyen227/zoetrope release assets `zoe-fleet-0.2.0-fc45c4d9ea1d-aarch64-apple-darwin.tar.gz` (SHA-256 `067ff921f660840b3cf4f0ab84a7a0500a8b2705f25f0164f1b3f970ca413e65`) and `zoe-fleet-0.2.0-fc45c4d9ea1d-x86_64-apple-darwin.tar.gz` (SHA-256 `f167a67bab048fb06a2c7e0e5254ba497c19249eda94441f3a08ed92e6f47a27`) |
| Zoe fleet runtime (Zoetrope), macOS | `fleet-v0.2.0-fc45c4d9ea1d` | github.com/pikenguyen227/zoetrope release asset `zoetrope-fleet-runtime-0.2.0-fc45c4d9ea1d.tar.gz` (SHA-256 `48b30346cec0ab1174e296745154defade431b1fb66da6a88c992b383a4e381a`) |
| Zoe fleet (Zoetrope), WSL2 (new) | `fleet-v0.2.0-fc45c4d9ea1d-linux` at `fc45c4d9ea1de0af27092f26eaa8f5008881f01e` | github.com/pikenguyen227/zoetrope release assets `zoe-fleet-0.2.0-fc45c4d9ea1d-aarch64-unknown-linux-gnu.tar.gz` (`wsl2-arm64`, SHA-256 `c22035f08c5f23631ebc87cac6d5116f86cae894d22f68bda60389d860609a3e`) and `zoe-fleet-0.2.0-fc45c4d9ea1d-x86_64-unknown-linux-gnu.tar.gz` (`wsl2-x64`, SHA-256 `8085a73f24d6290df078e4e7edf34ea00ab712288e9fbbd72ff50c50bb549a45`); release `SHA256SUMS` SHA-256 `69dfe1a75db9184bbd902f20e79ba463f4637cfa92a07c028b24840d0c7c446f`; built for glibc 2.35 (Ubuntu 22.04 or newer) |
| Zoe fleet runtime (Zoetrope), WSL2 (new) | `fleet-v0.2.0-fc45c4d9ea1d` | the same `zoetrope-fleet-runtime-0.2.0-fc45c4d9ea1d.tar.gz` asset as macOS (SHA-256 `48b30346cec0ab1174e296745154defade431b1fb66da6a88c992b383a4e381a`) for `wsl2-arm64` and `wsl2-x64` |
| Zoe fleet (Zoetrope), standalone Linux source fallback | `fc45c4d9ea1de0af27092f26eaa8f5008881f01e` | github.com/pikenguyen227/zoetrope source archive (SHA-256 `249efdac00b2acbaff71739e942be03c4fa0479aa69a90d597539e5679271fb7`) |
| Herdr | 0.9.3 | github.com/herdrdev/herdr release asset |
| Treehouse | 2.3.0 | github.com/kunchenguid/treehouse release asset |
| no-mistakes | 1.79.0 | github.com/kunchenguid/no-mistakes release asset |
| ShellCheck | 0.11.0 | github.com/koalaman/shellcheck release asset |
| actionlint | 1.7.12 | github.com/rhysd/actionlint release asset |
| gh-axi | 0.1.35 | registry.npmjs.org via `manifests/npm/package-lock.json` |
| chrome-devtools-axi | 0.1.35 | registry.npmjs.org via `manifests/npm/package-lock.json` |
| lavish-axi | 0.1.78 | registry.npmjs.org via `manifests/npm/package-lock.json` |
| quota-axi | 0.1.53 | registry.npmjs.org via `manifests/npm/package-lock.json` |
| tasks-axi | 0.2.6 | registry.npmjs.org via `manifests/npm/package-lock.json` |
| Codex CLI (`@openai/codex`) | 0.164.0 | registry.npmjs.org via `manifests/npm-codex/package-lock.json` |

## Verification and next work

`npm test` runs local `node:test` fixtures without network. They cover the guided setup with a fake HOME and PATH and scripted answers: every prompt, saved and reused answers, `--reconfigure`, `--yes` and `--dry-run` without a terminal, root refusals, the resume summary after a failed step, git identity only after a yes, the Treehouse wrapper and the starter second mate commands. They also cover `install.sh` with stubbed `gh`, `git` and `node` (prerequisite guidance, sign-in, channels, commit reachability, argument pass-through and cleanup), the Windows setup handoff, and Windows preflight from mocked UTF-16 and UTF-8 `wsl.exe` output (no WSL, WSL1 default, WSL2 without a distribution, WSL2 ready, Arm64), handoff command construction and the handoff script in a fake Linux HOME, a no-op second run, interrupted resume, checksum refusal, unsupported OS/architecture/libc/WSL1, Linux and WSL2 artifact selection, WSL2 tower installation from fixture release and runtime archives with launcher configuration, its refusal below glibc 2.35 and of a non-ELF or wrong-architecture binary, `wsl2-<arch>` selection only on a WSL2 kernel, and the python3 and jq tower advisories, fresh source staging and build packaging, macOS tower installation from fixture release and runtime archives with launcher configuration in a fake HOME (no cargo, no-op rerun, config and state conflicts, XDG paths, refused runtime links and missing launcher, cleanup of fleet state after a failed setup, a tower download network failure versus a checksum mismatch, and a `plan` preview under a symlinked parent), the Linux source-build fallback and its rerun over an older source-built tower, Firstmate reruns after local untracked settings, an upgrade from `macos-pilot-5` whose only change is the Firstmate pin (refused until `/updatefirstmate`, then applied), tracked-file conflicts, Firstmate home path refusals, and global hook/skill merge behavior in a fake HOME. Every CI job runs the single installer in dry run against the checkout under review: `install.sh` on macOS and Linux in a disposable HOME, and `install.ps1 -DryRun` under Windows PowerShell and pwsh on `windows-latest`, which also checks the saved-channel receipt path for `--root` and `--install-root` values starting with `~/`. Setup refuses `--distro` and `--handoff` off Windows, as the other commands do. The Ubuntu job also runs `shellcheck install.sh`. The `windows-latest` CI job also runs a read-only smoke of `check`, `plan`, `install --dry-run` and the PowerShell bootstrap under Windows PowerShell and pwsh. The Ubuntu job also runs `scripts/wsl2-tower-smoke.mjs`: the installer with a WSL2 kernel identity and the runner's glibc installs Firstmate and the real `wsl2-x64` tower and runtime assets in a disposable HOME, and the script checks their staged digests, that `zoe-fleet` is a Linux x64 ELF whose `--version` runs, the launcher config at mode 0600, and a no-op rerun. The Ubuntu CI smoke uses real downloads in a disposable HOME, verifies staged SHA-256 digests and a no-op rerun, and checks an unrelated HOME file. macOS smoke tests previously downloaded and verified the pinned release assets, Firstmate source archive, and npm lock groups in isolated locations. For the `macos-pilot-6` Firstmate pin, `976c3ba730b9dafefc159b12a97a084c8c633e8f` was confirmed as the head of `main`, two commits ahead of the previous pin, and its GitHub source archive was downloaded once and hashed locally; the previous pin's archive reproduced its recorded digest the same way. For the `macos-pilot-4` tower pin, each release asset was downloaded once and checked against both the given SHA-256 values and the release `SHA256SUMS`. A disposable-HOME macOS run then installed Firstmate, `zoe-fleet` and the runtime from the real `macos-pilot-3` assets and ran the shipped launcher `setup`; its rerun was a no-op. `update --yes` to `macos-pilot-4` then staged the `fleet-v0.2.0-fc45c4d9ea1d` binary and runtime from the real assets, rewrote the launcher config to name the new release's `zoe-fleet` with the same fleet state, and left `macos-pilot-3` in place; a second update was a no-op. No agent or service is started.

Hands-on tower acceptance (Zoetrope Phase B: one person opens the tower from a Herdr pane and spawns one second mate) is still pending; the maintainers' automated Phase A passed on the downloaded `fleet-v0.2.0-fc45c4d9ea1d` assets, and that release adds the Phase B dedicated-account preflight and evidence export. A real Windows device with WSL2 is not yet acceptance tested; see the Windows list above. Linux arm64 has fixture coverage but no real arm64 runner in this PR. [Zoetrope packaging follow-ups](docs/zoetrope-followups.md) record which packaging items this release closes and what remains. The WSL2 tower release `fleet-v0.2.0-fc45c4d9ea1d-linux` was checked the same way: each asset was downloaded and its SHA-256 matched both the release notes and its `SHA256SUMS`, the tag resolves to `fc45c4d9ea1de0af27092f26eaa8f5008881f01e`, each archive holds `zoe-fleet`, `LICENSE`, `NOTICE` and a `BUILD.txt` naming that commit and glibc 2.35, and the runtime archive reproduced its recorded digest. It has not run on a real WSL2 distribution yet; that is part of the [Windows pilot check](docs/windows-pilot-check.md). Other follow-ups: a standalone Linux tower release, an end-to-end personal tower pilot, and making `agent-kit update` and upgrade follow the saved update channel (PR 9b; today only the installer rerun reuses it). Windows v1 remains WSL2, with no native or Git Bash installation path.

## Never ship

The kit never packages `.env`, credentials, tokens, passwords, cookies or browser profiles; keychain or credential-manager exports; SSH keys, machine registrations, account pins or global user configuration; existing `data/`, `state/`, or `config/` values; captain preferences or memories; histories, transcripts, databases or sockets; task, backlog or project registries; project clones or worktree pools; validation runs or mirrors; generated review artifacts or personal plugin caches; local backups, absolute-path wrappers, private patches or permissive agent-launch settings. Public packages come from approved upstreams, never from another person's installation.
