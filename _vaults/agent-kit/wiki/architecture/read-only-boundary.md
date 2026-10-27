---
title: Read-only boundary
description: How the skeleton evaluates a proposed tool manifest without installing
date: 2026-10-26
---

# Read-only boundary

Updated 2026-10-27: Windows has a preflight adapter and WSL2 handoff instead of a stub; citations refreshed.

The entry point loads the bundled JSON manifest, routes `install` to the shared macOS/Linux installer or, on Windows, to the WSL2 handoff, and writes results to stdout; it handles invalid input on stderr (bin/agent-kit.mjs:1-49). `run` remains read-only and validates the manifest, chooses the requested harness, evaluates gaps, and builds check or plan output, listing unselected optional components in the plan (src/kit.mjs:84-102; src/kit.mjs:151-188). `install --dry-run` maps to `plan` (src/kit.mjs:41-69).

The macOS adapter searches PATH and uses bounded version commands, `xcode-select -p`, and `git rev-parse HEAD` confined by `GIT_CEILING_DIRECTORIES` so it cannot walk into an enclosing repository. It reports path duplicates, tool status, Homebrew, CLT, `$SHELL`, install-root writability (via `access` only), terminal and browser app presence, and supporting CLI presence. Unverified manifest versions are reported as unknown, never pass or fail (src/platforms/macos.mjs:9-116). Terminal and browser results on every platform, and the Windows virtualization hint, are advisories that do not block readiness (src/kit.mjs:82-102). Linux and WSL2 checks are described in [Linux and WSL2 installation](linux-install.md), and Windows checks in [Windows entry and WSL2 handoff](windows-entry.md); other platforms stop in the platform router (src/platforms/index.mjs:5-14).

The manifest has verified macOS and Linux pins for the source archives and selected release assets, while unavailable adapters and Windows targets remain unverified. Windows plans evaluate the `linux-<arch>` artifacts installed inside WSL2. `evaluate` carries those gaps into the issue list and `run` exits nonzero (src/kit.mjs:84-102; src/kit.mjs:187). The [README](../../../../README.md) lists excluded personal material under "Never ship".
