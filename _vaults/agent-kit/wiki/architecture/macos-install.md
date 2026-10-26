---
title: macOS install
description: Verified staging, ownership receipts and partial tower boundary
date: 2026-10-26
---

# macOS install

The CLI dispatches `install` to an asynchronous macOS installer while `install --dry-run` routes to the read-only plan (bin/agent-kit.mjs:10-35; src/kit.mjs:39-60). The installer requires macOS arm64 or x64, a compatible Node runtime, an absolute kit root, and a new or empty teammate-selected Firstmate home outside that root; it refuses HOME itself, system locations, paths inside an existing Firstmate home or git checkout, and non-empty directories (src/install/macos.mjs).

The installer downloads pinned artifacts into release staging, checks SHA-256 before extraction, and uses kit-owned destinations. It writes a pending receipt before activation and then marks each phase complete; later runs verify the owned file or tree digest before skipping; the Firstmate home recorded in the receipt is verified by pinned HEAD and git-tracked files only, and a tracked-file change is a conflict for that phase while other phases continue (src/install/macos.mjs:136-154; src/install/macos.mjs:218-280). npm tools use committed integrity locks and `npm ci --ignore-scripts` with an empty kit npm configuration (src/install/macos.mjs:155-200). The narrow lock is scoped to this kit root (src/install/macos.mjs:60-79).

Firstmate source is fetched at the pinned commit into a fresh home; runtime directories begin empty. The source-owned hooks and relative skills remain in that checkout (src/install/macos.mjs:124-135; src/install/macos.mjs:264-280; README.md:27). Global Claude/Codex hook and skill registration by ownership marker is deferred to the next PR as its first item; this install writes no global Claude/Codex settings (README.md; test/kit.test.mjs).

Zoetrope has a source build adapter using `cargo build --locked --release --bin zoe`. Build failure yields a partial result. A built binary still leaves fleet-manifest and launcher parity **UNVERIFIED**, and the installer reports partial status (src/install/macos.mjs:281-325). The [Zoetrope follow-ups](../../../../docs/zoetrope-followups.md) name the needed packaging and acceptance work (docs/zoetrope-followups.md:1-10).
