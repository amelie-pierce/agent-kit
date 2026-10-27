import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { strategyTakesPlans } from '../src/dispatch.mjs';

// End-to-end proof that typing a key into `agent-kit keys` is the only step Jev routing needs: the kit writes
// the key and its plan-fitted starter rules (Claude Pro, lean) into a copy of the pinned Firstmate, and that Firstmate's own
// bin/fm-dispatch-resolve.sh then returns a clear profile from those rules. curl and quota-axi are stubs on
// PATH, so nothing reaches typesafe.ai and the key is an obvious placeholder.
// AGENT_KIT_FIRSTMATE_SRC may name an already extracted pinned Firstmate; otherwise the pinned archive is
// downloaded and checked against the manifest digest.
if (process.platform === 'win32') throw new Error('run this smoke on macOS or Linux; Windows runs the kit inside WSL');
const kit = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(kit, 'manifests', 'pilot-skeleton.json'), 'utf8'));
const pin = manifest.tools.find(tool => tool.id === 'firstmate');
const placeholder = 'placeholder-typesafe-key-000';
const base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-kit-jev-smoke-')));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
};
try {
  let source = process.env.AGENT_KIT_FIRSTMATE_SRC;
  if (!source) {
    const artifact = Object.values(pin.artifacts).find(a => a.status === 'verified');
    const body = Buffer.from(await (await fetch(artifact.url)).arrayBuffer());
    assert.equal(createHash('sha256').update(body).digest('hex'), artifact.sha256, 'pinned Firstmate archive digest');
    writeFileSync(join(base, 'firstmate.tgz'), body);
    source = join(base, 'firstmate-src');
    mkdirSync(source);
    assert.equal(run('tar', ['-xzf', join(base, 'firstmate.tgz'), '-C', source, '--strip-components=1']).status, 0);
  }

  // A kit install as setup leaves it: the pinned Firstmate home and a private receipt.
  const home = join(base, 'home'), root = join(home, 'Agentic'), firstmate = join(root, 'firstmate'), tools = join(root, '.tools');
  mkdirSync(tools, { recursive: true });
  cpSync(source, firstmate, { recursive: true });
  for (const dir of ['data', 'state', 'config', 'projects']) mkdirSync(join(firstmate, dir), { recursive: true });
  const gitEnv = { HOME: home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  assert.equal(run('git', ['init', '-q', firstmate], { env: gitEnv }).status, 0);
  writeFileSync(join(tools, 'receipt.json'), `${JSON.stringify({ schemaVersion: 1, release: manifest.release, phases: {},
    setup: { answers: { harness: 'claude', plans: { claude: 'pro' }, dispatchMode: 'lean' }, paths: { root, installRoot: tools, firstmateHome: firstmate } } })}\n`, { mode: 0o600 });

  // The one step: agent-kit keys on a terminal, key typed at the hidden prompt. Replies reach python on stdin.
  const driver = `
import json, os, pty, select, sys, time
spec = json.load(sys.stdin)
pid, fd = pty.fork()
if pid == 0:
    os.execve(spec["argv"][0], spec["argv"], spec["env"])
out, replies, deadline = b"", spec["replies"], time.time() + 60
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try: chunk = os.read(fd, 4096)
        except OSError: break
        if not chunk: break
        out += chunk
    if replies and replies[0][0].encode() in out.split(b"\\x00")[-1]:
        os.write(fd, replies.pop(0)[1].encode()); out += b"\\x00"
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.replace(b"\\x00", b"").decode(errors="replace"))
sys.exit(os.waitstatus_to_exitcode(status))
`;
  const keys = run('python3', ['-c', driver], { input: JSON.stringify({ argv: [process.execPath, join(kit, 'bin', 'agent-kit.mjs'), 'keys', '--install-root', tools],
    env: gitEnv, replies: [['Keep or add?', 'add\n'], ['hidden; press Enter', `${placeholder}\r`]] }) });
  assert.equal(keys.status, 0, keys.stdout + keys.stderr);
  // A Firstmate whose fm-strategy.sh takes --plans selects the strategy itself; an older one gets the kit's bridge file.
  const native = strategyTakesPlans(firstmate);
  if (native) {
    assert.match(keys.stdout, /Starter dispatch rules: selected Firstmate's lean strategy for claude fitted to your plan \(claude pro\) with bin\/fm-strategy\.sh set lean --providers claude --plans claude=pro --yes/);
    assert.match(readFileSync(join(firstmate, 'config', 'strategy'), 'utf8'), /^plans=claude=pro$/m);
    assert.equal(JSON.parse(readFileSync(join(tools, 'receipt.json'), 'utf8')).setup.dispatch.via, 'fm-strategy');
  } else {
    assert.match(keys.stdout, /Starter dispatch rules: wrote Firstmate's lean rules for claude fitted to your plan \(claude pro\)/);
    assert.equal(existsSync(join(firstmate, 'config', 'strategy')), false);
  }
  assert.equal((keys.stdout + keys.stderr).includes(placeholder), false, 'keys never shows the value');
  const rules = JSON.parse(readFileSync(join(firstmate, 'config', 'crew-dispatch.json'), 'utf8'));
  const pick = rules.rules.findIndex(rule => rule.strategy === 'standard');
  assert.ok(pick >= 0, 'balanced rules include the standard tier');
  const expected = [rules.rules[pick].use].flat()[0];
  assert.deepEqual(expected, { harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', floor: { scope: 'all_models', min_percent: 20 } }, 'Claude Pro lean standard tier');

  // Stubs: curl answers as typesafe.ai would and records whether the key arrived on fd 3; quota-axi reports room.
  const stubs = join(base, 'stubs'); mkdirSync(stubs);
  const choices = [...rules.rules.map((_rule, i) => `rule_${i + 1}`), 'default'];
  const probabilities = Object.fromEntries(choices.map(id => [id, id === `rule_${pick + 1}` ? 1 - 0.01 * (choices.length - 1) : 0.01]));
  writeFileSync(join(base, 'response.json'), JSON.stringify({ model: 'jev-fixture', answers: { rule: { type: 'choice', choice: `rule_${pick + 1}`, confidence: 0.95, probabilities } },
    usage: { input_tokens: 10, output_tokens: 2 } }));
  writeFileSync(join(stubs, 'curl'), `#!/usr/bin/env bash
out=''
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; *) shift ;; esac; done
cat > "${base}/request.json"
IFS= read -r header <&3 || header=''
[ "$header" = "Authorization: Bearer ${placeholder}" ] && echo delivered > "${base}/auth" || echo missing > "${base}/auth"
cp "${base}/response.json" "$out"
printf 200
`, { mode: 0o755 });
  writeFileSync(join(stubs, 'quota-axi'), `#!/bin/sh
cat <<'JSON'
{"generatedAt":"2030-01-01T00:00:00Z","schemaVersion":5,"providers":[{"provider":"claude","state":{"status":"fresh"},"quotaSemantics":{"status":"known","effectiveAvailability":[{"scope":"all_models","status":"known","effectivePercentRemaining":80,"runway":{"status":"through_reset"},"selection":{"spendPriority":0.5}}]}}]}
JSON
`, { mode: 0o755 });
  writeFileSync(join(base, 'brief.md'), "# Task\n## Captain's intent\nAdd a unit test for the existing date formatter; the expected output is described in the issue.\n\n## Firstmate spec\nOne new test file next to the formatter.\n");

  const jq = run('/bin/sh', ['-c', 'command -v jq']).stdout.trim();
  assert.ok(jq, 'jq is required, as Firstmate requires it');
  const resolve = run('bash', [join(firstmate, 'bin', 'fm-dispatch-resolve.sh'), join(base, 'brief.md'), '--project', 'sample'],
    { env: { HOME: home, FM_HOME: firstmate, PATH: [stubs, dirname(jq), '/usr/bin', '/bin'].join(':') } });
  process.stdout.write(resolve.stdout); process.stderr.write(resolve.stderr);
  assert.equal(resolve.status, 0);
  assert.equal(readFileSync(join(base, 'auth'), 'utf8').trim(), 'delivered', 'the resolver read the key the kit wrote to .env');
  assert.match(resolve.stdout, /status: clear/);
  assert.ok(resolve.stdout.includes(`profile: --harness '${expected.harness}' --model '${expected.model}' --effort '${expected.effort}'`), 'profile comes from the written standard rule');
  for (const text of [resolve.stdout, resolve.stderr, readFileSync(join(base, 'request.json'), 'utf8')]) assert.equal(text.includes(placeholder), false, 'no key in output or request body');

  const health = run(process.execPath, [join(kit, 'bin', 'agent-kit.mjs'), 'doctor', '--install-root', tools], { env: { HOME: home, PATH: [stubs, dirname(jq), '/usr/bin', '/bin'].join(':') } });
  assert.match(health.stdout, /PASS jev: ready \(key set, rules present\)/);
  assert.equal(health.stdout.includes(placeholder), false);
  console.log(`Jev end-to-end smoke passed against Firstmate ${process.env.AGENT_KIT_FIRSTMATE_SRC ? 'at AGENT_KIT_FIRSTMATE_SRC' : pin.version.value}: keys wrote the key and ${native ? 'selected the strategy' : 'the bridge rules'}, fm-dispatch-resolve.sh returned ${expected.harness} ${expected.model} ${expected.effort}`);
} finally {
  rmSync(base, { recursive: true, force: true });
}
