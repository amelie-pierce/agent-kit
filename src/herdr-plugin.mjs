import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

// The Zoetrope session-graph plugin (furkankly.zoetrope) from the pinned pikenguyen227/zoetrope commit, the
// way the owner runs it: herdr-plugin/ installed in the kit release, a kit-managed local entry in Herdr's
// plugins.json, `zoe` on PATH as the pinned zoe-fleet binary (built from the same commit's `zoe` target), and
// the plugin's own setup-keys block. The kit registers it only while Herdr is stopped, since Herdr owns that
// registry while it runs, never replaces an entry the person has, and backs the file up before each write.
export const pluginId = 'furkankly.zoetrope';
export const zoeFile = 'bin/zoe';
export const pluginKeysBegin = `# >>> ${pluginId} keys (managed: \`setup-keys\` writes this block, \`remove-keys\` deletes it)`;
export const pluginKeysEnd = `# <<< ${pluginId} keys`;
const sha = data => createHash('sha256').update(data).digest('hex');
const stat = path => lstatSync(path, { throwIfNoEntry: false });
const plainFile = path => { const s = stat(path); return !!s && s.isFile() && !s.isSymbolicLink() && s.nlink === 1; };
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const stable = value => JSON.stringify(value);

// Herdr keeps its plugin registry beside config.toml in its config directory.
export const pluginsPath = (env, home) => join(env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config'), 'herdr', 'plugins.json');

// Enough TOML for a Herdr plugin manifest: top-level keys, [[build]], [[panes]] and [[actions]] tables, and
// string, integer and string-array values.
export function parseManifest(text) {
  const out = {};
  let table = out;
  const value = raw => {
    raw = raw.trim();
    if (raw.startsWith('[')) return [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`));
    if (raw.startsWith('"')) return JSON.parse(raw.match(/^"((?:[^"\\]|\\.)*)"/)[0]);
    if (/^-?\d+$/.test(raw)) return Number(raw);
    if (raw === 'true' || raw === 'false') return raw === 'true';
    throw new Error(`unsupported plugin manifest value: ${raw}`);
  };
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const array = trimmed.match(/^\[\[([a-z_]+)\]\]$/);
    if (array) { (out[array[1]] ||= []).push(table = {}); continue; }
    const pair = trimmed.match(/^([a-z_]+)\s*=\s*(.+)$/);
    if (!pair) throw new Error(`unsupported plugin manifest line: ${trimmed}`);
    table[pair[1]] = value(pair[2]);
  }
  return out;
}

// The registry entry Herdr writes for a linked local plugin: the manifest's own fields, its panes and actions,
// source kind local, and no build step (the kit supplies zoe instead of ensure-zoe.sh installing one).
export function pluginEntry(pluginRoot) {
  const manifestPath = join(pluginRoot, 'herdr-plugin.toml'), m = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (m.id !== pluginId) throw new Error(`pinned plugin manifest names ${m.id}, not ${pluginId}`);
  const pick = (item, keys) => Object.fromEntries(keys.filter(k => item[k] !== undefined).map(k => [k, item[k]]));
  return { plugin_id: m.id, name: m.name, version: m.version, min_herdr_version: m.min_herdr_version, description: m.description,
    manifest_path: manifestPath, plugin_root: pluginRoot, enabled: true, platforms: m.platforms,
    panes: (m.panes || []).map(p => pick(p, ['id', 'title', 'placement', 'command'])),
    actions: (m.actions || []).map(a => pick(a, ['id', 'title', 'description', 'contexts', 'command'])), source: { kind: 'local' } };
}

export const zoeScript = binary => `#!/bin/sh
# agent-kit:zoe - the pinned Zoetrope build (zoe-fleet, the fork's zoe target) for the session-graph plugin.
exec ${quote(binary)} "$@"
`;

function readRegistry(path) {
  if (!stat(path)) return { entries: [], exists: false };
  if (!plainFile(path)) throw new Error(`${path} is not a plain file`);
  const entries = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(entries)) throw new Error(`${path} is not a Herdr plugin list`);
  return { entries, exists: true };
}
export function splitPluginKeys(text) {
  const lines = text.split('\n'), begin = lines.indexOf(pluginKeysBegin), end = lines.indexOf(pluginKeysEnd);
  return begin === -1 || end < begin ? null : lines.slice(begin, end + 1).join('\n');
}

// What setup, repair and upgrade would do with the plugin, without writing. record is setup.shortcuts.plugin.
export function planPlugin(receipt, root, { env = process.env, home = env.HOME, configPath, record = null, repair = false, isRunning } = {}) {
  const phase = id => receipt.phases?.[id]?.state === 'complete' && typeof receipt.phases[id].path === 'string' ? join(root, receipt.phases[id].path) : null;
  const pluginRoot = phase('zoetrope-herdr-plugin'), zoeFleet = phase('zoe-fleet'), herdr = phase('herdr');
  if (!pluginRoot) return { action: 'none', record };
  if (!zoeFleet || !stat(zoeFleet)?.isFile()) return { action: 'skip', detail: 'needs the zoe-fleet release binary for zoe', record };
  if (!herdr) return { action: 'skip', detail: 'needs the pinned Herdr', record };
  const registry = record?.registry || pluginsPath(env, home), zoe = join(root, zoeFile), zoeBody = zoeScript(zoeFleet);
  const entry = pluginEntry(pluginRoot);
  const current = stat(zoe);
  const zoeAction = !current ? 'write' : !plainFile(zoe) || !record?.zoeSha256 ? 'conflict'
    : sha(readFileSync(zoe)) === sha(zoeBody) ? 'verify' : sha(readFileSync(zoe)) === record.zoeSha256 ? 'refresh' : repair ? 'replace' : 'keep';
  let entries, regAction, detail = null;
  try { entries = readRegistry(registry).entries; } catch (error) { return { action: 'skip', detail: error.message, record }; }
  const found = entries.filter(e => e?.plugin_id === pluginId);
  const ours = found.length === 1 && record?.entrySha256 && sha(stable(found[0])) === record.entrySha256;
  if (found.length && !ours) { regAction = 'keep'; detail = `${registry} already has a ${pluginId} entry; left as it is`; }
  else if (found.length && stable(found[0]) === stable(entry)) regAction = 'verify';
  else if (!found.length && record?.entrySha256 && !repair) { regAction = 'keep'; detail = `the kit's ${pluginId} entry was removed; not added again (agent-kit repair restores it)`; }
  else regAction = found.length ? 'refresh' : 'add';
  if (['add', 'refresh'].includes(regAction) && (isRunning || (() => false))('herdr')) {
    regAction = 'deferred'; detail = `Herdr is running and owns ${registry}; stop it (herdr server stop) and rerun to register ${pluginId}`;
  }
  return { action: 'apply', root, herdr, pluginRoot, entry, registry, entries, record, configPath,
    zoe: { path: zoe, action: zoeAction, body: zoeBody }, register: { action: regAction, detail } };
}

// Runs the plugin's own keys.sh through a Herdr stand-in that answers `config check` with the pinned Herdr and
// skips `server reload-config` and notifications, so the kit never drives a running Herdr.
async function pluginKeys(plan, command, env) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-kit-herdr-'));
  try {
    const shim = join(dir, 'herdr');
    await writeFile(shim, `#!/bin/sh\nif [ "$1 $2" = "config check" ]; then exec ${quote(plan.herdr)} config check; fi\nexit 0\n`, { mode: 0o755 });
    const r = spawnSync('bash', [join(plan.pluginRoot, 'herdr', 'keys.sh'), command], { cwd: plan.pluginRoot, encoding: 'utf8', timeout: 60000,
      env: { PATH: env.PATH || '', HOME: env.HOME || '', HERDR_BIN_PATH: shim, HERDR_PLUGIN_ID: pluginId, HERDR_CONFIG_PATH: plan.configPath } });
    return { ok: r.status === 0, detail: (r.status === 0 ? r.stdout : r.stderr || r.stdout || '').trim().split('\n').pop() || `exit ${r.status}` };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function backup(root, path, name) {
  const dir = join(root, 'backups', 'shortcuts');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const destination = join(dir, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}-${name}`);
  await writeFile(destination, readFileSync(path), { mode: 0o600, flag: 'wx' });
  return destination;
}
async function writeRegistry(root, path, entries) {
  if (stat(path)) await backup(root, path, 'herdr-plugins.json');
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.agent-kit-${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
  await rename(temp, path);
}

export async function applyPlugin(plan, { env = process.env } = {}) {
  if (plan.action !== 'apply') return plan;
  const record = { ...(plan.record || {}), registry: plan.registry };
  const z = plan.zoe;
  if (['write', 'refresh', 'replace'].includes(z.action)) {
    if (z.action === 'replace') await backup(plan.root, z.path, 'zoe');
    await mkdir(dirname(z.path), { recursive: true, mode: 0o700 });
    const temp = `${z.path}.${randomUUID()}.tmp`;
    await writeFile(temp, z.body, { mode: 0o755, flag: 'wx' });
    await chmod(temp, 0o755);
    await rename(temp, z.path);
  }
  if (!['conflict', 'keep'].includes(z.action)) record.zoeSha256 = sha(z.body);
  const reg = plan.register;
  if (['add', 'refresh'].includes(reg.action)) {
    const entries = reg.action === 'add' ? [...plan.entries, plan.entry] : plan.entries.map(e => e?.plugin_id === pluginId ? plan.entry : e);
    await writeRegistry(plan.root, plan.registry, entries);
    record.entrySha256 = sha(stable(plan.entry));
    record.created = record.created ?? !plan.entries.length;
  } else if (reg.action === 'verify') record.entrySha256 = sha(stable(plan.entry));
  else if (reg.action === 'keep' && !reg.detail?.includes('was removed')) { delete record.entrySha256; delete record.keysSha256; }
  // The plugin's own keys, once registered by the kit: setup-keys writes them when its block is absent.
  let keys = { action: 'none' };
  if (record.entrySha256 && plan.configPath) {
    const text = plainFile(plan.configPath) ? readFileSync(plan.configPath, 'utf8') : '';
    const block = splitPluginKeys(text);
    if (block && record.keysSha256 && sha(block) !== record.keysSha256) { keys = { action: 'keep', detail: `the ${pluginId} keys block was edited; left as it is` }; delete record.keysSha256; }
    else if (block) { keys = { action: 'verify' }; record.keysSha256 ||= sha(block); }
    else if (!record.keysSha256 || plan.repairKeys !== false) {
      const result = await pluginKeys(plan, 'setup', env);
      const written = plainFile(plan.configPath) ? splitPluginKeys(readFileSync(plan.configPath, 'utf8')) : null;
      keys = result.ok && written ? { action: 'add', detail: result.detail } : { action: 'skip', detail: result.detail };
      if (written) record.keysSha256 = sha(written);
    }
  }
  return { ...plan, record, keys };
}

// Uninstall: the plugin's own remove-keys while its block is unchanged, then the kit entry and zoe wrapper while unchanged.
export function planRemovePlugin(root, record, configPath) {
  if (!record) return null;
  const zoe = join(root, zoeFile);
  let entries = [];
  try { entries = readRegistry(record.registry).entries; } catch { entries = null; }
  const found = entries?.filter(e => e?.plugin_id === pluginId) || [];
  const entry = found.length === 1 && record.entrySha256 && sha(stable(found[0])) === record.entrySha256;
  const block = configPath && plainFile(configPath) ? splitPluginKeys(readFileSync(configPath, 'utf8')) : null;
  return { root, registry: record.registry, entries, configPath, pluginRoot: entry ? found[0].plugin_root : null,
    zoe: { path: zoe, action: plainFile(zoe) && record.zoeSha256 && sha(readFileSync(zoe)) === record.zoeSha256 ? 'remove unchanged zoe wrapper' : 'keep changed or absent zoe wrapper' },
    register: { action: entry ? `remove the kit's ${pluginId} entry` : `keep changed or absent ${pluginId} entry` },
    keys: { action: entry && block && record.keysSha256 && sha(block) === record.keysSha256 ? `remove the unchanged ${pluginId} keys block` : `keep changed or absent ${pluginId} keys block` } };
}
export async function removePlugin(plan, { env = process.env, herdr } = {}) {
  if (!plan) return;
  if (plan.keys.action.startsWith('remove') && plan.pluginRoot && stat(join(plan.pluginRoot, 'herdr', 'keys.sh')))
    await pluginKeys({ ...plan, herdr: herdr || 'herdr' }, 'remove', env);
  if (plan.register.action.startsWith('remove')) await writeRegistry(plan.root, plan.registry, plan.entries.filter(e => e?.plugin_id !== pluginId));
  if (plan.zoe.action.startsWith('remove')) await rm(plan.zoe.path, { force: true });
}

export function describePlugin(result) {
  if (result.action === 'none') return [];
  if (result.action === 'skip') return [`Zoetrope session-graph plugin: not set up; ${result.detail}`];
  const z = result.zoe, r = result.register, k = result.keys || {};
  return [
    z.action === 'conflict' ? `zoe: ${z.path} exists and is not the kit's; left unchanged` : `zoe: ${z.action === 'verify' ? 'verified' : z.action === 'keep' ? 'kept your changed' : 'written'} at ${z.path}`,
    `Zoetrope plugin (${pluginId}) in ${result.registry}: ${r.detail || (r.action === 'verify' ? 'registered' : `${r.action === 'add' ? 'registered' : 'refreshed'}; backed up first`)}`,
    ...(k.action && k.action !== 'none' ? [`Zoetrope keys: ${k.action === 'verify' ? 'present' : k.action === 'add' ? 'written by its own setup-keys' : k.detail}${k.action === 'add' && k.detail ? ` (${k.detail})` : ''}`] : []),
  ];
}
