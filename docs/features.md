# Agent Kit: all features

This page lists the functions proposed for `pilot-12`. `pilot-11` is the released kit; the owner approves `pilot-12` by merging its manifest PR. Release names have the form `pilot-N`; older releases were named `macos-pilot-N`.

**How to read the support columns.** **Yes**: works today. **Partial**: works with a limit, explained in the row. **No**: not supported.

**This is a pilot.** No one has yet installed this release on a real Mac or a real Windows PC; the first teammates' own installs are the hands-on test. Results go back to the person who shared this guide (guide section 4).

**Windows (WSL2)** means the kit running inside Ubuntu on WSL2. There is no native Windows install. You start the installer from PowerShell, and everything else runs in your Ubuntu terminal. The Windows path is covered by automated tests but has not yet been run end to end on a real Windows PC (x64 or Arm64).

**Linux** means glibc Linux on x64 or arm64. Musl Linux (for example Alpine) and WSL1 are not supported.

In the commands below, `AK` is your kit command file, `<root>/.tools/kit/<commit>/bin/agent-kit.mjs`. The installer prints it on its `Health check later:` line. `<root>` is your root folder (default `~/Agentic`).

## 1. Installer: `install.sh` and `install.ps1`

`install.sh` is for macOS and Linux. `install.ps1` is for Windows: it checks Windows, then hands over to `install.sh` inside Ubuntu.

| Function | What it does | Command | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| Guided install | Checks prerequisites and your GitHub sign-in, fetches the approved kit, asks the setup questions (section 3), shows a summary, installs in 8 steps, then runs doctor and prints a `Next steps:` list that points to the guide's start-up section | `bash install.sh` / `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1` | Yes | Yes | Yes |
| Dry run | Asks every question and shows the full summary; never asks for the key and writes nothing. On Windows, run the handoff command that `-DryRun` prints to get this | `bash install.sh --dry-run` | Yes | Yes | Partial |
| Windows check-only run | Asks the root question, checks Windows, WSL2, git, gh, Node and your sign-in, prints `handoff-ready` and the `wsl.exe …` hand-over command, and runs nothing inside Ubuntu. It does not ask the setup questions; paste the printed command (it includes `--dry-run`) into the same window to see them | `install.ps1 -DryRun` (or `--dry-run`) | No | No | Yes |
| Resume | A re-run picks up at the first unfinished step. Finished steps are re-checked, not redone, and saved answers are reused | Run the installer again with the same root | Yes | Yes | Yes |
| Reconfigure | Asks every question again instead of reusing saved answers | `bash install.sh --reconfigure` / `install.ps1 --reconfigure` | Yes | Yes | Yes |
| Reconfigure keys | Runs the installed kit's `keys` command (section 2): adds, changes or removes `TYPESAFE_API_KEY` only, at a hidden prompt. Asks the root folder first unless you pass `--root`. With `--dry-run` it only shows set or not set. On Windows, run `node "$AK" keys` in Ubuntu instead; `install.ps1` has no keys option | `bash install.sh --reconfigure keys` | Yes | Yes | No (use `keys` in Ubuntu) |
| Unattended install | No questions: uses saved answers, then flags, then the shown defaults (including the full-access Codex launch on and the Herdr layout on). Never sets a key | `--yes` | Yes | Yes | Yes |
| Choose the root folder | Sets the root without asking question 1 | `--root <folder>` | Yes | Yes | Yes |
| Choose the update channel | `releases` (approved releases, default) or `main` | `--channel releases` or `--channel main` | Yes | Yes | Yes |
| Answer a question by flag | Set any non-secret setup answer with its matching flag; see [README Questions](../README.md#questions) | Add the flag to the installer command | Yes | Yes | Yes |
| Accept a non-empty root | Allows an unattended install into a root that already holds other files (an interactive run asks instead) | `--allow-existing-root` | Yes | Yes | Yes |
| Override a derived path | Places the kit or the Firstmate home somewhere other than inside the root | `--install-root <dir>`, `--firstmate-home <dir>` | Yes | Yes | Yes |
| Choose the WSL distribution | Hands over to this distribution instead of your default one | `install.ps1 --distro <name>` | No | No | Yes |
| Pin an exact kit commit | Uses one exact commit, which must be on `main` (for maintainers) | `--commit <sha>` | Yes | Yes | Yes |
| Use a local kit checkout | Uses a clean local copy of the kit instead of fetching it (kit development and CI) | `--kit-dir <dir>` | Yes | Yes | Yes |
| Help | Prints the installer's flags. `install.ps1` has no help flag | `bash install.sh --help` | Yes | Yes | No |

**The 8 setup steps:** see the [Mac and Linux guide](user-guide.md#a26-the-eight-steps) or [Ubuntu guide](user-guide.md#b210-the-eight-steps), including the selected shell profile block in step 4.

## 2. Agent Kit commands

Run these with `node "$AK" <command>`. On Windows, run them in your **Ubuntu** terminal. Every command accepts `--json` for a machine-readable result. When you run a kit copy other than your installed one, add `--root <root>` (an absolute path).

| Function | What it does | Command | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| Doctor | Health check: every kit file present and unchanged, PATH order, hooks, permissions, Firstmate version, and a `jev` row (`PASS jev: ready (key set, rules present)`, or `WARN jev: not ready: <reason>`, never a failure and never the key). Also rows for the Firstmate origin (`firstmate origin: … (approved fork)`), the full-access answer (`codex full-access launch: on\|off`), each kit command, the Herdr keys and layout blocks, the Herdr plugins, a `shell-path` row for every installed receipt (`FAIL` when this terminal lacks a kit folder; open a new terminal after install), a `shell-profile` row when a profile choice or kit-owned block was recorded (`FAIL` when its effective PATH line lacks a kit folder), a `herdr-path-env` row (`WARN` when a running Herdr server started without the kit folders on its PATH; `PASS` when Herdr is not running or cannot be read; it only reads), the tower's start-up entry, the help page, the Claude plugins and the Figma skills. The informational rows are `PASS` or `WARN`, never `FAIL`. Changes nothing. Sign-ins and the live fleet always show as `UNKNOWN` | `node "$AK" doctor` | Yes | Yes | Yes |
| Doctor as JSON | The same report, machine-readable, to redact and share | `node "$AK" doctor --json` | Yes | Yes | Yes |
| Repair | Re-checks and re-downloads your current release, backs up and replaces changed kit files, and puts back the kit's hooks, skill links, tower config, Treehouse wrapper, kit commands, Herdr keys and layout blocks, Herdr plugin entries, the tower's start-up entry, a deleted help page, the Figma skills and the Claude plugins it added. Selects your strategy again only if Firstmate's rules and strategy are both missing. Leaves your Firstmate home, `.env`, key and your own edits as they are and reports any local changes | `node "$AK" repair` | Yes | Yes | Yes |
| Reinstall | Same as repair | `node "$AK" reinstall` | Yes | Yes | Yes |
| Upgrade | Run only when the person who shared this guide asks you to. Moves to the newest approved release on your saved channel. Shows a plan, asks only questions without saved answers, keeps your key, refreshes Firstmate's strategy or the starter rules only while unchanged, places anything the release adds, and puts kit files, commands and Herdr files back if a step fails. Data and state changes are not rolled back | `node "$AK" upgrade` | Yes | Yes | Yes |
| Update | Same as upgrade; run only when asked | `node "$AK" update` | Yes | Yes | Yes |
| Uninstall | Removes the kit's programs, hooks, skill links, unchanged tower config, unchanged Treehouse wrapper, unchanged kit commands, unchanged Herdr keys and layout blocks, its Herdr plugin entries, the tower's start-up entry, an unchanged help page, the Figma skills, the Claude plugins and marketplaces it added, and unchanged starter rules from older releases. The programs and every edited file go into a private backup under `<root>/agent-kit-uninstall/`. Keeps your root, Firstmate home (including `.env` and the strategy chosen at install), projects, second mates and tower state | `node "$AK" uninstall` | Yes | Yes | Yes |
| Uninstall and remove `.env` | Also removes the Firstmate home's `.env` file, with the key. You must type its exact path, in a real terminal | `node "$AK" uninstall --remove-env` | Yes | Yes | Yes |
| Uninstall and remove the Firstmate home | Also deletes the Firstmate home. You must type its exact path, in a real terminal. Refuses while there is unsaved or unpushed work or a running second mate | `node "$AK" uninstall --remove-firstmate-home` | Yes | Yes | Yes |
| Apply without asking | Prints the plan and applies it with no `y/N` question (repair, upgrade and uninstall only). Without a terminal and without `--yes`, these commands only print the plan | `--yes` | Yes | Yes | Yes |
| Point at an install | Uses the install under this root | `--root <root>` (or `--install-root <root>/.tools`) | Yes | Yes | Yes |
| Second mate template | Prints the starter charter and the Firstmate commands that create, seed and start a second mate | `node "$AK" secondmate-template --print` | Yes | Yes | Yes |
| Keys | Shows `TYPESAFE_API_KEY: set` or `not set`, then asks keep, add, change or remove. A new key is typed at a hidden prompt; replacing asks first; removing needs `REMOVE TYPESAFE_API_KEY` typed. Changes nothing else apart from routing rules when none exist. Without a terminal or with `--yes` it changes nothing | `node "$AK" keys` | Yes | Yes | Yes (in Ubuntu) |
| Jev on / off / status | What `fm-jev` runs (section 4b): `off` comments the key line out of `.env` (the key stays), `on` restores it, both pass the change to running second mates; `status` shows `jev: key=… rules=…`. Never shows the key | `node "$AK" jev on\|off\|status` | Yes | Yes | Yes (in Ubuntu) |
| Mate | What `fm-mate` runs (section 7): create, list or retire a second mate with Firstmate's own commands | `node "$AK" mate [new <name> --scope <text> [--no-launch] \| list \| retire <name>]` | Yes | Yes | Yes (in Ubuntu) |
| Check | Read-only check of this computer before an install: platform, prerequisites, PATH conflicts | `node "$AK" check` | Yes | Yes | Yes |
| Plan | Read-only list of everything an install would do, including exact hook changes and the Herdr keys | `node "$AK" plan` (or `install --dry-run`) | Yes | Yes | Yes |
| Guided setup | The question-and-install flow the installer runs for you | Started by `install.sh`; you do not run it directly | Yes | Yes | Yes |
| Low-level install | Installs tools into given paths without the guided questions (advanced) | `node "$AK" install --install-root <dir> --firstmate-home <dir>` | Yes | Yes | Yes |
| Lifecycle commands from PowerShell | Checks WSL2 and runs repair, upgrade or uninstall inside Ubuntu for you. Needs a copy of the kit on Windows, which the normal install does not leave behind | `windows\agent-kit.ps1 <command> --root ~/Agentic --handoff` | No | No | Partial |

**Before repair, upgrade or uninstall:** they refuse while Herdr, the no-mistakes daemon or the tower is running, including when you start them from a pane inside Herdr. Each names the step to take (`herdr server stop`, `no-mistakes daemon stop`, or closing the tower's Fleet pane). The kit never stops these itself.

**Upgrade also refuses** while your Firstmate home has uncommitted changes to tracked files, is not on the Firstmate version the kit expects, or has an `origin` other than the approved Firstmate copy (the kit owner's). When a release changes the Firstmate version (as `pilot-9`, `pilot-10`, `pilot-11` and `pilot-12` do), applying stops until `/updatefirstmate` has run in the home. Moving to `pilot-10` or `pilot-11` also has Firstmate set up the strategy the kit selected again with the new models, if nobody changed it. After an upgrade, point `AK` at the new kit copy. An unchanged kit-owned PATH block is refreshed; if you skipped question 5b, change the release folder in your PATH line yourself.

## 3. The install questions

| # | Question | Default | Flag | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Root folder | `~/Agentic` | `--root <folder>` | Yes | Yes | Yes |
| 2 | Agent CLIs: `codex`, `claude` or `claude,codex` (Claude is offered only when Claude Code is already installed) | `codex` | `--harness ...` | Yes | Yes | Yes |
| 2a | Claude subscription plan (only if Claude was chosen): `pro`, `max5x`, `max20x`, `team-standard`, `team-premium`, `enterprise-standard`, `enterprise-premium`, `api`, or `skip` | `skip` | `--claude-plan <id>` | Yes | Yes | Yes |
| 2b | Codex subscription plan (only if Codex was chosen): `plus`, `pro`, `business-standard`, `business-premium`, `enterprise-edu`, `api`, or `skip` | `skip` | `--codex-plan <id>` | Yes | Yes | Yes |
| 2c | Routing mode: `lean`, `balanced` or `full`, shown first with what each means (full: unlock full power; balanced: optimize for token saving while everything still work; lean: harder optimization for token saving while everything still work). Selected as Firstmate's token strategy at install, key or not. Warns before `full` on Claude Pro, Team Standard, Enterprise standard, ChatGPT Plus and Business Standard | `lean` on those plans and on `api`, otherwise `balanced` | `--dispatch-mode <mode>` | Yes | Yes | Yes |
| 2d | Full-access Codex launch (only if Codex was chosen). A warning is shown first (below). Changeable later with `--reconfigure` or `--no-codex-full-access` | **yes** | `--codex-full-access`, `--no-codex-full-access` | Yes | Yes | Yes |
| 3 | Figma support: installs the Figma CLI and its `figma-cli`, `figma-make` and `figma-make-team` skills (and its Claude plugin with Claude) and shows the Figma Desktop sign-in | yes | `--no-figma` | Yes | Yes | Yes (Figma Desktop reach from Ubuntu not confirmed) |
| 4 | Fleet tower | yes | `--no-tower` | Partial | Partial | Partial |
| 5 | Register global hooks and skills, and with them the kit's commands, Herdr keys, Herdr plugins and Claude plugins | yes | `--no-global-hooks` | Yes | Yes | Yes |
| 5a | Herdr layout (only with 5): the kit owner's Herdr theme, sidebar, tab bar and pane settings; your own settings win | yes | `--no-herdr-layout` | Yes | Yes | Yes |
| 5b | Shell profile PATH block: one marked block in your zsh or bash profile (inside Ubuntu on Windows), exact text shown on the summary screen, removed by uninstall while unchanged | yes | `--no-shell-profile`, `--shell-profile` | Yes | Yes | Yes |
| 6 | GitHub account or organization for your projects (recorded only) | your `gh` login | `--github-owner <name>` | Yes | Yes | Yes |
| 7 | Git name and email: keep, or set with `git config --global` | keep | `--git-name`, `--git-email` | Yes | Yes | Yes |
| 8 | Create a starter second mate now | no | `--starter-mate <name> --starter-scope <text>` | Yes | Yes | Yes |
| 9 | Update channel | `releases` | `--channel releases\|main` | Yes | Yes | Yes |
| 10 | Add optional `TYPESAFE_API_KEY` now? A yes opens a hidden prompt. Not asked on a dry run, with `--yes`, without a terminal, or once a key is set | no | none: the key is never a flag (later: `keys`) | Yes | Yes | Yes (not yet confirmed through the PowerShell window) |

Question 4 is Partial everywhere: see section 6. On Windows, question 1 is asked in PowerShell and must be a Linux path inside Ubuntu (not under `/mnt`).

**The 2d warning, word for word:** "Full-access Codex launch: Codex workers that Firstmate starts can read and write anything your user account can, run any command without asking you first, and run hooks without the hook trust review. This matches the kit owner's own setup. Answer no to keep Codex's normal sandbox and approval prompts." With yes, the summary shows `2d. Full-access Codex launch: ON - …`, the kit writes its own `codex` command (section 4b), and doctor reports `codex full-access launch: on`. With no, Codex keeps its normal approvals.

**What the plan choice means.** In `balanced` and `lean`, every subscription plan gets cheaper models for light and standard work (Claude: Haiku and Sonnet; Codex: Luna and Terra), and each kind of work steps down to a cheaper route as the week's quota runs low: below 50% on the smaller plans (Claude Pro, Team Standard, Enterprise standard; ChatGPT Plus, Business Standard) and below 35% on the larger ones (Claude Max 5x, Max 20x, Team Premium, Enterprise premium; ChatGPT Pro, Business Premium, Enterprise/Edu). `full` keeps stronger models for standard work (Opus; Sol). `api` (pay per use) gets cheaper models for light work and no step-down. `skip` keeps Firstmate's own rules. Hard work stays on the strongest model the plan routes and only lowers its effort; checking always runs at high effort. The guide's token tables (A7.4 or B7.4) list every plan and mode. Only plan names are saved; the kit never checks your account. At install the kit runs Firstmate's own `bin/fm-strategy.sh set <mode> --providers <set> --plans …` in a new home, then adds two extra rules, `check` (the plan's light route at low effort) and `research` (the plan's hard route), which step down with the work they copy. It never selects a strategy over one that already exists.

**If Codex is your only agent CLI.** Work pauses when your weekly Codex quota is used up, and resumes after the quota resets. The kit never switches to another provider you have not set up. On Codex Plus, choose `lean`.

## 4. What gets installed

Every download is checked against a fixed checksum. Nothing is started and no one is signed in.

| Item | What it is | How you use it | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| Firstmate home | Your own Firstmate, at the version the kit pins (`21b21582`), from the kit owner's approved copy of Firstmate, in `<root>/firstmate`. Its `origin` is that approved copy, so `/updatefirstmate` updates from it; doctor's `firstmate-fork` row checks it | Start it inside Herdr (section 4b) | Yes | Yes | Yes |
| Firstmate strategy | Your routing mode (2c) selected through Firstmate's own `fm-strategy.sh --plans`, plus the kit's `check` and `research` rules. Only in a home with no strategy or rules yet | Question 2c | Yes | Yes | Yes |
| Herdr 0.9.3 | The terminal workspace the agents run in | `herdr` | Yes | Yes | Yes |
| Treehouse 2.3.0 | Gives each worker its own clean copy of a repo; a kit wrapper keeps the copies under `<root>/.treehouse` | Used by Firstmate | Yes | Yes | Yes |
| Codex CLI 0.164.0 | OpenAI's agent CLI, installed only when you choose `codex` | `codex` (sign in with `codex login`) | Yes | Yes | Yes |
| no-mistakes 1.79.0 | Checks code before a PR is opened | Used by Firstmate | Yes | Yes | Yes |
| ShellCheck 0.11.0 | Shell script checker | `shellcheck` | Yes | Yes | Yes |
| actionlint 1.7.12 | GitHub Actions workflow checker | `actionlint` | Yes | Yes | Yes |
| gh-axi 0.1.35 | GitHub helper for agents; uses your own `gh` sign-in | Used by agents | Yes | Yes | Yes |
| chrome-devtools-axi 0.1.35 | Browser helper for agents. On Windows the browser opens on the Windows side | Used by agents | Yes | Yes | Yes |
| lavish-axi 0.1.78 | Turns agent output into review pages in your browser | Used by agents | Yes | Yes | Yes |
| quota-axi 0.1.53 | Shows agent usage quota; sign in with each provider yourself | Used by agents | Yes | Yes | Yes |
| tasks-axi 0.2.6 | Task helper for agents | Used by agents | Yes | Yes | Yes |
| Figma CLI 2.2.5-make.2 | Installed by the kit at a pinned version when you choose Figma, with its `figma-cli`, `figma-make` and `figma-make-team` skills (skills with question 5) | Question 3; sign in to Figma Desktop yourself | Yes | Yes | Yes (Figma Desktop reach from Ubuntu not confirmed) |
| Claude Code support | Checks that Claude Code (2.1.293 or newer) you installed is there, registers hooks and skills for it, and installs the Claude plugins (section 4c). The kit does not install Claude Code | Question 2 | Yes | Yes | Yes |
| Zoe fleet tower | The fleet view in Herdr (see section 6) | Question 4 | Partial | Partial | Partial |
| Zoetrope session graph | A Herdr plugin that shows your sessions as a graph, with its `zoe` program; keys `Ctrl+B Shift+C` (tab) and `Ctrl+B Shift+Z` (overlay) | With the tower and question 5 | Yes (not confirmed on a real run) | Not confirmed | Yes (not confirmed on a real run) |
| Herdr plugin manager | A Herdr plugin to browse and manage Herdr plugins; key `Ctrl+B M` | Question 5 | Yes (not confirmed on a real run) | Yes (not confirmed on a real run) | Yes (not confirmed on a real run) |
| Herdr keys and layout | One marked keys block (section 10) and, with 5a, one marked layout block in your Herdr `config.toml`. Backed up first, checked with `herdr config check`, restored if rejected; your own keys and settings win | Question 5 / 5a | Yes | Yes | Yes |
| Starter help page | `data/captain-help.md` in your Firstmate home, written only when none exists: start-up steps, your actual Herdr keys, the kit's commands. Never overwritten once you change it | `fm-help` | Yes | Yes | Yes |
| `TYPESAFE_API_KEY` | Optional, in the Firstmate home's `.env` (mode 600, never committed). Typed only at a hidden prompt; only set or not set is ever shown | Question 10 or `keys` | Yes | Yes | Yes |
| Private record | `<root>/.tools/receipt.json`: what was installed and your answers (including plan names, routing mode, the full-access and layout answers, and digests of the kit's commands and Herdr blocks); paths only, never secrets. For the key it records only set or not set | Read by doctor, repair, upgrade and uninstall | Yes | Yes | Yes |

**You install these yourself; the kit only checks them:** Node.js 24.15.0 or newer, git 2.20.0 or newer, the GitHub CLI 2.0.0 or newer, and python3 3.9 or newer (on macOS from the Xcode Command Line Tools; on Linux and in Ubuntu, `sudo apt install python3`). On macOS also Homebrew, the Xcode Command Line Tools and jq. Optional: Claude Code 2.1.293 or newer, and Figma Desktop. On Windows you also set up WSL2 with Ubuntu 22.04 or newer yourself, and install git, Node.js and `gh` on both Windows and Ubuntu (inside Ubuntu, Node.js from nvm or NodeSource, not `apt install nodejs`). On Windows with the tower chosen, jq inside Ubuntu (`sudo apt install -y jq`); a missing jq is a `tower-jq` warning and does not stop the install.

**The PATH block (question 5b).** The kit offers a marked zsh or bash profile block and checks whether a running Herdr can see the kit folders; it never stops Herdr. `--no-shell-profile` skips adding a block on a new install and preserves an existing kit-owned block on a rerun; `--shell-profile` explicitly turns it on. If the profile changed since the kit read it, the kit leaves your edit untouched, names the file, and exits with an error so you can re-run the command. A save between the kit's final check and its file replacement can still be lost. If you change your login shell, uninstall the kit and reinstall it from the new shell. See the guide's [Mac and Linux instructions](user-guide.md#a24-the-questions) or [Ubuntu instructions](user-guide.md#b28-the-questions) for the profile path, repair, doctor and uninstall behavior.

### 4b. The kit's commands (question 5)

Written into `<root>/.tools/bin` from your receipt. They run once that folder is first on your PATH. Repair rewrites changed ones, uninstall removes unchanged ones.

| Command | What it does | Written when | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| `firstmate [claude\|codex\|check]` | Starts Firstmate in your Firstmate home from a Herdr pane, only while no other Firstmate runs there; `check` runs Firstmate's own tool check without starting anything | always | Yes | Yes | Yes |
| `open-firstmate [claude\|codex\|mates]` | What the Herdr keys run: opens the **Control Tower** workspace and its **Captain (Claude)**, **Captain (Codex)** or **Mates** tab, creating them when missing; types only into an idle shell | always | Yes | Yes | Yes |
| `fm-mate` | Creates a second mate (asks a name, a one-line scope and a final yes, then creates and starts it); `fm-mate list`; `fm-mate retire <name>` | always | Yes | Yes | Yes |
| `fm-help` | Prints your help page | always | Yes | Yes | Yes |
| `fm-jev on\|off\|status` | Turns Jev routing off (key kept, commented out) or back on; never shows the key | always | Yes | Yes | Yes |
| `zoe-fleet-open`, `zoe-fleet-demo` | The tower launcher's `open` and `demo` with the pinned Herdr | with the tower | Yes | No | Yes |
| `zoe-fleet-autostart` | Opens the tower's tab once when Firstmate starts in Claude Code (a start-up entry in the home's `.claude/settings.local.json`, kept out of the home's git status) | with the tower | Yes | No | Yes |
| `claude` | The tower's Claude usage and status bridge in front of your own Claude Code | with the tower and Claude Code | Yes | No | Yes |
| `codex` | The full-access Codex launch: Firstmate's workers run with full access, no approval prompts and no hook trust review; Firstmate in Codex via `firstmate codex` runs with full access but keeps the hook review; everything else passes through | with Codex and 2d yes | Yes | Yes | Yes |
| `zoe` | The pinned Zoetrope program the session graph runs | with the tower | Yes | Not confirmed | Yes |
| `env.sh` | The folder names this setup uses | always | Yes | Yes | Yes |

### 4c. Claude Code plugins (with Claude Code and question 5)

Installed with your own `claude` command, from marketplaces pinned to reviewed commits. Plugins you or a marketplace you already have stay yours; doctor warns when your `claude-plugins-official` marketplace is at a different version than the kit's. Uninstall removes only what the kit added. The kit never writes a token or MCP sign-in.

| Plugin | What you do | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- |
| `codex` (OpenAI's Codex plugin; the kit shortens its session-end wait from 5 to 3 seconds), `cc-gemini-plugin`, `code-review`, `code-simplifier`, `commit-commands`, `frontend-design`, `security-guidance`, `skill-creator`, `superpowers`, `typescript-lsp`, `rust-analyzer-lsp` | nothing | Yes | Yes | Yes |
| `chrome-devtools-mcp` (runs `chrome-devtools-mcp@1.11.0`), `playwright` (pinned by the kit to `@playwright/mcp@0.0.83`) | nothing; fetched from npm when first used | Yes | Yes | Yes |
| `data-engineering` | nothing; fetches Python packages when used | Yes | Yes | Yes |
| `atlassian`, `figma` | sign in yourself through the plugin's own flow | Yes | Yes | Yes |
| `context7` | may ask for your own Context7 key | Yes | Yes | Yes |
| `figma-cli` | nothing; only with Figma | Yes | Yes | Yes |

## 5. Global hooks and skills (question 5)

| Function | What it does | Where | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| Start-up hooks | Session start hooks for gh-axi, chrome-devtools-axi, lavish-axi, tasks-axi and Herdr's agent-state script, in every Claude Code and Codex session. The gh-axi and chrome-devtools-axi hooks run through small gates that do nothing outside your Firstmate home | `~/.claude/settings.json`, `~/.codex/hooks.json` | Yes | Yes | Yes |
| Codex hooks setting | Turns on hooks in Codex. Codex still asks you to review the new hooks once (`/hooks`) | `~/.codex/config.toml` | Yes | Yes | Yes |
| Helper skills | Links the skills of gh-axi, chrome-devtools-axi, lavish, quota-axi and tasks-axi, and with Figma the Figma CLI's three skills | `~/.claude/skills/`, `~/.agents/skills/` | Yes | Yes | Yes |
| Safe merge | Keeps your own hooks and settings, backs up each file first, and stops with a conflict instead of overwriting a skill you own with the same name | `<root>/.tools/backups/hooks/` | Yes | Yes | Yes |
| Removal | Uninstall removes only the kit's own entries and links | `node "$AK" uninstall` | Yes | Yes | Yes |

Question 5 also covers the kit's commands (4b), the Herdr keys and plugins (sections 4 and 10) and the Claude plugins (4c); with `n`, none of them is set up. On Windows these files are in your Ubuntu home, not in Windows.

## 6. The fleet tower (zoe-fleet)

| Function | What it does | Command | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| Tower install | macOS and Windows (inside Ubuntu): installed from a checked release with its launcher config. The install reports `partial` until the tower's hands-on test passes. On Windows it needs Ubuntu 22.04 or newer; on an older Ubuntu only the tower is refused (`refused: the WSL2 tower release needs Ubuntu 22.04 or newer`). Standalone Linux: no reviewed release; the tower program is built from source only if you already have Rust (`cargo`), no launcher is set up, and the install reports `partial` | Question 4 | Partial | Partial | Partial |
| Tower doctor | The tower's own health check | `<root>/.tools/releases/<release>/zoe-fleet-runtime/bin/zoe-fleet-tower doctor` (the `Tower launcher:` line) | Yes (not hands-on confirmed) | No | Yes (not hands-on confirmed) |
| Tower open | Run from inside a Herdr pane: links the tower into Herdr and adds a **Team** tab | `zoe-fleet-open` (or the launcher's `open`) | Yes (not hands-on confirmed) | No | Yes (not hands-on confirmed) |
| Opens by itself | When Firstmate starts in Claude Code in a Herdr pane, the tower's tab opens once for it | automatic (with Claude Code) | Yes (not hands-on confirmed) | No | Yes (not hands-on confirmed) |
| Tower Fleet plugin | The tower's own Herdr plugin, registered while Herdr is stopped | automatic | Yes | No | Yes |
| Claude usage bridge | The kit's `claude` command passes Claude's usage and status to the tower | automatic (with Claude Code) | Yes | No | Yes |
| Tower config | The launcher's settings, private to you, now including the tower's telemetry folder | `~/.config/zoe-fleet/config` | Yes | No | Yes |
| Tower prerequisites | python3 3.9 or newer (required for the whole kit) and jq; on Windows a missing jq is a `tower-jq` warning | `sudo apt install -y python3 jq` (Ubuntu) | Yes | Yes | Yes |
| Lifecycle guard | Repair, upgrade and uninstall refuse while the tower is running | close the Fleet pane (`herdr pane close <pane-id>`) | Yes | Yes | Yes |

The kit never starts the tower. Without the tower you can still see your fleet by asking Firstmate or with `/bearings`.

**"Partial" is a testing label:** with the tower chosen, the install says `partial` until the tower's separate hands-on test has been run for that release. Everything else installs normally and setup ends `complete`. No real Mac or Windows PC has run the tower from these releases yet, x64 or Arm64 (most teammates' PCs are x64); the first teammates' runs are that test.

## 7. Second mates

| Function | What it does | Command | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| Starter second mate at install | Creates and seeds a second mate at `<root>/secondmates/<name>` with your one-line scope. It is not started | Question 8 | Yes | Yes | Yes |
| Create one from Herdr | Opens the **Mates** tab and runs `fm-mate`: asks a name, a one-line scope and a final yes, then creates the mate with Firstmate's own commands and starts it | `Ctrl+B Shift+M`, or `fm-mate` | Yes (not confirmed on a real run) | Yes (not confirmed on a real run) | Yes (not confirmed on a real run) |
| List or retire | Lists your second mates; retires one through Firstmate's own teardown, which refuses while it holds unfinished work | `fm-mate list`, `fm-mate retire <name>` | Yes | Yes | Yes |
| Starter template | Prints the charter to fill in and the commands to create one by hand | `node "$AK" secondmate-template --print` | Yes | Yes | Yes |
| Create a second mate yourself | Firstmate's own scripts, run from your Firstmate home | `bin/fm-brief.sh <name> --secondmate ...`, then `bin/fm-home-seed.sh <name> <home\|-> ...` | Yes | Yes | Yes |
| Start a second mate | Launches it | `bin/fm-spawn.sh <name> --secondmate` | Yes | Yes | Yes |
| Ask Firstmate | Describe what the second mate should own, and Firstmate creates and starts it | Say it in plain words | Yes | Yes | Yes |

## 8. Update channels

**Updates happen only when the person who shared this guide asks you to.** Never run upgrade or `/updatefirstmate` on your own.

| Function | What it does | How | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| `releases` channel (default) | Only releases the team has approved by merging them | Question 9, or `--channel releases` | Yes | Yes | Yes |
| `main` channel | The newest commit on `main` | Question 9, or `--channel main` | Yes | Yes | Yes |
| Get a new release | Nothing updates by itself. Run upgrade only when the person who shared this guide asks you to; never on your own | `node "$AK" upgrade` | Yes | Yes | Yes |
| Change the saved channel | Re-run the installer with the new `--channel`. If the other channel carries a different release, the installer stops and points you to upgrade | `bash install.sh --channel main` | Yes | Yes | Yes |

## 9. Firstmate commands for teammates

These belong to the Firstmate version the kit pins. Type them to Firstmate. Codex uses `$` instead of `/` (for example `$bearings`).

| Function | What it does | How | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| `/bearings` | A short digest of what is going on and what needs your decision. `/bearings file` also saves it as a dated report | `/bearings` | Yes | Yes | Yes |
| `/ahoy` | Catches you up on what happened since your last message and walks you through open decisions one by one | `/ahoy` | Yes | Yes | Yes |
| `/afk` | Firstmate keeps supervising the crew while you are away | `/afk` | Yes | Yes | Yes |
| `/quiet` | Fewer routine interruptions while you stay and chat: messages that need you are collected for up to 90 seconds (180 in `lean`) and anything arriving mid-answer comes at the end of that answer, never dropped; `/quiet off` ends it. `balanced` and `lean` turn it on while you are at the keyboard | `/quiet` | Yes | Yes | Yes |
| `/stow` | Saves what the session learned to Firstmate's notes before you clear or close it | `/stow` | Yes | Yes | Yes |
| Managing context (stow, then clear) | When a long session gets slow or near its context limit: run `/stow`, then clear the conversation. Firstmate restarts from its saved records; work in progress and running workers are not affected | `/stow`, then `/clear` in Claude Code, or a new Codex session (`$stow` first) | Yes | Yes | Yes |
| `/updatefirstmate` | Updates Firstmate and your second mates from the approved Firstmate copy. Run it only when the person who shared this guide asks you to, never on your own: a Firstmate newer than the kit expects makes doctor fail and upgrade refuse | `/updatefirstmate` | Yes | Yes | Yes |
| Creating second mates | Ask Firstmate in plain words, press `Ctrl+B Shift+M`, or use section 7 | Plain words | Yes | Yes | Yes |
| Merges only on your word | Firstmate brings you the PR and merges only when you say so (for example `merge it`). The exception is a project you yourself set to `+yolo` | Say `merge it` | Yes | Yes | Yes |
| Token strategies: full, balanced, lean | full: unlock full power; balanced: optimize for token saving while everything still work; lean: harder optimization for token saving while everything still work. Sets which models workers and new second mates use and how much Firstmate starts on its own (`lean`, also called light, asks before every job). On a plan, `balanced` and `lean` step each kind of work down to a cheaper route as your weekly quota runs low, on Claude and Codex. `balanced` and `lean` also use quiet mode while you are at the keyboard (messages batched for up to 90 or 180 seconds, delivered at the end of Firstmate's current answer, never dropped). The kit selects the one you chose at question 2c, once, in a new home; an upgrade refreshes it only while unchanged, and after you change it the kit never overwrites it. Never changes reviews or merge rules | Ask Firstmate, or `bin/fm-strategy.sh list`, `status`, `set <mode>` in your Firstmate home | Yes | Yes | Yes |
| Jev routing with `TYPESAFE_API_KEY` | Firstmate asks Jev (typesafe.ai) which agent and model fit each job, using your routing rules (already set up at install). Adding the key is the only step. Off without the key; then Firstmate uses its normal rules. When on, each job's screened task text is sent to typesafe.ai. Gives a clear answer only when you are signed in to the agent CLI, so quota can be read; until then Firstmate decides as it does without the key. `fm-jev off` pauses it without removing the key | Question 10, or `node "$AK" keys` (never paste the key into a chat) | Yes | Yes | Yes |

## 10. Shortcuts and commands

Taken from the help or docs of the pinned versions (Herdr 0.9.3, Codex CLI 0.164.0, the pinned Firstmate and tower), the kit's own code for the kit-managed keys, and the official Claude Code and Microsoft docs. The user guide (A8 and B8) has the full tables.

| Tool | Function | Keys or command | macOS | Linux | Windows (WSL2) |
| --- | --- | --- | --- | --- | --- |
| Herdr | Prefix key, then an action key; help | `Ctrl+B`, then `?` | Yes | Yes | Yes |
| Herdr | New tab; next / previous tab; tab 1–9 | `Ctrl+B c`; `Ctrl+B n` / `p`; `Ctrl+B 1`…`9` | Yes | Yes | Yes |
| Herdr | Split pane; move between panes; zoom | `Ctrl+B v` / `-`; `Ctrl+B h j k l` or `Tab`; `Ctrl+B z` | Yes | Yes | Yes |
| Herdr | Scroll and copy | mouse wheel; select to copy; `Ctrl+B e` opens history in an editor. No keyboard copy mode in 0.9.3 | Yes | Yes | Yes |
| Herdr | Close pane / tab | `Ctrl+B x` / `Ctrl+B Shift+X` | Yes | Yes | Yes |
| Herdr | Reload settings | `Ctrl+B Shift+R` | Yes | Yes | Yes |
| Herdr | Detach (keeps running) and reattach; stop completely | `Ctrl+B q`, `herdr`; `herdr server stop` | Yes | Yes | Yes (keeping work running after closing every window not confirmed) |
| Herdr, kit-managed | Firstmate in Claude Code (only if chosen) | `Ctrl+B F` | Yes (not confirmed on a real run) | Yes (not confirmed on a real run) | Yes (not confirmed through Windows Terminal) |
| Herdr, kit-managed | Firstmate in Codex (only if chosen) | `Ctrl+B Shift+F` | Yes (not confirmed on a real run) | Yes (not confirmed on a real run) | Yes (not confirmed through Windows Terminal) |
| Herdr, kit-managed | New second mate (Mates tab, `fm-mate`) | `Ctrl+B Shift+M` | Yes (not confirmed on a real run) | Yes (not confirmed on a real run) | Yes (not confirmed through Windows Terminal) |
| Herdr, kit-managed | Session graph in a tab / over the pane (with the tower) | `Ctrl+B Shift+C` / `Ctrl+B Shift+Z` | Yes (not confirmed on a real run) | Not confirmed | Yes (not confirmed through Windows Terminal) |
| Herdr, kit-managed | Herdr plugin manager | `Ctrl+B M` | Yes (not confirmed on a real run) | Yes (not confirmed on a real run) | Yes (not confirmed through Windows Terminal) |
| Claude Code | Interrupt; clear draft or rewind; switch mode | `Esc`; `Esc Esc`; `Shift+Tab` | Yes | Yes | Yes |
| Claude Code | History; new line | `Up` / `Ctrl+R`; `\`+`Enter` or `Ctrl+J` | Yes | Yes | Yes |
| Claude Code | Fresh conversation; shrink context; quit; help | `/clear`, `/compact`, `/exit`, `/help` | Yes | Yes | Yes |
| Codex | Call a skill; interrupt; quit | `$name`; `Esc`; `/quit` (or `Ctrl+C` twice) | Yes | Yes | Yes |
| Codex | New conversation; shrink context; review hooks; shortcut overview | `/new`, `/compact`, `/hooks`, `?` | Yes | Yes | Yes |
| Firstmate | Summary, catch-up, away, quiet, save notes, update (Codex: `$`) | `/bearings`, `/ahoy`, `/afk`, `/quiet` (`/quiet off`), `/stow`, `/updatefirstmate` (only when asked) | Yes | Yes | Yes |
| Kit commands | Start Firstmate; new second mate; help page; Jev on/off | `firstmate`, `fm-mate`, `fm-help`, `fm-jev` | Yes | Yes | Yes (in Ubuntu) |
| Tower Team tab | Help; select; open / back; pause; back to live; quit | `?`; `Tab` or arrows; `Enter` / `Esc`; `Space`; `g`; `q` | Yes (not confirmed on a real run) | No | Yes (not confirmed on a real run) |
| Windows Terminal | Ubuntu tab; copy; paste | drop-down or `Ctrl+Shift+1`…`9`; `Ctrl+Shift+C`; `Ctrl+Shift+V` | No | No | Yes |
| Classic PowerShell window | QuickEdit freeze: press `Esc` to continue. Turning QuickEdit off in Properties is not verified; use Windows Terminal | `Esc` | No | No | Yes |

Kit-managed keys are added only with question 5, never replace a key you bound yourself (that key is skipped and named), and replace no Herdr default.

## 11. Not supported

- **Native Windows.** Everything runs inside WSL2. WSL1 is refused.
- **Musl Linux** (for example Alpine), and any CPU other than x64 or arm64.
- **The tower on standalone Linux:** no launcher, no `doctor` or `open`, no Team tab, no `zoe-fleet-open`, no automatic opening and no Claude usage bridge.
- **The tower on Ubuntu older than 22.04** inside WSL2: only the tower is refused.
- **Installing prerequisites:** the kit never installs Node.js, git, `gh`, python3, jq, Homebrew, Xcode tools, Claude Code, Figma Desktop or WSL2, and never runs `sudo`.
- **Signing in:** the kit never signs you in or out and never reads, prints or stores a password or token, including for Claude plugins that connect to an account.
- **Editing any other part of your shell profile:** the kit writes only its own marked PATH block (section 4). Shells other than zsh and bash get no block; you add the PATH line yourself.
- **Starting anything:** the kit never starts or stops Herdr, the tower, the no-mistakes daemon or agents, and never reloads Herdr's settings.
- **Changing Herdr while it runs:** the kit adds its Herdr plugins only while Herdr is stopped.
- **Relay and mail settings** in Firstmate: not set up by the kit.
- **API keys other than `TYPESAFE_API_KEY`:** the kit manages no other key. It never tests the key with typesafe.ai, and there is no flag, file or environment variable for entering it, only the hidden prompt.
- **Left out by the kit owner:** git-ai (and its Codex hook), claude-mem, tode, and the terminal-browser app and skill are not part of the kit.
