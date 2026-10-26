---
title: macOS install
description: Verified staging, ownership receipts and partial tower boundary
date: 2026-10-26
---

# macOS install

The CLI dispatches `install` to an asynchronous macOS installer while `install --dry-run` routes to the read-only plan (bin/agent-kit.mjs:10-35; src/kit.mjs:39-60). The installer requires macOS arm64 or x64, a compatible Node runtime, an absolute kit root, and a new Firstmate home beneath it (src/install/macos.mjs:202-215).

The installer downloads pinned artifacts into release staging, checks SHA-256 before extraction, and uses kit-owned destinations. It writes a pending receipt before activation and then marks each phase complete; later runs verify the owned file or tree digest before skipping (src/install/macos.mjs:136-154; src/install/macos.mjs:218-280). npm tools use committed integrity locks and `npm ci --ignore-scripts` with an empty kit npm configuration (src/install/macos.mjs:155-200). The narrow lock is scoped to this kit root (src/install/macos.mjs:60-79).

Firstmate source is fetched at the pinned commit into a fresh home; runtime directories begin empty. The source-owned hooks and relative skills remain in that checkout (src/install/macos.mjs:124-135; src/install/macos.mjs:264-280; README.md:27). Global Claude/Codex settings are not modified until their kit registration has a reviewed integration command, so existing unknown hooks are preserved (README.md:27; test/kit.test.mjs:290-299).

Zoetrope has a source build adapter using `cargo build --locked --release --bin zoe`. Build failure yields a partial result. A built binary still leaves fleet-manifest and launcher parity **UNVERIFIED**, and the installer reports partial status (src/install/macos.mjs:281-325). The [Zoetrope follow-ups](../../../../docs/zoetrope-followups.md) name the needed packaging and acceptance work (docs/zoetrope-followups.md:1-10).
