"""open-firstmate: open the Firstmate coordinator, or the tower Team tab, from a Herdr pane or key.

Agent Kit writes <root>/.tools/bin/open-firstmate, which sets the OPEN_FIRSTMATE_* variables
from the kit receipt and runs this file. Usage: open-firstmate [claude|codex|mates]

claude or codex focuses the coordinator tab in the "Control Tower" workspace, creating the
workspace or the tab when missing, and starts that agent CLI in the Firstmate home when the
tab is an idle shell. A tab already running something is only focused, never typed into.
mates runs the tower launcher's own `open`, which shows the Team tab.

Every ID comes from the running Herdr's JSON responses (herdr 0.9.3 CLI); nothing is guessed.
"""
import fcntl
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

WORKSPACE_LABEL = 'Control Tower'
CAPTAIN_TABS = {'claude': 'Captain (Claude)', 'codex': 'Captain (Codex)'}
SHELLS = ('zsh', 'bash', 'sh', 'fish', 'dash')


def setting(name):
    value = os.environ.get('OPEN_FIRSTMATE_' + name, '')
    return value or None


def cli(herdr, *args):
    operation = ' '.join(args[:2])
    result = subprocess.run([herdr, *args], capture_output=True, text=True, timeout=35)
    if result.returncode:
        detail = (result.stderr or result.stdout).strip() or f'exit status {result.returncode}'
        raise RuntimeError(f'herdr {operation} failed: {detail}')
    # pane run submits text and Enter; success may print nothing.
    if args[:2] == ('pane', 'run') and not result.stdout.strip():
        return {}
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'herdr {operation} returned no JSON.') from exc
    if not isinstance(response, dict) or 'result' not in response:
        raise RuntimeError(f'herdr {operation} returned an unexpected response.')
    return response['result']


def idle_shell(herdr, pane_id):
    """True only when a bare shell is the sole foreground process, so nothing running is typed into."""
    info = cli(herdr, 'pane', 'process-info', '--pane', pane_id).get('process_info') or {}
    processes = info.get('foreground_processes') or []
    return (len(processes) == 1 and info.get('shell_pid') is not None
            and processes[0].get('pid') == info['shell_pid']
            and Path(processes[0].get('name') or '').name.lstrip('-') in SHELLS)


def captain_tab(herdr, workspace, tabs, mode):
    """The tab running <mode>, found by the agent Herdr reports in its panes, else by its label."""
    panes = cli(herdr, 'pane', 'list', '--workspace', workspace)['panes']
    running = {p['tab_id'] for p in panes if p.get('agent') == mode}
    found = [t for t in tabs if t['tab_id'] in running]
    if len(found) > 1:
        named = [t for t in found if 'captain' in (t.get('label') or '').lower()]
        if len(named) != 1:
            raise RuntimeError(f'Several tabs in {WORKSPACE_LABEL} run {mode}; rename the coordinator tab "{CAPTAIN_TABS[mode]}".')
        found = named
    if found:
        return found[0], panes
    labelled = [t for t in tabs if t.get('label') == CAPTAIN_TABS[mode]]
    if len(labelled) > 1:
        raise RuntimeError(f'Several tabs are named {CAPTAIN_TABS[mode]}; rename all but one.')
    return (labelled[0] if labelled else None), panes


def open_captain(herdr, home, mode, agent):
    command = shlex.join(['cd', home]) + ' && ' + shlex.join([agent])
    workspaces = [w for w in cli(herdr, 'workspace', 'list')['workspaces'] if w.get('label') == WORKSPACE_LABEL]
    if len(workspaces) > 1:
        raise RuntimeError(f'Several workspaces are named {WORKSPACE_LABEL}; rename all but one.')
    if not workspaces:
        created = cli(herdr, 'workspace', 'create', '--cwd', home, '--label', WORKSPACE_LABEL, '--focus')
        cli(herdr, 'tab', 'rename', created['tab']['tab_id'], CAPTAIN_TABS[mode])
        cli(herdr, 'pane', 'run', created['root_pane']['pane_id'], command)
        return f'Opened {WORKSPACE_LABEL} and started {mode} in the Firstmate home.'
    workspace = workspaces[0]['workspace_id']
    tabs = cli(herdr, 'tab', 'list', '--workspace', workspace)['tabs']
    tab, panes = captain_tab(herdr, workspace, tabs, mode)
    if tab is None:
        created = cli(herdr, 'tab', 'create', '--workspace', workspace, '--cwd', home, '--label', CAPTAIN_TABS[mode], '--focus')
        cli(herdr, 'pane', 'run', created['root_pane']['pane_id'], command)
        return f'Opened {CAPTAIN_TABS[mode]} and started {mode} in the Firstmate home.'
    cli(herdr, 'workspace', 'focus', workspace)
    cli(herdr, 'tab', 'focus', tab['tab_id'])
    own = [p for p in panes if p['tab_id'] == tab['tab_id']]
    if len(own) == 1 and own[0].get('agent') != mode and idle_shell(herdr, own[0]['pane_id']):
        cli(herdr, 'pane', 'run', own[0]['pane_id'], command)
        return f'Started {mode} in {tab.get("label") or CAPTAIN_TABS[mode]}.'
    return f'Focused {tab.get("label") or CAPTAIN_TABS[mode]}; it is already running something, so nothing was typed into it.'


def main(argv):
    mode = argv[1] if len(argv) > 1 else None
    if len(argv) > 2 or mode not in ('claude', 'codex', 'mates', None):
        raise RuntimeError('usage: open-firstmate [claude|codex|mates]')
    herdr, home = setting('HERDR'), setting('HOME')
    agents = {name: setting(name.upper()) for name in CAPTAIN_TABS}
    mode = mode or next((name for name in CAPTAIN_TABS if agents[name]), None)
    if os.environ.get('HERDR_ENV') != '1':
        raise RuntimeError('Run open-firstmate inside Herdr: from a Herdr pane, or with its Herdr key.')
    if not herdr or not home:
        raise RuntimeError('open-firstmate is not configured; run agent-kit repair.')
    if mode == 'mates':
        tower = setting('TOWER')
        if not tower:
            raise RuntimeError('The fleet tower is not installed in this setup, so there is no Team tab to open.')
        os.execve(tower, [tower, 'open'], {**os.environ, 'HERDR_BIN_PATH': herdr})
    if mode is None or not agents.get(mode):
        raise RuntimeError(f'{mode or "No agent CLI"} is not set up by Agent Kit here; choose ' + ' or '.join(n for n in CAPTAIN_TABS if agents[n]) + '.')
    # A quickly repeated key must not create two coordinator tabs.
    with open(setting('LOCK') or os.devnull, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RuntimeError('open-firstmate is already running; try again in a moment.')
        print(open_captain(herdr, home, mode, agents[mode]))


if __name__ == '__main__':
    try:
        main(sys.argv)
    except Exception as exc:
        print('open-firstmate: ' + str(exc), file=sys.stderr)
        if sys.stdin.isatty():
            input('Press Enter to close. ')
        sys.exit(1)
