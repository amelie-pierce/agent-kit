---
title: Read-only boundary
description: How the skeleton evaluates a proposed tool manifest without installing
date: 2026-10-26
---

# Read-only boundary

The entry point loads the bundled JSON manifest, calls `run`, and writes a result to stdout; it handles invalid input on stderr (bin/agent-kit.mjs:1-19). `run` validates the manifest, chooses the requested harness, evaluates gaps, and builds check or plan output (src/kit.mjs:98-117). It has no install action (src/kit.mjs:38-49).

The macOS adapter searches PATH and uses bounded version commands plus `xcode-select -p`; it reports path duplicates, tool status, Homebrew, CLT and supporting CLI presence (src/platforms/macos.mjs:9-22; src/platforms/macos.mjs:51-71). Linux, WSL2 and Windows stop in the platform router. The Windows stub describes the proposed native preflight and WSL handoff; that flow is **UNVERIFIED** until built and tested (src/platforms/index.mjs:3-15).

The example manifest deliberately marks source commits and artifacts unverified. `evaluate` carries unverified pins and artifacts into the issue list, which makes the process exit nonzero (manifests/pilot-skeleton.json:245-262; manifests/pilot-skeleton.json:402-419; src/kit.mjs:72-78; src/kit.mjs:113-117). The [README](../../../../README.md) lists excluded personal material (README.md:23-27).
