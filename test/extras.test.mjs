import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlugin, fleetPluginId, managerPluginId, planPlugin, planRemovePlugin, pluginId, removePlugin } from '../src/herdr-plugin.mjs';
import { applyAutostart, applyLayout, autostartMarker, captainHelp, kitKeys, layoutBegin, placeCaptainHelp, planAutostart, planLayout, renderBlock, shortcutsHealth, shortcutInputs, splitBlock } from '../src/shortcuts.mjs';
import { applyPatch, claudePluginsHealth, placeClaudePlugins, pluginTable, removeClaudePlugins } from '../src/claude-plugins.mjs';
import { previewHooks } from '../src/install/hooks.mjs';
import { runJev } from '../src/jev.mjs';
import { runMate } from '../src/mate.mjs';
import { doctor, firstmateFork } from '../src/doctor.mjs';

const kit = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../manifests/pilot-skeleton.json', import.meta.url)));
const sha = body => createHash('sha256').update(body).digest('hex');
const posixOnly = { skip: process.platform === 'win32' };
const gitEnv = home => ({ HOME: home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
const sink = () => { const chunks = []; return { write: chunk => { chunks.push(String(chunk)); return true; }, get text() { return chunks.join(''); } }; };

// A kit root with Herdr, the tower runtime and the three Herdr plugins recorded in its receipt, a temp HOME and a
// Firstmate home that is a git checkout. Plugin manifests are small fixtures shaped like the pinned ones.
function fixture(t, { tower = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-extras-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), agentic = join(base, 'Agentic'), root = join(agentic, '.tools'), firstmate = join(agentic, 'firstmate'), rel = join(root, 'releases', 'r');
  for (const dir of [home, join(rel, 'bin'), join(firstmate, 'bin'), join(firstmate, 'data'), join(firstmate, '.claude')]) mkdirSync(dir, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', firstmate], { env: gitEnv(home) }).status, 0);
  writeFileSync(join(rel, 'bin', 'herdr'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(rel, 'bin', 'zoe-fleet'), '#!/bin/sh\necho zoe\n', { mode: 0o755 });
  const plugin = (dir, toml, files = {}) => { mkdirSync(join(rel, dir, 'herdr'), { recursive: true }); writeFileSync(join(rel, dir, 'herdr-plugin.toml'), toml);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(rel, dir, name), body, { mode: 0o755 }); };
  // The session graph's keys.sh stand-in writes its marker block the way the real one does, through HERDR_CONFIG_PATH.
  plugin('zoetrope-herdr-plugin', 'id = "furkankly.zoetrope"\nname = "zoetrope"\nversion = "0.1.0"\nmin_herdr_version = "0.8.2"\nplatforms = ["macos", "linux"]\n\n[[build]]\ncommand = ["bash", "herdr/ensure-zoe.sh"]\n\n[[panes]]\nid = "graph"\ntitle = "zoetrope"\nplacement = "overlay"\ncommand = ["bash", "herdr/open.sh"]\n\n[[actions]]\nid = "open-tab"\ntitle = "zoetrope: session graph (tab)"\ncontexts = ["pane", "workspace"]\ncommand = ["bash", "herdr/pane.sh", "open", "tab"]\n',
    { 'herdr/keys.sh': `#!/bin/sh\n"$HERDR_BIN_PATH" config check || exit 1\n[ "$1" = setup ] && printf '\\n# >>> furkankly.zoetrope keys (managed: \`setup-keys\` writes this block, \`remove-keys\` deletes it)\\n[[keys.command]]\\nkey = "prefix+shift+z"\\n# <<< furkankly.zoetrope keys\\n' >> "$HERDR_CONFIG_PATH"\n[ "$1" = remove ] && sed -i.bak '/furkankly.zoetrope keys/,/<<< furkankly.zoetrope keys/d' "$HERDR_CONFIG_PATH"\n"$HERDR_BIN_PATH" server reload-config\n` });
  plugin('zoe-fleet-runtime/fleet-plugin', 'id = "pikenguyen227.zoetrope-fleet"\nname = "Zoetrope Fleet"\nversion = "0.1.0"\nplatforms = ["macos", "linux"]\n\n[[panes]]\nid = "fleet"\ntitle = "Team"\nplacement = "tab"\ncommand = ["bash", "open.sh"]\n');
  plugin('herdr-plugin-manager', 'id = "ray.plugin-manager"\nname = "Plugin Manager"\nversion = "0.5.0"\n\n[[panes]]\nid = "manager"\ntitle = "Plugin Manager"\nplacement = "popup"\nwidth = 82\nheight = 28\ncommand = ["bash", "-c", "exec bash manager.sh"]\n\n[[actions]]\nid = "open"\ntitle = "Open plugin manager"\ncontexts = ["workspace"]\ncommand = ["bash", "-c", "exec herdr plugin pane open"]\n');
  const receipt = { schemaVersion: 1, release: 'r', phases: {
    herdr: { state: 'complete', path: 'releases/r/bin/herdr' }, 'zoe-fleet': { state: 'complete', path: 'releases/r/bin/zoe-fleet' },
    'zoetrope-herdr-plugin': { state: 'complete', path: 'releases/r/zoetrope-herdr-plugin' }, 'herdr-plugin-manager': { state: 'complete', path: 'releases/r/herdr-plugin-manager' },
    ...(tower ? { 'zoe-fleet-runtime': { state: 'complete', path: 'releases/r/zoe-fleet-runtime' }, 'zoe-fleet-tower': { state: 'complete', path: join(home, '.config', 'zoe-fleet', 'config') } } : {}),
    firstmate: { state: 'complete', path: firstmate } },
    setup: { answers: { harness: 'both', globalHooks: true, tower, figma: true }, paths: { root: agentic, firstmateHome: firstmate, installRoot: root }, kit: { commit: 'k', path: kit } } };
  writeFileSync(join(root, 'receipt.json'), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const env = { HOME: home, PATH: '/usr/bin:/bin' }, configPath = join(home, '.config', 'herdr', 'config.toml'), registry = join(home, '.config', 'herdr', 'plugins.json');
  return { base, home, root, firstmate, receipt, env, configPath, registry };
}
const plugins = async (f, extra = {}) => applyPlugin(planPlugin(f.receipt, f.root, { env: f.env, home: f.home, configPath: f.configPath, isRunning: () => false, ...extra }), { env: f.env });

test('the Herdr plugins are registered as local entries beside the person\'s own, from their manifests, and the session graph writes its own keys', posixOnly, async t => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.config', 'herdr'), { recursive: true });
  const theirs = { plugin_id: 'someone.else', name: 'theirs', enabled: true, source: { kind: 'github' } };
  writeFileSync(f.registry, `${JSON.stringify([theirs])}\n`);
  const result = await plugins(f);
  const entries = JSON.parse(readFileSync(f.registry, 'utf8'));
  assert.deepEqual(entries.map(e => e.plugin_id), ['someone.else', pluginId, managerPluginId, fleetPluginId]);
  assert.deepEqual(entries[0], theirs, 'the person\'s entry is untouched');
  const graph = entries[1];
  assert.deepEqual([graph.source, graph.enabled, graph.plugin_root, graph.build], [{ kind: 'local' }, true, join(f.root, 'releases', 'r', 'zoetrope-herdr-plugin'), undefined], 'a linked local plugin has no build step');
  assert.deepEqual(entries[2].panes[0], { id: 'manager', title: 'Plugin Manager', placement: 'popup', width: 82, height: 28, command: ['bash', '-c', 'exec bash manager.sh'] }, 'every manifest field is kept');
  assert.equal(readFileSync(join(f.root, 'bin', 'zoe'), 'utf8').includes(join(f.root, 'releases', 'r', 'bin', 'zoe-fleet')), true, 'zoe is the pinned zoe-fleet build');
  assert.equal(result.keys.action, 'add');
  assert.match(readFileSync(f.configPath, 'utf8'), /key = "prefix\+shift\+z"/);
  assert.ok(readdirSync(join(f.root, 'backups', 'shortcuts')).some(name => name.endsWith('herdr-plugins.json')), 'plugins.json backed up first');
  // A rerun verifies; an entry the person owns under the same id is never replaced.
  assert.deepEqual((await plugins(f, { record: result.record })).regs.map(r => r.action), ['verify', 'verify', 'verify']);
  const other = fixture(t);
  mkdirSync(join(other.home, '.config', 'herdr'), { recursive: true });
  writeFileSync(other.registry, `${JSON.stringify([{ plugin_id: pluginId, source: { kind: 'github' } }])}\n`);
  const kept = await plugins(other);
  assert.match(kept.regs[0].detail, /already has a furkankly\.zoetrope entry; left as it is/);
  assert.equal(JSON.parse(readFileSync(other.registry, 'utf8')).filter(e => e.plugin_id === pluginId).length, 1);
  // Uninstall: remove-keys, then only the kit's entries and zoe.
  const plan = planRemovePlugin(f.root, result.record, f.configPath);
  await removePlugin(plan, { env: f.env, herdr: join(f.root, 'releases', 'r', 'bin', 'herdr') });
  assert.deepEqual(JSON.parse(readFileSync(f.registry, 'utf8')), [theirs]);
  assert.doesNotMatch(readFileSync(f.configPath, 'utf8'), /furkankly\.zoetrope keys/);
  assert.equal(existsSync(join(f.root, 'bin', 'zoe')), false);
});

test('Herdr layout, plugin entries, zoe, the autostart hook and the captain guide identical to the kit\'s are adopted without a record; differing ones are kept', posixOnly, async t => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.config', 'herdr'), { recursive: true });
  writeFileSync(f.configPath, 'onboarding = true\n');
  const placed = await plugins(f);
  const layout = await applyLayout(planLayout(f.configPath, { root: '/r/Agentic', want: true }), f.root, { env: f.env, check: () => ({ ok: true }) });
  const inputs = shortcutInputs(f.receipt, f.root, f.env);
  const autostart = await applyAutostart(planAutostart(inputs, f.root), f.root);
  const help = await placeCaptainHelp(inputs, ['prefix+f']);
  const config = readFileSync(f.configPath, 'utf8'), registry = readFileSync(f.registry, 'utf8');
  // No record at all, as after a rolled-back upgrade: each piece is verified and recorded, nothing rewritten.
  const again = await plugins(f);
  assert.deepEqual(again.regs.map(r => r.action), ['verify', 'verify', 'verify']);
  assert.equal(again.zoe.action, 'verify');
  for (const key of ['entrySha256', 'managerSha256', 'fleetSha256', 'zoeSha256', 'keysSha256']) assert.equal(again.record[key], placed.record[key], key);
  const layoutPlan = planLayout(f.configPath, { root: '/r/Agentic', want: true });
  assert.equal(layoutPlan.action, 'verify');
  assert.deepEqual(await applyLayout(layoutPlan, f.root, { env: f.env }), layout);
  const autostartPlan = planAutostart(inputs, f.root);
  assert.equal(autostartPlan.action, 'verify');
  assert.equal((await applyAutostart(autostartPlan, f.root)).autostart, true);
  assert.deepEqual(await placeCaptainHelp(inputs, ['prefix+f']), { action: 'verify', path: help.path, record: help.record });
  assert.equal(readFileSync(f.configPath, 'utf8'), config);
  assert.equal(readFileSync(f.registry, 'utf8'), registry);
  // Differing pieces stay the person's.
  writeFileSync(join(f.root, 'bin', 'zoe'), '#!/bin/sh\necho mine\n', { mode: 0o755 });
  writeFileSync(f.configPath, config.replace('name = "gruvbox"', 'name = "nord"'));
  const entries = JSON.parse(registry); entries.find(e => e.plugin_id === managerPluginId).enabled = false;
  writeFileSync(f.registry, `${JSON.stringify(entries)}\n`);
  const kept = await plugins(f);
  assert.equal(kept.zoe.action, 'conflict');
  assert.equal(kept.record.zoeSha256, undefined);
  assert.equal(kept.regs.find(r => r.spec.id === managerPluginId).action, 'keep');
  assert.equal(kept.record.managerSha256, undefined);
  assert.equal(planLayout(f.configPath, { root: '/r/Agentic', want: true }).action, 'keep');
  assert.equal(readFileSync(join(f.root, 'bin', 'zoe'), 'utf8'), '#!/bin/sh\necho mine\n');
});

test('the kit never writes Herdr\'s plugin registry while Herdr runs', posixOnly, async t => {
  const f = fixture(t);
  const result = await plugins(f, { isRunning: id => id === 'herdr' });
  assert.ok(result.regs.every(r => r.action === 'deferred'));
  assert.match(result.regs[0].detail, /Herdr is running and owns .*plugins\.json; stop it \(herdr server stop\) and rerun/);
  assert.equal(existsSync(f.registry), false);
});

test('the Fleet autostart hook is a marker-owned SessionStart entry kept out of the home\'s Git state, and leaves with uninstall', posixOnly, async t => {
  const f = fixture(t);
  const settings = join(f.firstmate, '.claude', 'settings.local.json');
  writeFileSync(settings, `${JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } })}\n`);
  const inputs = shortcutInputs(f.receipt, f.root, f.env);
  const added = await applyAutostart(planAutostart(inputs, f.root), f.root);
  const value = JSON.parse(readFileSync(settings, 'utf8'));
  assert.deepEqual(value.permissions, { allow: ['Bash(ls)'] });
  assert.equal(value.hooks.SessionStart[0].hooks[0].command, 'echo mine');
  assert.ok(value.hooks.SessionStart[1].hooks[0].command.endsWith(autostartMarker));
  assert.equal(added.excludeAdded, true);
  const status = spawnSync('git', ['-C', f.firstmate, 'status', '--porcelain', '--untracked-files=all'], { env: gitEnv(f.home), encoding: 'utf8' }).stdout;
  assert.doesNotMatch(status, /settings\.local\.json/, 'the home stays clean for uninstall --remove-firstmate-home');
  assert.equal(planAutostart(inputs, f.root, { record: { autostart: added } }).action, 'verify');
  await applyAutostart(planAutostart({ ...inputs, tower: null }, f.root, { record: { autostart: added } }), f.root);
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')).hooks.SessionStart, [{ hooks: [{ type: 'command', command: 'echo mine' }] }]);
  assert.doesNotMatch(readFileSync(join(f.firstmate, '.git', 'info', 'exclude'), 'utf8'), /agent-kit/);
});

test('the Herdr layout block sits before the person\'s first table, leaves out what they set, and is removed cleanly', posixOnly, async t => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.config', 'herdr'), { recursive: true });
  const mine = '# mine\nonboarding = true\n\n[theme]\nname = "nord"\n\n[[keys.command]]\nkey = "prefix+x"\n';
  writeFileSync(f.configPath, mine);
  const plan = planLayout(f.configPath, { root: '/r/Agentic', want: true });
  assert.deepEqual(plan.skipped, ['onboarding', 'theme']);
  const layout = await applyLayout(plan, f.root, { env: f.env, check: () => ({ ok: true }) });
  const text = readFileSync(f.configPath, 'utf8');
  assert.ok(text.indexOf(layoutBegin) > text.indexOf('onboarding = true') && text.indexOf(layoutBegin) < text.indexOf('[theme]'), 'after their top-level keys, before their tables');
  assert.match(text, /\[terminal\]\n# Default root for new panes, tabs and workspaces\.\nnew_cwd = "\/r\/Agentic"/);
  assert.doesNotMatch(text, /theme-sync|Ghostty/);
  assert.equal(planLayout(f.configPath, { root: '/r/Agentic', want: true, record: layout }).action, 'verify');
  const rejected = planLayout(f.configPath, { root: '/elsewhere', want: true, record: layout });
  assert.equal(rejected.action, 'refresh');
  assert.match((await applyLayout(rejected, f.root, { env: f.env, check: () => ({ ok: false, detail: 'bad' }) })).error, /herdr config check rejected the layout block, so .* was restored: bad/);
  assert.equal(readFileSync(f.configPath, 'utf8'), text);
  await applyLayout(planLayout(f.configPath, { want: false, record: layout }), f.root, {});
  assert.equal(readFileSync(f.configPath, 'utf8'), mine);
});

test('the Herdr layout block never lands inside the kit keys block or the session graph\'s keys block', posixOnly, async t => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.config', 'herdr'), { recursive: true });
  const keys = renderBlock(kitKeys.map(k => ({ ...k, command: k.action || `open-firstmate ${k.mode}` })));
  const graph = '# >>> furkankly.zoetrope keys (managed: `setup-keys` writes this block, `remove-keys` deletes it)\n[[keys.command]]\nkey = "prefix+shift+z"\n# <<< furkankly.zoetrope keys';
  const mine = `onboarding = true\n\n${graph}\n\n${keys}\n`;
  writeFileSync(f.configPath, mine);
  const plan = planLayout(f.configPath, { root: '/r/Agentic', want: true });
  assert.equal(plan.action, 'add');
  const layout = await applyLayout(plan, f.root, { env: f.env, check: () => ({ ok: true }) });
  const text = readFileSync(f.configPath, 'utf8');
  assert.equal(splitBlock(text).block, keys, 'the kit keys block is intact, so its digest still matches');
  assert.ok(text.includes(graph), 'the session graph keys block is intact');
  assert.ok(text.indexOf(layoutBegin) > text.indexOf('onboarding = true') && text.indexOf(layoutBegin) < text.indexOf(graph));
  await applyLayout(planLayout(f.configPath, { want: false, record: layout }), f.root, {});
  assert.equal(readFileSync(f.configPath, 'utf8'), mine);
});

test('the playwright MCP server is pinned through the kit\'s edit of the pinned .mcp.json, and doctor names a marketplace the person already had', posixOnly, async t => {
  const f = fixture(t);
  const table = pluginTable(), patch = table.patches.find(p => p.id === 'playwright-mcp-version');
  const playwright = table.marketplaces.find(m => m.name === 'claude-plugins-official').plugins.find(p => p.name === 'playwright');
  assert.deepEqual(playwright.npm, { package: '@playwright/mcp', version: '0.0.83', integrity: 'sha512-oNcl+Ae2/IAjhfPeP46BfIkSakfmprY+aOtkv5MjrQ4lPav4/yNtPhL0iq8SlIM90oApWgBDUxaNKvktazUKOg==' });
  const upstream = '{\n  "playwright": {\n    "command": "npx",\n    "args": ["@playwright/mcp@latest"]\n  }\n}\n';
  assert.equal(sha(upstream), patch.sha256, 'the pinned original at claude-plugins-official 41f619d6');
  const cache = join(f.home, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'playwright', '41f619d61b99');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, '.mcp.json'), upstream);
  const run = () => ({ status: 0, stdout: `${JSON.stringify({ outcome: 'ok', message: 'Successfully done' })}\n` });
  const result = await placeClaudePlugins({ harness: 'claude', figma: false }, { claude: '/bin/claude', env: f.env, home: f.home, run });
  assert.deepEqual(JSON.parse(readFileSync(join(cache, '.mcp.json'), 'utf8')).playwright.args, ['@playwright/mcp@0.0.83']);
  assert.ok(result.record.patches.includes('playwright-mcp-version'));
  assert.ok(result.lines.includes('Claude plugins: playwright-mcp-version: playwright MCP server runs @playwright/mcp@0.0.83'));
  const again = await placeClaudePlugins({ harness: 'claude', figma: false }, { claude: '/bin/claude', env: f.env, home: f.home, record: result.record, run });
  assert.ok(again.lines.includes('Claude plugins: playwright-mcp-version: playwright MCP server runs @playwright/mcp@0.0.83'), 'a rerun sees the edit in place');
  writeFileSync(join(cache, '.mcp.json'), upstream.replace('@latest', '@next'));
  assert.equal((await applyPatch(patch, join(f.home, '.claude'))).applied, false, 'a file that is not the pinned original is left as it is');
  // A marketplace the person already had is theirs; doctor compares its revision with the kit's pin.
  const pinned = table.marketplaces.find(m => m.name === 'claude-plugins-official').commit, location = join(f.base, 'official');
  mkdirSync(location, { recursive: true });
  writeFileSync(join(f.home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'claude-plugins-official': { installLocation: location } }));
  writeFileSync(join(location, '.gcs-sha'), `${'a'.repeat(40)}\n`);
  const row = () => claudePluginsHealth(null, f.env, f.home, { harness: 'claude' }).find(r => r.id === 'claude-marketplace-claude-plugins-official');
  assert.deepEqual([row().status, row().detail], ['warn', `your own claude-plugins-official marketplace is at ${'a'.repeat(40)}, not the kit's pinned ${pinned}; its plugins follow your revision`]);
  writeFileSync(join(location, '.gcs-sha'), `${pinned}\n`);
  assert.equal(row().status, 'pass');
  assert.equal(claudePluginsHealth({ markets: ['claude-plugins-official'], plugins: [] }, f.env, f.home, { harness: 'claude' }).some(r => r.id.startsWith('claude-marketplace-')), false, 'a marketplace the kit added is pinned already');
});

test('a starter captain guide is written only when the home has none, names the bound keys, and is never overwritten', posixOnly, async t => {
  const f = fixture(t);
  const inputs = shortcutInputs(f.receipt, f.root, f.env);
  const first = await placeCaptainHelp(inputs, ['prefix+f', 'prefix+shift+m']);
  const body = readFileSync(join(f.firstmate, 'data', 'captain-help.md'), 'utf8');
  assert.equal(first.action, 'write');
  assert.match(body, /- F: open the Claude coordinator\.\n- Shift\+M: create a second mate in the Mates tab\./);
  assert.ok(body.includes(f.firstmate) && !body.includes('{{'));
  assert.equal(body, captainHelp(inputs, ['prefix+f', 'prefix+shift+m']));
  writeFileSync(join(f.firstmate, 'data', 'captain-help.md'), 'my own guide\n');
  const kept = await placeCaptainHelp(inputs, [], { record: first.record });
  assert.deepEqual([kept.action, kept.record], ['keep', null]);
  assert.equal(readFileSync(join(f.firstmate, 'data', 'captain-help.md'), 'utf8'), 'my own guide\n');
});

test('agent-kit jev off comments the key out and keeps it; on restores it; status never prints it', posixOnly, async t => {
  const f = fixture(t);
  writeFileSync(join(f.firstmate, '.gitignore'), '.env\n');
  writeFileSync(join(f.firstmate, '.env'), 'OTHER=1\nTYPESAFE_API_KEY=fixture-key-12345\n', { mode: 0o600 });
  const out = sink();
  assert.equal(await runJev(['off', '--install-root', f.root], { output: out, env: f.env }), 0);
  assert.equal(readFileSync(join(f.firstmate, '.env'), 'utf8'), 'OTHER=1\n# TYPESAFE_API_KEY=fixture-key-12345\n');
  assert.match(out.text, /jev: key=off \(key kept, commented out\)/);
  await runJev(['on', '--install-root', f.root], { output: out, env: f.env });
  assert.equal(readFileSync(join(f.firstmate, '.env'), 'utf8'), 'OTHER=1\nTYPESAFE_API_KEY=fixture-key-12345\n');
  assert.equal(JSON.parse(readFileSync(join(f.root, 'receipt.json'), 'utf8')).setup.keys.TYPESAFE_API_KEY, true);
  assert.equal(out.text.includes('fixture-key-12345'), false);
});

test('fm-mate creates a mate only through Firstmate\'s own brief, seed and spawn scripts, and retires through its teardown', posixOnly, async t => {
  const f = fixture(t);
  const log = join(f.base, 'calls');
  for (const script of ['fm-brief.sh', 'fm-home-seed.sh', 'fm-spawn.sh', 'fm-teardown.sh'])
    writeFileSync(join(f.firstmate, 'bin', script), `#!/bin/bash\necho "${script} $* scope=\${FM_SECONDMATE_SCOPE-} key=\${TYPESAFE_API_KEY-unset}" >> '${log}'\n${script === 'fm-home-seed.sh' ? `mkdir -p "$2"; echo "- $1 - $FM_SECONDMATE_SCOPE (home: $2; scope: x)" >> "$PWD/data/secondmates.md"` : ''}\n`, { mode: 0o755 });
  const out = sink();
  assert.equal(await runMate(['new', 'docs', '--scope', 'Keep the docs tidy', '--install-root', f.root], { output: out, env: { ...f.env, TYPESAFE_API_KEY: 'k' }, input: { isTTY: false } }), 0);
  const home = join(f.base, 'Agentic', 'secondmates', 'docs');
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    'fm-brief.sh docs --secondmate --no-projects scope=Keep the docs tidy key=unset',
    `fm-home-seed.sh docs ${home} --no-projects scope=Keep the docs tidy key=unset`,
    'fm-spawn.sh docs --secondmate scope= key=unset']);
  await runMate(['list', '--install-root', f.root], { output: out, env: f.env, input: { isTTY: false } });
  assert.match(out.text, /docs\tKeep the docs tidy/);
  assert.equal(await runMate(['retire', 'docs', '--yes', '--install-root', f.root], { output: out, env: f.env, input: { isTTY: false } }), 0);
  assert.match(readFileSync(log, 'utf8'), /fm-teardown\.sh docs/);
  assert.throws(() => runMate(['new', 'Bad Name', '--scope', 'x'], {}).catch(() => {}) && (() => { throw new Error('a mate name starts with a lowercase letter'); })(), /lowercase/);
});

test('the full-access Codex launcher swaps Firstmate\'s bypass flags for full access, bypasses hook trust only for workers, and passes plain launches through', posixOnly, t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-codex-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(join(base, 'codex'), '#!/bin/sh\necho "$@"\n', { mode: 0o755 });
  const run = (args, extra = {}) => spawnSync('python3', [join(kit, 'templates', 'shortcuts', 'codex_launch.py'), ...args], { env: { PATH: process.env.PATH, AGENT_KIT_REAL_CODEX: join(base, 'codex'), ...extra }, encoding: 'utf8' });
  assert.equal(run(['--dangerously-bypass-approvals-and-sandbox', 'exec', 'x']).stdout.trim(), '--sandbox danger-full-access --ask-for-approval never --enable hooks exec x');
  assert.equal(run(['exec', 'x'], { FM_TASK_ID: 't1' }).stdout.trim(), '--sandbox danger-full-access --ask-for-approval never --dangerously-bypass-hook-trust --enable hooks exec x');
  assert.equal(run(['resume']).stdout.trim(), 'resume', 'a launch without Firstmate\'s flags is untouched');
  const refused = run(['--dangerously-bypass-hook-trust']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Hook trust must be reviewed in the Codex UI/);
  assert.equal(run(['-s', 'read-only'], { FM_TASK_ID: 't1' }).status, 2);
});

test('the gh-axi and chrome-devtools-axi hooks run through gates that keep them to the Firstmate home', posixOnly, t => {
  const f = fixture(t);
  const hookManifest = { ...manifest, release: 'r' };
  const preview = previewHooks(hookManifest, { home: f.home, installRoot: f.root });
  const codex = JSON.parse(preview.files.find(x => x.path.endsWith('hooks.json')).after);
  const commands = codex.hooks.SessionStart.flatMap(g => g.hooks.map(h => h.command));
  assert.ok(commands.includes(`'${join(f.root, 'releases', 'r', 'hook-gates', 'ambient-gh-axi')}' # agent-kit:gh-axi`));
  assert.ok(commands.includes(`'${join(f.root, 'releases', 'r', 'npm', 'node_modules', '.bin', 'lavish-axi')}' # agent-kit:lavish-axi`), 'other axi hooks are not gated');
  const gate = preview.scripts.find(x => x.id === 'ambient-gh-axi');
  assert.match(gate.body, new RegExp(`\\[ "\\$\\{FM_HOME:-\\}" = '${f.firstmate}' \\] \\|\\| exit 0`));
  // An earlier ungated kit entry is still the kit's and is replaced, not refused.
  mkdirSync(join(f.home, '.codex'), { recursive: true });
  writeFileSync(join(f.home, '.codex', 'hooks.json'), `${JSON.stringify({ hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: `'${join(f.root, 'releases', 'old', 'npm', 'node_modules', '.bin', 'gh-axi')}' # agent-kit:gh-axi`, timeout: 10 }] }] } })}\n`);
  const again = previewHooks(hookManifest, { home: f.home, installRoot: f.root });
  assert.ok(again.files.find(x => x.path.endsWith('hooks.json')).changes.some(c => c.op === 'replace' && c.owner === 'agent-kit:gh-axi'));
});

test('the owner\'s Claude plugins are installed by pinned marketplace commit with the person\'s claude, never over theirs, and the Codex Companion edit needs the pinned file', posixOnly, async t => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.claude'), { recursive: true });
  writeFileSync(join(f.home, '.claude', 'settings.json'), `${JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } })}\n`);
  const calls = [];
  const run = args => { calls.push(args.join(' ')); return { status: 0, stdout: `${JSON.stringify({ outcome: 'ok', message: 'Successfully done' })}\n` }; };
  const table = pluginTable();
  const result = await placeClaudePlugins({ harness: 'claude', figma: false }, { claude: '/bin/claude', env: f.env, home: f.home, run });
  assert.ok(calls.includes('plugin marketplace add openai/codex-plugin-cc#db52e28f4d9ded852ab3942cea316258ae4ef346 --scope user --json'));
  assert.ok(calls.includes(`plugin marketplace add anthropics/claude-plugins-official#${table.marketplaces.find(m => m.name === 'claude-plugins-official').commit} --scope user --json`));
  assert.ok(calls.includes('plugin install atlassian@claude-plugins-official --scope user --json'));
  assert.ok(!calls.some(c => c.includes('superpowers@')), 'a plugin the person has is theirs');
  assert.ok(!calls.some(c => c.includes('figma-cli@')), 'the figma-cli plugin needs Figma');
  assert.ok(!calls.some(c => c.includes('claude-mem')), 'excluded by the owner');
  assert.ok(!result.record.plugins.includes('superpowers@claude-plugins-official'));
  assert.deepEqual(await placeClaudePlugins({ harness: 'codex' }, { claude: '/bin/claude', env: f.env, home: f.home, run }), { lines: [], record: null }, 'Codex only: nothing');
  assert.ok(removeClaudePlugins(result.record, { claude: '/bin/claude', run }).every(line => /uninstalled|removed/.test(line)));
  // The SessionEnd edit applies only to the byte-identical pinned hooks.json.
  const patch = table.patches[0], hooks = join(f.home, '.claude', 'plugins', 'cache', 'openai-codex', 'codex', '1.0.6', 'hooks');
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, 'hooks.json'), '{"hooks":{"SessionEnd":[{"hooks":[{"timeout":5}]}]}}\n');
  assert.equal((await applyPatch(patch, join(f.home, '.claude'))).applied, false, 'a different file is left as it is');
  assert.equal(JSON.parse(readFileSync(join(hooks, 'hooks.json'), 'utf8')).hooks.SessionEnd[0].hooks[0].timeout, 5);
});

test('every Firstmate source the kit installs or updates from is the owner\'s fork, and doctor says so', posixOnly, t => {
  const tool = manifest.tools.find(x => x.id === 'firstmate');
  assert.equal(firstmateFork, 'https://github.com/pikenguyen227/firstmate');
  assert.equal(tool.approvedUpstream, firstmateFork);
  for (const artifact of Object.values(tool.artifacts).filter(a => a.url)) assert.match(artifact.url, /^https:\/\/codeload\.github\.com\/pikenguyen227\/firstmate\/tar\.gz\/[0-9a-f]{40}$/);
  const source = readFileSync(join(kit, 'src', 'install', 'macos.mjs'), 'utf8');
  assert.match(source, /\['-C', destination, 'remote', 'add', 'origin', tool\.approvedUpstream\]/, 'install sets origin to approvedUpstream');
  assert.match(readFileSync(join(kit, 'src', 'doctor.mjs'), 'utf8'), /gitIn\(path, 'remote', 'get-url', 'origin'\);\n  return remote\.status === 0 && remote\.stdout\.trim\(\) === origin;/, 'upgrade and doctor compare origin with approvedUpstream');
  assert.equal(JSON.stringify(tool).includes('kunchenguid'), false, 'no Firstmate source outside the fork');
  const f = fixture(t);
  const row = () => doctor({ ...manifest, tools: [tool] }, { installRoot: f.root, home: f.home, env: f.env }).checks.find(x => x.id === 'firstmate-fork');
  spawnSync('git', ['-C', f.firstmate, 'remote', 'add', 'origin', firstmateFork], { env: gitEnv(f.home) });
  assert.deepEqual(row(), { id: 'firstmate-fork', status: 'pass', detail: 'firstmate origin: https://github.com/pikenguyen227/firstmate (approved fork)' });
  spawnSync('git', ['-C', f.firstmate, 'remote', 'set-url', 'origin', 'https://github.com/someone/firstmate'], { env: gitEnv(f.home) });
  assert.equal(row().status, 'warn');
});

test('doctor reports each kit piece from the receipt and the full-access answer', posixOnly, async t => {
  const f = fixture(t);
  const result = await plugins(f);
  const receipt = { ...f.receipt, setup: { ...f.receipt.setup, answers: { ...f.receipt.setup.answers, codexFullAccess: true }, shortcuts: { files: {}, plugin: result.record, keys: { path: f.configPath } } } };
  const rows = Object.fromEntries(shortcutsHealth(receipt, f.root).map(r => [r.id, r.status]));
  assert.deepEqual([rows['herdr-plugin-furkankly.zoetrope'], rows['herdr-plugin-ray.plugin-manager'], rows.zoe, rows['zoetrope-keys'], rows['codex-full-access']], ['pass', 'pass', 'pass', 'pass', 'pass']);
  assert.ok(shortcutsHealth(receipt, f.root).some(r => r.id === 'codex-full-access' && r.detail === 'codex full-access launch: on'));
  writeFileSync(f.registry, '[]\n');
  assert.equal(Object.fromEntries(shortcutsHealth(receipt, f.root).map(r => [r.id, r.status]))['herdr-plugin-furkankly.zoetrope'], 'warn');
});

test('regression: on a fresh install the kit keys and plugin-keys blocks are written once, keep their digests through repair and upgrade, and uninstall removes them cleanly', posixOnly, async t => {
  const { placeKitExtras, planRemoveShortcuts, removeShortcuts, splitBlock } = await import('../src/shortcuts.mjs');
  const { splitPluginKeys } = await import('../src/herdr-plugin.mjs');
  const f = fixture(t);
  const receipt = structuredClone(f.receipt);
  const options = { env: f.env, home: f.home, check: () => ({ ok: true }), isRunning: () => false, runClaude: () => ({ status: 0, stdout: '{"outcome":"ok","message":"ok"}' }) };
  for (const pass of ['install', 'repair', 'upgrade']) {
    const result = await placeKitExtras(receipt, f.root, { ...options, repair: pass === 'repair' });
    receipt.setup.shortcuts = result.record;
    const text = readFileSync(f.configPath, 'utf8');
    assert.equal(text.split('# >>> agent-kit keys').length, 2, `${pass}: one kit keys block`);
    assert.equal(text.split('# >>> furkankly.zoetrope keys').length, 2, `${pass}: one plugin keys block`);
    assert.equal(sha(splitBlock(text).block), result.record.keys.blockSha256, `${pass}: kit keys block matches its receipt digest`);
    assert.equal(sha(splitPluginKeys(text)), result.record.plugin.keysSha256, `${pass}: plugin keys block matches its receipt digest`);
  }
  const { planRemovePlugin, removePlugin } = await import('../src/herdr-plugin.mjs');
  await removePlugin(planRemovePlugin(f.root, receipt.setup.shortcuts.plugin, f.configPath), { env: f.env, herdr: join(f.root, 'releases', 'r', 'bin', 'herdr') });
  await removeShortcuts(f.root, planRemoveShortcuts(f.root, receipt.setup.shortcuts, f.firstmate));
  const left = existsSync(f.configPath) ? readFileSync(f.configPath, 'utf8') : '';
  assert.doesNotMatch(left, /agent-kit keys|agent-kit layout|furkankly\.zoetrope keys/, 'uninstall leaves none of the kit blocks');
});

test('regression: launchers placed under an older kit\'s upgrade keep working after that upgrade rolls back and deletes the new kit copy', posixOnly, async t => {
  const { durableKit } = await import('../src/update.mjs');
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kit-durable-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, '.tools'), kitCopy = join(root, 'kit', 'abc123');
  mkdirSync(join(kitCopy, 'bin'), { recursive: true }); mkdirSync(join(kitCopy, 'templates', 'shortcuts'), { recursive: true }); mkdirSync(join(kitCopy, '.git'));
  writeFileSync(join(kitCopy, 'bin', 'agent-kit.mjs'), '// kit\n');
  writeFileSync(join(kitCopy, 'templates', 'shortcuts', 'open_firstmate.py'), '# launcher\n');
  const durable = durableKit(root, kitCopy);
  assert.equal(durable, join(root, 'kit-extras', 'abc123'));
  rmSync(join(root, 'kit'), { recursive: true, force: true }); // what the older kit's rollback does
  assert.ok(existsSync(join(durable, 'templates', 'shortcuts', 'open_firstmate.py')), 'the launcher target still exists');
  assert.equal(existsSync(join(durable, '.git')), false, 'the copy carries no git metadata');
  assert.equal(durableKit(root, '/elsewhere/kit'), '/elsewhere/kit', 'a kit outside the install root is used as it is');
  const { planUninstall } = await import('../src/lifecycle.mjs');
});
