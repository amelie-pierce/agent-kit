---
title: Owner stack parity
description: What pilot-9 ships from the owner's Firstmate stack, where each piece lives in the kit, how it is installed, upgraded and removed, and what is excluded
date: 2026-10-27
---

# Owner stack parity

Owner rules (2026-10-27): ship what we build, include everything the Herdr setup runs, and install it all automatically. The inventory is the kit-stack-gap scout report; this note maps each shipped piece to its code.

One entry point places the pieces: `placeKitExtras` (src/shortcuts.mjs). Setup step 4, repair and the new kit's `applyUpdate` (src/update.mjs) all call it, so an upgrade from pilot-8 gets everything, because pilot-8's lifecycle calls the new kit's update code. Its record is `receipt.setup.shortcuts`, and it follows question 5 (`globalHooks`).

| Piece | Code | Notes |
| --- | --- | --- |
| Launchers: env.sh, firstmate, open-firstmate, fm-mate, fm-jev, fm-help, zoe-fleet-open/demo/autostart, claude telemetry, full-access codex | src/shortcuts.mjs `ownedFiles` | Rendered from receipt paths and recorded by digest. A file no longer wanted is removed while unchanged. |
| Fleet autostart hook | src/shortcuts.mjs `planAutostart` | Marker-owned SessionStart entry in `<FM_HOME>/.claude/settings.local.json`. Firstmate's .gitignore lacks that file, so the kit adds it to the home's `.git/info/exclude`. |
| Herdr keys and layout blocks | src/shortcuts.mjs `planShortcuts`, `planLayout` | The layout block sits before the person's first table, since TOML would put later root keys into that table. |
| Herdr plugins: furkankly.zoetrope, pikenguyen227.zoetrope-fleet, ray.plugin-manager | src/herdr-plugin.mjs; src/install/macos.mjs `pluginSpecs` | Local entries in plugins.json, written only while Herdr is stopped. Session-graph keys come from its own keys.sh through a Herdr shim that never reloads a running Herdr. |
| Ambient axi gates | src/install/hooks.mjs `gatedTools` | `releases/<release>/hook-gates/ambient-*`, owned by release path like the Herdr scripts. |
| agent-kit mate / jev | src/mate.mjs, src/jev.mjs, src/secondmate.mjs `seedMate` | Only Firstmate's own scripts and the guarded .env writer. |
| Strategy step and check/research tiers | src/dispatch.mjs `withOwnerTiers` | Custom rules without a strategy key survive `fm-strategy.sh set`. A rerun is a dry-run verify (checked against Firstmate e823c61f). |
| figma-cli and its skills | src/install/macos.mjs `npmPhase`, `figmaSkills`; manifests/npm-figma | The only non-registry lock entry is the pinned codeload archive. |
| Claude plugins and the Codex Companion edit | src/claude-plugins.mjs; manifests/claude-plugins.json | Run with the person's own claude CLI. Pinned by marketplace commit; per-plugin licence and run-time fetch notes are in the data. |
| Tower telemetry dir | src/install/macos.mjs `towerPhase` | ZOE_TELEMETRY_DIR under the fleet state. |

Excluded by the owner: git-ai, claude-mem, tode, terminal-browser.

Sharp edges:
- **zoe on PATH.** The session graph finds zoe on PATH, and its #44 fallback looks only in Homebrew and Cargo locations. Herdr must therefore start from a terminal whose PATH holds `<root>/.tools/bin`.
- **Unpinned MCP package.** The playwright plugin's MCP server runs `@playwright/mcp@latest`.
- **Pin-only checks.** A popup key command receiving HERDR_ENV, and `herdr config check` honouring HERDR_CONFIG_PATH, are UNVERIFIED until hands-on use.
