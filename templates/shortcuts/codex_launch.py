"""Full-access Codex launch for this teammate's Firstmate, installed only when they answered yes at setup.

Agent Kit writes <root>/.tools/bin/codex, which sets AGENT_KIT_REAL_CODEX to the kit's pinned Codex CLI and
runs this file. When Firstmate launches Codex with its own bypass or hooks-off flags, those are replaced by
full access with no approval prompts and hooks on. A worker launch (FM_TASK_ID set) also bypasses the hook
trust review, so an autonomous worker never stops at that dialog. A coordinator launch keeps the hook trust
review in the Codex UI. A launch without those flags passes through unchanged. This never edits Codex config
or approves hook trust on disk.
"""
import os
import sys


def adapt(arguments, worker=False):
    result = []
    changed = worker
    index = 0
    while index < len(arguments):
        arg = arguments[index]
        if arg == '--':
            result.extend(arguments[index:])
            break
        if arg == '--dangerously-bypass-hook-trust':
            if not worker:
                raise ValueError('Hook trust must be reviewed in the Codex UI.')
            index += 1
            continue
        if arg == '--dangerously-bypass-approvals-and-sandbox':
            changed = True
            index += 1
            continue
        if arg == '--disable' and index + 1 < len(arguments) and arguments[index + 1] == 'hooks':
            changed = True
            index += 2
            continue
        if arg == '--disable=hooks':
            changed = True
            index += 1
            continue
        # Refuse conflicting forms instead of relying on option precedence.
        if worker and arg in ('-c', '--config') and index + 1 < len(arguments):
            key = arguments[index + 1].split('=', 1)[0].strip()
            if key in ('sandbox_mode', 'approval_policy', 'features.hooks'):
                raise ValueError('Conflicting worker launch policy: ' + key)
        if worker and (arg in ('-s', '--sandbox', '-a', '--ask-for-approval') or
                       arg.startswith(('--sandbox=', '--ask-for-approval='))):
            raise ValueError('Worker permission policy is supplied by the Agent Kit launcher.')
        result.append(arg)
        index += 1
    if changed:
        hooks = ['--dangerously-bypass-hook-trust', '--enable', 'hooks'] if worker else ['--enable', 'hooks']
        result = ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never'] + hooks + result
    return result


def main():
    real = os.environ.get('AGENT_KIT_REAL_CODEX', '')
    if not real:
        print('Agent Kit Codex launcher: not configured; run agent-kit repair.', file=sys.stderr)
        return 2
    try:
        arguments = adapt(sys.argv[1:], worker=bool(os.environ.get('FM_TASK_ID')))
    except ValueError as exc:
        print('Agent Kit Codex launcher: ' + str(exc), file=sys.stderr)
        return 2
    os.execv(real, [real] + arguments)


if __name__ == '__main__':
    sys.exit(main())
