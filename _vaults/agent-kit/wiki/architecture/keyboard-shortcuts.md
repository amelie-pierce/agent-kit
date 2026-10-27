---
title: Keyboard shortcuts and open-firstmate
description: The kit-owned open-firstmate launcher, the agent-kit Herdr keys block, Herdr 0.9.3 facts behind them, and their receipt lifecycle
date: 2026-10-27
---

# Keyboard shortcuts and open-firstmate

Setup step 4 writes `<root>/.tools/bin/open-firstmate` and one `# >>> agent-kit keys` ... `# <<< agent-kit keys` block in the person's Herdr config. Both follow the global registrations answer (question 5) (src/setup.mjs `placeShortcuts`; src/shortcuts.mjs).

- The launcher is a generated `sh` wrapper. It exports the `OPEN_FIRSTMATE_*` paths from the receipt and runs `templates/shortcuts/open_firstmate.py` from the installed kit copy (`receipt.setup.kit.path`), never from the temporary checkout setup runs from (src/shortcuts.mjs `shortcutInputs`, `launcherScript`).
- The receipt supplies each path: Herdr from `phases.herdr.path`, Codex from `phases['npm-codex'].path` plus `node_modules/.bin/codex`, and the tower from `phases['zoe-fleet-runtime'].path` plus `bin/zoe-fleet-tower`, which needs `phases['zoe-fleet-tower']`. Claude and python3 are found on PATH and recorded in `setup.shortcuts`.
- The key table is `kitKeys` (Updated 2026-10-27): `prefix+f` claude, `prefix+shift+f` codex, `prefix+shift+m` mates (fm-mate in the Mates tab), `prefix+shift+c` the session graph tab and `prefix+m` the plugin manager. The last two are plugin actions, bound only once the kit registered that plugin. The owner chose `prefix+shift+m` after ruling out `prefix+n` (Herdr's `next_tab`) and `prefix+shift+n` (`new_workspace`). `herdrDefaults` lists the Herdr 0.9.3 defaults from `herdr --default-config`. `previewKeys` and `planShortcuts` name any default a kit key would replace, and skip any key the person bound outside the block.
- Herdr 0.9.3 facts used here: the CLI forms are `workspace list|create|focus`, `tab list|create|focus|rename`, `pane list|process-info|run`. Leaf `--help` falls back to the top-level text, so these forms come from the binary's usage strings. Custom keys are `[[keys.command]]` with `type = "shell"|"pane"|"popup"`. The config path is `HERDR_CONFIG_PATH`, then `XDG_CONFIG_HOME`, then `~/.config/herdr/config.toml`.
- Not yet confirmed by hands-on use (UNVERIFIED): that a popup key command gets `HERDR_ENV=1`, and that `herdr config check` honours `HERDR_CONFIG_PATH`.
- The pinned tower launcher has no keys command (`setup|doctor|open|inspect|demo`). `setup-keys` belongs to the session-graph plugin, which the kit now installs and whose own setup-keys it runs ([owner stack parity](owner-stack-parity.md)).

Lifecycle: `setup.shortcuts` records the python and agent paths, `launcherSha256` and `keys` (path, `blockSha256`, bound, skipped, created) (src/shortcuts.mjs `applyShortcuts`).
- Setup reruns and upgrade refresh an unchanged block. An edited block releases ownership. A removed block keeps the record so repair can restore it.
- Repair also backs up and replaces a changed launcher.
- Uninstall removes only the unchanged launcher and block (src/lifecycle.mjs `reconcileShortcuts`, `planUninstall`; src/shortcuts.mjs `planRemoveShortcuts`, `removeShortcuts`).
- Every config write is backed up to `<root>/.tools/backups/shortcuts/` and validated with `herdr config check`, and the backup is restored on rejection.

Updated 2026-10-27: a pilot-8 install gets them on upgrade, because pilot-8's lifecycle runs the new kit's `applyUpdate`, which calls `placeKitExtras`.

Tests: test/shortcuts.test.mjs (temp HOME, fixture config, stub herdr answering in Herdr's JSON shape).
