# Agent Kit

Agent Kit is a per-person setup for Firstmate, Herdr, the custom Zoe fleet tower, Treehouse, agent CLIs, and source-owned skills. This release adds a **macOS pilot installer**. It reports a partial result until every selected component and the tower's fleet manifest/launcher integration are verified. It never starts services or signs in for anyone.

## Read-only commands

Use Node.js 24.15.0 or newer. The CLI itself has no runtime dependencies.

```sh
node bin/agent-kit.mjs check
node bin/agent-kit.mjs plan --harness codex --with-figma
node bin/agent-kit.mjs install --dry-run --install-root /your/new/kit-root --firstmate-home /your/new/firstmate
```

`install --dry-run` is exactly `plan`: it makes no changes. `check` and `plan` only inspect and print. They do not probe authentication, run Firstmate bootstrap, or invoke Herdr lifecycle commands. `--json` is available for all commands. `check` is still the initial read-only presence check, not an installed-state doctor for an arbitrary custom root. Linux and Windows/WSL2 adapters remain out of scope for this PR.

## macOS install

Choose a new kit root and a Firstmate home path of your own, **outside** that root (for example `~/.agent-kit` and `~/firstmate`). The Firstmate home must be a new or empty directory. The installer refuses your home directory itself, system locations, a path inside an existing Firstmate home or git checkout, and an existing non-empty directory. The chosen path is recorded in the receipt, and a rerun with a different `--firstmate-home` is refused. Firstmate is staged in a hidden `.<name>.agent-kit-staging` sibling of that path so activation is an atomic rename; an interrupted stage is replaced on the next run.

```sh
node bin/agent-kit.mjs install --install-root /your/new/kit-root --firstmate-home /your/new/firstmate --harness codex
```

The default harness is Claude; `--harness codex` selects Codex. Figma remains optional with `--with-figma`. The installer requires macOS arm64 or x64 and Node 24.15.0 or newer. It stages exact artifacts under `releases/<release>/staging`, checks SHA-256 before extraction or execution, and activates kit-owned paths by rename. A private `receipt.json` records completed phases, versions, artifact digests, and owned paths without credentials or project names. A narrow lock prevents concurrent installs. On rerun it checks owned file digests and skips matching phases; changed files and unknown existing destinations cause refusal. The Firstmate home is verified by its pinned commit and git-tracked files only, so untracked or ignored files created by normal use (such as `.claude/settings.local.json`) do not block a rerun. A changed tracked Firstmate file is reported as a conflict for that phase, left untouched, and the other phases continue. An interrupted phase can resume from a verified staged artifact or a pending receipt.

The manifest pins the approved `pikenguyen227/firstmate` and `pikenguyen227/zoetrope` commits, with SHA-256 hashes computed from their pinned GitHub source archives. Firstmate is checked out at the pinned commit into the new home. The installer creates empty private `data/`, `state/`, `config/`, and `projects/` directories; it never imports an existing home or runs `fm-bootstrap.sh`. Repository-owned Claude/Codex hooks and relative skills stay with that checkout.

**Deferred: global hook and skill registration.** This release does not register anything in global Claude/Codex settings and does not merge hooks or skills by ownership marker. It writes nothing to global Claude/Codex settings, permissions, plugins, or trust records. The ownership-marker merge (show exact changes, then add only kit-owned registrations while preserving unrelated settings) is the first item of the next PR.

The pinned Zoetrope fork has no verified release asset in this pilot. If Cargo and a compatible Rust toolchain are available, the installer attempts `cargo build --locked --release --bin zoe` from the verified source archive, with its own Cargo home and target directory. A missing toolchain or failed build is reported as partial. Even a packaged binary does not prove tower parity: fleet-manifest production and a user-relative launcher still need packaging and acceptance work in the Zoetrope fork. The installer does not launch it.

Herdr 0.9.3, Treehouse 2.3.0, no-mistakes 1.79.0, ShellCheck 0.11.0, and actionlint 1.7.12 use the upstream macOS release assets and published SHA-256 digests in the manifest. The axi tools and optional Codex CLI use committed npm lockfiles with registry integrity data. `npm ci` runs in a kit-owned prefix with `--ignore-scripts`, an empty kit npm configuration, a kit cache, and the public registry. No global npm installation occurs. Components without a verified adapter or artifact, including Claude CLI, Figma CLI, Node, Git and GitHub CLI, are reported as unverified and skipped. No floating `latest` pin or remote install script is used.

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

`npm test` runs local `node:test` fixtures without network. They cover a no-op second run, interrupted resume, checksum refusal, unsupported OS/architecture, fresh source staging and build packaging, Firstmate reruns after local untracked settings, tracked-file conflicts, Firstmate home path refusals, and that install writes no global Claude/Codex settings. macOS smoke tests downloaded and verified the pinned Herdr, Treehouse, no-mistakes, ShellCheck, and actionlint assets, the Firstmate source archive, and both npm lock groups with fresh temporary HOME and root paths. Each skipped a second run; Firstmate runtime data began empty. The temporary files were removed. No agent or service was started.

The real Zoetrope Cargo build and tower runtime were not smoke tested in this isolated HOME. [Zoetrope packaging follow-ups](docs/zoetrope-followups.md) record the fleet-manifest, launcher and acceptance needs. Next PR, first item: global hook/skill registration by stable ownership markers. Other follow-ups: Linux and WSL2 installation; native Windows preflight for the WSL2 handoff; `doctor` and explicit reviewed updates; a starter second-mate template; and an end-to-end personal tower pilot. Windows v1 remains WSL2, with no native or Git Bash installation path.

## Never ship

The kit never packages `.env`, credentials, tokens, passwords, cookies or browser profiles; keychain or credential-manager exports; SSH keys, machine registrations, account pins or global user configuration; existing `data/`, `state/`, or `config/` values; captain preferences or memories; histories, transcripts, databases or sockets; task, backlog or project registries; project clones or worktree pools; validation runs or mirrors; generated review artifacts or personal plugin caches; local backups, absolute-path wrappers, private patches or permissive agent-launch settings. Public packages come from approved upstreams, never from another person's installation.
