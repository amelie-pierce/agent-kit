---
title: Agent Kit knowledge
description: Routing for the Agent Kit repository's compiled project notes
date: 2026-10-26
---

# Agent Kit

Agent Kit is a Node CLI for per-person Firstmate and tool setup. It has read-only `check` and `plan` commands and a macOS pilot `install` command; the [README](../../../README.md) states the current partial-install boundary (README.md:1-15; README.md:17-39).

## Operating mode and authority

Read this index before scanning the repository. Compile focused notes only when task work establishes new facts. Live code wins, then the manifest and schema, then this wiki. Start at `bin/agent-kit.mjs` for CLI dispatch, `src/kit.mjs` for validation and read-only result assembly, `src/install/macos.mjs` for installation, `src/platforms/` for platform checks, and `manifests/` for pins and npm locks (bin/agent-kit.mjs:1-40; src/kit.mjs:11-37; src/install/macos.mjs:202-327; src/platforms/index.mjs:1-15).

| Area | Index |
| --- | --- |
| Architecture and safety | [architecture](architecture/index.md) |

## Note conventions

Each note has title, description and date frontmatter and appears in its folder index. Cite repository paths and lines for claims. Mark facts without source proof `UNVERIFIED`; keep scratch outside the tracked wiki. Link to code for values that may change.
