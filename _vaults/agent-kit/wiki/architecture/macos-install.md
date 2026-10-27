---
title: macOS install
description: Verified staging, ownership receipts and tower install boundary
date: 2026-10-26
---

# macOS install

The CLI dispatches `install` to an asynchronous macOS installer while `install --dry-run` routes to the read-only plan (bin/agent-kit.mjs:18-24; src/kit.mjs:39-58). The installer requires macOS arm64 or x64, a compatible Node runtime, an absolute kit root, and a new or empty teammate-selected Firstmate home outside that root; it refuses HOME itself, system locations, paths inside an existing Firstmate home or git checkout, and non-empty directories (src/install/macos.mjs:130-141; src/install/macos.mjs:231-251).

The installer downloads pinned artifacts into release staging, checks SHA-256 before extraction, and uses kit-owned destinations. It writes a pending receipt before activation and then marks each phase complete; later runs verify the owned file or tree digest before skipping; the Firstmate home recorded in the receipt is verified by pinned HEAD and git-tracked files only, and a tracked-file change is a conflict for that phase while other phases continue (src/install/macos.mjs:142-178; src/install/macos.mjs:247-320). npm tools use committed integrity locks and `npm ci --ignore-scripts` with an empty kit npm configuration (src/install/macos.mjs:182-230). The narrow lock is scoped to this kit root (src/install/macos.mjs:59-78).

Firstmate source is fetched at the pinned commit into a fresh home; runtime directories begin empty. The source-owned hooks and relative skills remain in that checkout (src/install/macos.mjs:110-128; src/install/macos.mjs:302-320; README.md:27). After the pinned npm phase, the installer previews and applies owned global AXI hooks and skills; see [Global registration](global-registration.md) (src/install/macos.mjs:359-370; src/install/hooks.mjs:195-249).

Updated 2026-10-27: on macOS the tower installs from verified Zoetrope release archives and its runtime launcher is configured; see [Tower release install](tower-release.md). The `cargo build --locked --release --bin zoe` adapter remains only for source-archive targets (Linux), where a built binary still leaves fleet-manifest and launcher parity **UNVERIFIED** (src/install/macos.mjs:431-462; src/install/macos.mjs:491-497).
