---
title: Launcher refresh on upgrade
description: How upgrade rewrites an unchanged kit launcher and keeps one the person edited
date: 2026-11-13
---

# Launcher refresh on upgrade

Upgrade and repair both call `placeKitExtras`, which plans every kit launcher with `planShortcuts` (src/shortcuts.mjs:399-405; src/update.mjs:91; src/lifecycle.mjs:164). Each launcher is compared with the digest the receipt recorded for it: a file equal to the new body is `verify`, a file equal to the recorded digest is `refresh` (rewritten), a file with no record is `conflict`, and a file that differs from the record is `keep` on upgrade and `replace` (after a backup) only on repair (src/shortcuts.mjs:256-261).

So a change to a launcher template, such as dropping a variable from the `firstmate` launcher's `unset` line (src/shortcuts.mjs:106), reaches every install that still holds the kit's own bytes on its next upgrade, with no extra code. The test is `upgrade drops the old Grok variable...` in test/shortcuts.test.mjs. `test/no-grok.test.mjs` keeps the shipped sources free of that name.
