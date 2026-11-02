---
title: Browser check
description: The agent-kit browser-check command, its detection, library, verify and terminal-browser steps, and what has been run
date: 2026-11-02
---

# Browser check

`agent-kit browser-check` makes sure the Chromium-family browser that chrome-devtools-axi needs works on macOS, Linux, WSL and Windows. It lives in `src/browser.mjs` and is wired as its own command in `bin/agent-kit.mjs:151-155` and `src/kit.mjs:59`; it takes only `--json` (src/kit.mjs:59-76). It installs nothing, never runs `sudo`, never edits WSL networking, and removes its temporary browser profile.

## Steps and where they live

- **Detect** (src/browser.mjs `detectEnvironment`, `detectBrowsers`): OS and WSL come from `linuxIdentity` (src/platforms/linux.mjs:18-31) plus `/etc/os-release`. Chrome, Edge and Brave are looked up on PATH (Linux), in `/Applications` and `~/Applications` (macOS), in `Program Files`, `Program Files (x86)` and `%LOCALAPPDATA%` (Windows), and from WSL on the Windows side under `/mnt/c` plus `%LOCALAPPDATA%` read through `cmd.exe` and `wslpath`. A browser inside the distribution sorts before a Windows-side one.
- **Libraries** (src/libraries.mjs `libraryReport`, `libraryCommand`, `parseLddMissing`): Linux and WSL only, for a browser inside the distribution. Runs `ldd` on the browser binary (or on the real binary beside a vendor wrapper script), lists only the sonames reported `not found`, and maps each to an `apt-get`, `dnf` or `pacman` package for the distribution family; there is no fixed package list. The `t64` suffix (`libasound2t64`) applies from Ubuntu 24.04 and Debian 13, chosen from `UBUNTU_CODENAME` or `VERSION_CODENAME`. An unknown distribution or an unmapped library gets the names and a hint, no command. The same module serves [terminal-browser](terminal-browser.md).
- **Verify** (`browserCheck`): launches the browser visibly (no `--headless`) with `--remote-debugging-port=<free port>` and a temporary `--user-data-dir`, probes `/json/version`, then runs `chrome-devtools-axi open` against it with `CHROME_DEVTOOLS_AXI_BROWSER_URL` in the `agent-kit-browser-check` session, with `CHROME_DEVTOOLS_AXI_AUTO_CONNECT` and `CHROME_DEVTOOLS_AXI_MCP_SERVER_URL` blanked because chrome-devtools-axi gives them precedence over the browser URL (chrome-devtools-axi `dist/src/bridge.js` `buildTransportArgs`). It closes the browser through CDP `Browser.close`, then kills the process, and for a Windows-side browser also stops processes whose command line names the profile folder. Windows skips the chrome-devtools-axi step because the kit installs it inside WSL2.
- **Terminal pointer** (`detectTerminal`, `terminalBrowserOffer`): a single printed line pointing at `agent-kit terminal-browser`, only when the environment names kitty, Ghostty or WezTerm outside tmux and screen.

Every real-world touch point is an injected context field (`run`, `launch`, `probe`, `freePort`, `profile`, `closeBrowser`, `sleep`, `exists`), so `test/browser.test.mjs` runs on all three CI operating systems with no browser.

## Findings that shape the design

- In WSL2 `nat` networking the Windows localhost is not WSL's `127.0.0.1`: a Windows Chrome started by the check was reported as unreachable (`wslinfo --networking-mode` printed `nat`). `mirrored` mode was not run.
- chrome-devtools-axi launches only Chrome itself; Edge, Brave and a Windows browser from WSL need `CHROME_DEVTOOLS_AXI_BROWSER_URL` (chrome-devtools-axi `dist/src/cli.js` help text).
- The Windows bootstrap's Node floor (`windows/agent-kit.ps1`) stops before the CLI on a PC with an older Windows Node.js; the Windows steps still ran through `node bin\agent-kit.mjs browser-check`.

## Verified and UNVERIFIED

Run for real: Linux and WSL2 on Ubuntu 24.04.1 with WSLg, a Linux Chrome for Testing 158 binary linked as `google-chrome`, chrome-devtools-axi 0.1.35. UNVERIFIED: macOS; Edge and Brave anywhere; `install.ps1 browser-check` and `windows/agent-kit.ps1 browser-check` end to end; a Windows browser from WSL2 in `mirrored` mode; non-Ubuntu-24.04 library commands; the pointer line on a real kitty-graphics terminal. The `ldd` step ran for real against a Chrome for Testing binary and a compiled binary with a missing library.
