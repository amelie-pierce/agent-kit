---
title: Global hook and skill registration
description: macOS ownership merge and remaining vendor registration boundary
date: 2026-10-26
---

# Global registration

`plan` and `install --dry-run` derive kit-owned global changes from the same preview function that `install` applies. The preview shows per-file JSON/TOML operations and skill link targets while withholding unrelated global settings (src/kit.mjs:128-150; src/install/macos.mjs:359-365; src/install/hooks.mjs:308-312).

The kit targets Claude's `settings.json` and `skills/`, Codex's `hooks.json` and `config.toml`, and Codex's user skill location `.agents/skills/`. Four pinned AXI packages and Herdr contribute SessionStart hooks; five AXI packages contribute skills. Ownership is the `# agent-kit:<tool>` command suffix plus the expected kit path, or a skill symlink into the kit release. Unknown hooks/settings and unrelated skill paths are retained; a conflicting unowned skill causes refusal (src/install/hooks.mjs:9-30; src/install/hooks.mjs:75-116; src/install/hooks.mjs:163-218). The pinned upstream source evidence is listed in [global-hooks.md](../../../../docs/global-hooks.md:3-17).

The phase parses existing JSON/TOML before writing, checks that pinned package targets exist, privately backs up every edited existing file, atomically replaces configuration files and skill links, and records changed paths in the receipt. A matching rerun returns skipped without another write (src/install/hooks.mjs:37-66; src/install/hooks.mjs:118-160; src/install/hooks.mjs:240-306). New or changed Codex hooks remain subject to the person's interactive `/hooks` review; no trust or permission setting is written (src/install/macos.mjs:377-379; docs/global-hooks.md:15-19).

Herdr's verified binary generates its agent-state scripts in a disposable HOME, and the kit checks their reviewed hashes before linking them from owned paths. The no-mistakes user skill comes from `no-mistakes init` in the teammate's repository. Firstmate's own project hooks remain in the pinned checkout (src/install/hooks.mjs:17-29; src/install/hooks.mjs:221-237; src/install/macos.mjs:377-379; README.md:27-31).
