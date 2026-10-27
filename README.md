# Agent Kit

Agent Kit is a per-person setup for Firstmate, Herdr, the custom Zoe fleet tower, Treehouse, agent CLIs, and source-owned skills. This release supports **macOS and Linux installation**; the Linux path also runs inside WSL2, and a [Windows entry](#windows-personal-devices) checks WSL2 and hands off to it. It reports a partial result until every selected component is verified and the tower has passed hands-on acceptance. It never starts services or signs in for anyone.

## Read-only commands

Use Node.js 24.15.0 or newer. The CLI itself has no runtime dependencies.

```sh
node bin/agent-kit.mjs check
node bin/agent-kit.mjs plan --harness codex --with-figma
node bin/agent-kit.mjs install --dry-run --install-root /your/new/kit-root --firstmate-home /your/new/firstmate
```

`install --dry-run` is exactly `plan`: it makes no changes. `check` and `plan` only inspect and print. They do not probe authentication, run Firstmate bootstrap, or invoke Herdr lifecycle commands. `--json` is available for all commands. `check` is still the initial read-only presence check, not an installed-state doctor for an arbitrary custom root. Linux checks report distro, libc, WSL2, required commands, shell, writable root, PATH conflicts, and a terminal emulator and browser found on PATH (`google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser` or `firefox`). A missing browser is a warning because chrome-devtools-axi and Lavish need one; a missing terminal emulator is unknown because a TTY or SSH session also works. Under WSL2 both are reported unknown: they are on the Windows side and not checked from Linux. Nothing is launched. On every platform, terminal and browser results are advisories: `check` and `plan` list them separately (`advisories` in `--json`) and they do not count toward the gap count or exit code, so a WSL2 or headless SSH host can report ready when every required item passes. Windows checks are described under [Windows personal devices](#windows-personal-devices).

## Doctor

After an install, run `node bin/agent-kit.mjs doctor --install-root /your/kit-root` (add `--json` for machine-readable results). Doctor reads the kit receipt and owned paths, checks the pinned Firstmate commit and tracked files, kit file digests, launcher and receipt permissions, hook ownership markers, required platform prerequisites, Node floor, and whether another executable shadows a kit binary on PATH. It resolves PATH entries by file path and never runs them. Each component reports installed, verified digest, configured, authenticated, and live-tested states. Authentication and live testing remain **unknown**: doctor does not inspect sign-in stores, start services, or probe a live fleet. A failed check exits nonzero. This command changes no files.

## Reviewed updates

Fetch a newer kit release yourself, then use its clean checkout at a commit reachable from `origin/main`. Its bundled manifest and committed npm locks are the update authority. Preview installed and proposed version/digest values before applying:

```sh
node bin/agent-kit.mjs update --install-root /your/kit-root
node bin/agent-kit.mjs update --yes --install-root /your/kit-root
```

The default command only prints a plan. `--yes` uses the existing staging, SHA-256 verification, ownership receipt and atomic activation paths. It installs binaries under the new versioned release and leaves the previous release in place for binary rollback; it does **not** promise rollback of user state or global configuration. A modified owned file or a dirty/diverged Firstmate checkout is a conflict. A Firstmate pin change waits for you to run `/updatefirstmate` from your own Firstmate, then rerun `agent-kit update --yes` so the kit can verify the reviewed commit. A running Herdr, no-mistakes or tower binary is deferred; stop it through its own operator workflow and rerun the update. The kit never restarts shared daemons. Hooks and skill links wait until dependent components are ready. A partial update records its target in the private receipt, so a normal `install` cannot silently finish it.

The `macos-pilot-2` manifest has the same kit-installed pins and digests as `macos-pilot-1`; its new release directory lets a receipt-recorded older Linux tower build be staged from the reviewed source commit while retaining the older build for rollback. On Windows, run these commands inside the WSL2 distribution after fetching the reviewed kit there.

## Create your first second mate

`node bin/agent-kit.mjs secondmate-template --print` prints an inert charter with responsibility and scope placeholders and the exact local Firstmate scaffold, seed, and spawn commands. Review and fill the charter in your own Firstmate checkout. The example uses `--no-projects`; substitute your own registered projects when appropriate. The kit only prints this material: it never clones projects, selects an account pin, seeds a home, or launches a mate.

## macOS and Linux install

Choose a new kit root and a Firstmate home path of your own, **outside** that root (for example `~/.agent-kit` and `~/firstmate`). The Firstmate home must be a new or empty directory. The installer refuses your home directory itself, system locations, a path inside an existing Firstmate home or git checkout, and an existing non-empty directory. The chosen path is recorded in the receipt, and a rerun with a different `--firstmate-home` is refused. Firstmate is staged in a hidden `.<name>.agent-kit-staging` sibling of that path so activation is an atomic rename; an interrupted stage is replaced on the next run.

```sh
node bin/agent-kit.mjs install --install-root /your/new/kit-root --firstmate-home /your/new/firstmate --harness codex
```

The default harness is Claude; `--harness codex` selects Codex. Figma remains optional with `--with-figma`. The installer requires macOS or glibc Linux on arm64 or x64 and Node 24.15.0 or newer. WSL2 uses the Linux artifacts and installer inside its distro: the lock has no `wsl2-<arch>` targets, and WSL2 resolves to `linux-<arch>`; its browser and terminal are on the Windows side. WSL1 and musl Linux are refused until their complete binary sets are reviewed. It stages exact artifacts under `releases/<release>/staging`, checks SHA-256 before extraction or execution, and activates kit-owned paths by rename. A private `receipt.json` records completed phases, versions, artifact digests, and owned paths without credentials or project names. A narrow lock prevents concurrent installs. On rerun it checks owned file digests and skips matching phases; changed files and unknown existing destinations cause refusal. Integrity and ownership failures stop the whole install for every tool: any SHA-256 mismatch, an existing destination without a matching receipt, a changed kit-owned file, and a refused npm lock. Only a network failure while downloading a tower artifact (`zoe-fleet` or its fleet runtime) is reported as a partial tower result, like a failed tower build, and its partial download is removed so the other phases finish. The Firstmate home is verified by its pinned commit and git-tracked files only, so untracked or ignored files created by normal use (such as `.claude/settings.local.json`) do not block a rerun. A changed tracked Firstmate file is reported as a conflict for that phase, left untouched, and the other phases continue. An interrupted phase can resume from a verified staged artifact or a pending receipt.

The manifest pins the approved `pikenguyen227/firstmate` and `pikenguyen227/zoetrope` commits. Firstmate and the Linux tower fallback use SHA-256 hashes computed from their pinned GitHub source archives; the macOS tower uses release assets. Firstmate is checked out at the pinned commit into the new home. The installer creates empty private `data/`, `state/`, `config/`, and `projects/` directories; it never imports an existing home or runs `fm-bootstrap.sh`. Repository-owned Claude/Codex hooks and relative skills stay with that checkout.

**Global hooks and skills.** `plan` and `install --dry-run` show the exact kit-owned operations for each global file and skill path. During `install`, the hooks phase prints that preview before applying it. Four pinned AXI packages and Herdr register `SessionStart` hooks in `~/.claude/settings.json` and `~/.codex/hooks.json`; all five pinned AXI packages link their published skills into `~/.claude/skills/` and `~/.agents/skills/` (Codex's documented user location). Herdr's pinned binary generates its agent-state scripts inside a disposable HOME; the kit verifies the reviewed script hashes and stores the scripts under the versioned kit root. The phase enables `[features] hooks = true` in `~/.codex/config.toml`. Hook commands carry `# agent-kit:<tool>` ownership markers. Existing unmarked hooks and other settings remain present, and an existing skill with another owner causes refusal. Edited files are backed up privately under the kit root, written atomically, and recorded in the receipt. Malformed files stop the phase. [Registration evidence and details](docs/global-hooks.md) list the upstream sources.

Codex asks each person to review new or changed hooks through `/hooks`; the kit does not pre-accept them. `no-mistakes init` installs its user-level skill when that person initializes their repository. Firstmate's own hooks and skills remain in its source checkout and are not registered globally.

**Zoe fleet tower.** The tower is pinned to the Zoetrope pre-release `fleet-v0.2.0-e81530fac3d7` (commit `e81530fac3d7754df134dd3c8e995e29bb40104c`). On macOS the installer uses its verified release archives and does not build from source. The arm64 or x64 `zoe-fleet` binary goes into the kit `bin/`. The fleet runtime archive is unpacked into `releases/<release>/zoe-fleet-runtime/` with the same staging, SHA-256, receipt and rerun rules as other artifacts. Its extractor accepts only regular files and directories. The runtime's own `bin/zoe-fleet-tower setup` is then run with `--home <your Firstmate home> --bin <kit zoe-fleet> --state <fresh state>`, plus `--no-mistakes <kit no-mistakes>` when that phase is installed. It writes the config into kit staging. The kit checks that the config names only those paths, then installs it atomically at `${XDG_CONFIG_HOME:-~/.config}/zoe-fleet/config` (mode 0600). The fleet state directory is the launcher's per-home default, `${XDG_STATE_HOME:-~/.local/state}/zoe-fleet/<first 12 hex of SHA-256 of the Firstmate home path>`, and it must be new or empty. An existing config the kit did not write, a changed kit-owned config, or non-empty state is reported as a conflict and left unchanged. A matching rerun is skipped. A kit root installed with the earlier source pin gets the release binary on rerun, and its old `zoetrope/` build directory is left in place. If setup or the config check fails before the receipt records the config, a state directory this run created and that holds only empty directories is removed, so a rerun is not blocked; a pre-existing or used state directory is never removed. `plan` shows the config and state paths, using the real path of the Firstmate home's nearest existing parent as install does. The installer never runs `doctor` or `open`, never links the Herdr plugin, and never launches the tower; the result prints the launcher path for you to run yourself. The tower then reports `installed from verified release; hands-on acceptance pending (Zoetrope Phase B)`. This is not full parity, so the install stays partial until the maintainers' hands-on acceptance passes.

This release has no Linux tower asset, so Linux and WSL2 keep the previous behaviour: if Cargo and a compatible Rust toolchain are available, the installer runs `cargo build --locked --release --bin zoe` from the verified source archive at the same commit, with its own Cargo home and target directory. The fleet runtime is not pinned for Linux, so no launcher is configured there. A missing toolchain or failed build is reported as partial. A Linux or WSL2 kit root that already holds a tower built from the earlier source pin keeps that build: rerun reports the tower phase as a conflict (`older tower build present; an explicit update is needed (planned)`), leaves the build and its receipt entry unchanged, and still completes Firstmate, npm, hooks and the other tool phases.

Herdr 0.9.3, Treehouse 2.3.0, no-mistakes 1.79.0, ShellCheck 0.11.0, and actionlint 1.7.12 use upstream macOS and Linux release assets with published SHA-256 digests in the manifest. The axi tools and optional Codex CLI use committed npm lockfiles with registry integrity data, including Codex Linux arm64/x64 optional packages. `npm ci` runs in a kit-owned prefix with `--ignore-scripts`, an empty kit npm configuration, a kit cache, and the public registry. No global npm installation occurs. Node, Git, GitHub CLI, Claude CLI and the optional Figma CLI are person-installed prerequisites: the kit checks their minimum versions and never installs them (see [Pins and approval](#pins-and-approval)). Other components without a verified adapter or artifact are reported as unverified and skipped. No floating `latest` pin or remote install script is used.

After installation, each person uses the printed vendor commands and documentation to sign in themselves. The kit does not run or capture logins and does not read or store credentials. A partial install is not a ready Control Tower.

The result prints kit and npm binary directories; add them to your own shell PATH if you want their commands available by name. The installer does not edit shell startup files or launch the fresh Firstmate home.

## Windows personal devices

On Windows the full stack runs inside WSL2 through the Linux installer above. There is no native Windows or Git Bash installation. The Windows side only checks readiness, prints the steps you run yourself, and hands off into your WSL2 distribution. It never enables Windows features, asks for administrator rights, restarts Windows, or installs Node.

From a normal (not administrator) PowerShell window in a git clone of this repository:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\windows\agent-kit.ps1 check
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\windows\agent-kit.ps1 install --install-root '~/.agent-kit' --firstmate-home '~/firstmate'
```

`-ExecutionPolicy RemoteSigned` applies only to that PowerShell process; it lets your local clone run and still blocks unsigned scripts marked as downloaded from the internet. `windows\agent-kit.ps1` prints what it will do, checks for Node.js at the `engines` floor in `package.json` and, if Node is missing or older, prints the [official download](https://nodejs.org/en/download) and `winget install --exact --id OpenJS.NodeJS.LTS` instead of installing it. It then runs `node bin\agent-kit.mjs` with your arguments (`check` when none are given). `-DryRun` is the bootstrap's no-change preview: it turns `install` into `install --dry-run` and refuses `--handoff`.

`check` and `plan` on Windows report the Windows version and build (WSL2 needs Windows 10 version 2004, build 19041, or Windows 11), the native architecture (x64 or Arm64; Node running under x64 emulation on an Arm64 PC still plans `linux-arm64`), and WSL state. They query the WSL service registration, then `wsl --status` and `wsl --list` (`--quiet` for names, `--running --quiet` for running ones, `--verbose` for each distribution's WSL version and the `*` default marker), decoding their UTF-16 or UTF-8 output. Localized headers and state words are never parsed, so the result is the same in any Windows display language. `wsl.exe` is not run at all when the WSL service is absent. `docker-desktop` distributions are ignored, and `--distro <name>` picks a distribution other than the default. Windows Terminal (`wt.exe`) and a Windows browser (Chrome passes; Edge or Firefox are reported unknown) are advisories, and a missing WSL adds a firmware virtualization hint. Each missing step is printed with the exact command:

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

**Needs a real Windows machine (owner acceptance).** CI covers mocked `wsl.exe` fixtures and a read-only `check`/`plan`/`install --dry-run` and bootstrap smoke on the GitHub `windows-latest` runner. It never enables WSL. These remain untested until a person runs them on a real device:

- on a PC without WSL, `check` printing the administrator `wsl --install -d Ubuntu` and restart steps without running them; then enabling WSL2 with that command, the restart, and first-run Linux user creation;
- `wsl --set-default-version 2` and `wsl --set-version` on a WSL1 setup, and non-English `wsl --status` output (the default version then reads as unknown);
- with a running WSL2 Ubuntu and non-English (for example German) `wsl.exe` output, `check` and `plan` reporting ready and `install` printing the pinned `wsl.exe` handoff command with Linux paths;
- `install` refusing `--install-root /mnt/c/kit` and `C:\kit`, so Windows and Linux files stay separate;
- on a real Windows PC with WSL2, a repeated-slash `/mnt` install root such as `//mnt/c/kit` being refused, with nothing written to C:;
- the preflight under Windows PowerShell 5.1 and pwsh leaving your user profile folder unchanged (CI checks this on the `windows-latest` runner only);
- `install --handoff` end to end on a real WSL2 distribution: argument passing through `wsl.exe --exec`, fetching the pinned kit commit of the private repository inside WSL, and the Linux install;
- the Windows browser opened from WSL by chrome-devtools-axi, Lavish and vendor sign-in flows;
- Herdr and the Zoe tower running under Windows Terminal in the WSL shell;
- a clean Windows 11 first run through Windows PowerShell 5.1, and an Arm64 PC.

## Pins and approval

In the manifest, `verified` means the artifact's identity and integrity were checked against the approved upstream: a source commit, a published SHA-256 digest, or registry integrity in a committed npm lock. It does not mean owner approval, and no pin field claims it. The owner approves a release by merging the PR that changes the manifest. `install` installs only `verified` pins. Unverified pins are reported and skipped. Person-installed `kind: "prerequisite"` entries have a minimum version and vendor install link instead of a kit pin or artifact; `install` and `update` never stage them. `check`, `plan` and `doctor` test their `--version` on PATH, and a missing or old optional Figma CLI is advisory. The Figma version probe uses disposable HOME state because that CLI can initialize its own settings even for `--version`.

Versions for owner approval in the `macos-pilot-2` release (kit-installed pins and digests unchanged from `macos-pilot-1`):

| Person-installed prerequisite | Minimum | Basis and install instructions |
| --- | --- | --- |
| Node.js | `24.15.0` | This is the kit's existing `engines.node` and `nodeMinimum` floor; [Node download](https://nodejs.org/en/download). |
| Git | `2.20.0` | The kit uses `--no-optional-locks` during source verification; the [Git 2.20 manual](https://git-scm.com/docs/git/2.20.0) documents it. [Git download](https://git-scm.com/downloads). |
| GitHub CLI | `2.0.0` | The kit's GitHub workflow needs `gh auth login` and CLI extension support; [GitHub CLI 2.0.0](https://github.com/cli/cli/releases/tag/v2.0.0) includes extensions. [Install instructions](https://github.com/cli/cli#installation). |
| Claude Code (Claude harness) | `2.0.0` | The kit installs `SessionStart` command hooks; Claude Code 2.x is the supported hook family for this kit. Install with the [official native installer](https://code.claude.com/docs/en/setup), then sign in yourself. |
| Figma CLI (optional) | `2.0.0` | The kit only checks the CLI's presence and version; it does not call a Figma API. [Figma CLI install instructions](https://github.com/amelie-pierce/figma-cli#readme). |

The former exact-version placeholders and their unverified artifact entries are removed: Node `24.15.0`, Git `2.48.1`, GitHub CLI `2.83.2`, Claude Code `2.1.310`, and Figma CLI `2.2.5-make.2`. These values were not approved kit-distributed pins. Other target-specific unverified artifacts still appear for their own targets; the Linux fleet runtime remains reported as an advisory because Linux uses the source-built tower without that runtime.

The new release label is `macos-pilot-2`. The update path may write the private `receipt.json` (0600), kit-owned `releases/<release>/` files, and previously approved global hook/skill files and Zoe launcher config (0600). These are the user-level files covered by this PR; no new tool or account pin is added.

| Tool | Version | Source |
| --- | --- | --- |
| Firstmate | `3cebfb5e809f7e87cea296a59fe14e2f1e47b7b6` | github.com/pikenguyen227/firstmate source archive |
| Zoe fleet (Zoetrope), macOS | `fleet-v0.2.0-e81530fac3d7` at `e81530fac3d7754df134dd3c8e995e29bb40104c` (changed from source commit `a8c495a887ed78308f7c682c5d194835e7094b05`) | github.com/pikenguyen227/zoetrope release assets `zoe-fleet-0.2.0-e81530fac3d7-aarch64-apple-darwin.tar.gz` (SHA-256 `87ead8bd844f2554c3fd5fe4ce738da7ec4165bda4bd8454febabf484c59c0cd`) and `zoe-fleet-0.2.0-e81530fac3d7-x86_64-apple-darwin.tar.gz` (SHA-256 `164155b32f4ab94cf3fac17660ddac07db6309043d42d58e5df304540d63e269`) |
| Zoe fleet runtime (Zoetrope), macOS | `fleet-v0.2.0-e81530fac3d7` (new) | github.com/pikenguyen227/zoetrope release asset `zoetrope-fleet-runtime-0.2.0-e81530fac3d7.tar.gz` (SHA-256 `2cdd16315f8e00603e97520c89294ffd8823bd3758f0a88b2a0ab9a8022280c1`) |
| Zoe fleet (Zoetrope), Linux source fallback | `e81530fac3d7754df134dd3c8e995e29bb40104c` (changed from `a8c495a887ed78308f7c682c5d194835e7094b05`) | github.com/pikenguyen227/zoetrope source archive (SHA-256 `f5619a635a8e6c168abad3cb088f0d0032980c6d1694feb86e345407c6c0cb95`) |
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
| Codex CLI (`@openai/codex`) | 0.155.1 | registry.npmjs.org via `manifests/npm-codex/package-lock.json` |

## Verification and next work

`npm test` runs local `node:test` fixtures without network. They cover Windows preflight from mocked UTF-16 and UTF-8 `wsl.exe` output (no WSL, WSL1 default, WSL2 without a distribution, WSL2 ready, Arm64), handoff command construction and the handoff script in a fake Linux HOME, a no-op second run, interrupted resume, checksum refusal, unsupported OS/architecture/libc/WSL1, Linux and WSL2 artifact selection, fresh source staging and build packaging, macOS tower installation from fixture release and runtime archives with launcher configuration in a fake HOME (no cargo, no-op rerun, config and state conflicts, XDG paths, refused runtime links and missing launcher, cleanup of fleet state after a failed setup, a tower download network failure versus a checksum mismatch, and a `plan` preview under a symlinked parent), the Linux source-build fallback and its rerun over an older source-built tower, Firstmate reruns after local untracked settings, tracked-file conflicts, Firstmate home path refusals, and global hook/skill merge behavior in a fake HOME. The `windows-latest` CI job runs a read-only smoke of `check`, `plan`, `install --dry-run` and the PowerShell bootstrap under Windows PowerShell and pwsh. The Ubuntu CI smoke uses real downloads in a disposable HOME, verifies staged SHA-256 digests and a no-op rerun, and checks an unrelated HOME file. macOS smoke tests previously downloaded and verified the pinned release assets, Firstmate source archive, and npm lock groups in isolated locations. For this tower pin, each release asset was downloaded once and checked against both the given SHA-256 values and the release `SHA256SUMS`. A disposable-HOME macOS run then installed Firstmate, `zoe-fleet` and the runtime from the real assets and ran the shipped launcher `setup`; its rerun was a no-op. No agent or service is started.

Hands-on tower acceptance (Zoetrope Phase B: one person opens the tower from a Herdr pane and spawns one second mate) is still pending; the maintainers' automated Phase A passed against these assets with Firstmate pin `3cebfb5e`. A real Windows device with WSL2 is not yet acceptance tested; see the Windows list above. Linux arm64 has fixture coverage but no real arm64 runner in this PR. [Zoetrope packaging follow-ups](docs/zoetrope-followups.md) record which packaging items this release closes and what remains. Other follow-ups: a Linux tower release and an end-to-end personal tower pilot. Windows v1 remains WSL2, with no native or Git Bash installation path.

## Never ship

The kit never packages `.env`, credentials, tokens, passwords, cookies or browser profiles; keychain or credential-manager exports; SSH keys, machine registrations, account pins or global user configuration; existing `data/`, `state/`, or `config/` values; captain preferences or memories; histories, transcripts, databases or sockets; task, backlog or project registries; project clones or worktree pools; validation runs or mirrors; generated review artifacts or personal plugin caches; local backups, absolute-path wrappers, private patches or permissive agent-launch settings. Public packages come from approved upstreams, never from another person's installation.
