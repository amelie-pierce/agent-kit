---
title: Read-only boundary
description: How the skeleton evaluates a proposed tool manifest without installing
date: 2026-10-26
---

# Read-only boundary

The entry point loads the bundled JSON manifest, routes `install` to the shared macOS/Linux installer, and writes results to stdout; it handles invalid input on stderr (bin/agent-kit.mjs:1-38). `run` remains read-only and validates the manifest, chooses the requested harness, evaluates gaps, and builds check or plan output, listing unselected optional components in the plan (src/kit.mjs:72-91; src/kit.mjs:133-167). `install --dry-run` maps to `plan` (src/kit.mjs:39-58).

The macOS adapter searches PATH and uses bounded version commands, `xcode-select -p`, and `git rev-parse HEAD` confined by `GIT_CEILING_DIRECTORIES` so it cannot walk into an enclosing repository. It reports path duplicates, tool status, Homebrew, CLT, `$SHELL`, install-root writability (via `access` only), terminal and browser app presence, and supporting CLI presence. Unverified manifest versions are reported as unknown, never pass or fail (src/platforms/macos.mjs:9-116). Terminal and browser results on every platform are advisories that do not block readiness (src/kit.mjs:72-91). Linux and WSL2 checks are described in [Linux and WSL2 installation](linux-install.md); Windows and other platforms stop in the platform router. The Windows stub describes the proposed native preflight and WSL handoff; that flow is **UNVERIFIED** until built and tested (src/platforms/index.mjs:3-15).

The manifest has verified macOS and Linux pins for the source archives and selected release assets, while unavailable adapters and Windows targets remain unverified. `evaluate` carries those gaps into the issue list and `run` exits nonzero (src/kit.mjs:74-91; src/kit.mjs:166). The [README](../../../../README.md) lists excluded personal material (README.md:69-71).
