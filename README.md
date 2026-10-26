# Agent Kit

Agent Kit is a per-person setup for Firstmate, Herdr, the custom Zoe fleet tower, Treehouse, agent CLIs, and source-owned skills. This release supports **macOS and Linux installation**; the Linux path also runs inside WSL2. It reports a partial result until every selected component and the tower's fleet manifest/launcher integration are verified. It never starts services or signs in for anyone.

## Read-only commands

Use Node.js 24.15.0 or newer. The CLI itself has no runtime dependencies.

```sh
node bin/agent-kit.mjs check
node bin/agent-kit.mjs plan --harness codex --with-figma
node bin/agent-kit.mjs install --dry-run --install-root /your/new/kit-root --firstmate-home /your/new/firstmate
```

`install --dry-run` is exactly `plan`: it makes no changes. `check` and `plan` only inspect and print. They do not probe authentication, run Firstmate bootstrap, or invoke Herdr lifecycle commands. `--json` is available for all commands. `check` is still the initial read-only presence check, not an installed-state doctor for an arbitrary custom root. Linux checks report distro, libc, WSL2, required commands, shell, writable root, PATH conflicts, and a terminal emulator and browser found on PATH (`google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser` or `firefox`). A missing browser is a warning because chrome-devtools-axi and Lavish need one; a missing terminal emulator is unknown because a TTY or SSH session also works. Under WSL2 both are reported unknown: they are on the Windows side and not checked from Linux. Nothing is launched. On every platform, terminal and browser results are advisories: `check` and `plan` list them separately (`advisories` in `--json`) and they do not count toward the gap count or exit code, so a WSL2 or headless SSH host can report ready when every required item passes. Native Windows preflight is a later PR.

## macOS and Linux install

Choose a new kit root and a Firstmate home path of your own, **outside** that root (for example `~/.agent-kit` and `~/firstmate`). The Firstmate home must be a new or empty directory. The installer refuses your home directory itself, system locations, a path inside an existing Firstmate home or git checkout, and an existing non-empty directory. The chosen path is recorded in the receipt, and a rerun with a different `--firstmate-home` is refused. Firstmate is staged in a hidden `.<name>.agent-kit-staging` sibling of that path so activation is an atomic rename; an interrupted stage is replaced on the next run.

```sh
node bin/agent-kit.mjs install --install-root /your/new/kit-root --firstmate-home /your/new/firstmate --harness codex
```

The default harness is Claude; `--harness codex` selects Codex. Figma remains optional with `--with-figma`. The installer requires macOS or glibc Linux on arm64 or x64 and Node 24.15.0 or newer. WSL2 uses the Linux artifacts and installer inside its distro: the lock has no `wsl2-<arch>` targets, and WSL2 resolves to `linux-<arch>`; its browser and terminal are on the Windows side. WSL1 and musl Linux are refused until their complete binary sets are reviewed. It stages exact artifacts under `releases/<release>/staging`, checks SHA-256 before extraction or execution, and activates kit-owned paths by rename. A private `receipt.json` records completed phases, versions, artifact digests, and owned paths without credentials or project names. A narrow lock prevents concurrent installs. On rerun it checks owned file digests and skips matching phases; changed files and unknown existing destinations cause refusal. The Firstmate home is verified by its pinned commit and git-tracked files only, so untracked or ignored files created by normal use (such as `.claude/settings.local.json`) do not block a rerun. A changed tracked Firstmate file is reported as a conflict for that phase, left untouched, and the other phases continue. An interrupted phase can resume from a verified staged artifact or a pending receipt.

The manifest pins the approved `pikenguyen227/firstmate` and `pikenguyen227/zoetrope` commits, with SHA-256 hashes computed from their pinned GitHub source archives. Firstmate is checked out at the pinned commit into the new home. The installer creates empty private `data/`, `state/`, `config/`, and `projects/` directories; it never imports an existing home or runs `fm-bootstrap.sh`. Repository-owned Claude/Codex hooks and relative skills stay with that checkout.

**Global hooks and skills.** `plan` and `install --dry-run` show the exact kit-owned operations for each global file and skill path. During `install`, the hooks phase prints that preview before applying it. Four pinned AXI packages and Herdr register `SessionStart` hooks in `~/.claude/settings.json` and `~/.codex/hooks.json`; all five pinned AXI packages link their published skills into `~/.claude/skills/` and `~/.agents/skills/` (Codex's documented user location). Herdr's pinned binary generates its agent-state scripts inside a disposable HOME; the kit verifies the reviewed script hashes and stores the scripts under the versioned kit root. The phase enables `[features] hooks = true` in `~/.codex/config.toml`. Hook commands carry `# agent-kit:<tool>` ownership markers. Existing unmarked hooks and other settings remain present, and an existing skill with another owner causes refusal. Edited files are backed up privately under the kit root, written atomically, and recorded in the receipt. Malformed files stop the phase. [Registration evidence and details](docs/global-hooks.md) list the upstream sources.

Codex asks each person to review new or changed hooks through `/hooks`; the kit does not pre-accept them. `no-mistakes init` installs its user-level skill when that person initializes their repository. Firstmate's own hooks and skills remain in its source checkout and are not registered globally.

The pinned Zoetrope fork has no verified release asset in this pilot. If Cargo and a compatible Rust toolchain are available, the installer attempts `cargo build --locked --release --bin zoe` from the verified source archive, with its own Cargo home and target directory. A missing toolchain or failed build is reported as partial. Even a packaged binary does not prove tower parity: fleet-manifest production and a user-relative launcher still need packaging and acceptance work in the Zoetrope fork. The installer does not launch it.

Herdr 0.9.3, Treehouse 2.3.0, no-mistakes 1.79.0, ShellCheck 0.11.0, and actionlint 1.7.12 use upstream macOS and Linux release assets with published SHA-256 digests in the manifest. The axi tools and optional Codex CLI use committed npm lockfiles with registry integrity data, including Codex Linux arm64/x64 optional packages. `npm ci` runs in a kit-owned prefix with `--ignore-scripts`, an empty kit npm configuration, a kit cache, and the public registry. No global npm installation occurs. Components without a verified adapter or artifact, including Claude CLI, Figma CLI, Node, Git and GitHub CLI, are reported as unverified and skipped. No floating `latest` pin or remote install script is used.

After installation, each person uses the printed vendor commands and documentation to sign in themselves. The kit does not run or capture logins and does not read or store credentials. A partial install is not a ready Control Tower.

The result prints kit and npm binary directories; add them to your own shell PATH if you want their commands available by name. The installer does not edit shell startup files or launch the fresh Firstmate home.

## Pins and approval

In the manifest, `verified` means the artifact's identity and integrity were checked against the approved upstream: a source commit, a published SHA-256 digest, or registry integrity in a committed npm lock. It does not mean owner approval, and no pin field claims it. The owner approves a release by merging the PR that changes the manifest. `install` installs only `verified` pins. Unverified pins are reported and skipped.

Versions for owner approval in the `macos-pilot-1` release:

| Tool | Version | Source |
| --- | --- | --- |
| Firstmate | `3cebfb5e809f7e87cea296a59fe14e2f1e47b7b6` | github.com/pikenguyen227/firstmate source archive |
| Zoe fleet (Zoetrope) | `a8c495a887ed78308f7c682c5d194835e7094b05` | github.com/pikenguyen227/zoetrope source archive |
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

`npm test` runs local `node:test` fixtures without network. They cover a no-op second run, interrupted resume, checksum refusal, unsupported OS/architecture/libc/WSL1, Linux and WSL2 artifact selection, fresh source staging and build packaging, Firstmate reruns after local untracked settings, tracked-file conflicts, Firstmate home path refusals, and global hook/skill merge behavior in a fake HOME. The Ubuntu CI smoke uses real downloads in a disposable HOME, verifies staged SHA-256 digests and a no-op rerun, and checks an unrelated HOME file. macOS smoke tests previously downloaded and verified the pinned release assets, Firstmate source archive, and npm lock groups in isolated locations. No agent or service is started.

The real Zoetrope tower runtime and a real WSL2 device are not yet acceptance tested. Linux arm64 has fixture coverage but no real arm64 runner in this PR. [Zoetrope packaging follow-ups](docs/zoetrope-followups.md) record the fleet-manifest, launcher and acceptance needs. Other follow-ups: native Windows preflight for the WSL2 handoff; `doctor` and explicit reviewed updates; a starter second-mate template; Zoetrope packaging; and an end-to-end personal tower pilot. Windows v1 remains WSL2, with no native or Git Bash installation path.

## Never ship

The kit never packages `.env`, credentials, tokens, passwords, cookies or browser profiles; keychain or credential-manager exports; SSH keys, machine registrations, account pins or global user configuration; existing `data/`, `state/`, or `config/` values; captain preferences or memories; histories, transcripts, databases or sockets; task, backlog or project registries; project clones or worktree pools; validation runs or mirrors; generated review artifacts or personal plugin caches; local backups, absolute-path wrappers, private patches or permissive agent-launch settings. Public packages come from approved upstreams, never from another person's installation.
