import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The owner's Claude Code plugins, installed with the person's own claude CLI when Claude is chosen
// (manifests/claude-plugins.json). Each marketplace is added from its repository pinned to a commit; a
// marketplace or plugin the person already has is left as theirs and never recorded, so uninstall removes only
// what the kit added. The kit's edits (the Codex Companion SessionEnd timeout, the playwright MCP version pin)
// apply only while the installed file is byte-identical to the pinned original.
const sha = data => createHash('sha256').update(data).digest('hex');
export const pluginTable = () => JSON.parse(readFileSync(new URL('../manifests/claude-plugins.json', import.meta.url), 'utf8'));
const configDir = (env, home) => env.CLAUDE_CONFIG_DIR || join(home, '.claude');

function wantedPlugins(table, answers) {
  const claude = answers.harness === 'claude' || answers.harness === 'both' || answers.harness === undefined;
  return table.marketplaces.flatMap(m => m.plugins.filter(p => claude && (p.when === 'claude' || (p.when === 'claude+figma' && answers.figma))).map(p => ({ ...p, market: m })));
}
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
const knownMarkets = (env, home) => readJson(join(configDir(env, home), 'plugins', 'known_marketplaces.json'));
// What the person already has: enabled plugins in their user settings and the marketplaces Claude Code knows.
function existing(env, home) {
  return { plugins: new Set(Object.keys(readJson(join(configDir(env, home), 'settings.json')).enabledPlugins || {})) };
}
const lastJson = text => { try { return JSON.parse(text.trim().split('\n').pop()); } catch { return null; } };
function marketOwnership(record, name, known) {
  if (!(record?.markets || []).includes(name)) return { status: 'user', revision: marketRevision(known[name]?.installLocation) };
  if (!known[name]) return { status: 'missing', revision: null };
  const revision = marketRevision(known[name].installLocation);
  if (!revision) return { status: 'unknown', revision: null };
  return { status: record?.marketRevisions?.[name] && record.marketRevisions[name] !== revision ? 'replaced' : 'owned', revision };
}

export async function placeClaudePlugins(answers, { claude, env = process.env, home = env.HOME, record = null, run, table = pluginTable() } = {}) {
  const lines = [], next = { markets: [...(record?.markets || [])], marketRevisions: { ...(record?.marketRevisions || {}) }, previousMarketRevisions: { ...(record?.previousMarketRevisions || {}) }, plugins: [...(record?.plugins || [])], patches: [...(record?.patches || [])] };
  const wanted = wantedPlugins(table, answers);
  if (!wanted.length) return { lines, record: record || null };
  if (!claude) return { lines: ['Claude plugins: not installed; the claude CLI was not found on PATH'], record };
  const call = run || ((args) => spawnSync(claude, args, { env: { ...env, HOME: home }, encoding: 'utf8', timeout: 300000 }));
  const have = existing(env, home), known = knownMarkets(env, home), skipped = new Set();
  for (const market of [...new Set(wanted.map(w => w.market))]) {
    const ownership = marketOwnership(record, market.name, known), owned = ownership.status === 'owned' || ownership.status === 'missing', installed = ownership.revision;
    if (ownership.status === 'replaced' || ownership.status === 'unknown') {
      skipped.add(market.name);
      if (ownership.status === 'replaced') {
        next.markets = next.markets.filter(name => name !== market.name);
        next.plugins = next.plugins.filter(id => !id.endsWith(`@${market.name}`));
        next.patches = next.patches.filter(id => !table.patches.some(p => p.id === id && p.plugin.endsWith(`@${market.name}`)));
        delete next.marketRevisions[market.name];
        delete next.previousMarketRevisions[market.name];
      }
      lines.push(`Claude plugins: marketplace ${market.name} ${ownership.status === 'replaced' ? 'no longer matches the kit receipt' : 'revision unknown'}; left in place`);
      continue;
    }
    if (owned && known[market.name] && installed !== market.commit) {
      const removed = call(['plugin', 'marketplace', 'remove', market.name, '--scope', 'user', '--json']);
      if (removed.status !== 0 || lastJson(removed.stdout || '')?.outcome !== 'ok') { lines.push(`Claude plugins: marketplace ${market.name} not refreshed; removal failed`); continue; }
    }
    if (!known[market.name] || (owned && installed && installed !== market.commit)) {
      const r = call(['plugin', 'marketplace', 'add', `${market.repo}#${market.commit}`, '--scope', 'user', '--json']), out = lastJson(r.stdout || '');
      if (r.status !== 0 || out?.outcome !== 'ok') {
        if (owned && installed) {
          const restored = call(['plugin', 'marketplace', 'add', `${market.repo}#${installed}`, '--scope', 'user', '--json']);
          lines.push(`Claude plugins: marketplace ${market.name} not refreshed: ${out?.message || (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`}; previous revision ${lastJson(restored.stdout || '')?.outcome === 'ok' && restored.status === 0 ? 'restored' : 'could not be restored'}`);
        } else lines.push(`Claude plugins: marketplace ${market.name} not added: ${out?.message || (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`}`);
        continue;
      }
      if (!next.markets.includes(market.name)) next.markets.push(market.name);
      if (owned && installed && installed !== market.commit) next.previousMarketRevisions[market.name] = installed;
      lines.push(`Claude plugins: ${owned ? 'refreshed' : 'added'} marketplace ${market.name} from ${market.repo} at ${market.commit.slice(0, 12)} (${market.license})`);
    }
    if (next.markets.includes(market.name)) next.marketRevisions[market.name] = market.commit;
    for (const plugin of wanted.filter(w => w.market === market)) {
      const id = `${plugin.name}@${market.name}`;
      if (have.plugins.has(id) && !next.plugins.includes(id)) { lines.push(`Claude plugins: ${id} is already yours; left as it is`); continue; }
      const r = call(['plugin', 'install', id, '--scope', 'user', '--json']), out = lastJson(r.stdout || '');
      if (r.status !== 0 || out?.outcome !== 'ok') { lines.push(`Claude plugins: ${id} not installed: ${out?.message || (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`}`); continue; }
      if (!next.plugins.includes(id)) next.plugins.push(id);
      lines.push(`Claude plugins: ${/already installed/i.test(out.message || '') ? 'present' : 'installed'} ${id}`);
    }
  }
  for (const patch of table.patches) if (next.plugins.includes(patch.plugin) && !skipped.has(patch.plugin.split('@')[1])) {
    const result = await applyPatch(patch, configDir(env, home));
    if (result.applied && !next.patches.includes(patch.id)) next.patches.push(patch.id);
    lines.push(`Claude plugins: ${patch.id}: ${result.detail}`);
  }
  return { lines, record: next.markets.length || next.plugins.length ? next : null };
}

// The installed copy of the plugin's file, under the Claude plugin cache (<marketplace>/<plugin>/<version>/).
function installedFiles(patch, dir) {
  const [plugin, market] = patch.plugin.split('@'), base = join(dir, 'plugins', 'cache', market, plugin);
  if (!existsSync(base)) return [];
  return readdirSync(base).map(version => join(base, version, ...patch.file.split('/'))).filter(path => existsSync(path));
}
// Each kind of kit edit: the change to the parsed file, whether a file already carries it, and how it reads.
const edits = {
  'hook-timeout': {
    apply: (value, patch) => { for (const group of value.hooks[patch.event] || []) for (const hook of group.hooks || []) if (hook.timeout === patch.from) hook.timeout = patch.to; },
    done: (value, patch) => value.hooks[patch.event].every(g => g.hooks.every(h => h.timeout === patch.to)),
    detail: patch => `${patch.event} timeout set to ${patch.to}s`,
  },
  'mcp-args': {
    apply: (value, patch) => { value[patch.server].args = value[patch.server].args.map(arg => arg === patch.from ? patch.to : arg); },
    done: (value, patch) => value[patch.server].args.includes(patch.to) && !value[patch.server].args.includes(patch.from),
    detail: patch => `${patch.server} MCP server runs ${patch.to}`,
  },
};
export async function applyPatch(patch, dir) {
  const files = installedFiles(patch, dir), edit = edits[patch.kind];
  if (!files.length) return { applied: false, detail: `no installed ${patch.file} found; skipped` };
  let applied = false;
  for (const path of files) {
    const body = readFileSync(path, 'utf8');
    if (sha(body) !== patch.sha256) { applied ||= (() => { try { return edit.done(JSON.parse(body), patch); } catch { return false; } })(); continue; }
    const value = JSON.parse(body);
    edit.apply(value, patch);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
    applied = true;
  }
  return { applied, detail: applied ? edit.detail(patch) : `the installed ${patch.file} differs from the pinned original; left as it is` };
}

// Uninstall: only the plugins and marketplaces the kit added, through the person's claude CLI.
export function removeClaudePlugins(record, { claude, env = process.env, home = env.HOME, run } = {}) {
  if (!record || !claude) return [];
  const call = run || ((args) => spawnSync(claude, args, { env: { ...env, HOME: home }, encoding: 'utf8', timeout: 300000 }));
  const lines = [];
  const known = knownMarkets(env, home);
  const safe = name => !(record.markets || []).includes(name) || marketOwnership(record, name, known).status === 'owned';
  for (const id of record.plugins || []) if (safe(id.split('@')[1])) lines.push(`${id}: ${call(['plugin', 'uninstall', id, '--scope', 'user', '--json']).status === 0 ? 'uninstalled' : 'left in place (uninstall failed)'}`);
  for (const name of record.markets || []) if (safe(name)) lines.push(`marketplace ${name}: ${call(['plugin', 'marketplace', 'remove', name, '--scope', 'user', '--json']).status === 0 ? 'removed' : 'left in place (remove failed)'}`);
  return lines;
}

// The revision Claude Code fetched a marketplace at: its .gcs-sha, or the HEAD of its git checkout.
function marketRevision(location) {
  if (typeof location !== 'string') return null;
  try { return readFileSync(join(location, '.gcs-sha'), 'utf8').trim(); } catch { /* a git checkout instead */ }
  const r = spawnSync('git', ['-C', location, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000 });
  return r.status === 0 ? r.stdout.trim() : null;
}
// A pinned marketplace the person already had stays theirs, so its plugins follow their revision; doctor names it.
export function claudePluginsHealth(record, env, home, answers = {}) {
  const settings = readJson(join(configDir(env, home), 'settings.json')), known = knownMarkets(env, home);
  const markets = [...new Set(wantedPlugins(pluginTable(), answers).map(w => w.market))].filter(m => known[m.name] || (record?.markets || []).includes(m.name)).map(m => {
    const ownership = marketOwnership(record, m.name, known), owned = ownership.status !== 'user' && ownership.status !== 'replaced', revision = ownership.revision;
    return { id: `claude-marketplace-${m.name}`, status: revision === m.commit && ownership.status !== 'replaced' ? 'pass' : 'warn', detail: ownership.status === 'replaced'
      ? `${m.name} marketplace is at ${revision}; it no longer matches the kit receipt and is left untouched`
      : revision === m.commit ? `${owned ? 'kit-owned' : 'your'} ${m.name} marketplace is at the kit's pinned ${m.commit}`
        : `${owned ? 'kit-owned' : 'your own'} ${m.name} marketplace is at ${revision || 'an unknown revision'}, not the kit's pinned ${m.commit}; ${owned ? 'agent-kit repair refreshes it' : 'its plugins follow your revision'}` };
  });
  return [...markets, ...(record?.plugins || []).map(id => ({ id: `claude-plugin-${id}`, status: settings.enabledPlugins?.[id] ? 'pass' : 'warn',
    detail: settings.enabledPlugins?.[id] ? `${id} enabled in your Claude settings` : `${id} is not enabled; agent-kit repair installs it again` }))];
}
