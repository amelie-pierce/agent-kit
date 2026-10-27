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
export function pluginEntry(pluginRoot, id = pluginId) {
  const manifestPath = join(pluginRoot, 'herdr-plugin.toml'), m = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (m.id !== id) throw new Error(`pinned plugin manifest names ${m.id}, not ${id}`);
  // Panes and actions carry every field their manifest declares (popup width and height included).
  return { plugin_id: m.id, name: m.name, version: m.version, min_herdr_version: m.min_herdr_version, description: m.description,
    manifest_path: manifestPath, plugin_root: pluginRoot, enabled: true, platforms: m.platforms,
    panes: (m.panes || []).map(p => ({ ...p })), actions: (m.actions || []).map(a => ({ ...a })), source: { kind: 'local' } };
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

// The plugins the kit registers: the session graph with its zoe and keys, and the tower's own Fleet plugin
// (pikenguyen227.zoetrope-fleet from the runtime's fleet-plugin/), which the launcher's open would otherwise link.
export const fleetPluginId = 'pikenguyen227.zoetrope-fleet';
export const managerPluginId = 'ray.plugin-manager';
function pluginSpecs(receipt, root) {
  const phase = id => receipt.phases?.[id]?.state === 'complete' && typeof receipt.phases[id].path === 'string' ? join(root, receipt.phases[id].path) : null;
  const graph = phase('zoetrope-herdr-plugin'), runtime = phase('zoe-fleet-runtime'), manager = phase('herdr-plugin-manager');
  return [graph && { id: pluginId, root: graph, key: 'entrySha256' }, manager && { id: managerPluginId, root: manager, key: 'managerSha256' },
    runtime && receipt.phases?.['zoe-fleet-tower'] && stat(join(runtime, 'fleet-plugin', 'herdr-plugin.toml')) && { id: fleetPluginId, root: join(runtime, 'fleet-plugin'), key: 'fleetSha256' }].filter(Boolean);
}
function registration(entries, spec, record, repair, registry) {
  const found = entries.filter(e => e?.plugin_id === spec.id);
  const entry = pluginEntry(spec.root, spec.id), ours = found.length === 1 && record?.[spec.key] && sha(stable(found[0])) === record[spec.key];
  if (found.length && !ours) return { spec, entry, action: 'keep', release: true, detail: `${registry} already has a ${spec.id} entry; left as it is` };
  if (found.length && stable(found[0]) === stable(entry)) return { spec, entry, action: 'verify' };
  if (!found.length && record?.[spec.key] && !repair) return { spec, entry, action: 'keep', detail: `the kit's ${spec.id} entry was removed; not added again (agent-kit repair restores it)` };
  return { spec, entry, action: found.length ? 'refresh' : 'add' };
}

// What setup, repair and upgrade would do with the plugins, without writing. record is setup.shortcuts.plugin.
export function planPlugin(receipt, root, { env = process.env, home = env.HOME, configPath, record = null, repair = false, isRunning } = {}) {
  const specs = pluginSpecs(receipt, root), herdr = receipt.phases?.herdr?.state === 'complete' ? join(root, receipt.phases.herdr.path) : null;
  if (!specs.length) return { action: 'none', record };
  if (!herdr) return { action: 'skip', detail: 'needs the pinned Herdr', record };
  const graph = specs.find(s => s.id === pluginId), zoeFleet = receipt.phases?.['zoe-fleet']?.path ? join(root, receipt.phases['zoe-fleet'].path) : null;
  if (graph && (!zoeFleet || !stat(zoeFleet)?.isFile())) return { action: 'skip', detail: 'needs the zoe-fleet release binary for zoe', record };
  const registry = record?.registry || pluginsPath(env, home);
  let entries;
  try { entries = readRegistry(registry).entries; } catch (error) { return { action: 'skip', detail: error.message, record }; }
  const regs = specs.map(spec => registration(entries, spec, record, repair, registry));
  if (regs.some(r => ['add', 'refresh'].includes(r.action)) && (isRunning || (() => false))('herdr'))
    for (const r of regs) if (['add', 'refresh'].includes(r.action)) Object.assign(r, { action: 'deferred', detail: `Herdr is running and owns ${registry}; stop it (herdr server stop) and rerun to register ${r.spec.id}` });
  let zoe = null;
  if (graph) {
    const path = join(root, zoeFile), body = zoeScript(zoeFleet), current = stat(path);
    zoe = { path, body, action: !current ? 'write' : !plainFile(path) || !record?.zoeSha256 ? 'conflict'
      : sha(readFileSync(path)) === sha(body) ? 'verify' : sha(readFileSync(path)) === record.zoeSha256 ? 'refresh' : repair ? 'replace' : 'keep' };
  }
  return { action: 'apply', root, herdr, pluginRoot: graph?.root || null, registry, entries, record, configPath, zoe, regs,
    register: regs.find(r => r.spec.id === pluginId) || { action: 'none' } };
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
  if (z && ['write', 'refresh', 'replace'].includes(z.action)) {
    if (z.action === 'replace') await backup(plan.root, z.path, 'zoe');
    await mkdir(dirname(z.path), { recursive: true, mode: 0o700 });
    const temp = `${z.path}.${randomUUID()}.tmp`;
    await writeFile(temp, z.body, { mode: 0o755, flag: 'wx' });
    await chmod(temp, 0o755);
    await rename(temp, z.path);
  }
  if (z && !['conflict', 'keep'].includes(z.action)) record.zoeSha256 = sha(z.body);
  const writes = plan.regs.filter(r => ['add', 'refresh'].includes(r.action));
  if (writes.length) {
    let entries = plan.entries;
    for (const r of writes) entries = r.action === 'add' ? [...entries, r.entry] : entries.map(e => e?.plugin_id === r.spec.id ? r.entry : e);
    await writeRegistry(plan.root, plan.registry, entries);
    record.created = record.created ?? !plan.entries.length;
  }
  for (const r of plan.regs) {
    if (['add', 'refresh', 'verify'].includes(r.action)) record[r.spec.key] = sha(stable(r.entry));
    else if (r.release) { delete record[r.spec.key]; if (r.spec.id === pluginId) delete record.keysSha256; }
  }
  // The session graph's own keys, once the kit registered it: its setup-keys writes them when its block is absent.
  let keys = { action: 'none' };
  if (record.entrySha256 && plan.configPath && plan.pluginRoot) {
    const text = plainFile(plan.configPath) ? readFileSync(plan.configPath, 'utf8') : '';
    const block = splitPluginKeys(text);
    if (block && record.keysSha256 && sha(block) !== record.keysSha256) { keys = { action: 'keep', detail: `the ${pluginId} keys block was edited; left as it is` }; delete record.keysSha256; }
    else if (block) { keys = { action: 'verify' }; record.keysSha256 ||= sha(block); }
    else {
      const result = await pluginKeys(plan, 'setup', env);
      const written = plainFile(plan.configPath) ? splitPluginKeys(readFileSync(plan.configPath, 'utf8')) : null;
      keys = result.ok && written ? { action: 'add', detail: result.detail } : { action: 'skip', detail: result.detail };
      if (written) record.keysSha256 = sha(written);
    }
  }
  return { ...plan, record, keys };
}

// Uninstall: the session graph's own remove-keys while its block is unchanged, then each kit entry and the zoe wrapper while unchanged.
export function planRemovePlugin(root, record, configPath) {
  if (!record) return null;
  const zoe = join(root, zoeFile);
  let entries = null;
  try { entries = readRegistry(record.registry).entries; } catch { /* left as it is */ }
  const ours = (id, key) => { const found = entries?.filter(e => e?.plugin_id === id) || []; return found.length === 1 && record[key] && sha(stable(found[0])) === record[key] ? found[0] : null; };
  const graph = ours(pluginId, 'entrySha256'), fleet = ours(fleetPluginId, 'fleetSha256'), manager = ours(managerPluginId, 'managerSha256');
  const block = configPath && plainFile(configPath) ? splitPluginKeys(readFileSync(configPath, 'utf8')) : null;
  const remove = [graph && pluginId, fleet && fleetPluginId, manager && managerPluginId].filter(Boolean);
  return { root, registry: record.registry, entries, configPath, pluginRoot: graph?.plugin_root || null, remove,
    zoe: { path: zoe, action: plainFile(zoe) && record.zoeSha256 && sha(readFileSync(zoe)) === record.zoeSha256 ? 'remove unchanged zoe wrapper' : 'keep changed or absent zoe wrapper' },
    register: { action: remove.length ? `remove the kit's ${remove.join(', ')} entries` : 'keep changed or absent plugin entries' },
    keys: { action: graph && block && record.keysSha256 && sha(block) === record.keysSha256 ? `remove the unchanged ${pluginId} keys block` : `keep changed or absent ${pluginId} keys block` } };
}
export async function removePlugin(plan, { env = process.env, herdr } = {}) {
  if (!plan) return;
  if (plan.keys.action.startsWith('remove') && plan.pluginRoot && stat(join(plan.pluginRoot, 'herdr', 'keys.sh')))
    await pluginKeys({ ...plan, herdr: herdr || 'herdr' }, 'remove', env);
  if (plan.remove.length) await writeRegistry(plan.root, plan.registry, plan.entries.filter(e => !plan.remove.includes(e?.plugin_id)));
  if (plan.zoe.action.startsWith('remove')) await rm(plan.zoe.path, { force: true });
}

export function describePlugin(result) {
  if (result.action === 'none') return [];
  if (result.action === 'skip') return [`Herdr plugins: not set up; ${result.detail}`];
  const z = result.zoe, k = result.keys || {};
  return [
    ...(z ? [z.action === 'conflict' ? `zoe: ${z.path} exists and is not the kit's; left unchanged` : `zoe: ${z.action === 'verify' ? 'verified' : z.action === 'keep' ? 'kept your changed' : 'written'} at ${z.path}`] : []),
    ...result.regs.map(r => `Herdr plugin ${r.spec.id} in ${result.registry}: ${r.detail || (r.action === 'verify' ? 'registered' : `${r.action === 'add' ? 'registered' : 'refreshed'}; backed up first`)}`),
    ...(k.action && k.action !== 'none' ? [`Zoetrope keys: ${k.action === 'verify' ? 'present' : k.action === 'add' ? 'written by its own setup-keys' : k.detail}`] : []),
  ];
}
