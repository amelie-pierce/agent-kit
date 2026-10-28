# Windows pilot check

This is the hands-on check that the Windows path works end to end: `install.ps1` on Windows hands off into WSL2, and the guided setup, install and health check run inside Ubuntu. CI covers mocked `wsl.exe` output and dry runs on the GitHub `windows-latest` runner only (see the README's [Windows personal devices](../README.md#windows-personal-devices) section), so this check is the first real run.

Who runs it and what it covers:

- A teammate runs it on their own personal Windows PC. Most PCs are x64; Windows on Arm (Arm64) follows the same steps. Never use a work server or a shared machine.
- **Not confirmed yet:** nothing in this check has been run on a real Windows PC. Both x64 and Arm64 stay unconfirmed until the first teammates report back with [Pilot feedback](#pilot-feedback).
- You sign in to every service yourself. Agents never sign in, and never ask for or handle a password, token or sign-in code.

Plan about 45 minutes. Use a normal (not administrator) PowerShell window unless a step says otherwise.

`<SHA>` in the commands below is the full 40-character kit commit you were given. Both installers accept only a commit that is already on `main`, so this check runs after the release PR has merged. Leaving out `--commit <SHA>` uses the newest reviewed release instead.

## The check

1. **Baseline (read-only).** In PowerShell:

   ```powershell
   cmd /c ver
   $env:PROCESSOR_ARCHITECTURE
   wsl --version
   wsl --status
   wsl -l -v
   ```

   Success: you have the Windows build (from `cmd /c ver`), the architecture (`AMD64` for x64, `ARM64` for Arm64) and the WSL version, and either a WSL2 distribution is listed or WSL is clearly absent.
2. **WSL, only if it is missing.** In an **administrator** PowerShell run `wsl --install -d Ubuntu`, restart Windows, open Ubuntu once and create your Linux user. Success: `wsl -l -v` shows Ubuntu with `VERSION` `2`, and `wsl -e grep VERSION_ID /etc/os-release` shows `22.04` or newer.
3. **Windows-side tools.** In a normal PowerShell:

   ```powershell
   winget install --exact --id Git.Git
   winget install --exact --id GitHub.cli
   winget install --exact --id OpenJS.NodeJS.LTS
   ```

   Open a new PowerShell window, then check `node --version` (it must be `v24.15.0` or newer), `git --version` and `gh --version`. Sign in to GitHub yourself:

   ```powershell
   gh auth login
   ```

4. **WSL-side tools.** Open Ubuntu (or run `wsl` in PowerShell) and install, inside Ubuntu:
   - Node.js 24.15.0 or newer from NodeSource or nvm, not `apt install nodejs` (Ubuntu's package is far older). With NodeSource, follow <https://github.com/nodesource/distributions> for Node.js 24. With nvm, follow <https://github.com/nvm-sh/nvm#installing-and-updating>, open a new Ubuntu shell, then run `nvm install 24`.
   - git: `sudo apt-get update && sudo apt-get install -y git`
   - the GitHub CLI, following <https://github.com/cli/cli/blob/trunk/docs/install_linux.md>
   - for the fleet tower, python3 3.9 or newer and jq: `sudo apt-get install -y python3 jq` (setup lists them as advisories if missing; they do not block it)

   Then sign in again inside Ubuntu. This is a separate sign-in from Windows:

   ```sh
   gh auth login
   ```

   Check from PowerShell that a login shell inside WSL finds every tool, since that is how the handoff runs:

   ```powershell
   wsl -e bash -l -c 'node --version; git --version; gh --version'
   ```

   Success: Node.js is `v24.15.0` or newer and all three print a version. If `node` is not found here but works in an open Ubuntu window, nvm was loaded only for interactive shells; use NodeSource instead, or load nvm from `~/.profile`.
5. **Fetch the installer.** In PowerShell, in an empty folder:

   ```powershell
   gh api -H "Accept: application/vnd.github.raw" "repos/amelie-pierce/agent-kit/contents/install.ps1?ref=<SHA>" > install.ps1
   ```

6. **Windows dry run.**

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun --commit <SHA>
   ```

   Accept the root `~/Agentic`. This checks the Windows prerequisites and WSL2 only; it does not ask the other questions. Success: it prints `Agent Kit install (Windows): handoff-ready` and one `wsl.exe -d Ubuntu --exec bash -l -c '...' agent-kit-setup <SHA> ... --dry-run` command. Nothing runs inside WSL.
7. **WSL dry run.** Paste that printed `wsl.exe ...` command into the same PowerShell window. Success: every setup question and the summary appear, it ends with `Dry run: nothing was written.`, and afterwards `wsl -e sh -c 'ls ~/Agentic'` reports no such file or directory.
8. **Real install.**

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 --commit <SHA>
   ```

   Answer the questions with the defaults unless you were told otherwise. The fleet tower is on by default and installs from the pinned WSL2 release, so the expected ending is `Agent Kit setup complete.`, with the tools step reading `tower: installed from verified release; hands-on acceptance pending (Zoetrope Phase B)` and a `Tower launcher:` line. Success: the health check step reports `pass`, the output names no `cargo` build, and running the same command again skips every completed step. Keep the installer's final text (from `Agent Kit setup` to the end) for [Pilot feedback](#pilot-feedback). If the tools step instead reports `zoe-fleet: unverified; refused: the WSL2 tower release needs Ubuntu 22.04 or newer`, the distribution is older than Ubuntu 22.04; note it and stop.
9. **Isolation checks.** In PowerShell:

   ```powershell
   Test-Path C:\Agentic
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun --commit <SHA> --root /mnt/c/kit
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun --commit <SHA> --root //mnt/c/kit
   Test-Path C:\kit
   ```

   Success: both `Test-Path` lines print `False`, and both dry runs are refused with a message that the root must be a Linux path inside WSL or stay off the Windows drive under `/mnt`.
10. **Runtime smoke.** Open a new Windows Terminal tab with the Ubuntu profile. It reads the kit's PATH block if question 5b added one. If you skipped question 5b or the installer could not edit your profile, add the folders from its final PATH instructions in this shell first ([B2.11](user-guide.md#b211-add-the-kit-to-your-path-in-ubuntu)). Then run:

    ```sh
    herdr --version
    treehouse --version
    no-mistakes --version
    ```

    Optionally run `lavish-axi --help`, or `chrome-devtools-axi open https://example.com` and note whether a Windows browser opens. Do not sign in to any agent CLI for this check.
11. **Tower.** In the same Ubuntu shell, run the launcher path the installer printed on its `Tower launcher:` line:

    ```sh
    uname -m
    getconf GNU_LIBC_VERSION
    <printed launcher> doctor
    ```

    Success: `uname -m` prints `x86_64` on an x64 PC (`aarch64` on Arm64), `getconf` prints `glibc 2.35` or newer, and `doctor` reports no failures. Then start Herdr in that shell, and from a Herdr pane run `<printed launcher> open`. Success: the Fleet pane opens in the Herdr Team tab. Close it with `herdr pane close <pane-id>` and stop Herdr with `herdr server stop`. The full Zoetrope Phase B check (spawning a second mate) is not part of this check. This step is not hands-on confirmed on either x64 or Arm64 yet.

## Clean up

Send the [Pilot feedback](#pilot-feedback) first: its health check needs the install in place. Then, inside Ubuntu:

```sh
node ~/Agentic/.tools/kit/<SHA>/bin/agent-kit.mjs uninstall --root ~/Agentic
```

This removes the kit's hooks and skill links and moves kit files into `~/Agentic/agent-kit-uninstall/backups`. Once you have checked that nothing personal is left in `~/Agentic`, remove it with `rm -rf ~/Agentic`. Optionally sign out with `gh auth logout` in both Windows and Ubuntu. If you created Ubuntu only for this check, `wsl --unregister Ubuntu` in PowerShell deletes the whole distribution and everything in it, so run it only when it holds nothing else. Finally delete `install.ps1` from the Windows folder.

## Pilot feedback

Send these, as text, to the person who shared this guide with you:

1. **Health check as JSON.** Inside Ubuntu:

   ```sh
   node ~/Agentic/.tools/kit/<SHA>/bin/agent-kit.mjs doctor --json
   ```

2. **The installer's final text** from step 8, from the `Agent Kit setup` line to the end.
3. **Windows build** (`cmd /c ver`) and **architecture** (`$env:PROCESSOR_ARCHITECTURE`) from step 1.
4. **WSL version** (`wsl --version`, all lines).
5. **Ubuntu version**: `wsl -e grep VERSION_ID /etc/os-release`.
6. Anything that failed or surprised you, with the step number and the exact message.

Redact before sending: replace your Windows user name, Linux user name, host name, GitHub login and email with `<user>`, `<host>`, `<login>` and `<email>`, including inside paths in the doctor output. Never include tokens, `gh auth status` token lines, anything from `~/.config/gh`, `.env` files, receipt contents other than its `release` and `phases` keys, or screenshots of browser sign-ins.
