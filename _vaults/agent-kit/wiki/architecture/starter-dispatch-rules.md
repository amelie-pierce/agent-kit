---
title: Starter dispatch rules and Jev readiness
description: Kit-written config/crew-dispatch.json from Firstmate's mode templates and owner-approved plan profiles, the native fm-strategy --plans selection and its bridge fallback, ownership digests and the doctor jev row
date: 2026-10-27
---

# Starter dispatch rules and Jev readiness

Firstmate's typed resolver needs a `TYPESAFE_API_KEY` line and at least one rule in `config/crew-dispatch.json`; with no rules it never asks Jev (pinned Firstmate `bin/fm-dispatch-resolve.sh`). So once the key is set, setup and `agent-kit keys` also write starter rules (src/setup.mjs, bin/agent-kit.mjs).

The rules follow the chosen mode's template in the pinned home (`bin/strategies/<mode>.json`), narrowed to the chosen agent CLIs the same way `fm-strategy.sh render_dispatch` narrows them for a home with no rules file. With every plan skipped, a local check found the output byte-identical to that renderer for every template and every set of agent CLIs at Firstmate 976c3ba (src/dispatch.mjs `renderStarter`).

`manifests/plan-models.json` (schema 2) holds the owner-approved plan profiles from the plan research. Plan ids match Firstmate's planned `fm-strategy.sh --plans` names. Each plan row names a profile, a default mode and whether to warn before full. Each profile gives the coordinator, light, standard, hard, requested and validation route, the second mates, and Claude floors for every mode.
- A harness with a plan takes that route in each rule slot. Exact-model rules run at high, and the default is the standard route without a floor.
- The Enterprise/Edu substitute swaps GPT-6.1 Sol for GPT-6 Sol.
- Setup saves `setup.answers.plans` and `setup.answers.dispatchMode`.
- Coordinator, validation and second mates are printed for the person to apply by hand.

Sources: src/dispatch.mjs `loadPlanTable`, `planRoles`, `starterAdvice`; src/setup.mjs `collectAnswers`.

When the home's `fm-strategy.sh --help` documents `--plans`, the kit runs `set <mode> --providers <set> [--plans ...] --yes` without the key in its environment, and Firstmate renders the routing files. Updated 2026-10-27: the pin is now e823c61f, which takes `--plans`, so setup and upgrade select the strategy at every install, key or not. The kit then appends the owner's `check` and `research` tiers as custom rules (src/dispatch.mjs `withOwnerTiers`). For an older home without `--plans`, the kit keeps a bridge that writes only the rules file, once the key is set (src/dispatch.mjs `strategyTakesPlans`, `planStarter`, `selectStrategy`). The `--plans` interface and plan names were checked against Firstmate branch `fm/fm-strategy-plans` (ffd39119), and `scripts/jev-resolve-smoke.mjs` passes against both that branch (`AGENT_KIT_FIRSTMATE_SRC`) and the pin. The rules use models newer than older CLIs know: Codex CLI is pinned to 0.164.0 for GPT-6.1 Terra, and the Claude Code minimum is 2.1.293 for Haiku 5.5 (manifests/pilot-skeleton.json).

Ownership: the kit writes or selects only when neither the rules file nor `config/strategy` exists, by hard-linking a temp file so a file that appears concurrently is never replaced. It records `setup.dispatch` with the template, agent CLIs, plans and a digest; a native selection adds `via: 'fm-strategy'` and `strategySha256`. The record moves as follows (src/dispatch.mjs `planStarter`, `applyStarter`, `selectStrategy`, `starterRemovable`; src/lifecycle.mjs `reconcileStarter`, `planUninstall`).
- Repair restores a missing kit file while the key is set. A selection is restored only when both files are gone.
- Upgrade and setup refresh the file only while its digest matches. A selection is refreshed only while both digests match, after an `fm-strategy.sh set --dry-run` that does not print `no change:`.
- An unchanged bridge file in a home that gains `--plans` is moved aside, Firstmate renders from its template alone, and the aside copy is put back if no strategy got selected (`migrate`). An edited bridge file is kept and the result names the switching command.
- Uninstall removes only unchanged bridge files and keeps a native selection, since its four config files are Firstmate's.
- A changed file or a strategy the kit did not select releases ownership.

Doctor's `jev` row checks the key line (set / not set only), well-formed rules, a usable never-send list, the resolver script, and `jq curl quota-axi awk grep sed tr` on PATH. It warns rather than fails (src/dispatch.mjs `jevReadiness`; src/doctor.mjs). A clear resolver answer also needs quota-axi to measure the signed-in provider. Unmeasured quota escalates, which is the person's own sign-in and outside the kit. `scripts/jev-resolve-smoke.mjs` proves keys-then-resolve against the pinned Firstmate with stubbed curl and quota-axi.
