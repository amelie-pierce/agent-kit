---
title: Global hook and skill registration
description: macOS ownership merge and remaining vendor registration boundary
date: 2026-10-26
---

# Global registration

`plan` and `install --dry-run` derive kit-owned global changes from the same preview function that `install` applies. The preview shows per-file JSON/TOML operations and skill link targets while withholding unrelated global settings (src/kit.mjs:134-141; src/install/macos.mjs:359-370; src/install/hooks.mjs:338-342).

The kit targets Claude's `settings.json` and `skills/`, Codex's `hooks.json` and `config.toml`, and Codex's user skill location `.agents/skills/`. Four pinned AXI packages and Herdr contribute SessionStart hooks; five AXI packages contribute skills. Ownership is the `# agent-kit:<tool>` command suffix plus a command path under any release of this kit root, or a skill symlink into the kit release. Unknown hooks/settings and unrelated skill paths are retained; a conflicting unowned skill causes refusal (src/install/hooks.mjs:9-35; src/install/hooks.mjs:63-123; src/install/hooks.mjs:195-249). The pinned upstream source evidence is listed in [global-hooks.md](../../../../docs/global-hooks.md:3-17).

The phase parses existing JSON/TOML before writing, checks that pinned package targets exist, privately backs up every edited existing file, atomically replaces configuration files and skill links, and records changed paths in the receipt. In `config.toml` only table headers and `[features] hooks` are interpreted; other lines pass through unchanged. A refused preview becomes a `hooks` conflict while the rest of `plan` or `install` still reports. A matching rerun returns skipped without another write (src/install/hooks.mjs:37-61; src/install/hooks.mjs:125-193; src/install/hooks.mjs:270-337; src/kit.mjs:138-140; src/install/macos.mjs:361-370). New or changed Codex hooks remain subject to the person's interactive `/hooks` review; no trust or permission setting is written (src/install/macos.mjs:381-383; docs/global-hooks.md:13-19).

Herdr's verified binary generates its agent-state scripts in a disposable HOME, and the kit checks their reviewed hashes before linking them from owned paths. The no-mistakes user skill comes from `no-mistakes init` in the teammate's repository. Firstmate's own project hooks remain in the pinned checkout (src/install/hooks.mjs:17-29; src/install/hooks.mjs:251-269; src/install/macos.mjs:381-383; README.md:29-31).
