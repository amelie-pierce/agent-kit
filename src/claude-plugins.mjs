import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The owner's Claude Code plugins, installed with the person's own claude CLI when Claude is chosen
// (manifests/claude-plugins.json). Each marketplace is added from its repository pinned to a commit; a
// marketplace or plugin the person already has is left as theirs and never recorded, so uninstall removes only
// what the kit added. The Codex Companion SessionEnd timeout edit applies only while the installed file is
// byte-identical to the pinned original.
const sha = data => createHash('sha256').update(data).digest('hex');
export const pluginTable = () => JSON.parse(readFileSync(new URL('../manifests/claude-plugins.json', import.meta.url), 'utf8'));
const configDir = (env, home) => env.CLAUDE_CONFIG_DIR || join(home, '.claude');

function wantedPlugins(table, answers) {
  const claude = answers.harness === 'claude' || answers.harness === 'both' || answers.harness === undefined;
  return table.marketplaces.flatMap(m => m.plugins.filter(p => claude && (p.when === 'claude' || (p.when === 'claude+figma' && answers.figma))).map(p => ({ ...p, market: m })));
}
// What the person already has: enabled plugins in their user settings and the marketplaces Claude Code knows.
function existing(env, home) {
  const dir = configDir(env, home), read = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
  return { plugins: new Set(Object.keys(read(join(dir, 'settings.json')).enabledPlugins || {})), markets: new Set(Object.keys(read(join(dir, 'plugins', 'known_marketplaces.json')))) };
}
const lastJson = text => { try { return JSON.parse(text.trim().split('\n').pop()); } catch { return null; } };

export async function placeClaudePlugins(answers, { claude, env = process.env, home = env.HOME, record = null, run } = {}) {
  const lines = [], next = { markets: [...(record?.markets || [])], plugins: [...(record?.plugins || [])], patches: [...(record?.patches || [])] };
  const wanted = wantedPlugins(pluginTable(), answers);
  if (!wanted.length) return { lines, record: record || null };
  if (!claude) return { lines: ['Claude plugins: not installed; the claude CLI was not found on PATH'], record };
  const call = run || ((args) => spawnSync(claude, args, { env: { ...env, HOME: home }, encoding: 'utf8', timeout: 300000 }));
  const have = existing(env, home);
  for (const market of [...new Set(wanted.map(w => w.market))]) {
    if (!have.markets.has(market.name)) {
      const r = call(['plugin', 'marketplace', 'add', `${market.repo}#${market.commit}`, '--scope', 'user', '--json']), out = lastJson(r.stdout || '');
      if (r.status !== 0 || out?.outcome !== 'ok') { lines.push(`Claude plugins: marketplace ${market.name} not added: ${out?.message || (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`}`); continue; }
      if (!next.markets.includes(market.name)) next.markets.push(market.name);
      lines.push(`Claude plugins: added marketplace ${market.name} from ${market.repo} at ${market.commit.slice(0, 12)} (${market.license})`);
    }
    for (const plugin of wanted.filter(w => w.market === market)) {
      const id = `${plugin.name}@${market.name}`;
      if (have.plugins.has(id) && !next.plugins.includes(id)) { lines.push(`Claude plugins: ${id} is already yours; left as it is`); continue; }
      const r = call(['plugin', 'install', id, '--scope', 'user', '--json']), out = lastJson(r.stdout || '');
      if (r.status !== 0 || out?.outcome !== 'ok') { lines.push(`Claude plugins: ${id} not installed: ${out?.message || (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`}`); continue; }
      if (!next.plugins.includes(id)) next.plugins.push(id);
      lines.push(`Claude plugins: ${/already installed/i.test(out.message || '') ? 'present' : 'installed'} ${id}`);
    }
  }
  for (const patch of pluginTable().patches) if (next.plugins.includes(patch.plugin)) {
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
export async function applyPatch(patch, dir) {
  const files = installedFiles(patch, dir);
  if (!files.length) return { applied: false, detail: `no installed ${patch.file} found; skipped` };
  let applied = false;
  for (const path of files) {
    const body = readFileSync(path, 'utf8');
    if (sha(body) !== patch.sha256) { applied ||= patchedAlready(body, patch); continue; }
    const value = JSON.parse(body);
    for (const group of value.hooks[patch.event] || []) for (const hook of group.hooks || []) if (hook.timeout === patch.from) hook.timeout = patch.to;
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
    applied = true;
  }
  return { applied, detail: applied ? `${patch.event} timeout set to ${patch.to}s` : `the installed ${patch.file} differs from the pinned original; left as it is` };
}
const patchedAlready = (body, patch) => { try { return JSON.parse(body).hooks[patch.event].every(g => g.hooks.every(h => h.timeout === patch.to)); } catch { return false; } };

// Uninstall: only the plugins and marketplaces the kit added, through the person's claude CLI.
export function removeClaudePlugins(record, { claude, env = process.env, home = env.HOME, run } = {}) {
  if (!record || !claude) return [];
  const call = run || ((args) => spawnSync(claude, args, { env: { ...env, HOME: home }, encoding: 'utf8', timeout: 300000 }));
  const lines = [];
  for (const id of record.plugins || []) lines.push(`${id}: ${call(['plugin', 'uninstall', id, '--scope', 'user', '--json']).status === 0 ? 'uninstalled' : 'left in place (uninstall failed)'}`);
  for (const name of record.markets || []) lines.push(`marketplace ${name}: ${call(['plugin', 'marketplace', 'remove', name, '--scope', 'user', '--json']).status === 0 ? 'removed' : 'left in place (remove failed)'}`);
  return lines;
}

export function claudePluginsHealth(record, env, home) {
  if (!record) return [];
  const settings = (() => { try { return JSON.parse(readFileSync(join(configDir(env, home), 'settings.json'), 'utf8')); } catch { return {}; } })();
  return (record.plugins || []).map(id => ({ id: `claude-plugin-${id}`, status: settings.enabledPlugins?.[id] ? 'pass' : 'warn',
    detail: settings.enabledPlugins?.[id] ? `${id} enabled in your Claude settings` : `${id} is not enabled; agent-kit repair installs it again` }));
}
