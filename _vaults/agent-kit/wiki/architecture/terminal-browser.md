---
title: Terminal browser
description: The agent-kit terminal-browser command: terminal detection, per-machine numbered steps, ldd library step, the guarded vendor install, and what has been run
date: 2026-11-02
---

# Terminal browser

`agent-kit terminal-browser` helps many people on different machines get [terminal-browser](https://github.com/zenbu-labs/terminal-browser) working. It lives in `src/terminal-browser.mjs`, with terminal detection in `src/browser.mjs` (`detectTerminal`) and library mapping in `src/libraries.mjs`; it is a command in `bin/agent-kit.mjs` and `src/kit.mjs` that takes `--json` and `--install`. Plain runs print one numbered list of only the steps that apply, each with a one-line check, and run nothing.

## Steps and where they live

- **Terminal** (`detectTerminal`): kitty, Ghostty and WezTerm draw kitty graphics (`yes`); the VS Code terminal and Windows Terminal do not (`no`; VS Code showed a blank screen on WSL2 Ubuntu 24.04); tmux, screen and anything unrecognised are `unknown`. If not `yes`, step 1 is that machine's route: kitty from the package manager, `kitty -o linux_display_server=x11` on WSLg (without it kitty fails `Wayland: Failed to connect to display`), `brew install --cask kitty` on macOS.
- **Install**: the vendor's `curl -fsSL https://terminal-browser.sh/install | bash` (read, never run by the authors' tests; it installs under `~/.local/share/terminal-browser/app` and `~/.local/bin/terminal-browser`, honouring `XDG_DATA_HOME` and `XDG_BIN_HOME`), or `brew install terminal-browser` on macOS with `brew` on PATH. `installTerminalBrowser` runs it only with `--install`, in a terminal, after the person types `y`; the prompt and runner are injectable.
- **Libraries**: after install, `libraryReport` runs `ldd` on the bundled engine `app/electron/pixel` and prints the install command for only what is `not found`.
- **Open, herdr, verify**: `terminal-browser open terminal-browser.com`; the herdr plugin step appears only when `herdr` is on PATH; the final step is `agent-kit browser-check`. With no graphics terminal, `terminal-browser action -- snapshot` is offered as a text fallback.
- Native Windows prints one step: run it inside WSL2.

## Verified and UNVERIFIED

Run on Ubuntu 24.04.1 under WSL2: the plan printout, `ldd` against real binaries, kitty on X11, the `snapshot` fallback. UNVERIFIED: macOS; native Windows and Windows-from-WSL; the herdr plugin and herdr's kitty-graphics passthrough; WSL2 `nat` networking with a Windows-side Edge; Fedora-like and Arch-like package names; the `--install` flow against the real script (tested with a faked prompt and runner only).
