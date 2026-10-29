# Agent Kit: user guide

## Status of this guide

This guide describes the proposed `pilot-13` kit. `pilot-12` is the released kit; the owner approves `pilot-13` by merging its manifest PR. Release names have the form `pilot-N`; older releases were named `macos-pilot-N`.

| Release | What it added |
| --- | --- |
| `pilot-8` | Windows readiness fixes and the tower on Windows (inside Ubuntu) |
| `pilot-9` | Firstmate from the kit owner's approved copy, set up with your plan and routing mode at install; the kit's own commands (`firstmate`, `fm-mate`, `fm-help`, `fm-jev` and others); Herdr keyboard shortcuts, plugins and look; the Claude Code plugin set; the Figma CLI and its skills; a starter help page; and the full-access Codex launch question (on by default) |
| `pilot-10` | A newer Firstmate: `balanced` and `lean` are cheaper on large plans and step down to cheaper models as your weekly quota runs low, on Claude and Codex; quiet mode now delivers Firstmate's messages reliably on Claude Code and Codex (the `pilot-9` `/quiet off` workaround is gone); question 2c shows what each mode means |
| `pilot-11` | Firstmate fixes for Codex models, quiet entry replay, batch restart and honest Codex monitoring; the updated Zoe fleet tower; the installer's PATH block and stale-Herdr guidance |
| `pilot-12` | A Firstmate ship-branch naming fix; the PATH block writer stops when it detects a profile edit before replacement |
| `pilot-13` | Firstmate enforces branch rules it finds when naming ship branches; see the [release note](../README.md#pins-and-approval) |

**Branch-rule finder limits.** It may miss `feature/*` globs and tables headed `Naming convention`. It may over-count a sentence that mixes branch advice with a path, or file-name tables under a `Branching` heading. If this happens, record the project's branch pattern.

**This is a pilot.** No one has yet installed this release on a real Mac or a real Windows PC. You, the first teammates, running it on your own computers, are the hands-on test. Please send back what you saw (section 4).

**How to use this guide.** Read the shared part (sections 1 to 3), then follow **only your own track**:

- **Part A: macOS** (with a short note for Linux at the end).
- **Part B: Windows (WSL2).**

Each track is complete on its own. You do not need to read the other one.

In this guide, `<root>` means the root folder you choose during install (default `~/Agentic`). `<release>` is the kit release name, such as `pilot-13` (older releases were named `macos-pilot-N`, for example `macos-pilot-6`). `<commit>` is the 40-character kit commit the installer prints. `<you>` is your own user name.

---

# Shared: read this first

## 1. What the kit gives you

Agent Kit sets up your own personal agent workspace on your own computer:

- **Your own Firstmate.** Firstmate is the one agent you talk to. It runs a crew of worker agents for you, gives each one its own clean copy of the project, and brings back finished pull requests or written reports. Nothing merges without your word.
- **The agent stack**, at versions the team has reviewed: Herdr (the terminal workspace the agents run in), Treehouse (gives each worker its own clean copy of a repo), the Codex CLI, no-mistakes (checks code before a PR is opened), ShellCheck, actionlint, and helper tools (`gh-axi`, `chrome-devtools-axi`, `lavish-axi`, `quota-axi`, `tasks-axi`).
- **The kit's own commands**: `firstmate` starts Firstmate, `fm-mate` creates a second mate, `fm-help` prints your help page, `fm-jev` turns Jev routing on or off, and a few more (A6.6 or B6.6).
- **Herdr shortcuts, plugins and look**: keys that open Firstmate or a new second mate, the Zoetrope session graph, the Herdr plugin manager, and the kit owner's Herdr theme and layout (A8.2 or B8.2).
- **The fleet tower** (on macOS and, inside Ubuntu, on Windows): a view of your Firstmate and its crew.
- **If you use Claude Code**: the kit owner's set of Claude Code plugins (A2.4 or B2.8).
- **If you work with Figma**: the Figma CLI and its three skills.
- **Your own second mates**: extra long-running Firstmates you create for a separate area of work, each with its own folder.
- **Optional Jev routing**: if you add a `TYPESAFE_API_KEY`, Firstmate lets Jev (from typesafe.ai) pick the right agent and model for each job (A6.5 or B6.5).

**You sign in to everything yourself**: GitHub, Codex, Claude Code, Figma, and any Claude plugin that connects to an account (Atlassian, Figma, Context7). The kit never asks for, reads, prints or stores a password or sign-in token. Its only secret is the optional `TYPESAFE_API_KEY`, which you type yourself at a hidden prompt and which the kit never shows.

**The kit never:** edits anything in your shell profile except its own marked PATH block (question 5b, which you can skip), runs `sudo`, needs administrator rights, starts services or agents, signs you in or out, installs Node, git, gh, python3, Homebrew, Xcode tools or WSL for you, or touches an existing Firstmate home. In your Herdr settings it writes only its own marked blocks, and settings you already have win.

**Not part of the kit:** git-ai, claude-mem, tode and the terminal-browser app and skill. The kit owner left these out on purpose.

Every file the kit will write is shown on a summary screen first. Nothing is written until you answer yes.

## 2. What never to share

Never send, paste, upload or screenshot:

- **API keys**, including `TYPESAFE_API_KEY`.
- **`.env` files**, from your Firstmate home or anywhere else.
- **Sign-in files and tokens:** anything in `~/.codex`, `~/.claude`, `~/.config/gh`, browser cookies, keychain or Windows Credential Manager entries, SSH keys.
- **Sign-in codes** shown during `gh auth login`, `codex login`, Claude sign-in, or a Claude plugin's own sign-in (Atlassian, Figma, Context7).
- **Your `receipt.json`** or backups: they contain your folder paths.
- **Chat transcripts** or agent logs that might contain any of the above.

**Never paste a key or token into an agent chat.** The agent session sees it and its transcript keeps it. Use the kit's own key command instead (A6.5 or B6.5).

No one helping you with the kit needs your keys or passwords.

## 3. Getting help and updates

- **Help:** ask the person who shared this guide with you. Include the error text and redacted doctor output (A10.6 or B10.6), never secrets.
- **Updates happen only when the person who shared this guide asks you to.** Never run upgrade or `/updatefirstmate` on your own. When you are asked, run upgrade (A6.3 or B6.3). On the default `releases` channel you only ever get approved releases. Nothing updates by itself.
- **Firstmate updates:** run `/updatefirstmate` only when the person who shared this guide asks you to, or when an upgrade you were asked to run says so. `/updatefirstmate` moves Firstmate to its newest version; if that is newer than the version the kit expects, doctor reports `FAIL firstmate` and upgrade refuses (A10.4 or B10.4).

## 4. Pilot feedback: what to send back

You are among the first people to run the kit on a real computer, so your results are the pilot's hands-on test. After your install (whether it worked or not), send the following to **the person who shared this guide**, and no one else:

1. **Your redacted doctor report.** Collect it as shown in A10.6 or B10.6 (`node "$AK" doctor --json > ~/kit-doctor.json`).
2. **The installer's final text**: the last lines it printed, from the last `Step N of 8:` line to the end (including `Agent Kit setup complete.` or the failure message, and the `Next steps:` list). Copy it as text, not a screenshot.
3. **Your system versions:**
   - **macOS:** the macOS version (Apple menu → **About This Mac**, or run `sw_vers` in Terminal) and whether your Mac has Apple silicon or Intel (`uname -m` prints `arm64` or `x86_64`).
   - **Windows:** the Windows version and build (run `winver`), your PC type (`$env:PROCESSOR_ARCHITECTURE` in PowerShell: `AMD64` for x64, the most common, or `ARM64`), the WSL version (`wsl -l -v` shows `VERSION 2`), and the Ubuntu version (`wsl -e grep VERSION_ID /etc/os-release`).
4. **Which Herdr keys worked** (A8.2 or B8.2): for example "Ctrl+B F opened Firstmate, Ctrl+B Shift+C did nothing".
5. **Anything that did not match this guide**: which section, what you expected, and what you saw.

**Redact before sending**, exactly as in A10.6 or B10.6: replace your user names (Mac, Windows and Linux) and home paths with `~`, your root folder with `<root>`, your computer's name with `<host>`, and your GitHub login and email with `<login>` and `<email>`. Make sure there is no key, token, password or sign-in code anywhere. Never send your `receipt.json`, any `.env` file, anything from `~/.claude`, `~/.codex` or `~/.config`, the token lines of `gh auth status`, or screenshots of sign-in pages.

---

# Part A: macOS

## A1. Before you install

**Use your own Mac and your own normal login.** Install directly in the account you use every day. You do not need a separate test account.

You install these yourself first. The installer checks them and tells you what is missing; it never installs them.

| You need | Minimum | How to get it |
| --- | --- | --- |
| Xcode Command Line Tools | — | `xcode-select --install` |
| Homebrew | — | <https://brew.sh> |
| Node.js | 24.15.0 | `brew install node` or <https://nodejs.org/en/download> |
| git | 2.20.0 | `brew install git` |
| GitHub CLI (`gh`) | 2.0.0 | `brew install gh` or <https://cli.github.com> |
| python3 | 3.9 | comes with the Xcode Command Line Tools. The kit's own commands run on it |
| jq | — | the installer checks it is there; if it says it is missing, `brew install jq` |
| Optional: Claude Code | 2.1.293 | <https://code.claude.com/docs/en/setup> (an older Claude Code cannot run the models the routing rules use). Needed for the Claude plugins |
| Optional: Figma Desktop | — | <https://www.figma.com/downloads/>, only if you work with Figma |

The kit installs the Codex CLI itself (version 0.164.0), so you do not install Codex first. If you say yes to Figma, it also installs the Figma CLI itself, so you do not install that either.

You also need:

- **Access to the kit's GitHub repository.** It is private. Ask for access before you start.
- **About 15–30 minutes**, most of it downloads.
- **Optional:** your own `TYPESAFE_API_KEY` from <https://console.typesafe.ai/keys>, if you want Jev routing (A6.5). You can also add it later.

Quick check in a new Terminal window:

```sh
node --version; git --version; gh --version
brew --version; xcode-select -p; python3 --version; command -v jq
```

**Stop Herdr first if you already run it.** The kit adds its Herdr plugins only while Herdr is stopped (`herdr server stop`). If Herdr is running, the install still finishes and tells you to stop Herdr and run the installer again to add them.

## A2. Install

### A2.1 Recommended first step: a dry run

A dry run asks every question and shows the full summary, but **writes nothing**. It is the safest way to see what the kit will do.

Make an empty folder for the installer file and go into it:

```sh
mkdir -p ~/agent-kit-installer && cd ~/agent-kit-installer
```

Sign in to GitHub (skip this if `gh auth status` already says you are logged in):

```sh
gh auth login
```

Download the installer and do a dry run:

```sh
gh api -H "Accept: application/vnd.github.raw" "repos/amelie-pierce/agent-kit/contents/install.sh?ref=main" > install.sh
bash install.sh --dry-run
```

It ends with `Dry run: nothing was written.`

### A2.2 The real install

From the same folder:

```sh
bash install.sh
```

Or the full one-liner from a fresh folder:

```sh
gh auth login && gh api -H "Accept: application/vnd.github.raw" "repos/amelie-pierce/agent-kit/contents/install.sh?ref=main" > install.sh && bash install.sh
```

Keep the `install.sh` file. You use it again to resume (A5).

### A2.3 The root folder question

The first question is:

```text
1. Root folder for your agent setup (holds firstmate/, .tools/, .treehouse/ and .zoe-fleet/) [~/Agentic]:
```

Press **Enter** for the default `~/Agentic`, then `y` to confirm. Choose a different, **new** folder if you already have something at `~/Agentic`.

The installer refuses a root that is your home folder itself, a system folder, inside a git checkout, or inside an existing Firstmate home. Once installed, the root cannot be moved by a re-run.

### A2.4 The questions

Every question shows its default in brackets. Press Enter to accept it.

| # | Question | Default | Change it when… |
| --- | --- | --- | --- |
| 1 | Root folder | `~/Agentic` | that folder is already in use |
| 2 | Agent CLIs: `codex`, `claude` or `claude,codex` | `codex` | you use Claude Code (only asked if Claude Code is already installed) |
| 2a | Your Claude subscription plan (only if you chose Claude) | `skip` | you know your plan; see "The plan questions" below |
| 2b | Your Codex (ChatGPT) subscription plan (only if you chose Codex) | `skip` | you know your plan; see below |
| 2c | Routing mode for Firstmate: `lean`, `balanced` or `full` | depends on your plan | see below |
| 2d | Use the full-access Codex launch? (only if you chose Codex) | **yes** | say `n` if you want Codex to keep asking before it acts (see below) |
| 3 | Figma support | yes | say `n` unless you work with Figma |
| 4 | Fleet tower | yes | say `n` if you already have your own tower set up (`~/.config/zoe-fleet/config` exists) |
| 5 | Register global hooks and skills (this also covers the kit's commands, Herdr keys, Herdr plugins and Claude plugins) | yes | say `n` only if you want none of these (see below) |
| 5a | Herdr layout (only if you said yes to 5) | yes | say `n` to keep Herdr's own look |
| 5b | Add the kit's PATH block to your shell profile | yes | say `n` if you manage your own PATH and will add the line from A2.7 yourself |
| 6 | GitHub account or organization for your projects | your `gh` login | you work under an organization. Recorded only; nothing is created on GitHub |
| 7 | Git name and email: keep as is? | keep | your git name or email is wrong. Changing it runs `git config --global` |
| 8 | Create a starter second mate now? | no | you already know what your first second mate will do (see A7.6) |
| 9 | Update channel: `releases` or `main` | `releases` | almost never. `releases` gets only owner-approved releases |
| 10 | Add optional `TYPESAFE_API_KEY` now? | no | you want Jev routing and have your key ready (A6.5) |

**About question 2d: the full-access Codex launch.** Asked only if you chose Codex. Before the question, the installer shows this warning:

```text
2d. Full-access Codex launch: Codex workers that Firstmate starts can read and write anything your user account can, run any command without asking you first, and run hooks without the hook trust review. This matches the kit owner's own setup. Answer no to keep Codex's normal sandbox and approval prompts.
2d. Use the full-access Codex launch (y/n) [y]:
```

The default is **yes**, as on the kit owner's own setup. Read the warning before you press Enter.

- **With yes:** the kit adds its own `codex` command in `<root>/.tools/bin`. When Firstmate starts a Codex worker, that worker runs with full access and no approval prompts, and skips the hook trust review. Firstmate in Codex, started with `firstmate codex` or `Ctrl+B Shift+F`, also runs with full access, but still asks you to review hooks (`/hooks`). Running `codex` yourself for anything else works as normal. The kit never edits your Codex settings.
- **With no:** Codex keeps its normal sandbox and asks before it acts.
- **To change it later:** re-run the installer with `--reconfigure` and answer again, or run `bash install.sh --no-codex-full-access` to turn it off. Doctor shows `codex full-access launch: on` or `off` (A6.1). Uninstall removes the kit's `codex` command.

**About question 5.** If you say yes, the kit:

- adds small start-up hooks to `~/.claude/settings.json` and `~/.codex/hooks.json`, turns on hooks in `~/.codex/config.toml`, and links its helper skills into `~/.claude/skills/` and `~/.agents/skills/`. The hooks run in **every** Claude Code and Codex session on your account; the `gh-axi` and `chrome-devtools-axi` hooks do nothing outside your Firstmate home;
- writes its own commands into `<root>/.tools/bin` (A6.6);
- adds a block of Herdr keys to your Herdr settings file (A8.2);
- adds three Herdr plugins: the Zoetrope session graph and the tower's Fleet plugin (with the tower), and the Herdr plugin manager;
- with Claude Code, installs the kit owner's Claude Code plugins (see "The Claude plugins" below);
- with Figma, links the Figma CLI's three skills (`figma-cli`, `figma-make`, `figma-make-team`).

The list of files and links it will touch is shown before the question. Your own hooks, settings, keys and plugins stay. Each file is backed up first. If you already have your own skill with one of the same names, this step stops and reports a conflict instead of overwriting it. With `n`, none of the above is set up: no kit commands, no Herdr keys, no plugins.

**About question 5a: the Herdr layout.** Yes adds the kit owner's Herdr look as one marked block in your Herdr settings: the gruvbox theme, sidebar, tab bar and pane settings, new panes opening in your root folder, and Herdr's first-run tour turned off. A section you already set yourself is left out and named. Uninstall removes the block.

**About question 5b: the PATH block.** Yes adds **one marked block** at the end of your zsh profile (`~/.zshrc`; for bash `~/.bash_profile` on a Mac or `~/.bashrc` on Linux), chosen from your login shell. Other shells, symlinked profiles and profiles with damaged kit markers are left alone. The summary shows the exact block under "Files outside the root". It is the same `export PATH=…` line as in A2.7, between `# >>> agent-kit PATH >>>` and `# <<< agent-kit PATH <<<`. An existing file is backed up first and nothing outside the block is changed; running the installer again never adds a second block, and repair and upgrade keep an unchanged block current when the release folder changes. Uninstall removes the block if you have not edited it, and says so if you have. If the profile changes after the kit reads it, the kit stops at its first detected change, leaves your edit untouched, names the file, and ends with an error so you can re-run the command. A save between the kit's final check and its file replacement can still be lost. On a new install, say `n` or use `--no-shell-profile` to skip the block and add the line from A2.7 yourself. `--shell-profile` turns it on explicitly. On a rerun, skipping leaves an existing kit block in place for uninstall.

**The Claude plugins** (only if you chose Claude Code and said yes to 5). The kit installs them with your own `claude` command, from fixed versions the kit owner reviewed:

| Plugins | What you need to do |
| --- | --- |
| `codex` (OpenAI's Codex plugin), `cc-gemini-plugin`, `code-review`, `code-simplifier`, `commit-commands`, `frontend-design`, `security-guidance`, `skill-creator`, `superpowers`, `typescript-lsp`, `rust-analyzer-lsp` | nothing |
| `chrome-devtools-mcp`, `playwright` | nothing; they download a fixed version of their tool from npm when first used |
| `data-engineering` | nothing; it downloads Python packages when used |
| `atlassian` | sign in to Atlassian yourself, in the plugin's own sign-in |
| `figma` | sign in to Figma yourself, in the plugin's own sign-in |
| `context7` | it may ask for your own Context7 key; the kit never writes one |
| `figma-cli` (only with Figma) | nothing |

If you already have one of these plugins, or the `claude-plugins-official` marketplace, the kit leaves yours as it is; doctor then shows a warning if your marketplace version differs from the kit's. Uninstall removes only what the kit added.

**The plan questions (2a, 2b, 2c).** The kit asks which subscription you have for each agent CLI you chose, so that Firstmate (and Jev, once you add the key) picks models your plan can afford. Only the plan's name is saved; the kit never checks your account. If you are not sure, press Enter for `skip`.

| Your plan | What the kit does with it |
| --- | --- |
| **Smaller plans:** Claude `pro`, `team-standard`, `enterprise-standard`; Codex `plus`, `business-standard` | Cheaper models for light and standard work (Claude: Haiku for light, Sonnet for standard; Codex: Luna for light, Terra for standard), so your quota lasts. Routing mode defaults to `lean`, and the kit warns you before `full`, because `full` can use up your five-hour limit and then your weekly limit |
| **Larger plans:** Claude `max5x`, `max20x`, `team-premium`, `enterprise-premium`; Codex `pro`, `business-premium`, `enterprise-edu` | In `balanced` and `lean`, the same cheaper models as smaller plans, at higher effort while your weekly quota is healthy; in `full`, stronger models for standard work (Claude: Opus; Codex: Sol). Routing mode defaults to `balanced` |
| **Pay per use:** `api` (an API key, including usage-based Enterprise) | Cheaper models for light work, as on smaller plans. Routing mode defaults to `lean` |
| `skip` (not sure) | Firstmate's own standard rules, unchanged. Routing mode defaults to `balanced` |

On every plan, hard work stays on the strongest model the plan routes (on Claude Opus 5.5; on Codex GPT-6 Sol, or GPT-6 Astra in `full` on the larger plans), and checking (validation) always runs at high effort. The exact models for each plan and mode are in the token tables (A7.4).

**If Codex is your only agent CLI.** Work pauses when your weekly Codex quota is used up, and resumes after the quota resets. The kit never switches to another provider you have not set up. On Codex Plus, choose `lean`.

**Routing mode (2c)** is Firstmate's token strategy (A7.4). Before the question the installer shows what each mode means:

```text
2c. Firstmate token strategy modes:
   full: unlock full power
   balanced: optimize for token saving while everything still work
   lean: harder optimization for token saving while everything still work
```

At install the kit asks Firstmate to select that strategy for the agent CLIs and plans you chose (Firstmate's own `bin/fm-strategy.sh set <mode> --plans …`). That decides which agent and model each kind of job gets, and how much Firstmate starts on its own. The kit only does this in a new Firstmate home; it never overwrites a strategy or routing rules that already exist. Press Enter for the suggested mode (`lean` or `balanced`; the kit never suggests `full`) unless you know you want another. You can switch at any time later (A7.4).

**Question 10** is skipped on a dry run, and is not asked again once a key is set. See A6.5 for what happens when you say yes.

### A2.5 The summary screen

Before anything is written you see:

```text
Agent Kit setup summary. Nothing has been written yet.
Answers:
  ...
Derived paths:
  ...
Files outside the root that will be touched:
  ...
Will install (pinned and verified; nothing is downloaded until you say yes):
  ...
Person-installed prerequisites (checked, never installed):
  ...
Write these changes now (y/n) [n]:
```

**Read "Files outside the root that will be touched".** It lists your Claude and Codex settings, your Herdr settings file with the exact keys the kit will add (for example `prefix+shift+f open-firstmate codex`, `prefix+shift+m open-firstmate mates`), and the tower's settings file. If something there surprises you, answer `n` (the default) and nothing changes. If a prerequisite is missing, the screen says `Stopped before any change` and tells you what to install.

Under `Answers:` you also see `2d. Full-access Codex launch: ON - Codex workers can read and write anything your account can, run commands without asking and run hooks without the trust review` (or `off`), and `5a. Herdr layout settings: on` (or `off`).

The key never appears, only its state: `10. Optional TYPESAFE_API_KEY: not set`, `will set` or `set`. A following line says how your routing mode will be set up, for example `Starter dispatch rules: will select Firstmate's lean strategy for codex with bin/fm-strategy.sh --plans`.

### A2.6 The eight steps

After you answer `y`, each step prints `Step N of 8:` and then a result.

| Step | What it does | Good result |
| --- | --- | --- |
| 1 | Places the kit itself at its reviewed commit | `complete` |
| 2 | Downloads and checks every tool, creates your Firstmate home and selects its strategy (2c), sets up the tower, hooks and (with Figma) the Figma CLI | `complete` (see note) |
| 3 | Installs the Treehouse wrapper so worker copies go under your root | `complete` |
| 4 | The kit's commands, Herdr keys, layout and plugins, the Claude plugins, your starter help page, and the PATH block if you chose 5b | `complete` (it names what it added) |
| 5 | Your git name and email | `complete: kept as it is` (or set) |
| 6 | Starter second mate | `not-selected` unless you asked for one |
| 7 | Shows the sign-ins you do yourself | `complete: shown` |
| 8 | Health check (doctor) | see A6.1 |

**Note on step 2:** you will see `Agent Kit install: partial`. That is expected while the tower shows `hands-on acceptance pending` (see A9). Every other component should say `installed`.

**Note on step 4:** it lists each piece it placed. If Herdr was running, it says the Herdr plugins were not added yet: stop Herdr with `herdr server stop` and run the installer again (A5). If you had already bound one of the kit's keys yourself, it says it skipped that key. With `n` to both questions 5 and 5b, this step says `not-selected`; question 5b is independent of question 5.

Every download is checked against a fixed checksum before use. No service or agent is started.

The install ends with one of:

- `Agent Kit setup complete.`
- `Agent Kit setup finished; some tools are partial and are retried on rerun.`
- `Agent Kit setup finished with failures.` If its next line says an older copy of a tool comes first on PATH, open a new terminal and run doctor again.

It then prints a short `Next steps:` list. **Save it**, especially:

- **Step 1: your PATH.** With question 5b answered yes, it says `Open a new terminal` and names the profile file the kit added its PATH block to. With `n` (or an unsupported shell) it lists the folders to add yourself (A2.7).
- **Step 4, only if needed:** if Herdr was already running and cannot see the kit tools, the list shows how to restart it (A3 step 4). The installer never stops Herdr for you.
- **Step 2: the `Health check later:` line.** This is your doctor command (A6.1).

Steps 3 to 5 are the start-up steps in A3. The list ends with `Start-up walkthrough: see "After a successful install: start it up" in the Agent Kit guide.`: that is section A3 of this guide.

### A2.7 Add the kit to your PATH

The installer prints four folders, or five if you chose Figma. With the default root they look like this:

```sh
R="$HOME/Agentic"
export PATH="$R/.tools/bin:$R/.tools/releases/<release>/bin:$R/.tools/releases/<release>/npm/node_modules/.bin:$R/.tools/releases/<release>/npm-codex/node_modules/.bin:$PATH"
```

With Figma, the fifth folder is `$R/.tools/releases/<release>/npm-figma/node_modules/.bin`. Use the exact folders your installer printed. Run this in a Terminal window to try it. With question 5b answered yes, the kit has already added this line to your profile as a marked block and you can skip this section. Otherwise, when you are happy, add the same `export` line to your own `~/.zshrc`.

**Keep `<root>/.tools/bin` first.** It holds the kit's own commands (A6.6), the Treehouse wrapper, the `zoe` program the session graph needs, and, if you chose them, the kit's `codex` (full-access launch) and `claude` (tower) commands. If another folder comes first, those do not run.

If you already had Codex or Herdr installed some other way, the kit's versions only win once these folders come first on your PATH.

### A2.8 Sign in yourself

Step 7 lists what to sign in to. Do each one yourself, in your own Terminal or browser:

```sh
codex login
```

- **Claude Code** (if you chose it): run `claude` and follow its sign-in.
- **GitHub**: you already did `gh auth login`; `gh-axi` uses that sign-in.
- **Figma** (if chosen): install Figma Desktop from <https://www.figma.com/downloads/> and sign in yourself, then follow the Figma CLI's own sign-in instructions for your account. The kit never patches or restarts Figma.
- **Claude plugins that connect to an account** (with Claude Code): `atlassian` and `figma` ask you to sign in through their own flow the first time you use them, and `context7` may ask for your own key. Sign in only there, never in a chat.
- **Codex hooks**: the first time Codex starts, it asks you to review the kit's new hooks (`/hooks`). Review and approve them yourself.

Never send your sign-in codes, tokens or screenshots of them to anyone, including an agent.

## A3. After a successful install: start it up

Do this once your install ends with `Agent Kit setup complete.` (or `finished; some tools are partial`, when the only partial item is the tower). Replace `~/Agentic` with your own root if you chose another one.

**1. Open a new Terminal window and check your PATH.** If you said yes to question 5b the kit already put the PATH block in your profile; otherwise add the `export PATH=…` line first (A2.7). Then:

```sh
command -v herdr no-mistakes codex treehouse firstmate fm-help
```

Each name should print a path inside your root, for example `~/Agentic/.tools/…` (`treehouse`, `firstmate` and `fm-help` must be in `~/Agentic/.tools/bin/`, and so must `codex` if you kept the full-access launch on). If one prints nothing or a path elsewhere, fix your PATH (A2.7, A10.2). With Claude Code only, leave `codex` out. If you said `n` to question 5, leave `firstmate` and `fm-help` out.

**2. Run the health check.** Set your `AK` shortcut (A6) and run doctor:

```sh
AK="$HOME/Agentic/.tools/kit/<commit>/bin/agent-kit.mjs"
node "$AK" doctor
```

Healthy output starts with `Agent Kit doctor: pass (pilot-13)`. These lines are normal and expected: `UNKNOWN authenticated: …`, `UNKNOWN live-tested: …`, and `WARN jev: not ready: TYPESAFE_API_KEY is not set…` if you did not add a key. You should also see `PASS firstmate-fork: firstmate origin: … (approved fork)` and, with Codex, `PASS codex-full-access: codex full-access launch: on` (or `off`). A `FAIL` line is not normal: see A6.1 and A10.

**3. Sign in to your agent CLIs yourself.** In the same Terminal window:

```sh
gh auth status
codex login
```

- `gh auth status` should say you are logged in. If not, run `gh auth login`.
- `codex login` signs you in to Codex (if you chose Codex).
- For Claude Code (if you chose it), run `claude` and follow its sign-in, then quit it again.
- Type sign-in codes only into the official sign-in page or prompt. **Never paste a password, token, sign-in code or key anywhere else**, including an agent chat.

**4. Start Herdr**, the terminal workspace the agents run in, from that same Terminal window (so Herdr gets your PATH):

```sh
herdr
```

**If Herdr was already running and the installer says it cannot see the kit tools,** let your agents finish, stop Herdr with `herdr server stop`, then start it again with `herdr` from a new Terminal window that has the PATH line.

**5. Start Firstmate.** Pick one way, inside Herdr:

- **The key:** press `Ctrl+B`, let go, then `Shift+F` for Firstmate in Codex, or `F` for Firstmate in Claude Code (A8.2).
- **The command:** in a Herdr pane, type `firstmate codex` (or `firstmate claude`).
- **By hand:** in a Herdr pane, `cd ~/Agentic/firstmate`, then `codex` (or `claude`).

The key and the command open a **Control Tower** workspace with a **Captain (Codex)** or **Captain (Claude)** tab and start Firstmate there, in your Firstmate home. If that tab is already running something, they only switch to it. Only one Firstmate can run in a home; do not open both Captain tabs at once.

The first time Codex starts it asks you to review the kit's hooks (`/hooks`); review and approve them yourself (A2.8). With the tower and Claude Code, the tower's **Team** tab also opens on its own the first time Firstmate starts in Claude Code (A9).

**6. Say hello to Firstmate.** Your agent reads Firstmate's instructions and becomes your first mate; you are the **captain**.

- **Codex check-in:** Firstmate checks in only while you talk to it; it does not monitor the crew in the background.
- **What to say:** anything. `ahoy` is fine, or go straight to a request such as `look at my GitHub project <your-github-login>/<project>`. In Codex, if Firstmate does not report on its own, say `start up`.
- **What its startup check shows:** Firstmate runs its own startup check first and tells you in plain words whether its tools are ready. On a fresh kit install everything it needs is already there. On the very first start it has no notes or projects yet; that is normal.
- **Answering its first questions:** if it says a tool is missing and asks to install it, answer yes only if you expect that tool; if unsure, say no and ask the person who shared this guide. If it asks you to sign in to GitHub, run `gh auth login` yourself in a normal Terminal window, never in the chat. For anything else, answer in plain words; you can always say "not now".

The exact wording of the startup check is not confirmed on a kit install yet; please note what you saw in your pilot feedback (section 4).

**7. Optional: Jev routing and token mode.** To turn on Jev routing, add your key from a normal Terminal window (not the agent chat): `node "$AK" keys` (A6.5). Your routing mode from question 2c is already set up. To change how many tokens Firstmate spends, ask Firstmate ("switch to balanced") or see A7.4.

**8. Optional: open the tower.** From a Herdr pane, run `zoe-fleet-open` (or the launcher's `doctor`, then `open`; A9). A **Team** tab appears in Herdr.

**9. Your help page.** Type `fm-help` in any terminal with your PATH set. It prints `data/captain-help.md` in your Firstmate home: a short page the kit wrote for you with the start-up steps, the Herdr keys it actually added for you, and the kit's commands. It is yours to edit, or ask Firstmate to keep it current; the kit never overwrites it once you change it.

**10. Stopping for the day, and coming back.**

- **To leave work running:** press `Ctrl+B q` to detach from Herdr. Herdr and your agents keep running; `herdr` reattaches later. (Shutting down or restarting the computer still stops them.)
- **To stop:** first let running work finish, or accept that stopping ends it. Type `/stow` to Firstmate (in Codex: `$stow`) so it saves what it learned (A7.3). Quit your agent CLI. Then stop Herdr from a normal Terminal window with `herdr server stop`. Stopping Herdr ends any agent still running in it.
- **To come back:** open a new Terminal window, run `herdr`, then start Firstmate again (step 5: `Ctrl+B Shift+F` or `Ctrl+B F`). Firstmate runs its startup check and picks up from its saved records: open tasks, pull requests and your pending decisions are kept on disk, not in the conversation. Type `/ahoy` (in Codex: `$ahoy`) to catch up.

## A4. Your folder layout

Everything lives under your root folder:

| Path | What it is | Safe to edit? |
| --- | --- | --- |
| `<root>/firstmate` | **Your Firstmate home.** Talk to Firstmate here. | Let Firstmate manage it. Do not edit its tracked files by hand. |
| `<root>/firstmate/projects/` | Your project clones | Firstmate and its workers manage these |
| `<root>/firstmate/data/` | Firstmate's notes, reports and backlog | Read freely; private to you |
| `<root>/firstmate/data/captain-help.md` | Your help page, printed by `fm-help` | Yes, it is yours |
| `<root>/firstmate/state/`, `config/` | Firstmate's running state and settings (including the strategy chosen at install) | No; change the strategy through Firstmate (A7.4) |
| `<root>/.tools` | The kit: tools, releases, backups and the kit copy | No |
| `<root>/.tools/bin` | The kit's own commands (A6.6) and the Treehouse wrapper | No |
| `<root>/.tools/receipt.json` | Private record of what the kit installed and your answers. Contains paths, never secrets. | No |
| `<root>/.tools/kit/<commit>` | The kit's own commands (doctor and others) | No |
| `<root>/.tools/backups/` | Private copies of files the kit changed | No |
| `<root>/.treehouse` | The workers' temporary project copies | No; they are created and removed automatically |
| `<root>/.zoe-fleet` | The tower's state | No |
| `<root>/secondmates/<name>` | A second mate's home, if you created one | Same rules as your Firstmate home |

Outside the root:

- Your zsh or bash profile gets the kit's marked PATH block if you chose question 5b (A2.4).
- `~/.config/zoe-fleet/config`: the tower's launcher settings (if you chose the tower).
- The hook and skill files from question 5 (if you chose them).
- Your Herdr settings: `~/.config/herdr/config.toml` gets the kit's marked keys block, the layout block (5a) and the session graph's own keys block; `~/.config/herdr/plugins.json` gets the kit's three plugin entries (question 5).
- Your Claude Code plugins (with Claude Code and question 5), in Claude Code's own settings.
- Second mates' worker copies under `~/.local/state/firstmate/treehouse-pools/` (Firstmate's own choice).

Inside your Firstmate home, with the tower, the kit also adds one start-up entry to `.claude/settings.local.json` (it opens the tower's tab when Firstmate starts in Claude Code), and lists that file in the home's own git exclude list so it never shows up as a change.

## A5. If install stops: resume

If anything fails, the installer stops safely and says so:

```text
Stopped safely at step N. Rerun the installer to resume; completed steps are re-verified, not redone.
```

**To resume, run the installer again** from the same folder:

```sh
cd ~/agent-kit-installer && bash install.sh
```

Give the **same root folder** when asked. Then you will see:

```text
Found an Agent Kit install at <root>/.tools.
Resuming from step N of 8 (...).
Completed steps are re-verified against the receipt; only failed or missing steps are redone.
Reusing your saved answers (pass --reconfigure to answer every question again).
```

Your other answers are not asked again. Confirm the summary with `y`. Files that were already downloaded and checked are not downloaded again.

If everything is already done it says `All 8 setup steps are recorded complete; re-verifying them (no changes expected).` A re-run is always safe. Run it with Herdr stopped (`herdr server stop`) if step 4 said the Herdr plugins were not added yet.

To change your answers (for example to turn Figma on, to turn the full-access Codex launch off, or to change your plan), re-run with:

```sh
bash install.sh --reconfigure
```

If you change your plan or routing mode this way, the kit updates Firstmate's strategy only while it is still exactly as the kit set it. If you or Firstmate changed it since, it is left alone; switch it yourself instead (A7.4). To change only the key, use `bash install.sh --reconfigure keys` instead (A6.5).

Do not stop a running install with Ctrl-C. If it fails, read the message first.

**Common reasons it stops:**

- A missing or old prerequisite: it prints `Install these yourself first, then rerun bash install.sh (nothing was changed)` and how to install each one.
- `sign in to GitHub with your own account first`: run `gh auth login`.
- `could not fetch the kit`: you probably do not have access to the repository yet.
- A network error during download: just re-run.
- A **checksum mismatch**: do not work around it; see A10.1.

## A6. Day-to-day commands

The kit's commands live in your kit copy. The easiest way is to set a shortcut in your Terminal, using the `Health check later:` line the installer printed:

```sh
AK="$HOME/Agentic/.tools/kit/<commit>/bin/agent-kit.mjs"
```

If you lost that line, list the kit copies and use the folder name:

```sh
ls ~/Agentic/.tools/kit/
```

After an upgrade (A6.3) there is a new kit copy for the new release. Set `AK` again to the new `<commit>`, which upgrade shows on its `reviewed kit: <old> -> <new>` line.

All of these commands also accept `--json` for a machine-readable result. If you run a kit copy from somewhere else, add `--root ~/Agentic` so it finds your install.

### A6.1 Doctor (health check)

Checks that everything the kit installed is present, unchanged and set up. **It changes nothing.**

```sh
node "$AK" doctor
```

Healthy output starts with:

```text
Agent Kit doctor: pass (<release>)
```

followed by one line per tool and per check. These two lines are always expected, because the kit never looks at your sign-ins or a running fleet:

```text
UNKNOWN authenticated: sign-in belongs to this teammate; no auth store queried
UNKNOWN live-tested: live fleet was not probed
```

There is also one line for Jev routing. It is only ever `PASS` or `WARN`, never a failure, and it never shows the key:

```text
PASS jev: ready (key set, rules present)
WARN jev: not ready: TYPESAFE_API_KEY is not set; add it from your own terminal with agent-kit keys
```

`WARN jev: not ready` is normal if you did not add a key. Other reasons it can give are a missing or broken routing rules file (A6.5) or a helper tool not on your PATH (A2.7).

These rows cover what `pilot-9` added. Each is `PASS` or `WARN`, never `FAIL`: the kit still works without them, and repair (A6.2) puts back what changed.

| Row | What `PASS` means | If it says `WARN` |
| --- | --- | --- |
| `firstmate-fork` | `firstmate origin: … (approved fork)`: your Firstmate home updates from the kit owner's approved copy of Firstmate | its `origin` was changed; see A10.4 |
| `codex-full-access` | `codex full-access launch: on` or `off`, your answer to 2d | (always `PASS`; it only reports your answer) |
| `launcher-<name>` (one per kit command, A6.6) | the command matches what the kit wrote | changed or missing; run repair |
| `herdr-keys`, `herdr-layout` | the kit's marked blocks are in your Herdr settings | missing (repair restores it) or changed by you (left as you edited it) |
| `herdr-plugin-…`, `zoe`, `zoetrope-keys` | the Herdr plugins, the `zoe` program and the session graph's keys are in place | stop Herdr, then run repair |
| `shell-profile` (if you said yes to 5b, or an earlier install left a kit-owned block) | an effective PATH line in the kit's profile block holds every kit folder | `FAIL`: the block was removed or misses a folder; run repair after choosing 5b |
| `shell-path` | this terminal's PATH holds every kit folder | `FAIL` if this terminal lacks a folder; open a new terminal after install or repair |
| `herdr-path-env` | `PASS` when Herdr is not running (or cannot be read), or its PATH holds every kit folder | `WARN`: Herdr started before the kit folders were on your PATH. Quit your agents, run `herdr server stop`, open a new terminal and start `herdr` there (inside Ubuntu on Windows). Doctor only reads; it never stops Herdr |
| `fleet-autostart` (with the tower) | the start-up entry that opens the tower's tab is in place | run repair |
| `captain-help` | your help page exists | it was deleted; ask Firstmate to write one, or run repair |
| `claude-marketplace-…`, `claude-plugin-…` (with Claude Code) | the Claude plugins are installed and turned on | a plugin is turned off, or your own marketplace is at a different version than the kit's |
| `figma-skill-…` (with Figma) | the Figma CLI's skills are linked | run repair |

- `FAIL <tool>-path: another binary has PATH precedence` means an older copy of that tool comes first on your PATH. Fix your PATH (A2.7) and run doctor again.
- Any other `FAIL` is a real problem. See A10.

For a machine-readable report to share (after redacting; see A10.6):

```sh
node "$AK" doctor --json > ~/kit-doctor.json
```

### A6.2 Repair (reinstall)

Use repair when something the kit installed is damaged or missing, for example a deleted tool or a changed file.

Run repair, upgrade and uninstall from a **normal Terminal window, not from inside Herdr**: they refuse while Herdr is running (see A10.3).

```sh
node "$AK" repair
```

`reinstall` does the same thing. What it does:

- Shows a plan first, then asks `Apply this plan now? (y/N)`. Nothing changes until you answer `y`. (`--yes` applies without asking. Without a terminal and without `--yes`, it only prints the plan.)
- Checks every kit file in your **current** release against its recorded checksum. It downloads and checks the release's tools again and replaces anything missing or changed. A changed file is first moved to a private backup under `<root>/.tools/backups/repair/`.
- Fetches a fresh copy of the kit itself (`<root>/.tools/kit/<commit>`) at the same commit.
- Puts back the kit's own hooks, skill links, tower config and Treehouse wrapper.
- Puts back the kit's commands in `<root>/.tools/bin` (a changed one is backed up first), its Herdr keys and layout blocks, its Herdr plugin entries, the tower's start-up entry, your help page if it was deleted, the Figma CLI's skills, and the Claude plugins the kit added.
- If Firstmate's routing rules and strategy are both missing, selects your strategy again. A strategy or rules you or Firstmate changed are left alone.

What it never touches: your Firstmate home's notes, state, settings and projects; your `.env` file and key; your own hooks, settings, Herdr keys and plugins; anything you wrote yourself, including your own edits to the kit's Herdr blocks or your help page. If your Firstmate home has local changes, repair **reports** them and leaves them as they are.

Repair refuses to run while Herdr, the no-mistakes daemon or the tower is running. It tells you which one and what to do; close it and run repair again (see A10.3).

Repair fixes your current release only. If the kit copy you run is for a different release than your install, it stops and tells you to use upgrade. It also stops if an earlier upgrade did not finish.

### A6.3 Upgrade (update)

**Updates happen only when the person who shared this guide asks you to.** Never run upgrade or `/updatefirstmate` on your own.

Moves you to the newest approved kit release.

```sh
node "$AK" upgrade
```

`update` does the same thing. What it does:

1. Asks GitHub, with your own sign-in, for the newest release on your saved channel (`releases` by default).
2. Shows what changes: the release name, each tool's version, the tower release, whether the Firstmate version the kit expects changes, and any new questions.
3. Reuses your saved answers and asks only questions without saved answers. For example, moving from `pilot-8` to `pilot-9` asks 2d (the full-access Codex launch, with its warning; default yes) and 5a (Herdr layout; default yes) once. A kit version with question 5b asks it once if your receipt has no PATH-block answer. With `--yes` new questions take their defaults.
4. Asks `Apply this plan now? (y/N)`. (`--yes` applies without asking.)
5. Installs the new release next to the old one, then switches over. If a step fails, it puts back the kit's files, its record, its hook and skill registrations, and its commands and Herdr files as they were. **Changes to data and state are not rolled back**; the plan says so before you apply it.

Upgrade keeps your key. It refreshes Firstmate's strategy or the kit's starter routing rules only if nobody has changed them since the kit set them (A6.5). It also places anything new the release adds, for example the kit's commands, Herdr keys and plugins when moving to `pilot-9`.

Upgrade **refuses before changing anything** if your Firstmate home:

- has uncommitted changes to its tracked files, or
- is not on the Firstmate version the kit expects, or
- has an `origin` remote other than the approved Firstmate copy the kit uses (the kit owner's copy, which doctor's `firstmate-fork` row names).

It says which case applies. It will not reset your Firstmate home for you. Clean up the changes, put the home back on the expected version, or set `origin` back, then run upgrade again (A10.4). If a new release needs a newer Firstmate, the plan says `run /updatefirstmate in the Firstmate home before applying`, and applying stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade`. In that case, as part of the upgrade you were asked to run, ask Firstmate to run `/updatefirstmate`, then run upgrade again. (`pilot-9`, `pilot-10`, `pilot-11`, `pilot-12` and `pilot-13` are such releases.)

Like repair, upgrade refuses while Herdr, the no-mistakes daemon or the tower is running.

**After an upgrade:**

- Set `AK` to the new kit copy (A6).
- If you skipped question 5b, change `<release>` in your PATH line (A2.7) to the new release name from the plan's `Release: <old> -> <new>` line. An unchanged kit-owned block is refreshed for you. The old release folder stays in place, so an old PATH still runs the old tools and doctor reports `FAIL <tool>-path`.
- Run doctor (A6.1).

**Moving from `pilot-12` to `pilot-13`**, when you are asked to:

1. Run upgrade. The plan shows `Release: pilot-12 -> pilot-13`, one changed Firstmate line with the full commit numbers, and `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`.
2. Answer `y`. Upgrade stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` and changes nothing.
3. Start Herdr and Firstmate again (A3) and ask Firstmate to run `/updatefirstmate` (in Codex: `$updatefirstmate`). When it is done, quit Firstmate and stop Herdr (A10.3).
4. Run upgrade again. The plan now says `Firstmate pin: guarded update already verified`; answer `y`.
5. Do the "After an upgrade" steps above.

**Moving from `pilot-11` to `pilot-12`**, when you are asked to:

1. Run upgrade. The plan shows `Release: pilot-11 -> pilot-12`, one changed line, `- firstmate: 622311a5… -> 21b21582…` (with the full commit numbers), and `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`.
2. Answer `y`. Upgrade stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` and changes nothing.
3. Start Herdr and Firstmate again (A3) and ask Firstmate to run `/updatefirstmate` (in Codex: `$updatefirstmate`). When it is done, quit Firstmate and stop Herdr (A10.3).
4. Run upgrade again. The plan now says `Firstmate pin: guarded update already verified`; answer `y`.
5. Do the "After an upgrade" steps above.

**Moving from `pilot-10` to `pilot-11`**, when you are asked to:

1. Run upgrade. The plan shows `Release: pilot-10 -> pilot-11`, changed Firstmate and tower lines, `- firstmate: a6bc1877… -> 622311a5…` (with the full commit numbers), and `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`.
2. Answer `y`. Upgrade stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` and changes nothing.
3. Start Herdr and Firstmate again (A3) and ask Firstmate to run `/updatefirstmate` (in Codex: `$updatefirstmate`). When it is done, quit Firstmate and stop Herdr (A10.3).
4. Run upgrade again. The plan now says `Firstmate pin: guarded update already verified`; answer `y`.
5. If you never changed the token strategy the kit set up, upgrade has Firstmate set it up again with the current Codex models (A7.4). If you changed it, it is left alone; run `bin/fm-strategy.sh set <your mode>` in your Firstmate home to get the current models.
6. Do the "After an upgrade" steps above. The Codex GPT-6.1 Sol workaround is no longer needed: Firstmate now routes Sol to GPT-6 Sol. The updated tower adds current model prices.


**Moving from `pilot-9` to `pilot-10`**, when you are asked to:

1. Run upgrade. The plan shows `Release: pilot-9 -> pilot-10`, one changed line, `- firstmate: e823c61f… -> a6bc1877…` (with the full commit numbers), and `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`.
2. Answer `y`. Upgrade stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` and changes nothing.
3. Start Herdr and Firstmate again (A3) and ask Firstmate to run `/updatefirstmate` (in Codex: `$updatefirstmate`). When it is done, quit Firstmate and stop Herdr (A10.3).
4. Run upgrade again. The plan now says `Firstmate pin: guarded update already verified`; answer `y`.
5. If you never changed the token strategy the kit set up, upgrade has Firstmate set it up again with the new cheaper models (A7.4). If you changed it, it is left alone; run `bin/fm-strategy.sh set <your mode>` in your Firstmate home to get the new models.
6. Do the "After an upgrade" steps above. If you typed `/quiet off` at the start of each session because of the `pilot-9` known issue, you can stop: quiet mode now works on Claude Code (A7.4).

**One caveat when moving from `pilot-8` to `pilot-9` only:** if that upgrade fails near its end, the kit's new commands (`codex`, `fm-mate`, `fm-jev`, `open-firstmate` and the others) may point at a kit copy that was removed, and do not work. Run upgrade again; that puts them right. Upgrades from `pilot-9` onwards do not have this gap.

**How releases reach you.** Each kit release is reviewed and approved before it is published. You run upgrade only when the person who shared this guide asks you to; on the `releases` channel you then get that approved release. Nothing updates by itself.

### A6.4 Uninstall

Removes the kit itself and leaves your work in place.

```sh
node "$AK" uninstall
```

It shows a plan and asks before changing anything.

**What it removes:**

- The kit's programs, releases, helper tools and kit copy in `<root>/.tools`. These are **moved** into a private backup folder, not deleted (see below).
- The Treehouse wrapper, if you did not change it. A changed wrapper is left for you to review.
- The kit's hook entries in `~/.claude/settings.json` and `~/.codex/hooks.json`, and its skill links in `~/.claude/skills/` and `~/.agents/skills/`.
- The tower config the kit wrote, if you did not change it.
- The kit's commands in `<root>/.tools/bin` (including its `codex` and `claude` commands), its Herdr keys and layout blocks, and its Herdr plugin entries, each only if you did not change it. The rest of your Herdr settings stays.
- The tower's start-up entry in your Firstmate home, your help page if you never changed it, the Figma CLI's skills, and the Claude plugins and marketplaces the kit added (your own stay).
- Starter routing rules written by an older kit release, if nobody changed them since.
- The Codex "hooks on" setting, but only if the kit was the one that turned it on. If that setting was changed since, it is left alone and reported.

**What it keeps:**

- Your root folder, your Firstmate home and its projects, your second mates, and the tower's state.
- Firstmate's strategy and routing rules chosen at install: they are Firstmate's own settings.
- A private backup of everything it removed and a record of the uninstall, under `<root>/agent-kit-uninstall/`. Delete that folder yourself later if you want the space back.
- Your sign-ins, Node, git, gh, Claude Code, Xcode tools, Homebrew, and the rest of your shell profile. Uninstall removes only the kit's marked PATH block, and only if you have not edited it. If you did, it keeps the block and tells you; remove the `export PATH` line yourself.
- Your Firstmate home's `.env` file (with your key, if you added one), as part of the home.

**Also removing the `.env` file** (and with it your key):

```sh
node "$AK" uninstall --remove-env
```

You must type the exact path of the `.env` file to confirm, in a real terminal. To remove only the key and keep the kit, use `keys` instead (A6.5).

**Also removing your Firstmate home** (careful: this deletes your Firstmate, its projects and its `.env` file):

```sh
node "$AK" uninstall --remove-firstmate-home
```

You must type the full path of the home to confirm. This needs a real terminal and cannot be skipped, even with `--yes`. It refuses if the home or any project in it has uncommitted, untracked or unpushed work, or if a second mate is still running.

Like repair, uninstall refuses while Herdr, the no-mistakes daemon or the tower is running.

### A6.5 Keys: `TYPESAFE_API_KEY` and Jev routing

`TYPESAFE_API_KEY` is **optional**. You can install and use everything without it.

- **Without it:** Jev routing is off. Firstmate decides which agent handles each job using its normal rules. Everything else works the same.
- **With it:** Firstmate asks Jev (from typesafe.ai) which agent and model should handle each job, choosing from your routing rules. When it is on, the text of each job, after a screen for anything sensitive, is sent to typesafe.ai.

**Adding the key is the only step.** The routing rules Jev chooses from are already there: the kit set up Firstmate's strategy for your agent CLIs and plans at install (A2.4). Once the key is in, Jev routing is on. You do not need to choose a token strategy or edit any file.

**Get your key** from <https://console.typesafe.ai/keys>, signed in with your own account.

**During install (question 10).** The installer asks `10. Add optional TYPESAFE_API_KEY from https://console.typesafe.ai/keys now? Enabling Jev sends screened task text to typesafe.ai (y/n) [n]:`. The default is no. If you answer `y`, it shows a hidden prompt:

```text
TYPESAFE_API_KEY (hidden; press Enter to cancel):
```

Paste or type your key and press Enter. **Nothing appears on screen while you type; that is expected.** The summary then shows `will set`, never the key. A dry run never asks for the key.

**To add, change or remove the key later**, run this yourself in your own Terminal (not inside an agent chat):

```sh
node "$AK" keys
```

or, from your installer folder (it asks your root folder first; just press Enter for `~/Agentic`):

```sh
bash install.sh --reconfigure keys
```

What you see:

1. `TYPESAFE_API_KEY: set` or `not set`.
2. A question: `Keep or add? [keep]:` (or `Keep, change or remove? [keep]:` if a key is already set). Press Enter to change nothing.
3. For `add` or `change`: the same hidden prompt as above. For `change` it also asks `Replace the existing key? (y/N)`.
4. For `remove`: you must type `REMOVE TYPESAFE_API_KEY` to confirm.
5. The new state: `TYPESAFE_API_KEY: set` or `not set`, and a line about the routing rules.

The key command only ever shows **set** or **not set**, never the key, and changes nothing else apart from the routing rules described below (and only when none exist). The key is saved in your Firstmate home's `.env` file, private to you (mode 600) and never committed to git. Repair, upgrade and re-running the installer keep it. The kit cannot test the key with typesafe.ai; it only refuses a key that is empty or clearly malformed.

If it says `the installed kit predates the keys command`, your install is older than `pilot-7`. Do not work around it: ask the person who shared this guide, who will ask you to upgrade (A6.3) when it is time.

> **Never paste the key into an agent chat.** Anything you paste into a chat is visible to that agent session and saved in its transcript. If an agent is helping you set it up, it should tell you to run `keys` yourself, and you type the key only at the hidden prompt.

**The routing rules.** Firstmate's routing rules file (`config/crew-dispatch.json` in your Firstmate home) decides which agent and model each kind of job gets. At install, with or without the key, the kit asks Firstmate to select your routing mode (2c) for your agent CLIs and plans, so Firstmate writes this file itself. The kit then adds two extra rules after Firstmate's: `check` (quick checks that change nothing, on your plan's light model at low effort) and `research` (open-ended investigation, on your plan's strongest route). They step down with your quota the same way as the work they copy, and add no new model or spend.

- **Only when none exist.** The kit does this only if your Firstmate home has no routing rules and no token strategy yet. If you already have your own, the kit leaves them as they are and Jev uses them.
- **Your changes win.** You can change the rules at any time: ask Firstmate, choose another token strategy (`bin/fm-strategy.sh set <mode>`, A7.4), or edit the file yourself. From then on the kit never overwrites them. Repair and upgrade only touch them while they are exactly as the kit set them.
- **Removing the key keeps the rules.** Firstmate's normal routing still reads them; only Jev is off.
- **Nothing else changes.** The kit never edits your Claude, Codex or no-mistakes settings. Firstmate prints any settings it leaves to you, such as the model for your coordinator.

**Turning Jev off for a while** without removing the key: run `fm-jev off` in your own Terminal. It turns the key line in `.env` into a comment, so the key stays saved but Jev is off. `fm-jev on` turns it back on, and `fm-jev status` shows `jev: key=on|off (key kept, commented out)|not set rules=present|absent`. It never shows the key, and it passes the change on to any second mates that are running. `fm-jev on` needs a key already added with `keys`.

**Is Jev ready?** Run doctor (A6.1) and look for `PASS jev: ready (key set, rules present)`.

**Sign in to your agent CLI.** Jev gives a clear answer only when you are signed in to your agent CLI (`codex login`, or Claude Code's own sign-in; A2.8), because Firstmate reads your remaining quota through `quota-axi`. Until then, Firstmate simply decides as it does without the key. Nothing breaks.

**Not set up by the kit:** Firstmate's Relay and mail settings are advanced options the kit does not configure.

### A6.6 The kit's commands on your PATH

With question 5 answered yes, the kit writes these commands into `<root>/.tools/bin`. They work once that folder is first on your PATH (A2.7). Repair rewrites them, uninstall removes them.

| Command | What it does | Written when |
| --- | --- | --- |
| `firstmate` / `firstmate codex` / `firstmate claude` | Start Firstmate in your Firstmate home, from a Herdr pane. It refuses outside Herdr, and refuses while another Firstmate is already running in this home | always |
| `firstmate check` | Firstmate's own tool check, without starting anything | always |
| `open-firstmate codex`, `claude` or `mates` | What the Herdr keys run (A8.2): open the **Control Tower** workspace and its Firstmate or **Mates** tab | always |
| `fm-mate` | Create a second mate: asks a name and a one-line scope, asks once more, then creates it and starts it (A7.6). `fm-mate list` lists them; `fm-mate retire <name>` retires one, and refuses while it still holds unfinished work | always |
| `fm-help` | Print your help page (`data/captain-help.md`) | always |
| `fm-jev on`, `off` or `status` | Turn Jev routing on or off without removing the key (A6.5) | always |
| `zoe-fleet-open`, `zoe-fleet-demo` | The tower launcher's `open` and `demo` (A9) | with the tower |
| `codex` | The full-access Codex launch (A2.4, question 2d) in front of the kit's Codex | with Codex and 2d yes |
| `claude` | The tower's Claude usage and status bridge in front of your own Claude Code. It passes everything on to your Claude Code | with the tower and Claude Code |
| `zoe` | The program the Zoetrope session graph runs | with the tower |

Two files support them: `<root>/.tools/env.sh` (the folder names this setup uses) and the Treehouse wrapper. The kit also keeps its `gh-axi` and `chrome-devtools-axi` start-up hooks quiet outside your Firstmate home.

## A7. Working with Firstmate

### A7.1 Starting Firstmate

Firstmate runs inside Herdr, the terminal workspace the kit installed. In a Terminal window with your PATH set (A2.7):

```sh
herdr
```

Then press `Ctrl+B Shift+F` (Codex) or `Ctrl+B F` (Claude Code), or type `firstmate codex` (or `firstmate claude`) in the Herdr pane. You can also start it by hand:

```sh
cd ~/Agentic/firstmate
codex
```

Use `claude` instead of `codex` if you chose Claude Code. The agent reads Firstmate's instructions and becomes your first mate. You are the **captain**.

### A7.2 Talking to it

Just say what you want, in plain words:

```text
look at my GitHub project <your-github-login>/<project>, then fix the flaky login test and add dark mode
```

Firstmate:

1. checks its tools (and asks before installing anything),
2. clones the project into `projects/`,
3. starts one worker agent per task, each in its own Herdr tab and its own clean copy of the code,
4. watches them and comes back with results, for example a pull request link with a short risk note.

**Nothing merges without your word.** Firstmate brings you the PR; you review it and say `merge it` when you are happy.

Some tasks are **investigations** instead of code changes. Those end with a written report rather than a PR.

On Codex, Firstmate only notices updates while you are talking to it. Ask "how is everything?" now and then, or use the Claude Captain when you want automatic notifications.

You can watch any worker in its Herdr tab, or type into it if you need to.

Useful built-in commands (type them to Firstmate; Codex uses `$` instead of `/`, for example `$bearings`):

| Command | What it does |
| --- | --- |
| `/bearings` | A short summary of what is going on and what needs your decision |
| `/ahoy` | Catch up on what happened since your last message and go through open decisions |
| `/afk` | Let Firstmate carry on supervising while you step away |
| `/quiet` | Fewer routine interruptions while you stay and chat; `/quiet off` ends it |
| `/stow` | Save what this session learned to Firstmate's notes before you clear or close the session (see Managing Firstmate's context) |
| `/updatefirstmate` | Update Firstmate itself and your second mates. Run it only when the person who shared this guide asks you to (section 3) |

### A7.3 Managing Firstmate's context

A long Firstmate conversation slowly fills up the agent's memory for that session (its context). When it gets slow, starts repeating itself, or your agent tool warns that the context is nearly full:

1. Type `/stow` (in Codex: `$stow`). Firstmate saves what this session learned and writes a short "where I left off" note in its own home.
2. Clear the conversation: in Claude Code type `/clear`; in Codex, quit and start a new Codex session in your Firstmate folder.
3. Carry on. In Claude Code, Firstmate reloads its saved notes and its records of the work in progress by itself. In a new Codex session, say "start up" (or anything) and Firstmate runs its own startup check first.

Nothing in progress is lost: workers keep running in their own panes, and their tasks, pull requests and your pending decisions live in Firstmate's records, not in the conversation. Run `/stow` before a clear, not after; a clear without it only loses notes Firstmate had not saved yet.

### A7.4 Saving tokens: full, balanced and lean

Firstmate has three token strategies. Each one sets which model each kind of worker uses, which model new second mates use, and how much Firstmate starts on its own. None of them changes quality checks, reviews, or the rule that nothing merges without your word.

| Mode | What it does | Suits you if |
| --- | --- | --- |
| `full` | **Unlock full power.** The strongest models your plan routes; Firstmate starts approved work, fix rounds and fresh starts on its own; second mates allowed; every update reaches you straight away | you have plenty of quota and want the most done unattended |
| `balanced` | **Optimize for token saving while everything still work.** Cheaper models that step down further as your weekly quota runs low (tables below); light and standard jobs start on their own, hard or expensive ones need your OK with a rough cost; one automatic fix round, then it asks; second mates optional (off on the smaller plans); quiet mode while you are at the keyboard, with messages batched for up to 90 seconds | you want a sensible middle ground |
| `lean` (also called "light") | **Harder optimization for token saving while everything still work.** The cheapest routes for each plan; every new job needs a plan and your OK; no automatic fix rounds, retries or fresh starts; one coordinator, no new second mates unless you ask; quiet mode while you are at the keyboard, with messages batched for up to 180 seconds | you want to spend as few tokens as possible |

**Which models each kind of job gets.** Firstmate sorts every job as light, standard or hard. The tables show the model and effort for each, as `light / standard / hard`. An arrow (`→`) means the job starts on the first route and moves to the cheaper one once less than the "steps down below" share of your weekly quota is left, so the week's quota lasts. Hard work only ever lowers its effort; it never moves to a weaker model. Checking (validation) always runs at high effort.

Claude Code (Haiku, Sonnet and Opus are the 5.5 models):

| Your plan | `full` | `balanced` | `lean` |
| --- | --- | --- | --- |
| `pro`, `team-standard`, `enterprise-standard` | Sonnet low / Opus medium / Opus high | Haiku medium → low / Sonnet medium → low / Opus high → medium; steps down below 50% | Haiku low / Sonnet low / Opus medium |
| `max5x`, `max20x`, `team-premium`, `enterprise-premium` | Sonnet low / Opus medium / Opus high | Haiku medium → low / Sonnet medium → low / Opus high → medium; steps down below 35% | Haiku low / Sonnet low / Opus medium |
| `api` | Sonnet low / Opus medium / Opus high | Haiku medium / Sonnet medium / Opus high | Haiku medium / Sonnet medium / Opus high |
| `skip` | Sonnet low / Opus medium / Opus high | the same | the same |

Codex (Luna, Sol and Astra are GPT-6; Terra is GPT-6.1):

| Your plan | `full` | `balanced` | `lean` |
| --- | --- | --- | --- |
| `plus`, `business-standard` | Luna high / Sol medium / Sol high | Luna high → medium / Terra medium → low / Sol high → medium; steps down below 50% | Luna medium / Terra low → Luna high, below 60% / Sol medium |
| `pro`, `business-premium`, `enterprise-edu` | Luna high / Sol medium / Astra medium | Luna high → medium / Terra medium → low / Sol high → medium; steps down below 35% | Luna medium / Terra low → Luna high, below 50% / Sol medium |
| `api` | Luna high / Sol medium / Astra medium | Luna high / Sol medium / Sol high | Luna high / Terra medium / Sol high |
| `skip` | Luna high / Sol medium / Astra medium | Luna high / Sol medium / Sol high | the same as `balanced` |

On a subscription plan there is also a last floor for light and standard work: below it, that work moves to your other agent CLI, or Firstmate asks you first if you only have one. The floors are, for light and standard work, Claude Pro 30% and 20%, Max 5x 20% and 10%, Max 20x 15% and 5%, Codex Plus 30% and 20%, and Codex Pro 20% and 10% (the seat plans follow the plan they share a row with). API keys have no floors. Firstmate reads how much quota is left through `quota-axi`, so stepping down needs you signed in to that agent CLI. Terra needs Codex CLI 0.159.0 or newer, which the kit's 0.164.0 is; if Terra is unavailable in an interactive session, choose an available model explicitly (`bin/fm-strategy.sh show` notes this).

**Quiet mode in `balanced` and `lean`.** While you are at the keyboard, these two modes put Firstmate in its quiet mode (`/quiet`):

- Routine updates from the crew are handled in the background, without using one of Firstmate's turns.
- Anything that needs you (a decision, a failure, a sign-in, a pull request ready for review) is collected and reaches you within about 90 seconds in `balanced` and 180 seconds in `lean`.
- If it arrives while Firstmate is in the middle of answering you, it is delivered as soon as that answer ends.
- Nothing that needs you is ever dropped. This works the same on Claude Code and Codex.

Type `/quiet off` if you want every update straight away, and `/quiet` to turn it back on. `full` never uses quiet mode.

**What the kit sets up:** the strategy you picked at question 2c (`lean` or `balanced` unless you chose `full`), fitted to your agent CLIs and plans. The kit asks Firstmate to select it once, at install, in a new Firstmate home. An upgrade sets it up again with a new release's models only if nobody changed it since.

**See or change it:** just ask Firstmate ("what token strategy am I on?", "switch to lean"), or run it yourself:

```sh
cd ~/Agentic/firstmate
bin/fm-strategy.sh list          # compare the three modes
bin/fm-strategy.sh status        # which mode is selected
bin/fm-strategy.sh set balanced  # shows the changes, then asks before applying
```

Choosing a strategy writes Firstmate's worker routing rules (its `config/crew-dispatch.json`), its second-mate model, and its fresh-start setting, and records your choice. It never edits your Claude, Codex or no-mistakes settings. Firstmate detects whether you have Claude, Codex or both and only uses the ones you have.

Once you switch, the kit treats the strategy as yours and never overwrites it. The kit's two extra rules (`check` and `research`, A6.5) stay when Firstmate re-renders its rules. With the key set, Jev routing stays on and uses whatever rules you have.

### A7.5 Where things live

- **Your projects:** `<root>/firstmate/projects/`.
- **Reports, notes and backlog:** under `<root>/firstmate/data/`. The easiest way to see them is to ask Firstmate, or `/bearings`.
- **Worker copies:** `<root>/.treehouse/`. They are created and cleaned up automatically.

### A7.6 Creating your own second mates

A second mate is another long-running Firstmate with its own home folder and its own area of work, for example "all front-end projects". It reports to your first mate.

**During install.** Answer `y` to question 8, give it a name and a one-line scope. The kit creates it at `<root>/secondmates/<name>` but does not start it.

**Easiest later: the key or `fm-mate`.** Inside Herdr, press `Ctrl+B Shift+M`. It opens a **Mates** tab in the **Control Tower** workspace and runs `fm-mate` there (you can also type `fm-mate` in any Herdr pane). It asks:

```text
Name (lowercase letters, digits and -, for example docs or jira):
One-line scope (what this mate owns):
Create <name> at <root>/secondmates/<name> and launch it? (y/N):
```

Nothing is created until you answer `y`. Then it creates the mate with Firstmate's own commands and starts it in its own Herdr space; type in its tab to talk to it. `fm-mate list` shows your second mates. `fm-mate retire <name>` retires one through Firstmate's own teardown, which refuses while the mate still holds unfinished work.

**By hand, from the starter template.** Print the template:

```sh
node "$AK" secondmate-template --print
```

It shows a short charter to fill in:

```text
Responsibility: <describe the work this mate owns>
Scope: <describe the projects and decisions this mate may handle>
```

and the commands to create it, run from your Firstmate home:

```sh
cd ~/Agentic/firstmate
FM_SECONDMATE_CHARTER='<your responsibility and rules>' FM_SECONDMATE_SCOPE='<your scope>' bin/fm-brief.sh <name> --secondmate --no-projects
bin/fm-home-seed.sh <name> <home|-> --no-projects
```

Replace `--no-projects` with your own project names if the mate should own projects. Review the generated charter before you seed it.

**Start it when you are ready:**

```sh
bin/fm-spawn.sh <name> --secondmate
```

Or simply ask your first mate to create and start a second mate for you, describing what it should own.

## A8. Shortcuts and commands

Every shortcut here comes from the help or documentation of the exact versions the kit installs (Herdr 0.9.3, Codex CLI 0.164.0, the pinned Firstmate and tower), from the kit's own code for the kit-managed keys, or from the official Claude Code and Microsoft documentation. Anything that could not be checked that way says **not verified**.

### A8.1 Herdr (the terminal workspace)

Herdr uses a **prefix key**: press `Ctrl+B`, let go, then press the action key. `Ctrl+B ?` shows all keys.

| Keys or command | What it does |
| --- | --- |
| `Ctrl+B ?` | Help: list all keys |
| `Ctrl+B c` | New tab |
| `Ctrl+B n` / `Ctrl+B p` | Next / previous tab |
| `Ctrl+B 1` … `Ctrl+B 9` | Go to tab 1 to 9 |
| `Ctrl+B v` / `Ctrl+B -` | Split the pane side by side / one above the other |
| `Ctrl+B h`, `j`, `k`, `l` | Move to the pane on the left, below, above, right |
| `Ctrl+B Tab` / `Ctrl+B Shift+Tab` | Next / previous pane |
| `Ctrl+B z` | Zoom the pane to full size, and back |
| `Ctrl+B r` | Resize mode |
| `Ctrl+B w` | Workspace picker (Firstmate's work is in the `firstmate` workspace, one tab per task) |
| `Ctrl+B b` | Show or hide the sidebar |
| `Ctrl+B e` | Open the pane's history (scrollback) in an editor |
| Mouse wheel / drag to select | Scroll the pane's history; selected text is copied automatically. Herdr 0.9.3 has no keyboard copy mode |
| `Ctrl+B x` / `Ctrl+B Shift+X` | Close the pane / close the tab (closing ends what runs in it) |
| `Ctrl+B Shift+R` | Reload Herdr's settings (after you or the kit changed them) |
| `Ctrl+B q` | Detach: Herdr and your agents keep running in the background |
| `herdr` | Start Herdr, or reattach to it after a detach |
| `herdr status` | Show whether the Herdr server is running |
| `herdr server stop` | Stop Herdr completely (ends every agent running in it) |

### A8.2 Kit-managed Herdr shortcuts

With question 5 answered yes, the kit adds these keys to your Herdr settings. Press `Ctrl+B`, let go, then the key. `fm-help` (A3 step 9) lists exactly the ones you got.

| Keys | What it does | Added when |
| --- | --- | --- |
| `Ctrl+B F` | Open Firstmate in Claude Code (the **Captain (Claude)** tab in the **Control Tower** workspace) | you chose Claude Code |
| `Ctrl+B Shift+F` | Open Firstmate in Codex (the **Captain (Codex)** tab) | you chose Codex |
| `Ctrl+B Shift+M` | Create a new second mate: opens the **Mates** tab and runs `fm-mate` (A7.6) | always |
| `Ctrl+B Shift+C` | Open the Zoetrope session graph in its own tab | the session graph plugin was added (with the tower) |
| `Ctrl+B Shift+Z` | Show the session graph over the pane you are in (this key comes from the plugin itself) | the session graph plugin was added |
| `Ctrl+B M` | Open the Herdr plugin manager | the plugin manager was added |

How they behave:

- **Firstmate keys:** if the workspace or tab does not exist yet, it is created and Firstmate starts in your Firstmate home. If the tab is an idle shell, Firstmate starts there. If the tab is already running something, the key only switches to it and never types into it. Firstmate does not start a second time while it already runs in this home.
- **Your keys win.** If you had already bound one of these keys yourself, the kit skips it and names it in the summary and the step 4 result.
- **No Herdr default is replaced**, so `Ctrl+B n` (next tab) and Herdr's other keys (A8.1) work as usual.
- **Safe changes.** The kit backs up your Herdr settings file first and checks the result with Herdr's own `herdr config check`; if the check fails, it puts your file back. It keeps its keys in one marked block (`# >>> agent-kit keys` … `# <<< agent-kit keys`). A block you edit is left as you edited it.
- **The plugins** (session graph, the tower's Fleet plugin, plugin manager) are added only while Herdr is stopped. The session graph needs `<root>/.tools/bin` first on your PATH when you start Herdr, because it runs the kit's `zoe`.
- If Herdr was already running when the kit changed its settings, press `Ctrl+B Shift+R` or restart Herdr.

**The Herdr layout (question 5a)** changes Herdr's look: the gruvbox theme, a sidebar that lists agents by priority, a tab bar at the top with the time, borders and gaps between panes, and new panes that open in your root folder. Settings you already had stay yours.

### A8.3 Claude Code

| Keys or command | What it does |
| --- | --- |
| `Esc` | Stop Claude mid-answer so you can redirect it; work so far is kept |
| `Esc` `Esc` | With text typed: clear it (`Up` brings it back). With an empty prompt: open the rewind menu |
| `Shift+Tab` | Switch mode: normal, accept edits, plan (and others when available) |
| `Up` / `Down` | Step through earlier prompts |
| `Ctrl+R` | Search earlier prompts |
| `\` then `Enter`, or `Ctrl+J` | New line without sending (works in every terminal). `Shift+Enter` also works in Apple Terminal, iTerm2 and most Mac terminals |
| `Ctrl+C` | Interrupt; when idle, press twice to exit |
| `Ctrl+D` | Exit (press twice) |
| `Ctrl+O` | Show or hide the full transcript |
| `/clear` | Start a fresh conversation (run Firstmate's `/stow` first) |
| `/compact` | Shrink the conversation to free up context |
| `/exit` | Quit Claude Code |
| `/help` | All commands |
| `/status`, `/model`, `/usage` | Version and account; switch model; plan usage |
| `/resume` | Reopen an earlier conversation |
| `/hooks`, `/rewind`, `/context`, `/doctor` | See hooks; roll back to an earlier point; see context use; check the setup |

Inside Herdr, `Ctrl+B` is Herdr's prefix key, so Claude Code's own `Ctrl+B` (send a task to the background) is most likely taken by Herdr (not verified).

### A8.4 Codex

| Keys or command | What it does |
| --- | --- |
| `$name` | Call a skill by name, for example Firstmate's `$bearings` |
| `Esc` | Interrupt the running turn |
| `Esc` `Esc` | Edit your previous message |
| `Ctrl+C` | Interrupt or close a view; press twice to quit (`Ctrl+D` also quits) |
| `Enter` / `Tab` | Send / queue the message while Codex is busy |
| `Shift+Enter`, `Alt+Enter` or `Ctrl+J` | New line without sending |
| `Ctrl+R` | Search earlier prompts |
| `?` | Show the shortcut overview |
| `/new` | Start a new conversation (run `$stow` first) |
| `/quit` or `/exit` | Quit Codex |
| `/status`, `/model` | Session settings and token use; choose model and effort |
| `/compact` | Shrink the conversation to free up context |
| `/hooks` | Review the kit's hooks (asked the first time) |
| `/resume`, `/diff`, `/review` | Reopen a saved conversation; show changes; review changes |

The Codex rows come from the Codex 0.164.0 source, because its online docs moved to a site that could not be checked.

### A8.5 Firstmate

Type these to Firstmate. In Codex use `$` instead of `/`.

| Claude Code | Codex | What it does |
| --- | --- | --- |
| `/bearings` | `$bearings` | Short summary of what is going on and what needs your decision. `/bearings file` also saves it as a dated report |
| `/ahoy` | `$ahoy` | Catch up since your last message, then go through open decisions one at a time |
| `/afk` | `$afk` | Firstmate keeps supervising while you are away |
| `/quiet` / `/quiet off` | `$quiet` / `$quiet off` | Fewer routine interruptions while you chat / back to normal |
| `/stow` | `$stow` | Save what this session learned before you clear or quit |
| `/updatefirstmate` | `$updatefirstmate` | Update Firstmate. Only when the person who shared this guide asks you to (section 3) |

**Plain-language asks work too**, for example: "what's going on?", "fix the flaky login test in my project", "merge it", "switch to balanced", "what token strategy am I on?", "create a second mate for all front-end projects", "stop that task".

**The kit's own commands** (`firstmate`, `fm-mate`, `fm-help`, `fm-jev` and others) are typed in a terminal or Herdr pane, not to Firstmate: see A6.6.

### A8.6 Tower Team tab

Open it with `zoe-fleet-open` (or the launcher's `open`) from a Herdr pane (A9). Inside the **Team** tab:

| Keys | What it does |
| --- | --- |
| `?` | Help |
| `Tab`, arrow keys or click | Select a card |
| `Enter` / `Esc` | Open the selected session / back to the fleet |
| `i` | Session details |
| `Space` | Pause or play the timeline |
| `[` / `]` | Step to the previous / next event |
| `g` or `End` | Back to live |
| `o` / `f` | Overview / follow |
| `v` | Show or hide finished workers |
| `q` or `Ctrl+C` | Quit the tab |

Avoid `A`, `D` and `C` unless you mean it: they archive the selected worker, delete it (asks first) and clear everything. These keys come from the tower's source and docs; they are not confirmed on a real run yet.

## A9. The tower (zoe-fleet)

The tower shows your fleet: your Firstmate and its crew and second mates, in a **Team** tab inside Herdr.

The kit installs and configures the tower but never starts it. The launcher is:

```sh
~/Agentic/.tools/releases/<release>/zoe-fleet-runtime/bin/zoe-fleet-tower
```

Check it first:

```sh
~/Agentic/.tools/releases/<release>/zoe-fleet-runtime/bin/zoe-fleet-tower doctor
```

Then, **from inside a Herdr pane**, open it with the kit's short command:

```sh
zoe-fleet-open
```

or with the full launcher path:

```sh
~/Agentic/.tools/releases/<release>/zoe-fleet-runtime/bin/zoe-fleet-tower open
```

`open` links the tower into Herdr, and a **Team** tab appears. `zoe-fleet-demo` runs the launcher's own demo.

**Opening by itself.** With the tower and Claude Code, the kit adds a start-up entry in your Firstmate home: when Firstmate starts in Claude Code in a Herdr pane, the tower's tab opens once for it. It never takes the tower away from a Firstmate that is already running, and skips a pane that is not in focus.

**The Claude usage bridge.** With the tower and Claude Code, the kit's `claude` command (A6.6) sits in front of your own Claude Code and passes Claude's usage and status to the tower. Claude Code itself works as usual.

**The Zoetrope session graph** (`Ctrl+B Shift+C` and `Ctrl+B Shift+Z`, A8.2) is a separate Herdr plugin that shows your sessions as a graph. It comes with the tower.

**What "partial" means.** The installer and doctor show the tower as `installed from verified release; hands-on acceptance pending`, and the install summary says `partial`. "Partial" is only a testing label: it means the tower's separate hands-on test has not been run for this release yet. Everything else, the tower included, installed and was verified normally, and setup still ends with `Agent Kit setup complete.` Nothing is broken on your Mac. The same label appears on Windows.

No real Mac has run the tower, the session graph or the automatic opening from this release yet. If you try them, please include what you saw in your pilot feedback (section 4).

## A10. Troubleshooting

### A10.1 Common install problems

| You see | What to do |
| --- | --- |
| `Install these yourself first…` | Install what it lists, open a new Terminal window, re-run `bash install.sh` |
| `Node.js … is older than 24.15.0` | Update Node (`brew upgrade node`, or from nodejs.org). With nvm: `nvm install 24` |
| `sign in to GitHub with your own account first` | `gh auth login`, then re-run |
| `could not fetch the kit` | You probably do not have repository access yet. Ask for it. Never share a token to get around this. |
| A checksum or digest mismatch | **Stop.** Do not work around it. Re-run once (a broken download can cause it). If it happens again, send the message (A10.6). |
| Step 2 `partial` with `conflict` | Something already exists that the kit will not overwrite, for example your own `~/.config/zoe-fleet/config` or your own skill with the same name. Re-run with `--reconfigure` and answer `n` to the tower (question 4) or hooks (question 5), or move your own file aside if you no longer need it. |
| `refused` root folder | Pick a new, empty folder that is not inside a git checkout or another Firstmate home |
| `FAIL <tool>-path` in doctor | Fix your PATH (A2.7) |
| The receipt records a different kit release | Your install is on an older release than the installer. Use upgrade (A6.3), or ask for help. |
| `repair needs the current installed release; use upgrade for a new release` | You ran an older kit copy after an upgrade. Set `AK` to the new kit copy (A6) |
| `the installed kit predates the keys command` | Your install is older than `pilot-7`. Ask the person who shared this guide; upgrade only when asked (A6.3) |
| `TYPESAFE_API_KEY must be an 8–512 character token…` | The key you typed has spaces or extra characters. Copy it again from typesafe.ai and rerun `keys` (A6.5) |
| `WARN jev: not ready: …` in doctor | Normal without a key. With a key, read the reason: add the key (A6.5), fix your PATH (A2.7), or, if you edited the rules file, ask Firstmate to check it |
| `python3` or `jq` missing | Install python3 with `xcode-select --install` (or update the Xcode Command Line Tools), and jq with `brew install jq`, then re-run |
| Step 4 says `Herdr is running and owns …; stop it (herdr server stop) and rerun` | Stop Herdr with `herdr server stop` (let your agents finish first), then re-run `bash install.sh` (A5) |
| Step 4 says `skipped prefix+…: already bound` | You already use that key in Herdr. Nothing to do; the kit leaves yours. Use the command instead (A6.6) |
| Step 4 says `herdr config check rejected …, so … was restored` | Your Herdr settings file was put back as it was. Send the message (A10.6) |
| `Claude plugins: not installed; the claude CLI was not found on PATH` | Make sure `claude` runs in a new Terminal window, then re-run the installer |
| `Claude plugins: marketplace … not added: …` | Usually a network problem; re-run the installer. If it repeats, send the message (A10.6) |

### A10.2 PATH and Terminal

- **Changing your login shell:** uninstall the kit, then reinstall it from the new shell so its PATH block goes into that shell's profile.
- **`herdr` or `codex` not found, or an old version runs:** the PATH line from A2.7 is missing or not first. If you said yes to question 5b the kit put it in your profile: open a new Terminal window, or run `agent-kit repair` if the block is gone. Otherwise add it to `~/.zshrc` yourself.
- **`firstmate`, `fm-mate` or `fm-help` not found:** `<root>/.tools/bin` is not on your PATH (A2.7), or you said `n` to question 5.
- **`Open a Herdr pane, then run firstmate (or press Ctrl+B, then F).`:** `firstmate` only starts Firstmate inside Herdr. Run `herdr` first.
- **`Exit the current coordinator cleanly before switching.`:** Only one Firstmate can run in a home; do not open both Captain tabs at once. Switch to its tab, or quit it, before starting another.
- **Firstmate says treehouse, no-mistakes, gh-axi or other tools are missing, or doctor shows `WARN herdr-path-env`:** Herdr was already running before you added the PATH line, so it kept its old PATH. Run `herdr server stop`, then start `herdr` again from a Terminal window that has the PATH line (A2.7).
- **A Herdr key does nothing:** check `fm-help` for the keys you actually got. Press `Ctrl+B Shift+R` to reload Herdr's settings, or restart Herdr. The session graph keys need Herdr started from a Terminal window whose PATH has `<root>/.tools/bin` first.
- **Changes to `~/.zshrc` do nothing:** open a new Terminal window, or run `source ~/.zshrc`.

### A10.3 "Kit services are running"

Repair, upgrade and uninstall will not run while Herdr, the no-mistakes daemon or the tower is running. They never stop these for you. The plan shows a `Running <name>: ...` line for each one, with the step to take. This also happens if you run the command from a pane inside Herdr, so use a normal Terminal window.

First let your agents finish their work, or stop it: stopping Herdr or the daemon ends any agent or check that is still running. Then:

- **Herdr:** run `herdr server stop`.
- **no-mistakes daemon:** run `no-mistakes daemon stop`.
- **The tower:** close the Fleet pane in Herdr's **Team** tab (`herdr pane close <pane-id>`). The tower has no stop command of its own.

Then run the command again.

### A10.4 Firstmate home has local changes

Upgrade refuses before changing anything if your Firstmate home has uncommitted changes to its tracked files, is not on the Firstmate version the kit expects, or has an `origin` remote other than the approved Firstmate copy the kit uses. The message says which case applies. The kit will not reset the home.

- Ask Firstmate what the changes are and whether they are needed.
- Save anything you want to keep, then discard the changes, or put the home back on the expected version (the message names the commit).
- If `origin` was changed, set it back to the approved Firstmate copy the message names. Doctor's `firstmate-fork` row also names it, and shows `WARN` until `origin` is right.
- Firstmate updates only through `/updatefirstmate`, which updates from that approved copy.
- Run upgrade again.

**If `/updatefirstmate` was run without being asked** and Firstmate is now newer than the version the kit expects, doctor shows `FAIL firstmate` and upgrade refuses. Do not reset the home yourself. Send the redacted doctor output (A10.6) and wait for a kit release that expects the newer Firstmate, then run upgrade.

Repair still runs in these cases and just reports them.

**Your help page or the tower's start-up entry** are files the kit adds to your Firstmate home, but they never show up as changes there: `data/` is private to you, and the kit lists `.claude/settings.local.json` in the home's own git exclude list.

### A10.5 Anything else

1. Run doctor (A6.1) and read any `FAIL` line.
2. If a kit file is missing or changed, run repair (A6.2). For a failed install, re-run the installer (A5). Both are safe.
3. If it still fails, send redacted diagnostics (A10.6).

### A10.6 Sending diagnostics safely

Collect:

```sh
node "$AK" doctor --json > ~/kit-doctor.json
```

and copy the **text** of the error from your Terminal.

Before you send anything, **redact**:

- Replace your user name and home path (for example `/Users/<you>`) with `~`.
- Replace your root folder path with `<root>`.
- Remove any project names you do not want to share.
- Make sure there is no token, key, password, email or sign-in code anywhere in it.

Send only the redacted doctor output and the error text. **Do not send** your `receipt.json`, any `.env` file, anything from `~/.claude`, `~/.codex` or `~/.config`, or screenshots of sign-in pages.

### A10.7 Not confirmed yet on macOS, and pilot feedback

No one has yet installed this release on a real Mac. The automated tests pass, but these are not confirmed by a real run yet:

- `install.sh` from start to finish on your own Mac, including the plan questions, the full-access question and the hidden key prompt.
- The kit's Herdr keys, the Control Tower tabs they open, and `fm-mate` creating and starting a second mate (A8.2, A7.6).
- The Herdr plugins (session graph, plugin manager) and the Herdr layout.
- The Claude plugins installing through your own `claude`, and the full-access Codex launch with real Codex workers.
- The tower's `doctor` and `open` from a Herdr pane, and its tab opening by itself (A9).
- Jev routing giving a clear answer once you are signed in to your agent CLI (A6.5).
- Quiet mode delivering Firstmate's collected messages at the end of a turn, and the models stepping down as your quota runs low (A7.4).

Your own install is that first real run. When you are done, send your pilot feedback (section 4) to the person who shared this guide.

## A11. Note for Linux

On Linux (glibc, x64 or arm64) the kit uses the same `install.sh` and the same commands as Part A, with these differences:

- **Prerequisites:** no Xcode tools or Homebrew. Install Node.js 24.15.0 or newer, git, the GitHub CLI and **python3 3.9 or newer** (required; for example `sudo apt install python3`) with your package manager or from <https://nodejs.org/en/download> and <https://cli.github.com>.
- **PATH:** the kit's PATH block goes into `~/.bashrc` (bash) or `~/.zshrc` (zsh) for you if you said yes to question 5b. By hand, add the `export` line to `~/.bashrc` (or your own shell's profile) instead of `~/.zshrc`.
- **Home path** in diagnostics is `/home/<you>`.
- **No tower launcher yet.** There is no reviewed Linux tower release. The kit builds the tower program from its checked source only if you already have Rust (`cargo`) installed, and it never configures a launcher, so A9 does not apply and `~/.config/zoe-fleet/config` is not written. If you say yes to the tower (question 4), step 2 reports `partial` because of this; that is expected. Say `n` if you do not need it. Without a tower launcher there is no `zoe-fleet-open`, no automatic tower tab and no tower Fleet plugin; whether the session graph keys work on standalone Linux is not confirmed.
- The kit's commands, the other Herdr keys and plugins, the layout and the Claude plugins work as in Part A.
- Musl-based Linux (for example Alpine) is not supported yet.

---

# Part B: Windows (WSL2)

On Windows, the agents run inside **WSL2**: a real Linux system (Ubuntu) inside Windows. There is no native Windows install. You start the install from PowerShell, and it then hands over to Ubuntu.

**Two terminals, two sign-ins.** In this part you use two kinds of terminal. Each step says which one:

- **PowerShell** (Windows): only to set up WSL2 and to start the installer.
- **Ubuntu** (Linux, inside WSL2): for everything else, including all day-to-day kit commands and Firstmate. Open it from the Start menu (**Ubuntu**), or best, in **Windows Terminal** with the **Ubuntu** profile.

Windows and Ubuntu are separate computers as far as tools and sign-ins go. You install git, Node.js and the GitHub CLI **on both sides**, and sign in to GitHub **on both sides**.

## B1. Before you install

**Use your own PC and your own normal Windows login.** You do not need a separate test account. You do **not** need administrator rights for the kit itself; only the one-time WSL2 setup (B2.1) needs an administrator PowerShell.

You install these yourself first. The installer checks them and tells you what is missing; it never installs them.

**On Windows:**

| You need | Minimum | How to get it (in PowerShell) |
| --- | --- | --- |
| Windows | Windows 10 version 2004 (build 19041) or newer, or Windows 11 | Settings → Windows Update |
| WSL2 with Ubuntu | Ubuntu 22.04 or newer | see B2.1 (`wsl --install -d Ubuntu` installs a current version; check with `lsb_release -d` inside Ubuntu) |
| git | — | `winget install --exact --id Git.Git` or <https://git-scm.com/download/win> |
| GitHub CLI (`gh`) | — | `winget install --exact --id GitHub.cli` or <https://cli.github.com> |
| Node.js | 24.15.0 | `winget install --exact --id OpenJS.NodeJS.LTS` or <https://nodejs.org/en/download> |
| Recommended: Windows Terminal | — | from the Microsoft Store |

**Inside Ubuntu:**

| You need | Minimum | How to get it (in Ubuntu) |
| --- | --- | --- |
| git | 2.20.0 | `sudo apt update && sudo apt install -y git` |
| Node.js | 24.15.0 | with nvm (<https://github.com/nvm-sh/nvm>, then `nvm install 24`) or NodeSource (<https://github.com/nodesource/distributions>). **Not** `sudo apt install nodejs`: Ubuntu's own package is far too old |
| GitHub CLI (`gh`) | 2.0.0 | <https://github.com/cli/cli/blob/trunk/docs/install_linux.md> |
| python3 | 3.9 | `sudo apt install -y python3` (Ubuntu 22.04 and newer already include it). **Required**: the kit's own commands run on it |
| For the tower: jq | — | `sudo apt install -y jq` (see below) |
| Optional: Claude Code | 2.1.293 | <https://code.claude.com/docs/en/setup> (an older Claude Code cannot run the models the routing rules use). Needed for the Claude plugins |

**Optional on Windows:** Figma Desktop (<https://www.figma.com/downloads/>), only if you work with Figma.

The kit installs the Codex CLI itself (version 0.164.0), inside Ubuntu, so you do not install Codex first. If you say yes to Figma, it also installs the Figma CLI itself inside Ubuntu.

**For the tower (question 4):** the tower's own health check and Firstmate's fleet view need python3 (required anyway) and jq inside Ubuntu. If jq is missing, the installer shows a `tower-jq` warning; it does not stop the install.

**Stop Herdr first if you already run it inside Ubuntu.** The kit adds its Herdr plugins only while Herdr is stopped (`herdr server stop`). If Herdr is running, the install still finishes and tells you to stop Herdr and run the installer again to add them.

You also need:

- **Access to the kit's GitHub repository.** It is private. Ask for access before you start.
- **About 15–30 minutes**, most of it downloads, plus a restart if you set up WSL2 for the first time.
- **Optional:** your own `TYPESAFE_API_KEY` from <https://console.typesafe.ai/keys>, if you want Jev routing (B6.5). You can also add it later.

**Why Ubuntu 22.04 or newer:** the Windows tower release is built for Ubuntu 22.04, so it needs that version or newer to run (B9). Older Ubuntu versions are not supported.

## B2. Install

### B2.1 Set up WSL2 (once)

Skip this if you already have WSL2 with Ubuntu.

In an **administrator** PowerShell (right-click PowerShell → **Run as administrator**):

```powershell
wsl --install -d Ubuntu
```

Restart Windows. Open **Ubuntu** from the Start menu once, and create your Linux user name and password when asked. This Linux password is only for Ubuntu; it is not your Windows password.

Close the administrator window. You do not need administrator rights again.

**Check your PC** in a normal PowerShell window (note the answers for your pilot feedback, section 4):

```powershell
winver
$env:PROCESSOR_ARCHITECTURE
wsl -l -v
wsl -e grep VERSION_ID /etc/os-release
```

`winver` shows your Windows version and build. `$env:PROCESSOR_ARCHITECTURE` prints `AMD64` on an x64 PC (most PCs) or `ARM64`. `wsl -l -v` must show Ubuntu with `VERSION` `2`. `VERSION_ID` must be `22.04` or newer.

### B2.2 Prepare Ubuntu

In the **Ubuntu** terminal:

1. Install git, Node.js 24.15.0 or newer, the GitHub CLI, python3 and (for the tower) jq (see the table in B1). Check python3 with `python3 --version`.
2. Sign in to GitHub **inside Ubuntu**:

   ```sh
   gh auth login
   ```

3. Check that all three are found. This exact check matters, because the installer starts Ubuntu this way:

   ```sh
   bash -lc 'node --version; git --version; gh --version'
   ```

   You can run the same check from PowerShell: `wsl -e bash -l -c 'node --version; git --version; gh --version'`.

   If `node` is "not found" here but works in your normal Ubuntu window, Node is only set up for interactive windows (common with nvm). Use NodeSource instead, or load nvm from `~/.profile`, so that this check prints a version, then continue.

### B2.3 Prepare Windows

In a **normal (not administrator)** PowerShell window:

1. Install git, Node.js and the GitHub CLI (see the table in B1), then **open a new PowerShell window** so they are found.
2. Check them:

   ```powershell
   node --version; git --version; gh --version
   ```

3. Sign in to GitHub **on Windows** too:

   ```powershell
   gh auth login
   ```

### B2.4 Download the installer

Still in the **normal PowerShell** window, make an empty folder for the installer file, go into it, and download it:

```powershell
mkdir $HOME\agent-kit-installer; cd $HOME\agent-kit-installer
gh api -H "Accept: application/vnd.github.raw" "repos/amelie-pierce/agent-kit/contents/install.ps1?ref=main" > install.ps1
```

Keep the `install.ps1` file. You use it again to resume (B5).

> **Windows: if the install seems frozen.** In the classic PowerShell window, clicking or selecting text inside the window turns on "QuickEdit" selection, which **pauses the program** until you clear it. The install is not stuck. Press **Esc** (or right-click) to clear the selection and it continues. Avoid clicking in the window while the installer runs. To turn this off for good: right-click the window's title bar → **Properties** → **Options** → untick **QuickEdit Mode**. Windows Terminal does not have this problem.

### B2.5 Recommended first step: a check-only run

From the same folder, in **PowerShell**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
```

`-ExecutionPolicy Bypass` applies only to that one PowerShell window; your computer's setting does not change.

On Windows, `-DryRun` **does not ask the setup questions**. It:

1. asks the root folder question (B2.7),
2. checks git, gh and Node on Windows, your GitHub sign-in, Windows and WSL2,
3. prints `Agent Kit install (Windows): handoff-ready` and the exact `wsl.exe …` command that would hand over to Ubuntu, and **runs nothing** inside Ubuntu.

If WSL2 is not ready, it prints the exact command for you to run yourself (B10.2).

The printed handoff command includes `--dry-run`. To see every question (including the plan questions) and the full summary without writing anything, copy that printed command and paste it into the same PowerShell window. It ends with `Dry run: nothing was written.` It never asks for the key.

### B2.6 The real install

From the same folder, in **PowerShell**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

What happens:

1. **In PowerShell:** it asks the root folder question, checks git, gh and Node on Windows and your GitHub sign-in, and downloads the reviewed kit with your own Windows `gh` sign-in.
2. **It checks WSL2** and your Ubuntu distribution.
3. **It hands over to Ubuntu.** From here on the installer runs inside Ubuntu, using your **Ubuntu** `gh` sign-in, but its questions still appear in the **same PowerShell window**. Answer them there.

If you see `install the GitHub CLI inside this WSL distribution`, go back to B2.2.

### B2.7 The root folder question

The first question, asked in PowerShell, is:

```text
1. Root folder for your agent setup inside WSL (holds firstmate/, .tools/, .treehouse/ and .zoe-fleet/) [~/Agentic]:
```

Press **Enter** for the default `~/Agentic`, then `y` to confirm. Choose a different, **new** folder if you already have something at `~/Agentic` inside Ubuntu.

This is a **Linux path inside Ubuntu**, not a Windows folder. `~/Agentic` means `/home/<you>/Agentic` in Ubuntu. The root:

- must be a Linux path, such as `~/Agentic` or `/home/<you>/Agentic`, using only letters, digits, `.`, `_`, `-` and `/`;
- must **not** be a Windows drive under `/mnt` (such as `/mnt/c/...`) or a Windows path (such as `C:\...`), so Windows and Linux files and sign-ins stay separate;
- must not be your Ubuntu home folder itself, a system folder, inside a git checkout, or inside an existing Firstmate home.

Once installed, the root cannot be moved by a re-run.

### B2.8 The questions

The other questions are asked after the handoff (still in the same window). Every question shows its default in brackets. Press Enter to accept it.

| # | Question | Default | Change it when… |
| --- | --- | --- | --- |
| 1 | Root folder | `~/Agentic` | that folder is already in use (asked in B2.7) |
| 2 | Agent CLIs: `codex`, `claude` or `claude,codex` | `codex` | you use Claude Code (only asked if Claude Code is already installed **inside Ubuntu**) |
| 2a | Your Claude subscription plan (only if you chose Claude) | `skip` | you know your plan; see "The plan questions" below |
| 2b | Your Codex (ChatGPT) subscription plan (only if you chose Codex) | `skip` | you know your plan; see below |
| 2c | Routing mode for Firstmate: `lean`, `balanced` or `full` | depends on your plan | see below |
| 2d | Use the full-access Codex launch? (only if you chose Codex) | **yes** | say `n` if you want Codex to keep asking before it acts (see below) |
| 3 | Figma support | yes | say `n` unless you work with Figma |
| 4 | Fleet tower | yes | say `n` if you do not need the tower, or your Ubuntu is older than 22.04 (B9) |
| 5 | Register global hooks and skills (this also covers the kit's commands, Herdr keys, Herdr plugins and Claude plugins) | yes | say `n` only if you want none of these (see below) |
| 5a | Herdr layout (only if you said yes to 5) | yes | say `n` to keep Herdr's own look |
| 5b | Add the kit's PATH block to your shell profile | yes | say `n` if you manage your own PATH and will add the line from B2.11 yourself |
| 6 | GitHub account or organization for your projects | your `gh` login | you work under an organization. Recorded only; nothing is created on GitHub |
| 7 | Git name and email: keep as is? | keep | your **Ubuntu** git name or email is wrong. Changing it runs `git config --global` inside Ubuntu |
| 8 | Create a starter second mate now? | no | you already know what your first second mate will do (see B7.6) |
| 9 | Update channel: `releases` or `main` | `releases` | almost never. `releases` gets only owner-approved releases |
| 10 | Add optional `TYPESAFE_API_KEY` now? | no | you want Jev routing and have your key ready (B6.5) |

**About question 2d: the full-access Codex launch.** Asked only if you chose Codex. Before the question, the installer shows this warning:

```text
2d. Full-access Codex launch: Codex workers that Firstmate starts can read and write anything your user account can, run any command without asking you first, and run hooks without the hook trust review. This matches the kit owner's own setup. Answer no to keep Codex's normal sandbox and approval prompts.
2d. Use the full-access Codex launch (y/n) [y]:
```

The default is **yes**, as on the kit owner's own setup. Read the warning before you press Enter. "Your user account" here means your **Ubuntu** account, which can also reach your Windows files through `/mnt/c`.

- **With yes:** the kit adds its own `codex` command in `<root>/.tools/bin` inside Ubuntu. When Firstmate starts a Codex worker, that worker runs with full access and no approval prompts, and skips the hook trust review. Firstmate in Codex, started with `firstmate codex` or `Ctrl+B Shift+F`, also runs with full access, but still asks you to review hooks (`/hooks`). Running `codex` yourself for anything else works as normal. The kit never edits your Codex settings.
- **With no:** Codex keeps its normal sandbox and asks before it acts.
- **To change it later:** re-run `install.ps1` with `--reconfigure` and answer again, or add `--no-codex-full-access` to the `install.ps1` command line to turn it off. Doctor shows `codex full-access launch: on` or `off` (B6.1). Uninstall removes the kit's `codex` command.

**About question 5.** If you say yes, the kit, inside Ubuntu:

- adds small start-up hooks to `~/.claude/settings.json` and `~/.codex/hooks.json`, turns on hooks in `~/.codex/config.toml`, and links its helper skills into `~/.claude/skills/` and `~/.agents/skills/`. These are files in your **Ubuntu** home, not in Windows. The hooks run in **every** Claude Code and Codex session inside Ubuntu; the `gh-axi` and `chrome-devtools-axi` hooks do nothing outside your Firstmate home;
- writes its own commands into `<root>/.tools/bin` (B6.6);
- adds a block of Herdr keys to your Herdr settings file (B8.2);
- adds three Herdr plugins: the Zoetrope session graph and the tower's Fleet plugin (with the tower), and the Herdr plugin manager;
- with Claude Code, installs the kit owner's Claude Code plugins (see "The Claude plugins" below);
- with Figma, links the Figma CLI's three skills (`figma-cli`, `figma-make`, `figma-make-team`).

The list of files and links it will touch is shown before the question. Your own hooks, settings, keys and plugins stay. Each file is backed up first. If you already have your own skill with one of the same names, this step stops and reports a conflict instead of overwriting it. With `n`, none of the above is set up: no kit commands, no Herdr keys, no plugins.

**About question 5b: the PATH block.** Yes adds **one marked block** at the end of your Ubuntu profile (`~/.bashrc` for bash, or `~/.zshrc` for zsh), chosen from your login shell inside Ubuntu. It never touches the Windows profile; other shells, symlinked profiles and profiles with damaged kit markers are left alone. The summary shows the exact block under "Files outside the root". It is the same `export PATH=…` line as in B2.11, between `# >>> agent-kit PATH >>>` and `# <<< agent-kit PATH <<<`. An existing file is backed up first and nothing outside the block is changed; running the installer again never adds a second block, and repair and upgrade keep an unchanged block current when the release folder changes. Uninstall removes the block if you have not edited it, and says so if you have. If the profile changes after the kit reads it, the kit stops at its first detected change, leaves your edit untouched, names the file, and ends with an error so you can re-run the command. A save between the kit's final check and its file replacement can still be lost. On a new install, say `n` or use `--no-shell-profile` to skip the block and add the line from B2.11 yourself. `--shell-profile` turns it on explicitly. On a rerun, skipping leaves an existing kit block in place for uninstall.

**About question 5a: the Herdr layout.** Yes adds the kit owner's Herdr look as one marked block in your Herdr settings inside Ubuntu: the gruvbox theme, sidebar, tab bar and pane settings, new panes opening in your root folder, and Herdr's first-run tour turned off. A section you already set yourself is left out and named. Uninstall removes the block.

**The Claude plugins** (only if you chose Claude Code and said yes to 5). The kit installs them inside Ubuntu with your own `claude` command, from fixed versions the kit owner reviewed:

| Plugins | What you need to do |
| --- | --- |
| `codex` (OpenAI's Codex plugin), `cc-gemini-plugin`, `code-review`, `code-simplifier`, `commit-commands`, `frontend-design`, `security-guidance`, `skill-creator`, `superpowers`, `typescript-lsp`, `rust-analyzer-lsp` | nothing |
| `chrome-devtools-mcp`, `playwright` | nothing; they download a fixed version of their tool from npm when first used |
| `data-engineering` | nothing; it downloads Python packages when used |
| `atlassian` | sign in to Atlassian yourself, in the plugin's own sign-in |
| `figma` | sign in to Figma yourself, in the plugin's own sign-in |
| `context7` | it may ask for your own Context7 key; the kit never writes one |
| `figma-cli` (only with Figma) | nothing |

If you already have one of these plugins, or the `claude-plugins-official` marketplace, the kit leaves yours as it is; doctor then shows a warning if your marketplace version differs from the kit's. Uninstall removes only what the kit added.

**The plan questions (2a, 2b, 2c).** The kit asks which subscription you have for each agent CLI you chose, so that Firstmate (and Jev, once you add the key) picks models your plan can afford. Only the plan's name is saved; the kit never checks your account. If you are not sure, press Enter for `skip`.

| Your plan | What the kit does with it |
| --- | --- |
| **Smaller plans:** Claude `pro`, `team-standard`, `enterprise-standard`; Codex `plus`, `business-standard` | Cheaper models for light and standard work (Claude: Haiku for light, Sonnet for standard; Codex: Luna for light, Terra for standard), so your quota lasts. Routing mode defaults to `lean`, and the kit warns you before `full`, because `full` can use up your five-hour limit and then your weekly limit |
| **Larger plans:** Claude `max5x`, `max20x`, `team-premium`, `enterprise-premium`; Codex `pro`, `business-premium`, `enterprise-edu` | In `balanced` and `lean`, the same cheaper models as smaller plans, at higher effort while your weekly quota is healthy; in `full`, stronger models for standard work (Claude: Opus; Codex: Sol). Routing mode defaults to `balanced` |
| **Pay per use:** `api` (an API key, including usage-based Enterprise) | Cheaper models for light work, as on smaller plans. Routing mode defaults to `lean` |
| `skip` (not sure) | Firstmate's own standard rules, unchanged. Routing mode defaults to `balanced` |

On every plan, hard work stays on the strongest model the plan routes (on Claude Opus 5.5; on Codex GPT-6 Sol, or GPT-6 Astra in `full` on the larger plans), and checking (validation) always runs at high effort. The exact models for each plan and mode are in the token tables (B7.4).

**If Codex is your only agent CLI.** Work pauses when your weekly Codex quota is used up, and resumes after the quota resets. The kit never switches to another provider you have not set up. On Codex Plus, choose `lean`.

**Routing mode (2c)** is Firstmate's token strategy (B7.4). Before the question the installer shows what each mode means:

```text
2c. Firstmate token strategy modes:
   full: unlock full power
   balanced: optimize for token saving while everything still work
   lean: harder optimization for token saving while everything still work
```

At install the kit asks Firstmate to select that strategy for the agent CLIs and plans you chose (Firstmate's own `bin/fm-strategy.sh set <mode> --plans …`). That decides which agent and model each kind of job gets, and how much Firstmate starts on its own. The kit only does this in a new Firstmate home; it never overwrites a strategy or routing rules that already exist. Press Enter for the suggested mode (`lean` or `balanced`; the kit never suggests `full`) unless you know you want another. You can switch at any time later (B7.4).

**Question 10** is skipped on a dry run, and is not asked again once a key is set. If you prefer, answer `n` here and add the key later from your Ubuntu terminal (B6.5). See B6.5 for what happens when you say yes.

### B2.9 The summary screen

Before anything is written you see:

```text
Agent Kit setup summary. Nothing has been written yet.
Answers:
  ...
Derived paths:
  ...
Files outside the root that will be touched:
  ...
Will install (pinned and verified; nothing is downloaded until you say yes):
  ...
Person-installed prerequisites (checked, never installed):
  ...
Write these changes now (y/n) [n]:
```

All paths shown are inside Ubuntu. **Read "Files outside the root that will be touched".** It lists your Claude and Codex settings, your Herdr settings file with the exact keys the kit will add (for example `prefix+shift+f open-firstmate codex`, `prefix+shift+m open-firstmate mates`), and the tower's settings file. If something there surprises you, answer `n` (the default) and nothing changes. If a prerequisite is missing, the screen says `Stopped before any change` and tells you what to install inside Ubuntu.

Under `Answers:` you also see `2d. Full-access Codex launch: ON - Codex workers can read and write anything your account can, run commands without asking and run hooks without the trust review` (or `off`), and `5a. Herdr layout settings: on` (or `off`).

The key never appears, only its state: `10. Optional TYPESAFE_API_KEY: not set`, `will set` or `set`. A following line says how your routing mode will be set up, for example `Starter dispatch rules: will select Firstmate's lean strategy for codex with bin/fm-strategy.sh --plans`.

### B2.10 The eight steps

After you answer `y`, each step prints `Step N of 8:` and then a result.

| Step | What it does | Good result |
| --- | --- | --- |
| 1 | Places the kit itself at its reviewed commit | `complete` |
| 2 | Downloads and checks every tool, creates your Firstmate home and selects its strategy (2c), sets up hooks, the tower if you chose it, and (with Figma) the Figma CLI | `complete` (see note) |
| 3 | Installs the Treehouse wrapper so worker copies go under your root | `complete` |
| 4 | The kit's commands, Herdr keys, layout and plugins, the Claude plugins, your starter help page, and the PATH block if you chose 5b | `complete` (it names what it added) |
| 5 | Your git name and email | `complete: kept as it is` (or set) |
| 6 | Starter second mate | `not-selected` unless you asked for one |
| 7 | Shows the sign-ins you do yourself | `complete: shown` |
| 8 | Health check (doctor) | see B6.1 |

**Note on step 2:** with the tower, the tower installs inside Ubuntu like on macOS and shows `tower: installed from verified release; hands-on acceptance pending`, plus a `Tower launcher:` line with the launcher path. You will also see `Agent Kit install: partial`: that is only the testing label explained in B9, and setup still ends with `Agent Kit setup complete.` Every other component should say `installed`. If your Ubuntu is older than 22.04, the tower line says `refused: the WSL2 tower release needs Ubuntu 22.04 or newer` instead and step 2 reports `partial` (B10.1); everything else still installs.

**Note on step 4:** it lists each piece it placed. If Herdr was running inside Ubuntu, it says the Herdr plugins were not added yet: stop Herdr with `herdr server stop` and run `install.ps1` again (B5). If you had already bound one of the kit's keys yourself, it says it skipped that key. With `n` to both questions 5 and 5b, this step says `not-selected`; question 5b is independent of question 5.

Every download is checked against a fixed checksum before use. No service or agent is started.

The install ends with one of:

- `Agent Kit setup complete.`
- `Agent Kit setup finished; some tools are partial and are retried on rerun.`
- `Agent Kit setup finished with failures.` If its next line says an older copy of a tool comes first on PATH, open a new terminal and run doctor again.

It then prints a short `Next steps:` list. **Save it**, especially:

- **Step 1: your PATH** inside Ubuntu. With question 5b answered yes, it says `Open a new terminal` and names the Ubuntu profile file the kit added its PATH block to. With `n` (or an unsupported shell) it lists the folders to add yourself (B2.11).
- **Step 4, only if needed:** if Herdr was already running inside Ubuntu and cannot see the kit tools, the list shows how to restart it (B3 step 4). The installer never stops Herdr for you.
- **Step 2: the `Health check later:` line.** This is your doctor command (B6.1).

Steps 3 to 5 are the start-up steps in B3 (do them in Ubuntu, not PowerShell). The list ends with `Start-up walkthrough: see "After a successful install: start it up" in the Agent Kit guide.`: that is section B3 of this guide.

### B2.11 Add the kit to your PATH (in Ubuntu)

The installer prints four Linux folders, or five if you chose Figma. With the default root they look like this:

```sh
R="$HOME/Agentic"
export PATH="$R/.tools/bin:$R/.tools/releases/<release>/bin:$R/.tools/releases/<release>/npm/node_modules/.bin:$R/.tools/releases/<release>/npm-codex/node_modules/.bin:$PATH"
```

With Figma, the fifth folder is `$R/.tools/releases/<release>/npm-figma/node_modules/.bin`. Use the exact folders your installer printed. Run this in an **Ubuntu** terminal to try it. With question 5b answered yes, the kit has already added this line to your Ubuntu profile as a marked block and you can skip this section. Otherwise, when you are happy, add the same `export` line to `~/.bashrc` **inside Ubuntu**.

**Keep `<root>/.tools/bin` first.** It holds the kit's own commands (B6.6), the Treehouse wrapper, the `zoe` program the session graph needs, and, if you chose them, the kit's `codex` (full-access launch) and `claude` (tower) commands. If another folder comes first, those do not run.

Do not add these folders to the Windows PATH. They are Linux programs and only run inside Ubuntu.

If you already had Codex or Herdr installed inside Ubuntu some other way, the kit's versions only win once these folders come first on your PATH.

### B2.12 Sign in yourself (in Ubuntu)

Step 7 lists what to sign in to. Do each one yourself, in your **Ubuntu** terminal. When a sign-in opens a web page, it opens in your Windows browser; that is normal.

```sh
codex login
```

- **Claude Code** (if you chose it): run `claude` in Ubuntu and follow its sign-in.
- **GitHub**: you already did `gh auth login` inside Ubuntu (B2.2); `gh-axi` uses that sign-in.
- **Figma** (if chosen): install Figma Desktop on Windows from <https://www.figma.com/downloads/> and sign in yourself, then follow the Figma CLI's own sign-in instructions for your account, inside Ubuntu. The kit never patches or restarts Figma. Whether the Figma CLI inside Ubuntu can reach Figma Desktop on Windows is not confirmed yet.
- **Claude plugins that connect to an account** (with Claude Code): `atlassian` and `figma` ask you to sign in through their own flow the first time you use them, and `context7` may ask for your own key. Sign in only there, never in a chat.
- **Codex hooks**: the first time Codex starts, it asks you to review the kit's new hooks (`/hooks`). Review and approve them yourself.

Signing in on Windows does **not** sign you in inside Ubuntu. The kit never copies sign-ins between them.

Never send your sign-in codes, tokens or screenshots of them to anyone, including an agent.

## B3. After a successful install: start it up

Do this once your install ends with `Agent Kit setup complete.` (or `finished; some tools are partial`, when the only partial item is the tower). Everything below happens **in Ubuntu**, not in PowerShell. Replace `~/Agentic` with your own root if you chose another one.

**1. Open Ubuntu in Windows Terminal and check your PATH.** Open **Windows Terminal**, choose the **Ubuntu** profile from the drop-down next to the tab, and then, in a new Ubuntu tab (if you said yes to question 5b the kit already put the PATH block in your Ubuntu profile; otherwise add the `export PATH=…` line to `~/.bashrc` first, B2.11):

```sh
command -v herdr no-mistakes codex treehouse firstmate fm-help
```

Each name should print a path inside your root, for example `/home/<you>/Agentic/.tools/…` (`treehouse`, `firstmate` and `fm-help` must be in `…/Agentic/.tools/bin/`, and so must `codex` if you kept the full-access launch on). If one prints nothing or a path elsewhere, fix your Ubuntu PATH (B2.11, B10.2). With Claude Code only, leave `codex` out. If you said `n` to question 5, leave `firstmate` and `fm-help` out.

**2. Run the health check.** Set your `AK` shortcut (B6) and run doctor:

```sh
AK="$HOME/Agentic/.tools/kit/<commit>/bin/agent-kit.mjs"
node "$AK" doctor
```

Healthy output starts with `Agent Kit doctor: pass (pilot-13)`. These lines are normal and expected: `UNKNOWN authenticated: …`, `UNKNOWN live-tested: …`, and `WARN jev: not ready: TYPESAFE_API_KEY is not set…` if you did not add a key. You should also see `PASS firstmate-fork: firstmate origin: … (approved fork)` and, with Codex, `PASS codex-full-access: codex full-access launch: on` (or `off`). A `FAIL` line is not normal: see B6.1 and B10.

**3. Sign in to your agent CLIs yourself, inside Ubuntu.** Signing in on Windows does not count here.

```sh
gh auth status
codex login
```

- `gh auth status` should say you are logged in. If not, run `gh auth login`.
- `codex login` signs you in to Codex (if you chose Codex). Its sign-in page opens in your Windows browser; that is normal.
- For Claude Code (if you chose it), run `claude` in Ubuntu and follow its sign-in, then quit it again.
- Type sign-in codes only into the official sign-in page or prompt. **Never paste a password, token, sign-in code or key anywhere else**, including an agent chat.

**4. Start Herdr** in the same Ubuntu tab (so Herdr gets your PATH):

```sh
herdr
```

**If Herdr was already running and the installer says it cannot see the kit tools,** let your agents finish, stop Herdr inside Ubuntu with `herdr server stop`, then start it again with `herdr` from a new Ubuntu tab that has the PATH line.

**5. Start Firstmate.** Pick one way, inside Herdr:

- **The key:** press `Ctrl+B`, let go, then `Shift+F` for Firstmate in Codex, or `F` for Firstmate in Claude Code (B8.2).
- **The command:** in a Herdr pane, type `firstmate codex` (or `firstmate claude`).
- **By hand:** in a Herdr pane, `cd ~/Agentic/firstmate`, then `codex` (or `claude`).

The key and the command open a **Control Tower** workspace with a **Captain (Codex)** or **Captain (Claude)** tab and start Firstmate there, in your Firstmate home. If that tab is already running something, they only switch to it. Only one Firstmate can run in a home; do not open both Captain tabs at once.

The first time Codex starts it asks you to review the kit's hooks (`/hooks`); review and approve them yourself (B2.12). With the tower and Claude Code, the tower's **Team** tab also opens on its own the first time Firstmate starts in Claude Code (B9).

**6. Say hello to Firstmate.** Your agent reads Firstmate's instructions and becomes your first mate; you are the **captain**.

- **Codex check-in:** Firstmate checks in only while you talk to it; it does not monitor the crew in the background.
- **What to say:** anything. `ahoy` is fine, or go straight to a request such as `look at my GitHub project <your-github-login>/<project>`. In Codex, if Firstmate does not report on its own, say `start up`.
- **What its startup check shows:** Firstmate runs its own startup check first and tells you in plain words whether its tools are ready. On a fresh kit install everything it needs is already there. On the very first start it has no notes or projects yet; that is normal.
- **Answering its first questions:** if it says a tool is missing and asks to install it, answer yes only if you expect that tool; if unsure, say no and ask the person who shared this guide. If it asks you to sign in to GitHub, run `gh auth login` yourself in a normal Ubuntu tab, never in the chat. For anything else, answer in plain words; you can always say "not now".

The exact wording of the startup check is not confirmed on a Windows PC yet; please note what you saw in your pilot feedback (section 4).

**7. Optional: Jev routing and token mode.** To turn on Jev routing, add your key from a normal Ubuntu tab (not the agent chat): `node "$AK" keys` (B6.5). Your routing mode from question 2c is already set up. To change how many tokens Firstmate spends, ask Firstmate ("switch to balanced") or see B7.4.

**8. Optional: open the tower.** From a Herdr pane, run `zoe-fleet-open` (or the launcher's `doctor`, then `open`; B9). A **Team** tab appears in Herdr.

**9. Your help page.** Type `fm-help` in any Ubuntu terminal with your PATH set. It prints `data/captain-help.md` in your Firstmate home: a short page the kit wrote for you with the start-up steps, the Herdr keys it actually added for you, and the kit's commands. It is yours to edit, or ask Firstmate to keep it current; the kit never overwrites it once you change it.

**10. Stopping for the day, and coming back.**

- **To leave work running:** press `Ctrl+B q` to detach from Herdr. Herdr and your agents keep running; `herdr` reattaches later. (Shutting down or restarting the computer still stops them. Whether work keeps running inside Ubuntu after you close every Windows Terminal window is not confirmed on Windows yet.)
- **To stop:** first let running work finish, or accept that stopping ends it. Type `/stow` to Firstmate (in Codex: `$stow`) so it saves what it learned (B7.3). Quit your agent CLI. Then stop Herdr from a normal Ubuntu tab with `herdr server stop`. Stopping Herdr ends any agent still running in it. You can then close Windows Terminal.
- **To come back:** open Windows Terminal with the **Ubuntu** profile, run `herdr`, then start Firstmate again (step 5: `Ctrl+B Shift+F` or `Ctrl+B F`). Firstmate runs its startup check and picks up from its saved records: open tasks, pull requests and your pending decisions are kept on disk, not in the conversation. Type `/ahoy` (in Codex: `$ahoy`) to catch up.

## B4. Your folder layout

Everything lives under your root folder **inside Ubuntu** (default `/home/<you>/Agentic`):

| Path | What it is | Safe to edit? |
| --- | --- | --- |
| `<root>/firstmate` | **Your Firstmate home.** Talk to Firstmate here. | Let Firstmate manage it. Do not edit its tracked files by hand. |
| `<root>/firstmate/projects/` | Your project clones | Firstmate and its workers manage these |
| `<root>/firstmate/data/` | Firstmate's notes, reports and backlog | Read freely; private to you |
| `<root>/firstmate/data/captain-help.md` | Your help page, printed by `fm-help` | Yes, it is yours |
| `<root>/firstmate/state/`, `config/` | Firstmate's running state and settings (including the strategy chosen at install) | No; change the strategy through Firstmate (B7.4) |
| `<root>/.tools` | The kit: tools, releases, backups and the kit copy | No |
| `<root>/.tools/bin` | The kit's own commands (B6.6) and the Treehouse wrapper | No |
| `<root>/.tools/receipt.json` | Private record of what the kit installed and your answers. Contains paths, never secrets. | No |
| `<root>/.tools/kit/<commit>` | The kit's own commands (doctor and others) | No |
| `<root>/.tools/backups/` | Private copies of files the kit changed | No |
| `<root>/.treehouse` | The workers' temporary project copies | No; they are created and removed automatically |
| `<root>/.zoe-fleet` | The tower's state (with the tower) | No |
| `<root>/secondmates/<name>` | A second mate's home, if you created one | Same rules as your Firstmate home |

Outside the root (all inside Ubuntu):

- Your zsh or bash profile gets the kit's marked PATH block if you chose question 5b (B2.8).
- `~/.config/zoe-fleet/config`: the tower's launcher settings (if you chose the tower).
- The hook and skill files from question 5 (if you chose them).
- Your Herdr settings: `~/.config/herdr/config.toml` gets the kit's marked keys block, the layout block (5a) and the session graph's own keys block; `~/.config/herdr/plugins.json` gets the kit's three plugin entries (question 5).
- Your Claude Code plugins (with Claude Code and question 5), in Claude Code's own settings.
- Second mates' worker copies under `~/.local/state/firstmate/treehouse-pools/` (Firstmate's own choice).

Inside your Firstmate home, with the tower, the kit also adds one start-up entry to `.claude/settings.local.json` (it opens the tower's tab when Firstmate starts in Claude Code), and lists that file in the home's own git exclude list so it never shows up as a change.

Nothing is written to your Windows folders, apart from a temporary copy of the kit that `install.ps1` removes again when it finishes.

**Seeing the files from Windows.** In an Ubuntu terminal, `explorer.exe .` opens the current Ubuntu folder in Windows File Explorer. Read freely, but let Firstmate and the kit change files, and never move the root to a Windows drive.

## B5. If install stops: resume

If anything fails, the installer stops safely and says so:

```text
Stopped safely at step N. Rerun the installer to resume; completed steps are re-verified, not redone.
```

**To resume, run the installer again** from the same folder, in a **normal PowerShell** window:

```powershell
cd $HOME\agent-kit-installer
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Give the **same root folder** when asked. The installer finds your existing install inside Ubuntu and keeps your saved update channel. Then you will see:

```text
Found an Agent Kit install at <root>/.tools.
Resuming from step N of 8 (...).
Completed steps are re-verified against the receipt; only failed or missing steps are redone.
Reusing your saved answers (pass --reconfigure to answer every question again).
```

Your other answers are not asked again. Confirm the summary with `y`. Files that were already downloaded and checked are not downloaded again.

If everything is already done it says `All 8 setup steps are recorded complete; re-verifying them (no changes expected).` A re-run is always safe. Run it with Herdr stopped inside Ubuntu (`herdr server stop`) if step 4 said the Herdr plugins were not added yet.

To change your answers (for example to turn Figma on, to turn the full-access Codex launch off, or to change your plan), re-run with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 --reconfigure
```

If you change your plan or routing mode this way, the kit updates Firstmate's strategy only while it is still exactly as the kit set it. If you or Firstmate changed it since, it is left alone; switch it yourself instead (B7.4).

To change only the key, do not use `install.ps1`: run `node "$AK" keys` in your Ubuntu terminal instead (B6.5).

Do not stop a running install with Ctrl-C. If it seems stuck, check for the QuickEdit freeze first (B2.4) and press **Esc**. If it fails, read the message first.

**Common reasons it stops:**

- **On Windows:** `Install these yourself on Windows first, open a new PowerShell window, then rerun install.ps1 (nothing was changed)`, with the `winget` command for each missing tool.
- **Inside Ubuntu:** a missing or old prerequisite (including python3): install it **inside Ubuntu** (B2.2) and re-run `install.ps1`.
- `sign in to GitHub with your own account first`: run `gh auth login` on the side that says so (PowerShell before the handoff, Ubuntu after it).
- `could not fetch the kit`: you probably do not have access to the repository yet.
- WSL2 not ready: run the command it prints yourself (B10.2).
- A network error during download: just re-run.
- A **checksum mismatch**: do not work around it; see B10.1.

## B6. Day-to-day commands

Run **all** of these in your **Ubuntu** terminal, not in PowerShell.

The kit's commands live in your kit copy. The easiest way is to set a shortcut in Ubuntu, using the `Health check later:` line the installer printed:

```sh
AK="$HOME/Agentic/.tools/kit/<commit>/bin/agent-kit.mjs"
```

If you lost that line, list the kit copies and use the folder name:

```sh
ls ~/Agentic/.tools/kit/
```

### B6.1 Doctor (health check)

Checks that everything the kit installed is present, unchanged and set up. **It changes nothing.** In Ubuntu:

```sh
node "$AK" doctor
```

Healthy output starts with:

```text
Agent Kit doctor: pass (<release>)
```

followed by one line per tool and per check. These two lines are always expected, because the kit never looks at your sign-ins or a running fleet:

```text
UNKNOWN authenticated: sign-in belongs to this teammate; no auth store queried
UNKNOWN live-tested: live fleet was not probed
```

There is also one line for Jev routing. It is only ever `PASS` or `WARN`, never a failure, and it never shows the key:

```text
PASS jev: ready (key set, rules present)
WARN jev: not ready: TYPESAFE_API_KEY is not set; add it from your own terminal with agent-kit keys
```

`WARN jev: not ready` is normal if you did not add a key. Other reasons it can give are a missing or broken routing rules file (B6.5) or a helper tool not on your Ubuntu PATH (B2.11).

These rows cover what `pilot-9` added. Each is `PASS` or `WARN`, never `FAIL`: the kit still works without them, and repair (B6.2) puts back what changed.

| Row | What `PASS` means | If it says `WARN` |
| --- | --- | --- |
| `firstmate-fork` | `firstmate origin: … (approved fork)`: your Firstmate home updates from the kit owner's approved copy of Firstmate | its `origin` was changed; see B10.4 |
| `codex-full-access` | `codex full-access launch: on` or `off`, your answer to 2d | (always `PASS`; it only reports your answer) |
| `launcher-<name>` (one per kit command, B6.6) | the command matches what the kit wrote | changed or missing; run repair |
| `herdr-keys`, `herdr-layout` | the kit's marked blocks are in your Herdr settings | missing (repair restores it) or changed by you (left as you edited it) |
| `herdr-plugin-…`, `zoe`, `zoetrope-keys` | the Herdr plugins, the `zoe` program and the session graph's keys are in place | stop Herdr, then run repair |
| `shell-profile` (if you said yes to 5b, or an earlier install left a kit-owned block) | an effective PATH line in the kit's profile block holds every kit folder | `FAIL`: the block was removed or misses a folder; run repair after choosing 5b |
| `shell-path` | this terminal's PATH holds every kit folder | `FAIL` if this terminal lacks a folder; open a new terminal after install or repair |
| `herdr-path-env` | `PASS` when Herdr is not running (or cannot be read), or its PATH holds every kit folder | `WARN`: Herdr started before the kit folders were on your PATH. Quit your agents, run `herdr server stop`, open a new terminal and start `herdr` there (inside Ubuntu on Windows). Doctor only reads; it never stops Herdr |
| `fleet-autostart` (with the tower) | the start-up entry that opens the tower's tab is in place | run repair |
| `captain-help` | your help page exists | it was deleted; ask Firstmate to write one, or run repair |
| `claude-marketplace-…`, `claude-plugin-…` (with Claude Code) | the Claude plugins are installed and turned on | a plugin is turned off, or your own marketplace is at a different version than the kit's |
| `figma-skill-…` (with Figma) | the Figma CLI's skills are linked | run repair |

- `FAIL <tool>-path: another binary has PATH precedence` means an older copy of that tool comes first on your Ubuntu PATH. Fix your PATH (B2.11) and run doctor again.
- Any other `FAIL` is a real problem. See B10.

For a machine-readable report to share (after redacting; see B10.6):

```sh
node "$AK" doctor --json > ~/kit-doctor.json
```

### B6.2 Repair (reinstall)

Use repair when something the kit installed is damaged or missing, for example a deleted tool or a changed file.

Run repair, upgrade and uninstall in a **normal Ubuntu terminal, not from inside Herdr and not in PowerShell**: they refuse while Herdr is running (see B10.3). In Ubuntu:

```sh
node "$AK" repair
```

`reinstall` does the same thing. What it does:

- Shows a plan first, then asks `Apply this plan now? (y/N)`. Nothing changes until you answer `y`. (`--yes` applies without asking. Without a terminal and without `--yes`, it only prints the plan.)
- Checks every kit file in your **current** release against its recorded checksum. It downloads and checks the release's tools again and replaces anything missing or changed. A changed file is first moved to a private backup under `<root>/.tools/backups/repair/`.
- Fetches a fresh copy of the kit itself (`<root>/.tools/kit/<commit>`) at the same commit.
- Puts back the kit's own hooks, skill links, tower config and Treehouse wrapper.
- Puts back the kit's commands in `<root>/.tools/bin` (a changed one is backed up first), its Herdr keys and layout blocks, its Herdr plugin entries, the tower's start-up entry, your help page if it was deleted, the Figma CLI's skills, and the Claude plugins the kit added.
- If Firstmate's routing rules and strategy are both missing, selects your strategy again. A strategy or rules you or Firstmate changed are left alone.

What it never touches: your Firstmate home's notes, state, settings and projects; your `.env` file and key; your own hooks, settings, Herdr keys and plugins; anything you wrote yourself, including your own edits to the kit's Herdr blocks or your help page. If your Firstmate home has local changes, repair **reports** them and leaves them as they are.

Repair refuses to run while Herdr, the no-mistakes daemon or the tower is running inside Ubuntu. It tells you which one and what to do; close it and run repair again (see B10.3).

Repair fixes your current release only. If the kit copy you run is for a different release than your install, it stops and tells you to use upgrade. It also stops if an earlier upgrade did not finish.

### B6.3 Upgrade (update)

**Updates happen only when the person who shared this guide asks you to.** Never run upgrade or `/updatefirstmate` on your own.

Moves you to the newest approved kit release. In Ubuntu:

```sh
node "$AK" upgrade
```

`update` does the same thing. What it does:

1. Asks GitHub, with your own **Ubuntu** sign-in, for the newest release on your saved channel (`releases` by default).
2. Shows what changes: the release name, each tool's version, the tower release, whether the Firstmate version the kit expects changes, and any new questions.
3. Reuses your saved answers and asks only questions without saved answers. For example, moving from `pilot-8` to `pilot-9` asks 2d (the full-access Codex launch, with its warning; default yes) and 5a (Herdr layout; default yes) once. A kit version with question 5b asks it once if your receipt has no PATH-block answer. With `--yes` new questions take their defaults.
4. Asks `Apply this plan now? (y/N)`. (`--yes` applies without asking.)
5. Installs the new release next to the old one, then switches over. If a step fails, it puts back the kit's files, its record, its hook and skill registrations, and its commands and Herdr files as they were. **Changes to data and state are not rolled back**; the plan says so before you apply it.

Upgrade keeps your key. It refreshes Firstmate's strategy or the kit's starter routing rules only if nobody has changed them since the kit set them (B6.5). It also places anything new the release adds, for example the kit's commands, Herdr keys and plugins when moving to `pilot-9`.

Upgrade **refuses before changing anything** if your Firstmate home:

- has uncommitted changes to its tracked files, or
- is not on the Firstmate version the kit expects, or
- has an `origin` remote other than the approved Firstmate copy the kit uses (the kit owner's copy, which doctor's `firstmate-fork` row names).

It says which case applies. It will not reset your Firstmate home for you. Clean up the changes, put the home back on the expected version, or set `origin` back, then run upgrade again (B10.4). If a new release needs a newer Firstmate, the plan says `run /updatefirstmate in the Firstmate home before applying`, and applying stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade`. In that case, as part of the upgrade you were asked to run, ask Firstmate to run `/updatefirstmate`, then run upgrade again. (`pilot-9`, `pilot-10`, `pilot-11`, `pilot-12` and `pilot-13` are such releases.)

Like repair, upgrade refuses while Herdr, the no-mistakes daemon or the tower is running inside Ubuntu.

**After an upgrade:**

- Set `AK` to the new kit copy (B6).
- If you skipped question 5b, change `<release>` in your Ubuntu PATH line (B2.11) to the new release name from the plan's `Release: <old> -> <new>` line. An unchanged kit-owned block is refreshed for you. The old release folder stays in place, so an old PATH still runs the old tools and doctor reports `FAIL <tool>-path`.
- Run doctor (B6.1).

**Moving from `pilot-12` to `pilot-13`**, when you are asked to:

1. Run upgrade. The plan shows `Release: pilot-12 -> pilot-13`, one changed Firstmate line with the full commit numbers, and `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`.
2. Answer `y`. Upgrade stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` and changes nothing.
3. Start Herdr and Firstmate again (B3) and ask Firstmate to run `/updatefirstmate` (in Codex: `$updatefirstmate`). When it is done, quit Firstmate and stop Herdr (B10.3).
4. Run upgrade again. The plan now says `Firstmate pin: guarded update already verified`; answer `y`.
5. Do the "After an upgrade" steps above.

**Moving from `pilot-11` to `pilot-12`**, when you are asked to:

1. Run upgrade. The plan shows `Release: pilot-11 -> pilot-12`, one changed line, `- firstmate: 622311a5… -> 21b21582…` (with the full commit numbers), and `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`.
2. Answer `y`. Upgrade stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` and changes nothing.
3. Start Herdr and Firstmate again (B3) and ask Firstmate to run `/updatefirstmate` (in Codex: `$updatefirstmate`). When it is done, quit Firstmate and stop Herdr (B10.3).
4. Run upgrade again. The plan now says `Firstmate pin: guarded update already verified`; answer `y`.
5. Do the "After an upgrade" steps above.

**Moving from `pilot-10` to `pilot-11`**, when you are asked to:

1. Run upgrade. The plan shows `Release: pilot-10 -> pilot-11`, changed Firstmate and tower lines, `- firstmate: a6bc1877… -> 622311a5…` (with the full commit numbers), and `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`.
2. Answer `y`. Upgrade stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` and changes nothing.
3. Start Herdr and Firstmate again (B3) and ask Firstmate to run `/updatefirstmate` (in Codex: `$updatefirstmate`). When it is done, quit Firstmate and stop Herdr (B10.3).
4. Run upgrade again. The plan now says `Firstmate pin: guarded update already verified`; answer `y`.
5. If you never changed the token strategy the kit set up, upgrade has Firstmate set it up again with the current Codex models (B7.4). If you changed it, it is left alone; run `bin/fm-strategy.sh set <your mode>` in your Firstmate home to get the current models.
6. Do the "After an upgrade" steps above. The Codex GPT-6.1 Sol workaround is no longer needed: Firstmate now routes Sol to GPT-6 Sol. The updated tower adds current model prices.


**Moving from `pilot-9` to `pilot-10`**, when you are asked to:

1. Run upgrade. The plan shows `Release: pilot-9 -> pilot-10`, one changed line, `- firstmate: e823c61f… -> a6bc1877…` (with the full commit numbers), and `Firstmate pin: run /updatefirstmate in the Firstmate home before applying`.
2. Answer `y`. Upgrade stops with `Firstmate pin changed; run /updatefirstmate from <home>, then rerun agent-kit upgrade` and changes nothing.
3. Start Herdr and Firstmate again (B3) and ask Firstmate to run `/updatefirstmate` (in Codex: `$updatefirstmate`). When it is done, quit Firstmate and stop Herdr (B10.3).
4. Run upgrade again. The plan now says `Firstmate pin: guarded update already verified`; answer `y`.
5. If you never changed the token strategy the kit set up, upgrade has Firstmate set it up again with the new cheaper models (B7.4). If you changed it, it is left alone; run `bin/fm-strategy.sh set <your mode>` in your Firstmate home to get the new models.
6. Do the "After an upgrade" steps above. If you typed `/quiet off` at the start of each session because of the `pilot-9` known issue, you can stop: quiet mode now works on Claude Code (B7.4).

**One caveat when moving from `pilot-8` to `pilot-9` only:** if that upgrade fails near its end, the kit's new commands (`codex`, `fm-mate`, `fm-jev`, `open-firstmate` and the others) may point at a kit copy that was removed, and do not work. Run upgrade again; that puts them right. Upgrades from `pilot-9` onwards do not have this gap.

**How releases reach you.** Each kit release is reviewed and approved before it is published. You run upgrade only when the person who shared this guide asks you to; on the `releases` channel you then get that approved release. Nothing updates by itself.

### B6.4 Uninstall

Removes the kit itself and leaves your work in place. In Ubuntu:

```sh
node "$AK" uninstall
```

It shows a plan and asks before changing anything.

**What it removes** (all inside Ubuntu):

- The kit's programs, releases, helper tools and kit copy in `<root>/.tools`. These are **moved** into a private backup folder, not deleted (see below).
- The Treehouse wrapper, if you did not change it. A changed wrapper is left for you to review.
- The kit's hook entries in `~/.claude/settings.json` and `~/.codex/hooks.json`, and its skill links in `~/.claude/skills/` and `~/.agents/skills/`.
- The tower config the kit wrote, if you did not change it.
- The kit's commands in `<root>/.tools/bin` (including its `codex` and `claude` commands), its Herdr keys and layout blocks, and its Herdr plugin entries, each only if you did not change it. The rest of your Herdr settings stays.
- The tower's start-up entry in your Firstmate home, your help page if you never changed it, the Figma CLI's skills, and the Claude plugins and marketplaces the kit added (your own stay).
- Starter routing rules written by an older kit release, if nobody changed them since.
- The Codex "hooks on" setting, but only if the kit was the one that turned it on. If that setting was changed since, it is left alone and reported.

**What it keeps:**

- Your root folder, your Firstmate home and its projects, your second mates, and the tower's state.
- Firstmate's strategy and routing rules chosen at install: they are Firstmate's own settings.
- A private backup of everything it removed and a record of the uninstall, under `<root>/agent-kit-uninstall/`. Delete that folder yourself later if you want the space back.
- Your sign-ins, Node, git, gh and Claude Code (on both Windows and Ubuntu), WSL2 and Ubuntu themselves, and the rest of your shell profile. Uninstall removes only the kit's marked PATH block in Ubuntu, and only if you have not edited it. If you did, it keeps the block and tells you; remove the `export PATH` line yourself.
- Your Firstmate home's `.env` file (with your key, if you added one), as part of the home.

**Also removing the `.env` file** (and with it your key):

```sh
node "$AK" uninstall --remove-env
```

You must type the exact path of the `.env` file to confirm, in a real terminal. To remove only the key and keep the kit, use `keys` instead (B6.5).

**Also removing your Firstmate home** (careful: this deletes your Firstmate, its projects and its `.env` file):

```sh
node "$AK" uninstall --remove-firstmate-home
```

You must type the full path of the home to confirm. This needs a real terminal and cannot be skipped, even with `--yes`. It refuses if the home or any project in it has uncommitted, untracked or unpushed work, or if a second mate is still running.

Like repair, uninstall refuses while Herdr, the no-mistakes daemon or the tower is running inside Ubuntu.

### B6.5 Keys: `TYPESAFE_API_KEY` and Jev routing

`TYPESAFE_API_KEY` is **optional**. You can install and use everything without it.

- **Without it:** Jev routing is off. Firstmate decides which agent handles each job using its normal rules. Everything else works the same.
- **With it:** Firstmate asks Jev (from typesafe.ai) which agent and model should handle each job, choosing from your routing rules. When it is on, the text of each job, after a screen for anything sensitive, is sent to typesafe.ai.

**Adding the key is the only step.** The routing rules Jev chooses from are already there: the kit set up Firstmate's strategy for your agent CLIs and plans at install (B2.8). Once the key is in, Jev routing is on. You do not need to choose a token strategy or edit any file.

**Get your key** from <https://console.typesafe.ai/keys>, signed in with your own account.

**During install (question 10).** After the handoff, the installer asks `10. Add optional TYPESAFE_API_KEY from https://console.typesafe.ai/keys now? Enabling Jev sends screened task text to typesafe.ai (y/n) [n]:` in the same PowerShell window. The default is no. If you answer `y`, it shows a hidden prompt:

```text
TYPESAFE_API_KEY (hidden; press Enter to cancel):
```

Paste or type your key and press Enter. **Nothing appears on screen while you type; that is expected.** The summary then shows `will set`, never the key. A dry run never asks for the key. The hidden prompt through the PowerShell window is not confirmed on a real Windows PC yet; if you prefer, answer `n` and add the key afterwards in Ubuntu as below.

**To add, change or remove the key later**, run this yourself in your own **Ubuntu** terminal (not inside an agent chat, and not in PowerShell):

```sh
node "$AK" keys
```

What you see:

1. `TYPESAFE_API_KEY: set` or `not set`.
2. A question: `Keep or add? [keep]:` (or `Keep, change or remove? [keep]:` if a key is already set). Press Enter to change nothing.
3. For `add` or `change`: the same hidden prompt as above. For `change` it also asks `Replace the existing key? (y/N)`.
4. For `remove`: you must type `REMOVE TYPESAFE_API_KEY` to confirm.
5. The new state: `TYPESAFE_API_KEY: set` or `not set`, and a line about the routing rules.

The key command only ever shows **set** or **not set**, never the key, and changes nothing else apart from the routing rules described below (and only when none exist). The key is saved in your Firstmate home's `.env` file inside Ubuntu, private to you (mode 600) and never committed to git. Repair, upgrade and re-running the installer keep it. The kit cannot test the key with typesafe.ai; it only refuses a key that is empty or clearly malformed.

If it says `the installed kit predates the keys command`, your install is older than `pilot-7`. Do not work around it: ask the person who shared this guide, who will ask you to upgrade (B6.3) when it is time.

> **Never paste the key into an agent chat.** Anything you paste into a chat is visible to that agent session and saved in its transcript. If an agent is helping you set it up, it should tell you to run `keys` yourself, and you type the key only at the hidden prompt.

**The routing rules.** Firstmate's routing rules file (`config/crew-dispatch.json` in your Firstmate home) decides which agent and model each kind of job gets. At install, with or without the key, the kit asks Firstmate to select your routing mode (2c) for your agent CLIs and plans, so Firstmate writes this file itself. The kit then adds two extra rules after Firstmate's: `check` (quick checks that change nothing, on your plan's light model at low effort) and `research` (open-ended investigation, on your plan's strongest route). They step down with your quota the same way as the work they copy, and add no new model or spend.

- **Only when none exist.** The kit does this only if your Firstmate home has no routing rules and no token strategy yet. If you already have your own, the kit leaves them as they are and Jev uses them.
- **Your changes win.** You can change the rules at any time: ask Firstmate, choose another token strategy (`bin/fm-strategy.sh set <mode>`, B7.4), or edit the file yourself. From then on the kit never overwrites them. Repair and upgrade only touch them while they are exactly as the kit set them.
- **Removing the key keeps the rules.** Firstmate's normal routing still reads them; only Jev is off.
- **Nothing else changes.** The kit never edits your Claude, Codex or no-mistakes settings. Firstmate prints any settings it leaves to you, such as the model for your coordinator.

**Turning Jev off for a while** without removing the key: run `fm-jev off` in your own Ubuntu terminal. It turns the key line in `.env` into a comment, so the key stays saved but Jev is off. `fm-jev on` turns it back on, and `fm-jev status` shows `jev: key=on|off (key kept, commented out)|not set rules=present|absent`. It never shows the key, and it passes the change on to any second mates that are running. `fm-jev on` needs a key already added with `keys`.

**Is Jev ready?** Run doctor in Ubuntu (B6.1) and look for `PASS jev: ready (key set, rules present)`.

**Sign in to your agent CLI.** Jev gives a clear answer only when you are signed in to your agent CLI inside Ubuntu (`codex login`, or Claude Code's own sign-in; B2.12), because Firstmate reads your remaining quota through `quota-axi`. Until then, Firstmate simply decides as it does without the key. Nothing breaks.

**Not set up by the kit:** Firstmate's Relay and mail settings are advanced options the kit does not configure.

### B6.6 The kit's commands on your PATH (in Ubuntu)

With question 5 answered yes, the kit writes these commands into `<root>/.tools/bin` inside Ubuntu. They work once that folder is first on your Ubuntu PATH (B2.11). Run them in Ubuntu, not PowerShell. Repair rewrites them, uninstall removes them.

| Command | What it does | Written when |
| --- | --- | --- |
| `firstmate` / `firstmate codex` / `firstmate claude` | Start Firstmate in your Firstmate home, from a Herdr pane. It refuses outside Herdr, and refuses while another Firstmate is already running in this home | always |
| `firstmate check` | Firstmate's own tool check, without starting anything | always |
| `open-firstmate codex`, `claude` or `mates` | What the Herdr keys run (B8.2): open the **Control Tower** workspace and its Firstmate or **Mates** tab | always |
| `fm-mate` | Create a second mate: asks a name and a one-line scope, asks once more, then creates it and starts it (B7.6). `fm-mate list` lists them; `fm-mate retire <name>` retires one, and refuses while it still holds unfinished work | always |
| `fm-help` | Print your help page (`data/captain-help.md`) | always |
| `fm-jev on`, `off` or `status` | Turn Jev routing on or off without removing the key (B6.5) | always |
| `zoe-fleet-open`, `zoe-fleet-demo` | The tower launcher's `open` and `demo` (B9) | with the tower |
| `codex` | The full-access Codex launch (B2.8, question 2d) in front of the kit's Codex | with Codex and 2d yes |
| `claude` | The tower's Claude usage and status bridge in front of your own Claude Code. It passes everything on to your Claude Code | with the tower and Claude Code |
| `zoe` | The program the Zoetrope session graph runs | with the tower |

Two files support them: `<root>/.tools/env.sh` (the folder names this setup uses) and the Treehouse wrapper. The kit also keeps its `gh-axi` and `chrome-devtools-axi` start-up hooks quiet outside your Firstmate home.

## B7. Working with Firstmate

### B7.1 Starting Firstmate

Firstmate runs inside Herdr, the terminal workspace the kit installed, **inside Ubuntu**. Open **Windows Terminal**, choose the **Ubuntu** profile (from the drop-down next to the tab), and with your PATH set (B2.11) run:

```sh
herdr
```

Then press `Ctrl+B Shift+F` (Codex) or `Ctrl+B F` (Claude Code), or type `firstmate codex` (or `firstmate claude`) in the Herdr pane. You can also start it by hand:

```sh
cd ~/Agentic/firstmate
codex
```

Use `claude` instead of `codex` if you chose Claude Code. The agent reads Firstmate's instructions and becomes your first mate. You are the **captain**.

Do not start Herdr or the agents from PowerShell. When an agent opens a browser page (for example `chrome-devtools-axi` or a review page), it opens in your Windows browser.

### B7.2 Talking to it

Just say what you want, in plain words:

```text
look at my GitHub project <your-github-login>/<project>, then fix the flaky login test and add dark mode
```

Firstmate:

1. checks its tools (and asks before installing anything),
2. clones the project into `projects/` inside Ubuntu,
3. starts one worker agent per task, each in its own Herdr tab and its own clean copy of the code,
4. watches them and comes back with results, for example a pull request link with a short risk note.

**Nothing merges without your word.** Firstmate brings you the PR; you review it and say `merge it` when you are happy.

Some tasks are **investigations** instead of code changes. Those end with a written report rather than a PR.

On Codex, Firstmate only notices updates while you are talking to it. Ask "how is everything?" now and then, or use the Claude Captain when you want automatic notifications.

You can watch any worker in its Herdr tab, or type into it if you need to.

Useful built-in commands (type them to Firstmate; Codex uses `$` instead of `/`, for example `$bearings`):

| Command | What it does |
| --- | --- |
| `/bearings` | A short summary of what is going on and what needs your decision |
| `/ahoy` | Catch up on what happened since your last message and go through open decisions |
| `/afk` | Let Firstmate carry on supervising while you step away |
| `/quiet` | Fewer routine interruptions while you stay and chat; `/quiet off` ends it |
| `/stow` | Save what this session learned to Firstmate's notes before you clear or close the session (see Managing Firstmate's context) |
| `/updatefirstmate` | Update Firstmate itself and your second mates. Run it only when the person who shared this guide asks you to (section 3) |

### B7.3 Managing Firstmate's context

A long Firstmate conversation slowly fills up the agent's memory for that session (its context). When it gets slow, starts repeating itself, or your agent tool warns that the context is nearly full:

1. Type `/stow` (in Codex: `$stow`). Firstmate saves what this session learned and writes a short "where I left off" note in its own home.
2. Clear the conversation: in Claude Code type `/clear`; in Codex, quit and start a new Codex session in your Firstmate folder (inside Ubuntu).
3. Carry on. In Claude Code, Firstmate reloads its saved notes and its records of the work in progress by itself. In a new Codex session, say "start up" (or anything) and Firstmate runs its own startup check first.

Nothing in progress is lost: workers keep running in their own panes, and their tasks, pull requests and your pending decisions live in Firstmate's records, not in the conversation. Run `/stow` before a clear, not after; a clear without it only loses notes Firstmate had not saved yet.

### B7.4 Saving tokens: full, balanced and lean

Firstmate has three token strategies. Each one sets which model each kind of worker uses, which model new second mates use, and how much Firstmate starts on its own. None of them changes quality checks, reviews, or the rule that nothing merges without your word.

| Mode | What it does | Suits you if |
| --- | --- | --- |
| `full` | **Unlock full power.** The strongest models your plan routes; Firstmate starts approved work, fix rounds and fresh starts on its own; second mates allowed; every update reaches you straight away | you have plenty of quota and want the most done unattended |
| `balanced` | **Optimize for token saving while everything still work.** Cheaper models that step down further as your weekly quota runs low (tables below); light and standard jobs start on their own, hard or expensive ones need your OK with a rough cost; one automatic fix round, then it asks; second mates optional (off on the smaller plans); quiet mode while you are at the keyboard, with messages batched for up to 90 seconds | you want a sensible middle ground |
| `lean` (also called "light") | **Harder optimization for token saving while everything still work.** The cheapest routes for each plan; every new job needs a plan and your OK; no automatic fix rounds, retries or fresh starts; one coordinator, no new second mates unless you ask; quiet mode while you are at the keyboard, with messages batched for up to 180 seconds | you want to spend as few tokens as possible |

**Which models each kind of job gets.** Firstmate sorts every job as light, standard or hard. The tables show the model and effort for each, as `light / standard / hard`. An arrow (`→`) means the job starts on the first route and moves to the cheaper one once less than the "steps down below" share of your weekly quota is left, so the week's quota lasts. Hard work only ever lowers its effort; it never moves to a weaker model. Checking (validation) always runs at high effort.

Claude Code (Haiku, Sonnet and Opus are the 5.5 models):

| Your plan | `full` | `balanced` | `lean` |
| --- | --- | --- | --- |
| `pro`, `team-standard`, `enterprise-standard` | Sonnet low / Opus medium / Opus high | Haiku medium → low / Sonnet medium → low / Opus high → medium; steps down below 50% | Haiku low / Sonnet low / Opus medium |
| `max5x`, `max20x`, `team-premium`, `enterprise-premium` | Sonnet low / Opus medium / Opus high | Haiku medium → low / Sonnet medium → low / Opus high → medium; steps down below 35% | Haiku low / Sonnet low / Opus medium |
| `api` | Sonnet low / Opus medium / Opus high | Haiku medium / Sonnet medium / Opus high | Haiku medium / Sonnet medium / Opus high |
| `skip` | Sonnet low / Opus medium / Opus high | the same | the same |

Codex (Luna, Sol and Astra are GPT-6; Terra is GPT-6.1):

| Your plan | `full` | `balanced` | `lean` |
| --- | --- | --- | --- |
| `plus`, `business-standard` | Luna high / Sol medium / Sol high | Luna high → medium / Terra medium → low / Sol high → medium; steps down below 50% | Luna medium / Terra low → Luna high, below 60% / Sol medium |
| `pro`, `business-premium`, `enterprise-edu` | Luna high / Sol medium / Astra medium | Luna high → medium / Terra medium → low / Sol high → medium; steps down below 35% | Luna medium / Terra low → Luna high, below 50% / Sol medium |
| `api` | Luna high / Sol medium / Astra medium | Luna high / Sol medium / Sol high | Luna high / Terra medium / Sol high |
| `skip` | Luna high / Sol medium / Astra medium | Luna high / Sol medium / Sol high | the same as `balanced` |

On a subscription plan there is also a last floor for light and standard work: below it, that work moves to your other agent CLI, or Firstmate asks you first if you only have one. The floors are, for light and standard work, Claude Pro 30% and 20%, Max 5x 20% and 10%, Max 20x 15% and 5%, Codex Plus 30% and 20%, and Codex Pro 20% and 10% (the seat plans follow the plan they share a row with). API keys have no floors. Firstmate reads how much quota is left through `quota-axi`, so stepping down needs you signed in to that agent CLI. Terra needs Codex CLI 0.159.0 or newer, which the kit's 0.164.0 is; if Terra is unavailable in an interactive session, choose an available model explicitly (`bin/fm-strategy.sh show` notes this).

**Quiet mode in `balanced` and `lean`.** While you are at the keyboard, these two modes put Firstmate in its quiet mode (`/quiet`):

- Routine updates from the crew are handled in the background, without using one of Firstmate's turns.
- Anything that needs you (a decision, a failure, a sign-in, a pull request ready for review) is collected and reaches you within about 90 seconds in `balanced` and 180 seconds in `lean`.
- If it arrives while Firstmate is in the middle of answering you, it is delivered as soon as that answer ends.
- Nothing that needs you is ever dropped. This works the same on Claude Code and Codex.

Type `/quiet off` if you want every update straight away, and `/quiet` to turn it back on. `full` never uses quiet mode.

**What the kit sets up:** the strategy you picked at question 2c (`lean` or `balanced` unless you chose `full`), fitted to your agent CLIs and plans. The kit asks Firstmate to select it once, at install, in a new Firstmate home. An upgrade sets it up again with a new release's models only if nobody changed it since.

**See or change it:** just ask Firstmate ("what token strategy am I on?", "switch to lean"), or run it yourself inside Ubuntu:

```sh
cd ~/Agentic/firstmate
bin/fm-strategy.sh list          # compare the three modes
bin/fm-strategy.sh status        # which mode is selected
bin/fm-strategy.sh set balanced  # shows the changes, then asks before applying
```

Choosing a strategy writes Firstmate's worker routing rules (its `config/crew-dispatch.json`), its second-mate model, and its fresh-start setting, and records your choice. It never edits your Claude, Codex or no-mistakes settings. Firstmate detects whether you have Claude, Codex or both and only uses the ones you have.

Once you switch, the kit treats the strategy as yours and never overwrites it. The kit's two extra rules (`check` and `research`, B6.5) stay when Firstmate re-renders its rules. With the key set, Jev routing stays on and uses whatever rules you have.

### B7.5 Where things live

All inside Ubuntu:

- **Your projects:** `<root>/firstmate/projects/`.
- **Reports, notes and backlog:** under `<root>/firstmate/data/`. The easiest way to see them is to ask Firstmate, or `/bearings`.
- **Worker copies:** `<root>/.treehouse/`. They are created and cleaned up automatically.

### B7.6 Creating your own second mates

A second mate is another long-running Firstmate with its own home folder and its own area of work, for example "all front-end projects". It reports to your first mate.

**During install.** Answer `y` to question 8, give it a name and a one-line scope. The kit creates it at `<root>/secondmates/<name>` but does not start it.

**Easiest later: the key or `fm-mate`.** Inside Herdr, press `Ctrl+B Shift+M`. It opens a **Mates** tab in the **Control Tower** workspace and runs `fm-mate` there (you can also type `fm-mate` in any Herdr pane). It asks:

```text
Name (lowercase letters, digits and -, for example docs or jira):
One-line scope (what this mate owns):
Create <name> at <root>/secondmates/<name> and launch it? (y/N):
```

Nothing is created until you answer `y`. Then it creates the mate with Firstmate's own commands and starts it in its own Herdr space; type in its tab to talk to it. `fm-mate list` shows your second mates. `fm-mate retire <name>` retires one through Firstmate's own teardown, which refuses while the mate still holds unfinished work.

**By hand, from the starter template.** In Ubuntu, print the template:

```sh
node "$AK" secondmate-template --print
```

It shows a short charter to fill in:

```text
Responsibility: <describe the work this mate owns>
Scope: <describe the projects and decisions this mate may handle>
```

and the commands to create it, run in Ubuntu from your Firstmate home:

```sh
cd ~/Agentic/firstmate
FM_SECONDMATE_CHARTER='<your responsibility and rules>' FM_SECONDMATE_SCOPE='<your scope>' bin/fm-brief.sh <name> --secondmate --no-projects
bin/fm-home-seed.sh <name> <home|-> --no-projects
```

Replace `--no-projects` with your own project names if the mate should own projects. Review the generated charter before you seed it.

**Start it when you are ready:**

```sh
bin/fm-spawn.sh <name> --secondmate
```

Or simply ask your first mate to create and start a second mate for you, describing what it should own.

## B8. Shortcuts and commands

Every shortcut here comes from the help or documentation of the exact versions the kit installs (Herdr 0.9.3, Codex CLI 0.164.0, the pinned Firstmate and tower), from the kit's own code for the kit-managed keys, or from the official Claude Code and Microsoft documentation. Anything that could not be checked that way says **not verified**.

### B8.1 Herdr (the terminal workspace)

Herdr uses a **prefix key**: press `Ctrl+B`, let go, then press the action key. `Ctrl+B ?` shows all keys.

| Keys or command | What it does |
| --- | --- |
| `Ctrl+B ?` | Help: list all keys |
| `Ctrl+B c` | New tab |
| `Ctrl+B n` / `Ctrl+B p` | Next / previous tab |
| `Ctrl+B 1` … `Ctrl+B 9` | Go to tab 1 to 9 |
| `Ctrl+B v` / `Ctrl+B -` | Split the pane side by side / one above the other |
| `Ctrl+B h`, `j`, `k`, `l` | Move to the pane on the left, below, above, right |
| `Ctrl+B Tab` / `Ctrl+B Shift+Tab` | Next / previous pane |
| `Ctrl+B z` | Zoom the pane to full size, and back |
| `Ctrl+B r` | Resize mode |
| `Ctrl+B w` | Workspace picker (Firstmate's work is in the `firstmate` workspace, one tab per task) |
| `Ctrl+B b` | Show or hide the sidebar |
| `Ctrl+B e` | Open the pane's history (scrollback) in an editor |
| Mouse wheel / drag to select | Scroll the pane's history; selected text is copied automatically. Herdr 0.9.3 has no keyboard copy mode |
| `Ctrl+B x` / `Ctrl+B Shift+X` | Close the pane / close the tab (closing ends what runs in it) |
| `Ctrl+B q` | Detach: Herdr and your agents keep running in the background |
| `herdr` | Start Herdr, or reattach to it after a detach |
| `herdr status` | Show whether the Herdr server is running |
| `herdr server stop` | Stop Herdr completely (ends every agent running in it) |
| `Ctrl+B Shift+R` | Reload Herdr's settings (after you or the kit changed them) |

### B8.2 Kit-managed Herdr shortcuts

With question 5 answered yes, the kit adds these keys to your Herdr settings inside Ubuntu. Press `Ctrl+B`, let go, then the key. `fm-help` (B3 step 9) lists exactly the ones you got.

| Keys | What it does | Added when |
| --- | --- | --- |
| `Ctrl+B F` | Open Firstmate in Claude Code (the **Captain (Claude)** tab in the **Control Tower** workspace) | you chose Claude Code |
| `Ctrl+B Shift+F` | Open Firstmate in Codex (the **Captain (Codex)** tab) | you chose Codex |
| `Ctrl+B Shift+M` | Create a new second mate: opens the **Mates** tab and runs `fm-mate` (B7.6) | always |
| `Ctrl+B Shift+C` | Open the Zoetrope session graph in its own tab | the session graph plugin was added (with the tower) |
| `Ctrl+B Shift+Z` | Show the session graph over the pane you are in (this key comes from the plugin itself) | the session graph plugin was added |
| `Ctrl+B M` | Open the Herdr plugin manager | the plugin manager was added |

How they behave:

- **Firstmate keys:** if the workspace or tab does not exist yet, it is created and Firstmate starts in your Firstmate home. If the tab is an idle shell, Firstmate starts there. If the tab is already running something, the key only switches to it and never types into it. Firstmate does not start a second time while it already runs in this home.
- **Your keys win.** If you had already bound one of these keys yourself, the kit skips it and names it in the summary and the step 4 result.
- **No Herdr default is replaced**, so `Ctrl+B n` (next tab) and Herdr's other keys (B8.1) work as usual.
- **Safe changes.** The kit backs up your Herdr settings file first and checks the result with Herdr's own `herdr config check`; if the check fails, it puts your file back. It keeps its keys in one marked block (`# >>> agent-kit keys` … `# <<< agent-kit keys`). A block you edit is left as you edited it.
- **The plugins** (session graph, the tower's Fleet plugin, plugin manager) are added only while Herdr is stopped. The session graph needs `<root>/.tools/bin` first on your Ubuntu PATH when you start Herdr, because it runs the kit's `zoe`.
- If Herdr was already running when the kit changed its settings, press `Ctrl+B Shift+R` or restart Herdr.
- **Windows Terminal:** `Ctrl+B` reaches Herdr as usual. Whether Windows Terminal passes `Ctrl+B Shift+…` keys through to Herdr unchanged is not confirmed on a real PC yet; if one does nothing, use the matching command instead (B6.6) and note it in your pilot feedback.

**The Herdr layout (question 5a)** changes Herdr's look: the gruvbox theme, a sidebar that lists agents by priority, a tab bar at the top with the time, borders and gaps between panes, and new panes that open in your root folder. Settings you already had stay yours.

### B8.3 Claude Code

| Keys or command | What it does |
| --- | --- |
| `Esc` | Stop Claude mid-answer so you can redirect it; work so far is kept |
| `Esc` `Esc` | With text typed: clear it (`Up` brings it back). With an empty prompt: open the rewind menu |
| `Shift+Tab` | Switch mode: normal, accept edits, plan (and others when available) |
| `Up` / `Down` | Step through earlier prompts |
| `Ctrl+R` | Search earlier prompts |
| `\` then `Enter`, or `Ctrl+J` | New line without sending (works in every terminal). `Shift+Enter` also works in Windows Terminal |
| `Ctrl+C` | Interrupt; when idle, press twice to exit |
| `Ctrl+D` | Exit (press twice) |
| `Ctrl+O` | Show or hide the full transcript |
| `/clear` | Start a fresh conversation (run Firstmate's `/stow` first) |
| `/compact` | Shrink the conversation to free up context |
| `/exit` | Quit Claude Code |
| `/help` | All commands |
| `/status`, `/model`, `/usage` | Version and account; switch model; plan usage |
| `/resume` | Reopen an earlier conversation |
| `/hooks`, `/rewind`, `/context`, `/doctor` | See hooks; roll back to an earlier point; see context use; check the setup |

Inside Herdr, `Ctrl+B` is Herdr's prefix key, so Claude Code's own `Ctrl+B` (send a task to the background) is most likely taken by Herdr (not verified).

### B8.4 Codex

| Keys or command | What it does |
| --- | --- |
| `$name` | Call a skill by name, for example Firstmate's `$bearings` |
| `Esc` | Interrupt the running turn |
| `Esc` `Esc` | Edit your previous message |
| `Ctrl+C` | Interrupt or close a view; press twice to quit (`Ctrl+D` also quits) |
| `Enter` / `Tab` | Send / queue the message while Codex is busy |
| `Shift+Enter`, `Alt+Enter` or `Ctrl+J` | New line without sending |
| `Ctrl+R` | Search earlier prompts |
| `?` | Show the shortcut overview |
| `/new` | Start a new conversation (run `$stow` first) |
| `/quit` or `/exit` | Quit Codex |
| `/status`, `/model` | Session settings and token use; choose model and effort |
| `/compact` | Shrink the conversation to free up context |
| `/hooks` | Review the kit's hooks (asked the first time) |
| `/resume`, `/diff`, `/review` | Reopen a saved conversation; show changes; review changes |

The Codex rows come from the Codex 0.164.0 source, because its online docs moved to a site that could not be checked.

### B8.5 Firstmate

Type these to Firstmate. In Codex use `$` instead of `/`.

| Claude Code | Codex | What it does |
| --- | --- | --- |
| `/bearings` | `$bearings` | Short summary of what is going on and what needs your decision. `/bearings file` also saves it as a dated report |
| `/ahoy` | `$ahoy` | Catch up since your last message, then go through open decisions one at a time |
| `/afk` | `$afk` | Firstmate keeps supervising while you are away |
| `/quiet` / `/quiet off` | `$quiet` / `$quiet off` | Fewer routine interruptions while you chat / back to normal |
| `/stow` | `$stow` | Save what this session learned before you clear or quit |
| `/updatefirstmate` | `$updatefirstmate` | Update Firstmate. Only when the person who shared this guide asks you to (section 3) |

**Plain-language asks work too**, for example: "what's going on?", "fix the flaky login test in my project", "merge it", "switch to balanced", "what token strategy am I on?", "create a second mate for all front-end projects", "stop that task".

**The kit's own commands** (`firstmate`, `fm-mate`, `fm-help`, `fm-jev` and others) are typed in an Ubuntu terminal or Herdr pane, not to Firstmate: see B6.6.

### B8.6 Tower Team tab

Open it with `zoe-fleet-open` (or the launcher's `open`) from a Herdr pane inside Ubuntu (B9). Inside the **Team** tab:

| Keys | What it does |
| --- | --- |
| `?` | Help |
| `Tab`, arrow keys or click | Select a card |
| `Enter` / `Esc` | Open the selected session / back to the fleet |
| `i` | Session details |
| `Space` | Pause or play the timeline |
| `[` / `]` | Step to the previous / next event |
| `g` or `End` | Back to live |
| `o` / `f` | Overview / follow |
| `v` | Show or hide finished workers |
| `q` or `Ctrl+C` | Quit the tab |

Avoid `A`, `D` and `C` unless you mean it: they archive the selected worker, delete it (asks first) and clear everything. These keys come from the tower's source and docs; they are not confirmed on a real run yet.

### B8.7 Windows Terminal and WSL

| Keys or action | What it does |
| --- | --- |
| Drop-down arrow next to the tabs | Open a new tab with the **Ubuntu** profile |
| `Ctrl+Shift+1` … `Ctrl+Shift+9` | New tab with that profile from the drop-down (count where **Ubuntu** is) |
| `Ctrl+Shift+Space` | Open the profile drop-down |
| `Ctrl+Shift+T` | New tab with your default profile |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+Shift+C` (or `Ctrl+C` with text selected) | Copy. Without a selection, `Ctrl+C` goes to the program (interrupt) |
| `Ctrl+Shift+V` or `Ctrl+V` | Paste |
| `Ctrl+Shift+W` | Close the pane |
| `explorer.exe .` (in Ubuntu) | Open the current Ubuntu folder in File Explorer |

**The QuickEdit freeze** happens only in the classic PowerShell window, not in Windows Terminal: selecting text pauses the program. Press **Esc** to continue (B2.4). Turning it off (title bar → **Properties** → **Options** → untick **QuickEdit Mode**) is **not verified** against Microsoft's documentation; simplest is to use Windows Terminal.

## B9. The tower on Windows

The tower is a **Team** tab in Herdr showing your Firstmate, crew and second mates. On Windows it runs **inside Ubuntu**, from a reviewed Windows (WSL2) tower release. If you say yes to the tower (question 4), the kit installs and configures it inside Ubuntu the same way as on macOS. The kit never starts the tower.

- **Ubuntu 22.04 or newer is required.** The tower release is built for Ubuntu 22.04. On an older Ubuntu the kit refuses only the tower, with `refused: the WSL2 tower release needs Ubuntu 22.04 or newer`, and installs everything else. Upgrade Ubuntu, or re-run with `--reconfigure` and answer `n` to question 4.
- **python3 and jq** are needed by the tower's own health check and Firstmate's fleet view (B1). python3 is required for the whole kit; a missing jq shows a `tower-jq` warning. Install them with `sudo apt install -y python3 jq`.
- **The launcher** is printed on the installer's `Tower launcher:` line, and the launcher settings go to `~/.config/zoe-fleet/config` inside Ubuntu.
- **Check it, then open it.** In an Ubuntu terminal run the launcher's `doctor`; then, **from inside a Herdr pane**, open it with the kit's short command `zoe-fleet-open` (or the launcher's `open`). A **Team** tab appears in Herdr. Close it with `herdr pane close <pane-id>`. `zoe-fleet-demo` runs the launcher's own demo.

  ```sh
  <launcher printed on the Tower launcher: line> doctor
  zoe-fleet-open
  ```

- **Opening by itself.** With the tower and Claude Code, the kit adds a start-up entry in your Firstmate home: when Firstmate starts in Claude Code in a Herdr pane, the tower's tab opens once for it. It never takes the tower away from a Firstmate that is already running, and skips a pane that is not in focus.
- **The Claude usage bridge.** With the tower and Claude Code, the kit's `claude` command (B6.6) sits in front of your own Claude Code and passes Claude's usage and status to the tower. Claude Code itself works as usual.
- **The Zoetrope session graph** (`Ctrl+B Shift+C` and `Ctrl+B Shift+Z`, B8.2) is a separate Herdr plugin that shows your sessions as a graph. It comes with the tower.
- **"Partial" is only a testing label**, as on macOS: the install shows `tower: installed from verified release; hands-on acceptance pending`, and setup still ends with `Agent Kit setup complete.` It means the tower's separate hands-on test has not been run for this release yet, not that anything is broken.
- **Not confirmed on a real PC yet.** No Windows PC has run the tower, the session graph or the automatic opening yet, on x64 or Arm64. Most teammates' PCs are x64; your run is the first hands-on check. Please include what `doctor` and `zoe-fleet-open` showed in your pilot feedback (section 4).
- Like on macOS, repair, upgrade and uninstall refuse while the tower is running (B10.3).

Everything else (Firstmate, Herdr, the crew, second mates) works without the tower. You can see what your fleet is doing by asking Firstmate or with `/bearings`.

## B10. Troubleshooting

### B10.1 Common install problems

| You see | Where | What to do |
| --- | --- | --- |
| `Install these yourself on Windows first…` | PowerShell | Install what it lists (it shows the `winget` command), open a **new** PowerShell window, re-run `install.ps1` |
| `Install these yourself first…` | after the handoff (Ubuntu) | Install what it lists **inside Ubuntu** (B2.2), then re-run `install.ps1` |
| `install the GitHub CLI inside this WSL distribution` | after the handoff | Install `gh` inside Ubuntu and run `gh auth login` there (B2.2) |
| `Node.js … is older than 24.15.0` | either side | Update Node on the side that says so. With nvm in Ubuntu: `nvm install 24`, then check B2.2 step 3 |
| `sign in to GitHub with your own account first` | either side | `gh auth login` on that side, then re-run |
| `could not fetch the kit` | either side | You probably do not have repository access yet. Ask for it. Never share a token to get around this. |
| A checksum or digest mismatch | Ubuntu | **Stop.** Do not work around it. Re-run once (a broken download can cause it). If it happens again, send the message (B10.6). |
| `The root folder must be a Linux path inside WSL…` or a root on `/mnt/c/…` refused | PowerShell | Choose a Linux path such as `~/Agentic` (B2.7) |
| `refused` root folder | Ubuntu | Pick a new, empty Linux folder that is not inside a git checkout or another Firstmate home |
| `Agent Kit install: partial` with `hands-on acceptance pending` for the tower | Ubuntu | Expected: only the tower's testing label (B9). Setup still ends `complete` |
| Step 2 `partial` with `conflict` | Ubuntu | Something already exists that the kit will not overwrite, for example your own skill with the same name. Re-run with `--reconfigure` and answer `n` to hooks (question 5), or move your own file aside if you no longer need it. |
| `FAIL <tool>-path` in doctor | Ubuntu | Fix your Ubuntu PATH (B2.11) |
| The receipt records a different kit release | Ubuntu | Your install is on an older release than the installer. Use upgrade (B6.3), or ask for help. |
| `repair needs the current installed release; use upgrade for a new release` | Ubuntu | You ran an older kit copy after an upgrade. Set `AK` to the new kit copy (B6) |
| `the installed kit predates the keys command` | Ubuntu | Your install is older than `pilot-7`. Ask the person who shared this guide; upgrade only when asked (B6.3) |
| `TYPESAFE_API_KEY must be an 8–512 character token…` | Ubuntu | The key you typed has spaces or extra characters. Copy it again from typesafe.ai and rerun `keys` (B6.5) |
| `WARN jev: not ready: …` in doctor | Ubuntu | Normal without a key. With a key, read the reason: add the key (B6.5), fix your Ubuntu PATH (B2.11), or, if you edited the rules file, ask Firstmate to check it |
| `refused: the WSL2 tower release needs Ubuntu 22.04 or newer` | Ubuntu | Your Ubuntu is too old for the tower. Upgrade Ubuntu, or re-run with `--reconfigure` and answer `n` to question 4 (B9) |
| `python3: python3 absent from PATH; …` (or `older than 3.9`) | Ubuntu | Install it inside Ubuntu: `sudo apt install -y python3`, then re-run `install.ps1` |
| `tower-jq` warning | Ubuntu | Install it inside Ubuntu: `sudo apt install -y jq` (B1) |
| Step 4 says `Herdr is running and owns …; stop it (herdr server stop) and rerun` | Ubuntu | Stop Herdr inside Ubuntu with `herdr server stop` (let your agents finish first), then re-run `install.ps1` (B5) |
| Step 4 says `skipped prefix+…: already bound` | Ubuntu | You already use that key in Herdr. Nothing to do; the kit leaves yours. Use the command instead (B6.6) |
| Step 4 says `herdr config check rejected …, so … was restored` | Ubuntu | Your Herdr settings file was put back as it was. Send the message (B10.6) |
| `Claude plugins: not installed; the claude CLI was not found on PATH` | Ubuntu | Make sure `claude` runs in a new Ubuntu terminal, then re-run `install.ps1` |
| `Claude plugins: marketplace … not added: …` | Ubuntu | Usually a network problem; re-run `install.ps1`. If it repeats, send the message (B10.6) |

### B10.2 Windows and WSL2

- **Changing your Ubuntu login shell:** uninstall the kit, then reinstall it from the new shell so its PATH block goes into that shell's profile.
- **Install looks frozen:** it is almost always the QuickEdit selection (B2.4). Press **Esc**. Use Windows Terminal to avoid it.
- **WSL2 not ready:** `install.ps1` prints the exact command to run yourself. Common ones:

  | Situation | Run yourself |
  | --- | --- |
  | No WSL at all | `wsl --install -d Ubuntu` in an **administrator** PowerShell, restart Windows, open Ubuntu once to create your Linux user |
  | WSL2 platform missing | `wsl --install --no-distribution` in an **administrator** PowerShell, then restart Windows |
  | WSL1 is the default | `wsl --set-default-version 2` |
  | Your Ubuntu is on WSL1 | `wsl --set-version Ubuntu 2` |
  | No Linux distribution | `wsl --install -d Ubuntu`, then open it once |
  | Windows too old | Update through Settings → Windows Update |

  If WSL is missing entirely, it may also mention turning on virtualization in your PC's firmware settings.
- **"This window is elevated":** only a note. Close it and use a normal PowerShell window; the kit does not need administrator rights.
- **Node, git or gh "not found" after the handoff:** install them **inside Ubuntu** too, and sign in there with `gh auth login`. Windows and Ubuntu are separate. Run the check in B2.2 step 3.
- **`herdr`, `codex`, `firstmate`, `fm-mate` or `node "$AK"` not found:** you are probably in PowerShell. Open the **Ubuntu** terminal. If it still fails there, check your Ubuntu PATH (B2.11) and open a new Ubuntu terminal. `firstmate`, `fm-mate` and `fm-help` are also missing if you said `n` to question 5.
- **`Open a Herdr pane, then run firstmate (or press Ctrl+B, then F).`:** `firstmate` only starts Firstmate inside Herdr. Run `herdr` first.
- **`Exit the current coordinator cleanly before switching.`:** Only one Firstmate can run in a home; do not open both Captain tabs at once. Switch to its tab, or quit it, before starting another.
- **Firstmate says treehouse, no-mistakes, gh-axi or other tools are missing, or doctor shows `WARN herdr-path-env`:** Herdr was already running before you added the PATH line, so it kept its old PATH. Inside Ubuntu, run `herdr server stop`, then start `herdr` again from an Ubuntu tab that has the PATH line (B2.11).
- **A Herdr key does nothing:** check `fm-help` for the keys you actually got. Press `Ctrl+B Shift+R` to reload Herdr's settings, or restart Herdr. The session graph keys need Herdr started from an Ubuntu terminal whose PATH has `<root>/.tools/bin` first. If a `Ctrl+B Shift+…` key still does nothing in Windows Terminal, use the matching command (B6.6) and tell the person who shared this guide.
- **`run fm-mate inside the WSL2 distribution`** (or the same for `keys` or `jev`): you ran the kit from PowerShell. Run it in Ubuntu.
- **More than one Linux distribution:** the installer uses your default WSL distribution. To use another one, add `--distro <name>` to the `install.ps1` command line.

### B10.3 "Kit services are running"

Repair, upgrade and uninstall will not run while Herdr, the no-mistakes daemon or the tower is running inside Ubuntu. They never stop these for you. The plan shows a `Running <name>: ...` line for each one, with the step to take. This also happens if you run the command from a pane inside Herdr, so use a normal Ubuntu terminal.

First let your agents finish their work, or stop it: stopping Herdr or the daemon ends any agent or check that is still running. Then, in Ubuntu:

- **Herdr:** run `herdr server stop`.
- **no-mistakes daemon:** run `no-mistakes daemon stop`.
- **The tower:** close the Fleet pane in Herdr's **Team** tab (`herdr pane close <pane-id>`). The tower has no stop command of its own.

Then run the command again.

### B10.4 Firstmate home has local changes

Upgrade refuses before changing anything if your Firstmate home has uncommitted changes to its tracked files, is not on the Firstmate version the kit expects, or has an `origin` remote other than the approved Firstmate copy the kit uses. The message says which case applies. The kit will not reset the home.

- Ask Firstmate what the changes are and whether they are needed.
- Save anything you want to keep, then discard the changes, or put the home back on the expected version (the message names the commit).
- If `origin` was changed, set it back to the approved Firstmate copy the message names. Doctor's `firstmate-fork` row also names it, and shows `WARN` until `origin` is right.
- Firstmate updates only through `/updatefirstmate`, which updates from that approved copy.
- Run upgrade again.

**If `/updatefirstmate` was run without being asked** and Firstmate is now newer than the version the kit expects, doctor shows `FAIL firstmate` and upgrade refuses. Do not reset the home yourself. Send the redacted doctor output (B10.6) and wait for a kit release that expects the newer Firstmate, then run upgrade.

Repair still runs in these cases and just reports them.

**Your help page or the tower's start-up entry** are files the kit adds to your Firstmate home, but they never show up as changes there: `data/` is private to you, and the kit lists `.claude/settings.local.json` in the home's own git exclude list.

### B10.5 Anything else

1. Run doctor in Ubuntu (B6.1) and read any `FAIL` line.
2. If a kit file is missing or changed, run repair in Ubuntu (B6.2). For a failed install, re-run the installer from PowerShell (B5). Both are safe.
3. If it still fails, send redacted diagnostics (B10.6).

### B10.6 Sending diagnostics safely

Collect, in **Ubuntu**:

```sh
node "$AK" doctor --json > ~/kit-doctor.json
```

and copy the **text** of the error from your terminal (PowerShell or Ubuntu, wherever it appeared). To open the file from Windows, run `explorer.exe ~` in Ubuntu.

Before you send anything, **redact**:

- Replace your Ubuntu home path (`/home/<you>`) and any Windows user folder (`C:\Users\<you>`) with `~`.
- Replace your root folder path with `<root>`.
- Remove any project names you do not want to share.
- Make sure there is no token, key, password, email or sign-in code anywhere in it.

Send only the redacted doctor output and the error text. **Do not send** your `receipt.json`, any `.env` file, anything from `~/.claude`, `~/.codex` or `~/.config` (on either side), or screenshots of sign-in pages.

### B10.7 Not confirmed yet on Windows, and pilot feedback

The Windows path is checked by automated tests, but has **not yet been run end to end on a real Windows PC**, x64 or Arm64. You, the first teammates, running it on your own PCs, are that first real run. These are expected to work as described but are not confirmed yet:

- `install.ps1` from start to finish on a real PC, including answering the questions (the full-access question and the hidden key prompt) in the PowerShell window after the handoff.
- First-time WSL2 setup, the restart, and creating your Linux user.
- Herdr and the agents running in Windows Terminal, and browser pages opening on the Windows side.
- The kit's Herdr keys through Windows Terminal, the Control Tower tabs they open, and `fm-mate` creating and starting a second mate (B8.2, B7.6).
- The Herdr plugins (session graph, plugin manager), the Herdr layout, and the Claude plugins installing inside Ubuntu.
- The Figma CLI inside Ubuntu working with Figma Desktop on Windows.
- The exact doctor and step 2 wording on Windows.
- The tower's install, `doctor` and `open` inside Ubuntu, and its tab opening by itself (B9).
- Quiet mode delivering Firstmate's collected messages at the end of a turn, and the models stepping down as your quota runs low (B7.4).

When you are done, send your pilot feedback (section 4) to the person who shared this guide, including your Windows build, PC type (x64 or Arm64), WSL version and Ubuntu version. If something does not match this guide, include the redacted error text (B10.6).
