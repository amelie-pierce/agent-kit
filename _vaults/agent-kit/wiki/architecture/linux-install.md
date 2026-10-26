---
title: Linux and WSL2 installation
description: Linux platform selection and shared installer boundaries
date: 2026-10-27
---

# Linux and WSL2 installation

`check` and `plan` read Linux distro metadata, `/proc/version`, WSL markers, `getconf` libc identification, required commands, shell, install-root writability, PATH conflicts, and terminal/browser presence on PATH (a missing browser warns; under WSL2 both are unknown, Windows side). Only glibc Linux x64/arm64 and WSL2 on those targets proceed; WSL1 and other libc or architecture results refuse (src/platforms/linux.mjs:1-66). WSL2 plans use `linux-<arch>` artifacts; the manifest schema accepts only `darwin`, `linux` and `windows` targets, so there is no separate WSL2 artifact set, and preview the same owned global hook changes as macOS (src/kit.mjs:78-88; src/kit.mjs:133-145).

The Linux CLI calls the same install function as macOS. It chooses `linux-<arch>` artifacts while retaining the existing staging, SHA-256, lock, receipt, npm, source build and hooks phases. WSL2 adds Windows terminal and browser guidance to next steps (bin/agent-kit.mjs:14-32; src/install/macos.mjs:233-268; src/install/macos.mjs:358-391). The official Linux release hashes for the binary tools and pinned source archives are in `manifests/pilot-skeleton.json`; Codex Linux optional packages retain integrity entries in `manifests/npm-codex/package-lock.json` (manifests/pilot-skeleton.json:1; manifests/npm-codex/package-lock.json:1).

The Ubuntu x64 CI matrix job runs the full unit suite before an installer smoke with real downloads in a disposable HOME, compares staged artifact hashes to the manifest, repeats installation, and checks an unrelated HOME file. Linux arm64 and WSL2 have fixture coverage; a real arm64 runner and Windows device acceptance remain UNVERIFIED (.github/workflows/test.yml:5-19; scripts/linux-install-smoke.mjs:1-46; test/kit.test.mjs:130-175).
