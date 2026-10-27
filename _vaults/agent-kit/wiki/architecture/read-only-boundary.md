---
title: Read-only boundary
description: How the skeleton evaluates a proposed tool manifest without installing
date: 2026-10-26
---

# Read-only boundary

Updated 2026-10-27: Windows has a preflight adapter and WSL2 handoff; person-installed prerequisites now have their own minimum-version path.

The entry point loads the bundled JSON manifest, routes `install` to the shared macOS/Linux installer or, on Windows, to the WSL2 handoff, and writes results to stdout; it handles invalid input on stderr (bin/agent-kit.mjs:1-49). `run` remains read-only and validates the manifest, chooses the requested harness, evaluates gaps, and builds check or plan output, listing unselected optional components in the plan (src/kit.mjs:84-102; src/kit.mjs:151-188). `install --dry-run` maps to `plan` (src/kit.mjs:41-69).

The manifest distinguishes kit-installed pins from person-installed prerequisites. A prerequisite has a minimum version, required flag and vendor install link, with no artifact or install location; validation rejects unsafe version commands. The macOS and Linux adapters read `--version` from PATH and compare numeric version triples. Figma is optional, and its version probe uses a disposable HOME so it cannot initialize the teammate's settings (manifests/schema-v1.json:15-43; src/kit.mjs:23-28; src/platforms/macos.mjs:78-96). The macOS adapter also checks Homebrew, CLT, shell, install-root writability, terminal and browser presence; `git rev-parse HEAD` for source pins remains confined by `GIT_CEILING_DIRECTORIES` (src/platforms/macos.mjs:99-142). Terminal and browser results, optional Figma, and the Windows virtualization hint are advisories (src/kit.mjs:97-117). Linux and WSL2 checks are described in [Linux and WSL2 installation](linux-install.md), and Windows checks in [Windows entry and WSL2 handoff](windows-entry.md).

The manifest has verified macOS and Linux pins for source archives and selected release assets. Npm tools use committed locks, so their placeholder artifact fields do not create extra gaps. Windows plans evaluate the `linux-<arch>` artifacts installed inside WSL2. The unverified Linux fleet runtime is still reported as an advisory because Linux uses the source-built tower without that runtime; other relevant unverified pins remain gaps (src/kit.mjs:99-117; src/install/macos.mjs:12-14; manifests/pilot-skeleton.json:277-340). The [README](../../../../README.md) lists excluded personal material under "Never ship".
