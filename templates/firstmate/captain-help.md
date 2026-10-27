# Captain's guide

Agent Kit wrote this starter page for {{FIRSTMATE_HOME}} because none existed. It is yours: edit it, or ask Firstmate to keep it current. Agent Kit never overwrites it once you change it. Print it with `fm-help`.

## Start up

1. Open a new terminal. Make sure `{{TOOLS_BIN}}` comes first on your PATH.
2. Check the setup: `node {{KIT}}/bin/agent-kit.mjs doctor --install-root {{INSTALL_ROOT}}`.
3. Sign in to your agent CLIs yourself ({{AGENTS}}). The kit never signs in for you.
4. Start Herdr: `herdr`.
5. In a Herdr pane, start the coordinator with `firstmate` (or press a key below). It starts in {{FIRSTMATE_HOME}}.

## Herdr keys

Press Ctrl+B, release, then the key.

{{KEYS}}

Keys you bound yourself win: the kit skips any key you already use.

## Everyday commands

- `firstmate [claude|codex|check]`: start the coordinator in this home, or check it without starting anything.
- `fm-mate`: create a second mate (it asks for a name and a one-line scope). `fm-mate list` shows them. `fm-mate retire <name>` retires one through Firstmate's own teardown.
- `fm-jev on|off|status`: turn Jev routing on or off. Off keeps your TYPESAFE_API_KEY in `.env`, commented out.
- `agent-kit keys`: add, change or remove TYPESAFE_API_KEY at a hidden prompt, from your own terminal.
- `fm-help`: print this page.

## Stop and come back

To stop for the day, exit the coordinator, then close Herdr. Tomorrow, start Herdr and the coordinator again. Firstmate picks up from its own records in this home.
