---
title: Doctor and reviewed updates
description: Installed-state verification and explicit manifest-driven release transition
date: 2026-10-27
---

# Doctor and reviewed updates

`doctor` routes through the CLI to a read-only receipt check. It verifies the recorded owned file or tree digest, Firstmate HEAD, origin and tracked files, private receipt and launcher modes, kit hook ownership, path precedence, Node and platform prerequisites. It reports authentication and live testing as unknown (bin/agent-kit.mjs:22; src/doctor.mjs:61; src/doctor.mjs:96; src/doctor.mjs:134; src/doctor.mjs:141).

`update` only accepts the manifest bundled in a clean kit checkout reachable from `origin/main`. Its plan compares the receipt version and digest with the target manifest and npm locks; `--yes` runs the shared installer with update mode. The installer records a pending target, stages under the new release, leaves the earlier release files in place, defers running binaries and holds hook activation while dependencies are deferred or conflicted (src/update.mjs:11; src/update.mjs:18; src/install/macos.mjs:365; src/install/macos.mjs:398; src/install/macos.mjs:518). A changed Firstmate pin is completed only after its own guarded `/updatefirstmate` path has produced the exact reviewed commit (src/install/macos.mjs:379).

The starter charter is plain text; the CLI only prints it and Firstmate's local scaffold, seed and launch commands. No kit code performs those commands (templates/secondmate/charter.md:1; src/secondmate.mjs:3; bin/agent-kit.mjs:37).
