---
title: figma-cli pin locations
description: Every place the kit pins a figma-cli commit, and why the npm lock and the plugin marketplace pin move together
date: 2026-11-10
---

# figma-cli pin locations

The kit installs figma-cli at one commit of `amelie-pierce/figma-cli`, and that commit is written in several files that must change together in the same PR. Doctor and the figma-cli skill links read whatever the installed package ships, so the skills follow the pin (src/doctor.mjs `figmaSkillsLinked`; src/install/macos.mjs `figmaSkills`).

| Place | What it holds |
| --- | --- |
| manifests/npm-figma/package.json:6 | the dependency URL, a codeload archive of the commit |
| manifests/npm-figma/package-lock.json:11, 16-17 | the same URL as `resolved`, plus the archive `integrity` (sha512 of the downloaded archive); recompute it for every new commit |
| manifests/claude-plugins.json:32 | the `amelie-pierce` marketplace `commit`, the Claude plugin that ships the same skills |
| manifests/pilot-skeleton.json:1221, 1223 | the `figma-cli` `version.value` and the reason text, which also names the archive SHA-256 |
| README.md:215 | the marketplace pin table row |
| test/kit.test.mjs:378, 1252; test/extras.test.mjs:424 | tests that assert the pin, the lock URL and the marketplace commit |

The npm lock and the Claude plugin marketplace pin move together: the CLI installed from `manifests/npm-figma` and the plugin from `manifests/claude-plugins.json` are two copies of the same repository, and a teammate with Claude would otherwise get skills from one commit and a CLI from another. A pin move is a new release label (`manifests/pilot-skeleton.json:3`) with an upgrade-fixture test in test/lifecycle.test.mjs.

The package version in figma-cli's `package.json` does not change with every commit, so the commit, not the version label, is the pin.

How a Make deploy behaves (entry files last, two-batch first deploy, content-hash confirmation of uncertain writes) is figma-cli's own contract; read it in figma-cli's wiki at `_vaults/figma-cli/wiki/make/deploy.md` (in amelie-pierce/figma-cli) rather than copying it here. The kit's deploy prose lives in the user guide's AtomicAUI prototype upgrade section (docs/user-guide.md, A7.8 and B7.8) and its one-row summary in docs/features.md; both must follow that contract and the pinned skills at the pinned commit.
