---
title: Linux and WSL2 installation
description: Linux platform selection and shared installer boundaries
date: 2026-10-27
---

# Linux and WSL2 installation

`check` and `plan` read Linux distro metadata, `/proc/version`, WSL markers, `getconf` libc identification, required commands, shell, install-root writability, PATH conflicts, and terminal/browser presence on PATH (advisory only: listed under `advisories`, excluded from the gap count and exit code; a missing browser warns; under WSL2 both are unknown, Windows side). Only glibc Linux x64/arm64 and WSL2 on those targets proceed; WSL1 and other libc or architecture results refuse (src/platforms/linux.mjs:1-66). WSL2 plans use a tool's `wsl2-<arch>` artifact when present (only the Zoe fleet tower and runtime) and `linux-<arch>` otherwise; the manifest schema accepts `darwin`, `linux`, `wsl2` and `windows` targets. WSL2 plans preview the same owned global hook changes as macOS (src/kit.mjs:84-102; src/kit.mjs:151-165).

The Linux CLI calls the same install function as macOS. It chooses `wsl2-<arch>` artifacts inside WSL2 where the manifest has them and `linux-<arch>` artifacts otherwise, while retaining the existing staging, SHA-256, lock, receipt, npm, source build and hooks phases. WSL2 adds Windows terminal and browser guidance to next steps (bin/agent-kit.mjs:19-40; src/install/macos.mjs:233-268; src/install/macos.mjs:358-391). The official Linux release hashes for the binary tools and pinned source archives are in `manifests/pilot-skeleton.json`; Codex Linux optional packages retain integrity entries in `manifests/npm-codex/package-lock.json` (manifests/pilot-skeleton.json:1; manifests/npm-codex/package-lock.json:1).

The Ubuntu x64 CI matrix job runs the full unit suite before an installer smoke with real downloads in a disposable HOME, compares staged artifact hashes to the manifest, repeats installation, and checks an unrelated HOME file; `scripts/wsl2-tower-smoke.mjs` then installs the real `wsl2-x64` tower assets under a WSL2 kernel identity. Linux arm64 and WSL2 arm64 have fixture coverage; a real arm64 runner and Windows device acceptance remain UNVERIFIED (.github/workflows/test.yml:5-28; scripts/linux-install-smoke.mjs:1-46; scripts/wsl2-tower-smoke.mjs:1; test/kit.test.mjs:130-175).
