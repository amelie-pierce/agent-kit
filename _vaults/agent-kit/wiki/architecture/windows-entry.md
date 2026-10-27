---
title: Windows entry and WSL2 handoff
description: Windows preflight, step guidance and the handoff into the Linux installer inside WSL2
date: 2026-10-27
---

# Windows entry and WSL2 handoff

Windows has no native install. `windows/agent-kit.ps1` checks Node against the `engines` floor in `package.json`, prints the official download and winget command instead of installing Node, then runs the Node CLI; `-DryRun` turns `install` into `install --dry-run` and refuses `--handoff` (windows/agent-kit.ps1:20-67). It writes its own messages to stderr so `--json` output on stdout stays parseable.

`inspectWindows` reads the build from `os.release()` (floor 19041), derives the native architecture from `os.machine()` and the `PROCESSOR_*` variables so x64 Node emulated on Arm64 still targets `linux-arm64`, and sets `artifactTarget` so `evaluate` plans Linux artifacts (src/platforms/windows.mjs:57-71; src/platforms/windows.mjs:106-174; src/kit.mjs:94). It runs `wsl.exe` only when `reg.exe query` finds the `WslService` or `LxssManager` service, because the inbox stub can offer to install WSL; then it reads `wsl --status` and `wsl --list --verbose` and decodes UTF-16LE with or without a BOM, or UTF-8 (src/platforms/windows.mjs:7; src/platforms/windows.mjs:16-41; src/platforms/windows.mjs:122-135). `wsl --status` labels are English-only in the parser, so a localized status leaves the default version unknown; list rows are parsed by shape and `docker-desktop` distributions are ignored (src/platforms/windows.mjs:29-41; src/platforms/windows.mjs:134). Each gap becomes a step object with the command, whether it needs an administrator PowerShell, and whether Windows must restart; nothing runs it (src/platforms/windows.mjs:101-166; src/install/windows.mjs:60). Terminal, browser and virtualization are advisories (src/kit.mjs:82).

On Windows, `--install-root` and `--firstmate-home` must be Linux paths, absolute or `~/`, from a plain character set and never under `/mnt` (src/install/windows.mjs:11-18; src/kit.mjs:61-64). Plans show POSIX paths and skip the global hook preview, which the Linux installer prints inside WSL (src/kit.mjs:135-141; src/kit.mjs:155-181). The handoff argv is `wsl.exe -d <distro> --exec bash -l -c <script> agent-kit-handoff <commit> <root> <home> ...`. The script has no quote characters, so it pastes inside PowerShell single quotes. It fetches the Windows checkout's clean HEAD commit of the kit into `<root>/kit/<commit>` and execs the Linux `install` (src/install/windows.mjs:21-58). `install --handoff` spawns only that argv; without it the command is printed (src/install/windows.mjs:70-87; bin/agent-kit.mjs:24-30).

Tests mock `reg.exe`, `wsl.exe` and the CIM query, and run the handoff script with fake `git` and `node` in a temporary HOME (test/windows.test.mjs:1-237). The `windows-latest` job runs a read-only CLI and bootstrap smoke without enabling WSL (.github/workflows/test.yml; scripts/windows-preflight-smoke.mjs:1-56). Real-device behaviour remains **UNVERIFIED**: argument passing through `wsl.exe --exec`, PowerShell 5.1 quoting of the printed command, enablement and reboot, the private repository fetch inside WSL, and the Windows browser opened from WSL. The README keeps the owner's list (README.md:71-78).

Related: [Linux and WSL2 installation](linux-install.md), [Read-only boundary](read-only-boundary.md).
