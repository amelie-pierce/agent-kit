---
title: Tower release install
description: How the Zoe fleet tower installs from Zoetrope release archives, configures its runtime launcher, and reports acceptance
date: 2026-10-27
---

# Tower release install

The manifest pins `zoe-fleet` to commit `fc45c4d9ea1d…`. Its macOS artifacts are `release-archive` assets from the `fleet-v0.2.0-fc45c4d9ea1d` pre-release, and its Linux artifacts are `source-archive` entries. A separate `zoe-fleet-runtime` tool pins the architecture-independent runtime archive for macOS only (manifests/pilot-skeleton.json:338; manifests/pilot-skeleton.json:409). The artifact `kind` field is optional, and an absent kind means a source archive (manifests/schema-v1.json:64; src/kit.mjs:34).

On macOS a `release-archive` tower takes the ordinary binary path into `releases/<release>/bin/zoe-fleet`. Cargo runs only for a source-archive target, which on Linux is the fallback (src/install/macos.mjs:18; src/install/macos.mjs:383-405). The runtime archive goes through a strict in-process tar reader. Pax headers that override paths are refused, and only regular files and directories are accepted. Required launcher files are checked before the tree is staged and recorded with a tree digest (src/install/macos.mjs:116-152; src/install/macos.mjs:418-429).

After the tool phases, `zoe-fleet-tower` runs the runtime's own `bin/zoe-fleet-tower setup` with `XDG_CONFIG_HOME` pointed at kit staging. The kit accepts the config only if each key names this person's resolved Firstmate home, the kit binaries, or the fresh state directory. It then installs the config atomically under the person's XDG config and records its digest in the receipt. An unowned or edited config, or non-empty state, becomes a phase conflict (src/install/macos.mjs:278-333; src/install/macos.mjs:484-491). State and config paths mirror the launcher's own lookup, and `plan` previews them (src/install/macos.mjs:278-288; src/kit.mjs:158-188).

Parity reads `installed from verified release; hands-on acceptance pending (Zoetrope Phase B)` only when the release binary, runtime and launcher config are all installed or skipped. A selected tower keeps the install partial because Phase B is still pending (src/install/macos.mjs:507-514). Which Zoetrope items this release closes is recorded in [zoetrope-followups.md](../../../../docs/zoetrope-followups.md). Fixture coverage is in test/kit.test.mjs:698-891.

Updated 2026-10-27: re-pinned from `fleet-v0.2.0-e81530fac3d7` to `fleet-v0.2.0-fc45c4d9ea1d` under release label `macos-pilot-4` (manifests/pilot-skeleton.json:3). The new runtime archive keeps the same file list and a byte-identical launcher, scripts and Herdr plugin; only `NOTICE` and `docs/FLEET-PACKAGING.md` changed, so the install wiring above did not change. A release-label change moves the tower through `update`, which re-runs launcher `setup` against the new release paths when `receipt.pendingUpdate` is set (src/install/macos.mjs:304-312).
