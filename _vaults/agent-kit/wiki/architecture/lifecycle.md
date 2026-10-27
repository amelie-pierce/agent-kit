---
title: Kit lifecycle commands
description: Receipt-owned repair, reviewed-channel upgrade and scoped uninstall
date: 2026-10-27
---

# Kit lifecycle commands

`repair` and `reinstall` share a command, as do `upgrade` and `update`. `--root` resolves to the root's `.tools` receipt, and the installed kit copy can find that receipt itself (src/kit.mjs:73-78; bin/agent-kit.mjs:31-34). The CLI prints the plan before applying; `--yes` bypasses only the prompt (bin/agent-kit.mjs:57-88).

Repair compares receipt-owned paths with their recorded digests, reports Firstmate health without editing its home, then rebuilds kit phases through the existing installer. Changed kit files and the pinned kit checkout are moved to a private backup before replacement; the artifact staging area and npm cache are cleared so selected artifacts are re-fetched and verified. It restores the Treehouse wrapper and uses the hook merge path for kit-tagged registration (src/lifecycle.mjs:150-186; src/lifecycle.mjs:187-279; src/install/macos.mjs:389-404; src/install/hooks.mjs:210-263).

Upgrade resolves `releases` to the newest `main` commit touching the manifest, or `main` to its head, and verifies that the commit is on `main`. It imports the fetched commit's manifest and implementation, compares it with the saved receipt, and identifies answer keys absent from the saved answers (src/lifecycle.mjs:338-382; bin/agent-kit.mjs:70-77). A Firstmate pin change must be completed through `/updatefirstmate`. Upgrade refuses before writing while the Firstmate home has uncommitted tracked changes, is on neither the receipt nor the manifest pin, or has a non-approved origin or unreadable Git state, naming which case applies (src/doctor.mjs:46-58; src/lifecycle.mjs:95-100; src/update.mjs:35-36); activated kit files, receipt and global registrations are restored with their original file modes if apply fails, while user data and state migrations are outside rollback (src/lifecycle.mjs:383-441).

Uninstall removes only kit-owned hook entries and skill links and restores Codex hooks only when prior state proves the kit enabled them. It retains private backups and writes an uninstall record outside `.tools`. Removing the Firstmate home requires an exact typed path and clean local Git and nested project checks; live mates also block it (src/install/hooks.mjs:195-207; src/install/hooks.mjs:370-432; src/lifecycle.mjs:104-149; src/lifecycle.mjs:280-337).

All three commands check running Herdr, no-mistakes and tower processes before apply and refuse with the concrete stop step for each, which the kit never runs itself. The Windows entry builds a WSL2 handoff and leaves the Linux receipt and files to the installed kit inside WSL (src/lifecycle.mjs:78-86; src/lifecycle.mjs:101-103; src/install/windows.mjs:91-114). Local behavior tests and the CI dry-run smoke use disposable homes and stub the remote release resolution and artifact fetch (test/lifecycle.test.mjs:1; scripts/lifecycle-dry-run-smoke.mjs:1; .github/workflows/test.yml:23).
