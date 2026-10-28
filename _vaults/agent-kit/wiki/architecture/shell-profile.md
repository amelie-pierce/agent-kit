---
title: Shell profile PATH block writer
description: How the kit adds, refreshes, removes and rolls back its marked PATH block with compare-and-replace
date: 2026-10-28
---

# Shell profile PATH block writer

The kit owns one marked block between `# >>> agent-kit PATH >>>` and `# <<< agent-kit PATH <<<` in the zsh or bash profile its login shell selects; symlinked, hard-linked and damaged-marker profiles are skipped (src/shell-profile.mjs:9-14; src/shell-profile.mjs:61-77). The receipt keeps `setup.shellProfile` with the path, the block's sha256 and whether the kit created the file; ownership is that sha256 matching the block now in the file (src/shell-profile.mjs:68-76).

## Compare-and-replace

Every write goes through `replaceProfile`: the new text is written to a temp file beside the profile with the profile's mode, then the profile's sha256 (or `absent` / `other` for a non-plain file) is compared with the value the plan read, and only on a match is the temp file renamed over it (or the kit-created file removed). On a mismatch it raises `ProfileChanged` and writes nothing (src/shell-profile.mjs:16-20; src/shell-profile.mjs:79-101). A small window between that compare and the rename remains; no lock is taken.

`retryOnce` plans again from the fresh file once; a second change stops with the file untouched and a message naming it (src/shell-profile.mjs:103-110). The backup into `<root>/backups/shell-profile` still happens before each write attempt (src/shell-profile.mjs:79-87).

Callers and how a second change surfaces:

- Setup step 4 lets `ProfileChanged` fail the step, so setup stops and exits 1 (src/setup.mjs:578-585).
- Repair flags the reconcile lines and returns status `partial`, so the CLI exits 1 without rolling back the repair (src/lifecycle.mjs:164-176; src/lifecycle.mjs:346).
- `placeUpdateExtras` flags its lines `profileChanged`; update exits 1 and upgrade returns `partial`, again without a rollback (src/update.mjs:83-115; src/lifecycle.mjs:533).
- Uninstall finishes everything else, keeps the profile and returns `partial` (src/lifecycle.mjs:418-437).
- Upgrade rollback restores the captured profile bytes only when the current file differs from them by nothing but the block the new kit recorded; otherwise it leaves the file and appends the reason to the upgrade error (src/shell-profile.mjs:162-173; src/lifecycle.mjs:534-548).

Tests inject an edit between read and replace through the `beforeReplace` hook, passed as `beforeProfileReplace` on lifecycle, update and setup options (test/shell-profile.test.mjs; test/lifecycle.test.mjs; test/setup.test.mjs).
