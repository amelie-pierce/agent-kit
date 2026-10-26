---
title: Agent Kit knowledge
description: Routing for the Agent Kit repository's compiled project notes
date: 2026-10-26
---

# Agent Kit

Agent Kit is a Node CLI for a proposed per-person Firstmate and tool setup. The current implementation is a read-only check and plan skeleton; the [README](../../../README.md) states its release boundary (README.md:1-21).

## Operating mode and authority

Read this index before scanning the repository. Compile focused notes only when task work establishes new facts. Live code wins, then the manifest and schema, then this wiki. Start at `bin/agent-kit.mjs` for CLI loading, `src/kit.mjs` for validation and result assembly, `src/platforms/` for platform checks, and `manifests/` for proposed pins (bin/agent-kit.mjs:1-19; src/kit.mjs:11-37; src/platforms/index.mjs:1-15; manifests/schema-v1.json:1-21).

| Area | Index |
| --- | --- |
| Architecture and safety | [architecture](architecture/index.md) |

## Note conventions

Each note has title, description and date frontmatter and appears in its folder index. Cite repository paths and lines for claims. Mark facts without source proof `UNVERIFIED`; keep scratch outside the tracked wiki. Link to code for values that may change.
