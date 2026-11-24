---
title: OpenCode captain
description: Pinned CLI, captain choice and plugin ownership boundaries
date: 2026-11-23
---

# OpenCode captain

The kit records a `captain` choice independently of `harness`. The latter still selects only Claude and Codex worker routing providers; OpenCode cannot be selected as a worker. The default captain follows the earlier Claude/Codex behavior when no explicit answer exists. See [`src/harness.mjs`](../../../../src/harness.mjs), [`src/setup.mjs`](../../../../src/setup.mjs) and [`src/kit.mjs`](../../../../src/kit.mjs).

OpenCode is an exact OpenCode 2 npm group with a committed lock in [`manifests/npm-opencode/`](../../../../manifests/npm-opencode/). The installer copies the reviewed optional platform binary without running npm lifecycle scripts, probes its major version in a disposable HOME, and only then may register global hooks. The receipt and shell profile put this CLI under the versioned kit release. See [`src/install/macos.mjs`](../../../../src/install/macos.mjs) and [`src/shell-profile.mjs`](../../../../src/shell-profile.mjs).

`firstmate opencode` and `open-firstmate opencode` start the persistent TUI from the Firstmate home through the same Herdr and lock checks as the other captains. The launcher clears inherited Claude/Codex identity markers and passes OpenCode 2's `--standalone --auto` flags to auto-approve tool requests unless a policy explicitly denies them. The kit does not change user-owned OpenCode permission config. Firstmate's own `.opencode/plugins/` files remain project owned. See [`src/shortcuts.mjs`](../../../../src/shortcuts.mjs) and [`templates/shortcuts/open_firstmate.py`](../../../../templates/shortcuts/open_firstmate.py).

The kit writes one receipt-owned global OpenCode plugin for ambient helper hints and Herdr agent state. Existing foreign or edited files at its path are conflicts; uninstall removes only a matching recorded digest. It never writes OpenCode credentials, provider or model. OpenCode's passive V2 callbacks are a TUI integration and do not provide Claude's blocking Stop semantics. See [`src/install/hooks.mjs`](../../../../src/install/hooks.mjs), [`src/install/opencode-plugin.mjs`](../../../../src/install/opencode-plugin.mjs), and [`docs/global-hooks.md`](../../../../docs/global-hooks.md).
