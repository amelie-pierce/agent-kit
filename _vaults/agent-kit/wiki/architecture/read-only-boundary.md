---
title: Read-only boundary
description: How the skeleton evaluates a proposed tool manifest without installing
date: 2026-10-26
---

# Read-only boundary

The entry point loads the bundled JSON manifest, calls `run`, and writes a result to stdout; it handles invalid input on stderr (bin/agent-kit.mjs:1-19). `run` validates the manifest, chooses the requested harness, evaluates gaps, and builds check or plan output, listing unselected optional components in the plan (src/kit.mjs:64-81; src/kit.mjs:104-129). It has no install action (src/kit.mjs:39-51).

The macOS adapter searches PATH and uses bounded version commands, `xcode-select -p`, and `git rev-parse HEAD` confined by `GIT_CEILING_DIRECTORIES` so it cannot walk into an enclosing repository. It reports path duplicates, tool status, Homebrew, CLT, `$SHELL`, install-root writability (via `access` only), terminal and browser app presence, and supporting CLI presence. Unverified manifest versions are reported as unknown, never pass or fail (src/platforms/macos.mjs:9-115). Linux, WSL2 and Windows stop in the platform router. The Windows stub describes the proposed native preflight and WSL handoff; that flow is **UNVERIFIED** until built and tested (src/platforms/index.mjs:3-15).

The example manifest deliberately marks source commits and artifacts unverified. `evaluate` carries unverified pins and artifacts into the issue list, which makes the process exit nonzero (manifests/pilot-skeleton.json:245-262; manifests/pilot-skeleton.json:402-419; src/kit.mjs:74-78; src/kit.mjs:126-128). The [README](../../../../README.md) lists excluded personal material (README.md:23-27).
