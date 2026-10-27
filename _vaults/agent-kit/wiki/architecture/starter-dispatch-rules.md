---
title: Starter dispatch rules and Jev readiness
description: Kit-written config/crew-dispatch.json from Firstmate's balanced template, plan fitting, ownership digest and the doctor jev row
date: 2026-10-27
---

# Starter dispatch rules and Jev readiness

Firstmate's typed resolver needs a `TYPESAFE_API_KEY` line and at least one rule in `config/crew-dispatch.json`; with no rules it never asks Jev (pinned Firstmate `bin/fm-dispatch-resolve.sh`). So once the key is set, setup and `agent-kit keys` also write starter rules (src/setup.mjs, bin/agent-kit.mjs).

The rules come from the pinned home's `bin/strategies/balanced.json`, narrowed to the chosen agent CLIs the same way `fm-strategy.sh render_dispatch` narrows them for a home with no rules file. A local check found the output byte-identical for every template and every set of agent CLIs at Firstmate 976c3ba. The kit does not call `fm-strategy.sh`: `show` prints a summary, not the file, and `set` would also write `config/strategy`, `secondmate-harness` and `fresh-start.json`, which are autonomy changes (src/dispatch.mjs `renderStarter`).

`manifests/plan-models.json` is the plan-to-model table. Only `ready` rows are offered or applied. A ready row lists `models`, the template-model `substitute` map, a `source` URL and an optional `validation` model. A profile outside the plan is substituted or dropped, and an empty default is omitted because Firstmate rejects an empty array. Plan ids are saved in `setup.answers.plans` (src/dispatch.mjs `loadPlanTable`, `fitPlan`; src/setup.mjs `collectAnswers`).

Ownership: the kit writes only when neither the rules file nor `config/strategy` exists, by hard-linking a temp file so a file that appears concurrently is never replaced. It records `setup.dispatch` with the template, agent CLIs, plans and a digest. Repair restores a missing kit file while the key is set. Upgrade and setup refresh the file only while its digest matches, and uninstall removes it only while unchanged. A changed file or a selected strategy releases ownership (src/dispatch.mjs `planStarter`, `applyStarter`, `starterRemovable`; src/lifecycle.mjs `reconcileStarter`).

Doctor's `jev` row checks the key line (set / not set only), well-formed rules, a usable never-send list, the resolver script, and `jq curl quota-axi awk grep sed tr` on PATH. It warns rather than fails (src/dispatch.mjs `jevReadiness`; src/doctor.mjs). A clear resolver answer also needs quota-axi to measure the signed-in provider. Unmeasured quota escalates, which is the person's own sign-in and outside the kit. `scripts/jev-resolve-smoke.mjs` proves keys-then-resolve against the pinned Firstmate with stubbed curl and quota-axi.
