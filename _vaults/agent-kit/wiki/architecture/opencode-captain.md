---
title: OpenCode captain
description: Pinned CLI, captain choice and plugin ownership boundaries
date: 2026-11-23
---

# OpenCode captain

Updated 2026-11-24: OpenCode is also a worker option.

The kit records a `captain` choice next to `harness`: the selected workers' default CLI (Claude when selected, then Codex, otherwise OpenCode) or OpenCode. Claude and Codex captains never cross over to a CLI the harness did not select. A harness can select OpenCode alone or with Claude and Codex. See `src/harness.mjs:2`, `src/setup.mjs:209`, and `src/kit.mjs:125`.

Firstmate's pinned `fm-strategy.sh` accepts Claude and Codex subscription providers only, so the kit narrows native strategy setup to those profiles. An OpenCode-only home mirrors its OpenCode primary harness by Firstmate default; mixed homes can dispatch OpenCode explicitly by harness or use a personal dispatch profile with no model. Typed dispatch requires a personal quota provider declaration for OpenCode, which the kit does not write. See `src/dispatch.mjs:28`, `src/dispatch.mjs:186`, and `docs/user-guide.md:233`.

OpenCode is an exact OpenCode 2 npm group with a committed lock in [`manifests/npm-opencode/`](../../../../manifests/npm-opencode/). The installer selects the same binary group for a captain or worker, copies the reviewed optional platform binary without running npm lifecycle scripts, probes its major version in a disposable HOME, and only then may register global hooks. The receipt and shell profile put this CLI under the versioned kit release. See `src/install/macos.mjs:266`, `src/install/macos.mjs:627`, and `src/shell-profile.mjs:1`.

`firstmate opencode` and `open-firstmate opencode` start the persistent TUI from the Firstmate home through the same Herdr and lock checks as the other captains. The launcher clears inherited Claude/Codex identity markers and passes OpenCode 2's `--standalone` flag, plus `--auto` to auto-approve tool requests unless a policy explicitly denies them only when the person answered yes to setup question 2e (`setup.answers.opencodeAuto`). The kit does not change user-owned OpenCode permission config. Firstmate's own `.opencode/plugins/` files remain project owned. See [`src/shortcuts.mjs`](../../../../src/shortcuts.mjs) and [`templates/shortcuts/open_firstmate.py`](../../../../templates/shortcuts/open_firstmate.py).

The kit writes one receipt-owned global OpenCode plugin for ambient helper hints and Herdr agent state when the captain or worker uses OpenCode. Existing foreign or edited files at its path are conflicts; uninstall removes only a matching recorded digest. It never writes OpenCode credentials, provider or model. OpenCode's passive V2 callbacks are a TUI integration and do not provide Claude's blocking Stop semantics. See `src/install/hooks.mjs:221`, `src/install/opencode-plugin.mjs:10`, and `docs/global-hooks.md:1`.
