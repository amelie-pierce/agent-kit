---
title: Doctor and reviewed updates
description: Installed-state verification and explicit manifest-driven release transition
date: 2026-10-27
---

# Doctor and reviewed updates

Updated 2026-10-27: doctor and update take `--root <root>` (meaning `<root>/.tools`), and a kit copy at `<install-root>/kit/<commit>` finds its own receipt (src/kit.mjs:72-77; bin/agent-kit.mjs:26). Both prefer the guided setup's recorded answers for harness, Figma, tower, hooks and tower state over inference from receipt phases (src/doctor.mjs:67-76; src/update.mjs:26-27). See [Single installer](single-installer.md).

Updated 2026-10-27: `doctor` checks person-installed prerequisite version floors from the manifest. It infers Codex selection from the receipt's npm-codex phase so Claude is not required for that harness; optional Figma warns without failing. Missing and old required tools carry vendor install links (src/doctor.mjs:61-87; src/platforms/macos.mjs:78-96). The existing receipt check verifies owned file or tree digests, Firstmate HEAD, origin and tracked files, private receipt and launcher modes, kit hook ownership and path precedence. Authentication and live testing remain unknown (src/doctor.mjs:96-153).

`update` only accepts the manifest bundled in a clean kit checkout reachable from `origin/main`. Its plan compares the receipt version and digest with the target manifest and npm locks; `--yes` runs the shared installer with update mode. The installer records a pending target, stages under the new release, leaves the earlier release files in place, defers running binaries and holds hook activation while dependencies are deferred or conflicted (src/update.mjs:11; src/update.mjs:18; src/install/macos.mjs:365; src/install/macos.mjs:398; src/install/macos.mjs:518). A changed Firstmate pin is completed only after its own guarded `/updatefirstmate` path has produced the exact reviewed commit (src/install/macos.mjs:379).

The starter charter is plain text; the CLI only prints it and Firstmate's local scaffold, seed and launch commands. No kit code performs those commands (templates/secondmate/charter.md:1; src/secondmate.mjs:3; bin/agent-kit.mjs:37).
