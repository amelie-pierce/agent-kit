# Agent Kit

Agent Kit is a proposed per-person setup for Firstmate, Herdr, the Zoe fleet tower, Treehouse, agent CLIs, source-owned skills and reviewed plugins. This first release is a **read-only skeleton**. It does not install or configure anything, and it does not claim tower parity on any OS.

## Read-only usage

Use Node.js 24.15.0 or newer. The exact floor is a starting point from the stack investigation, not a compatibility certification. No `npm install` is needed; the CLI has no runtime dependencies.

```sh
node bin/agent-kit.mjs check
node bin/agent-kit.mjs --check --json
node bin/agent-kit.mjs plan --harness codex --with-figma
```

The selected harness defaults to Claude; `--harness codex` selects Codex. Figma is optional. `check` reports macOS architecture, Node floor, Homebrew and Xcode CLT presence, Bash, curl, jq, Python 3, tar and shasum presence, PATH conflicts, and the selected tools' presence and versions. `plan` shows the proposed versions, upstreams, locations, artifact gaps, hook boundary, and steps for each person to sign in. JSON output is available with `--json`. A gap or unverified pin exits 1; malformed arguments or a manifest error exits 2.

Both commands only read and print. They never install, download, write a file, start a service, run Firstmate bootstrap, or run Herdr lifecycle commands. This skeleton has no output-file option; stdout is its only output. The implementation calls only bounded version commands and `xcode-select -p`, with no shell. It never probes authentication status or opens credential stores. It does not read or print token, password, or credential values. Each teammate signs in with each vendor themselves, outside the kit.

The [v1 JSON Schema](manifests/schema-v1.json) and [example manifest](manifests/pilot-skeleton.json) are deliberately incomplete. Observed local versions are candidates, not an approved lock. Firstmate and the custom `pikenguyen227/zoetrope` source commits, artifact URLs, and SHA-256 values are marked unverified rather than guessed. `check` reports these as unknown. No install action should consume this manifest until each pin and artifact is reviewed and tested. Updates will only be explicit from reviewed manifests.

macOS arm64 and x64 are the only adapter targets in this skeleton. Linux and WSL2 stop clearly. Windows personal-device support is planned through native PowerShell/Node preflight, WSL2 and distro guidance, then installation inside Linux in WSL; the Windows stub describes that flow but does not perform it. Windows CI runs the unit tests now. Native Windows installation, Linux and WSL2 adapters, installers, login flows, fresh Firstmate home creation, source-owned skill and reviewed plugin registration, starter second-mate provisioning, updates, and integration tests are follow-up work.

## Never ship

The kit never packages `.env`, credentials, tokens, passwords, cookies or browser profiles; keychain or credential-manager exports; SSH keys, machine registrations, account pins or global user configuration; existing `data/`, `state/`, or `config/` values; captain preferences or memories; histories, transcripts, databases or sockets; task, backlog or project registries; project clones or worktree pools; validation runs or mirrors; generated review artifacts or personal plugin caches; local backups, absolute-path wrappers, private patches or permissive agent-launch settings. Public packages must come from their approved upstreams, never from another person's installation.

Run tests with `npm test`. Tests use temporary fake HOME and PATH fixtures and no network or installed tools.
