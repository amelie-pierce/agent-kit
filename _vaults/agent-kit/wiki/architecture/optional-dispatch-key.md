---
title: Optional dispatch key
description: Firstmate TYPESAFE_API_KEY setup, later updates and preservation
date: 2026-10-27
---

# Optional dispatch key

The guided setup asks about `TYPESAFE_API_KEY` after the saved non-secret answers. It defaults to skip, labels the summary with set / not set / will set, and writes only a boolean `setup.keys.TYPESAFE_API_KEY` to the private receipt after the tool step (src/setup.mjs:413-426; src/setup.mjs:472-477). The hidden terminal prompt is the only key source; with `--yes` or no terminal the key is left unchanged and the summary names `install.sh --reconfigure keys`. An ambient `TYPESAFE_API_KEY` is removed from the environment passed to installer child processes (src/setup.mjs:379).

The key writer validates token syntax, requires a gitignored and untracked `.env` in a plain Firstmate home, and replaces only matching assignments with a private temp file and rename. It preserves unrelated lines and comments (src/keys.mjs:17-23; src/keys.mjs:35-78). Hidden terminal entry uses a readline output sink so typed characters are not echoed (src/keys.mjs:80-90).

`agent-kit keys` updates or removes only that key after a keep/change/remove choice; replacement and removal require confirmation. The command records the resulting set flag, never the value (bin/agent-kit.mjs:47-75). `install.sh --reconfigure keys` routes to the installed kit copy without fetching a release, and asks the person to upgrade first when that copy predates the keys command (install.sh:105-116). Repair and upgrade preserve the Firstmate home; uninstall keeps its `.env` by default and removes it only after exact path confirmation with `--remove-env` or confirmed removal of the whole home (src/lifecycle.mjs:280-339).

The teammate guide owns the user-facing key inventory, source link, Jev behavior, and safe later-update instructions (README.md:71-77). The manifest release label changes independently of tool pins (manifests/pilot-skeleton.json:3).
