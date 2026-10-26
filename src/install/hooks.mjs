import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

// These are the published skill directories in the integrity-locked npm packages.
const tools = [
  ['gh-axi', 'gh-axi'],
  ['chrome-devtools-axi', 'chrome-devtools-axi'],
  ['lavish-axi', 'lavish'],
  ['quota-axi', 'quota-axi'],
  ['tasks-axi', 'tasks-axi'],
];
const hookTools = new Set(['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'tasks-axi']);
const herdrScripts = {
  'herdr-claude': { agent: 'claude', sha256: '7f117c303ffc1a66975b76dda8189d70b718fc04af4cf7cb11449e4ee5b4ae86' },
  'herdr-codex': { agent: 'codex', sha256: '38a90a2a99872d06dcbc978e7613406cdd852dbb07503abd7a113f518d5951f3' },
};
const hookIds = [...hookTools, ...Object.keys(herdrScripts)];
const exec = promisify(execFile);
const sha = data => createHash('sha256').update(data).digest('hex');
const marker = id => ` # agent-kit:${id}`;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const scriptPath = (root, release, id) => join(root, 'releases', release, 'herdr-hooks', herdrScripts[id].agent, 'herdr-agent-state.sh');
const commandFor = (root, release, id) => herdrScripts[id]
  ? `bash ${quote(scriptPath(root, release, id))} session${marker(id)}`
  : `${quote(join(root, 'releases', release, 'npm', 'node_modules', '.bin', id))}${marker(id)}`;
const ownedCommand = (command, root, id) => {
  const [head, tail] = commandFor(root, '\0', id).split('\0');
  return command.length > head.length + tail.length && command.startsWith(head) && command.endsWith(tail)
    && /^(?!\.\.?$)[^/']+$/.test(command.slice(head.length, command.length - tail.length));
};
const matcherFor = id => id === 'herdr-codex' ? undefined : id === 'herdr-claude' ? '^(startup|resume|clear|compact|fork)$' : '';
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const safeFile = path => {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (!st) return null;
  if (!st.isFile() || st.isSymbolicLink()) throw new Error(`${path}: expected a plain file; refusing hooks phase`);
  return readFileSync(path, 'utf8');
};
function plainParents(base, path) {
  let current = resolve(base);
  const suffix = relative(current, dirname(path));
  if (suffix.startsWith('..') || suffix.split(sep).includes('..')) throw new Error(`${path}: outside expected root; refusing hooks phase`);
  for (const part of ['', ...suffix.split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const st = lstatSync(current, { throwIfNoEntry: false });
    if (st && (!st.isDirectory() || st.isSymbolicLink())) throw new Error(`${current}: symlink or non-directory in hooks path; refusing hooks phase`);
  }
}
function jsonFile(path) {
  const source = safeFile(path);
  if (source === null) return { source, value: {} };
  let value;
  try { value = JSON.parse(source); } catch { throw new Error(`${path}: malformed JSON; refusing hooks phase`); }
  if (!plainObject(value)) throw new Error(`${path}: expected a JSON object; refusing hooks phase`);
  if (value.hooks !== undefined && !plainObject(value.hooks)) throw new Error(`${path}: hooks must be an object; refusing hooks phase`);
  if (value.hooks?.SessionStart !== undefined && !Array.isArray(value.hooks.SessionStart)) throw new Error(`${path}: SessionStart must be an array; refusing hooks phase`);
  return { source, value };
}
function managedId(command) {
  if (typeof command !== 'string') return null;
  return hookIds.find(id => command.endsWith(marker(id))) || null;
}
function managedCommands(value) {
  const found = new Map();
  for (const group of value.hooks?.SessionStart || []) {
    if (!plainObject(group) || !Array.isArray(group.hooks)) continue;
    for (const hook of group.hooks) {
      const id = managedId(hook?.command);
      if (id) {
        if (!found.has(id)) found.set(id, []);
        found.get(id).push({ ...(group.matcher === undefined ? {} : { matcher: group.matcher }), hooks: [hook] });
      }
    }
  }
  return found;
}
function mergeHooks(source, desired, root, path) {
  const value = structuredClone(source);
  const before = managedCommands(value);
  // A marker identifies ownership only when its command still points at a release inside this kit root.
  for (const [id, hooks] of before) for (const hook of hooks) {
    const handler = hook.hooks[0];
    if (!ownedCommand(handler.command, root, id) || handler.type !== 'command' || Object.keys(handler).some(key => !['command', 'type', 'timeout'].includes(key))
      || hook.matcher !== matcherFor(id)) {
      throw new Error(`${path}: marked ${id} hook was changed outside the kit path; refusing overwrite`);
    }
  }
  const seen = new Set();
  if (value.hooks?.SessionStart) {
    value.hooks.SessionStart = value.hooks.SessionStart.flatMap(group => {
      if (!plainObject(group) || !Array.isArray(group.hooks)) return [group];
      const remaining = [];
      for (const hook of group.hooks) {
        const id = managedId(hook?.command);
        if (!id) remaining.push(hook);
        else if (desired.has(id) && !seen.has(id)) {
          remaining.push(desired.get(id).hooks[0]);
          seen.add(id);
        }
      }
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
    if (!value.hooks.SessionStart.length) delete value.hooks.SessionStart;
    if (!Object.keys(value.hooks).length) delete value.hooks;
  }
  const changes = [];
  for (const id of hookIds) {
    const old = before.get(id) || [];
    const next = desired.get(id);
    if (old.length === 1 && next && JSON.stringify(old[0]) === JSON.stringify(next)) continue;
    if (old.length || next) changes.push({ op: old.length && next ? 'replace' : next ? 'add' : 'remove', path: '/hooks/SessionStart', owner: `agent-kit:${id}`, before: old, after: next ? [next] : [] });
  }
  if (desired.size) {
    value.hooks ||= {};
    value.hooks.SessionStart ||= [];
    for (const [id, entry] of desired) if (!seen.has(id)) value.hooks.SessionStart.push(entry);
  }
  // Do not reserialize an unchanged file, including whitespace and key order.
  return { value, changes };
}
const tomlKey = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
const tomlDottedKey = `${tomlKey}(?:\\s*\\.\\s*${tomlKey})*`;
const tomlHeader = new RegExp(`^(?:\\[\\s*(${tomlDottedKey})\\s*\\]|\\[\\[\\s*${tomlDottedKey}\\s*\\]\\])\\s*(?:#.*)?$`);
const tomlAssignment = new RegExp(`^(${tomlDottedKey})\\s*=\\s*(.+)$`);
const tomlName = key => key.split(/\s*\.\s*/).map(part => part.replace(/^(["'])(.*)\1$/, '$2')).join('.');
// Tracks strings and bracket depth so lines inside multi-line values are never read as headers or keys.
function tomlScan(text, state, path, line) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state.string) {
      if (text.startsWith(state.string, i)) { i += state.string.length - 1; state.string = null; }
      else if (ch === '\\' && state.string.startsWith('"')) i++;
      continue;
    }
    if (ch === '#') break;
    const triple = ['"""', "'''"].find(delimiter => text.startsWith(delimiter, i));
    if (triple) { state.string = triple; i += 2; }
    else if (ch === '"' || ch === "'") state.string = ch;
    else if (ch === '[' || ch === '{') state.depth++;
    else if (ch === ']' || ch === '}') state.depth--;
  }
  if (state.string?.length === 1 || state.depth < 0) throw new Error(`${path}: malformed TOML at line ${line}; refusing hooks phase`);
}
function tomlFeature(source, desired, path) {
  if (source === null && !desired) return { after: null, changes: [] };
  const input = source || '';
  const newline = input.includes('\r\n') ? '\r\n' : '\n';
  const lines = input.split(/\r?\n/);
  // Only table headers and the features.hooks key are interpreted; every other line passes through untouched.
  let section = '', featureAt = -1, featureEnd = -1, hookAt = -1, hookValue = null;
  const state = { string: null, depth: 0 };
  for (let i = 0; i < lines.length; i++) {
    if (state.string || state.depth) { tomlScan(lines[i], state, path, i + 1); continue; }
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(tomlHeader);
    if (header) {
      if (section === 'features') featureEnd = i;
      section = header[1] === undefined ? 'array' : tomlName(header[1]);
      if (section === 'features') {
        if (featureAt !== -1) throw new Error(`${path}: duplicate [features] table; refusing hooks phase`);
        featureAt = i;
      }
      continue;
    }
    const assignment = line.match(tomlAssignment);
    if (!assignment) throw new Error(`${path}: malformed TOML at line ${i + 1}; refusing hooks phase`);
    tomlScan(assignment[2], state, path, i + 1);
    const key = tomlName(assignment[1]);
    if (section === '' && (key === 'features' || key.startsWith('features.'))) throw new Error(`${path}: dotted or inline features needs manual review; refusing hooks phase`);
    if (section === 'features' && key === 'hooks') {
      if (hookAt !== -1 || !/^(true|false)(?:\s*#.*)?$/.test(assignment[2])) throw new Error(`${path}: invalid features.hooks value; refusing hooks phase`);
      hookAt = i; hookValue = assignment[2].startsWith('true');
    }
  }
  if (state.string || state.depth) throw new Error(`${path}: unterminated TOML value; refusing hooks phase`);
  if (!desired || hookValue === true) return { after: source, changes: [] };
  const out = [...lines];
  if (hookAt !== -1) out[hookAt] = out[hookAt].replace(/\bfalse\b/, 'true');
  else if (featureAt !== -1) {
    let end = featureEnd === -1 ? out.length : featureEnd;
    while (end > featureAt + 1 && out[end - 1].trim() === '') end--;
    out.splice(end, 0, 'hooks = true');
  } else {
    if (out.at(-1) !== '') out.push('');
    out.push('[features]', 'hooks = true', '');
  }
  return { after: out.join(newline), changes: [{ op: hookAt === -1 ? 'add' : 'replace', path: 'features.hooks', before: hookValue, after: true }] };
}

export function previewHooks(manifest, { home, installRoot }) {
  if (!home || !installRoot) throw new Error('hooks preview requires HOME and --install-root');
  const root = resolve(installRoot), release = manifest.release;
  const selected = new Set(manifest.tools.filter(tool => tool.classification !== 'never-ship' && tool.profile === 'core' && tool.version.status === 'verified').map(tool => tool.id));
  const axi = new Map();
  for (const id of hookTools) if (selected.has(id)) axi.set(id, { matcher: '', hooks: [{ type: 'command', command: commandFor(root, release, id), timeout: 10 }] });
  const herdr = manifest.tools.find(tool => tool.id === 'herdr');
  if (herdr?.version.status === 'verified' && herdr.version.value !== '0.9.3') throw new Error('Herdr integration contract requires review for this version');
  const hasHerdr = herdr?.version.status === 'verified' && herdr.version.value === '0.9.3';
  const files = [];
  for (const [agent, path] of [['claude', join(home, '.claude', 'settings.json')], ['codex', join(home, '.codex', 'hooks.json')]]) {
    plainParents(home, path);
    const desired = new Map(axi);
    if (hasHerdr) {
      const id = `herdr-${agent}`;
      desired.set(id, { ...(matcherFor(id) === undefined ? {} : { matcher: matcherFor(id) }), hooks: [{ type: 'command', command: commandFor(root, release, id), timeout: 10 }] });
    }
    const { source, value } = jsonFile(path);
    const merged = mergeHooks(value, desired, root, path);
    files.push({ path, kind: 'json', before: source, after: merged.changes.length ? `${JSON.stringify(merged.value, null, 2)}\n` : source, changes: merged.changes });
  }
  const config = join(home, '.codex', 'config.toml');
  plainParents(home, config);
  const toml = safeFile(config);
  const mergedToml = tomlFeature(toml, axi.size > 0 || hasHerdr, config);
  files.push({ path: config, kind: 'toml', before: toml, after: mergedToml.after, changes: mergedToml.changes });
  const skills = [];
  for (const [id, skill] of tools) for (const base of [join(home, '.claude', 'skills'), join(home, '.agents', 'skills')]) {
    const path = join(base, skill);
    const target = join(root, 'releases', release, 'npm', 'node_modules', id, 'skills', skill);
    plainParents(home, path);
    const st = lstatSync(path, { throwIfNoEntry: false });
    const old = st?.isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : null;
    const kitPrefix = join(root, 'releases') + sep;
    const owned = old?.startsWith(kitPrefix) && old.endsWith(join('node_modules', id, 'skills', skill));
    const next = selected.has(id) ? target : null;
    if (st && !owned) {
      if (next) throw new Error(`${path}: existing unowned skill; refusing hooks phase`);
      continue;
    }
    if (old !== next) skills.push({ path, kind: 'symlink', op: old && next ? 'replace' : next ? 'add' : 'remove', before: old, after: next, owner: `agent-kit:${id}` });
  }
  const scripts = [];
  for (const [id, spec] of Object.entries(herdrScripts)) {
    const path = scriptPath(root, release, id);
    plainParents(root, path);
    const source = safeFile(path);
    if (source !== null && sha(source) !== spec.sha256) throw new Error(`${path}: kit Herdr script changed; refusing hooks phase`);
    if (hasHerdr && source === null) scripts.push({ path, id, op: 'add', sha256: spec.sha256 });
    else if (!hasHerdr && source !== null) scripts.push({ path, id, op: 'remove', sha256: spec.sha256 });
  }
  return { files, skills, scripts, binaries: [...axi.keys()].map(id => join(root, 'releases', release, 'npm', 'node_modules', '.bin', id)),
    herdrBinary: hasHerdr ? join(root, 'releases', release, 'bin', 'herdr') : null,
    changed: files.some(x => x.changes.length) || skills.length > 0 || scripts.length > 0 };
}

async function generateHerdr(preview, installRoot) {
  const stage = await mkdtemp(join(installRoot, 'herdr-hooks-stage-'));
  try {
    const home = join(stage, 'home');
    await mkdir(join(home, '.claude'), { recursive: true, mode: 0o700 });
    await mkdir(join(home, '.codex'), { recursive: true, mode: 0o700 });
    const env = { HOME: home, PATH: '/usr/bin:/bin', TMPDIR: stage, LC_ALL: 'C' };
    const output = new Map();
    for (const [id, spec] of Object.entries(herdrScripts)) {
      await exec(preview.herdrBinary, ['integration', 'install', spec.agent], { env, timeout: 30000, maxBuffer: 65536 });
      const vendorPath = spec.agent === 'claude' ? join(home, '.claude', 'hooks', 'herdr-agent-state.sh') : join(home, '.codex', 'herdr-agent-state.sh');
      const body = await readFile(vendorPath);
      if (sha(body) !== spec.sha256) throw new Error(`Herdr ${spec.agent} script differs from reviewed 0.9.3 output; refusing hooks phase`);
      output.set(id, body);
    }
    return output;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export async function applyHooks(preview, { installRoot, receipt, save, generateHerdrHooks }) {
  if (!preview.changed) return { id: 'hooks', status: 'skipped', reason: 'global hooks and skills already match' };
  // Validate all kit package targets before the first global write.
  for (const binary of preview.binaries) if (!existsSync(binary)) throw new Error(`${binary}: pinned hook binary missing; refusing hooks phase`);
  if (preview.herdrBinary) {
    const entry = receipt.phases.herdr;
    if (!entry || entry.state !== 'complete' || !existsSync(preview.herdrBinary) || sha(await readFile(preview.herdrBinary)) !== entry.ownedSha256)
      throw new Error(`${preview.herdrBinary}: pinned Herdr receipt or binary mismatch; refusing hooks phase`);
  }
  const scripts = preview.scripts.some(x => x.op === 'add') ? await (generateHerdrHooks || generateHerdr)(preview, installRoot) : new Map();
  for (const skill of preview.skills) if (skill.after && !existsSync(join(skill.after, 'SKILL.md'))) throw new Error(`${skill.after}: pinned skill missing; refusing hooks phase`);
  for (const file of preview.files) if (file.changes.length && safeFile(file.path) !== file.before) throw new Error(`${file.path}: changed since preview; refusing hooks phase`);
  for (const skill of preview.skills) {
    const st = lstatSync(skill.path, { throwIfNoEntry: false });
    if (st && !st.isSymbolicLink()) throw new Error(`${skill.path}: changed since preview; refusing hooks phase`);
    const old = st?.isSymbolicLink() ? resolve(dirname(skill.path), readlinkSync(skill.path)) : null;
    if (old !== skill.before) throw new Error(`${skill.path}: changed since preview; refusing hooks phase`);
  }
  for (const script of preview.scripts) {
    const current = safeFile(script.path);
    if ((script.op === 'add' && current !== null) || (script.op === 'remove' && (current === null || sha(current) !== script.sha256)))
      throw new Error(`${script.path}: changed since preview; refusing hooks phase`);
    if (script.op === 'add' && sha(scripts.get(script.id) || '') !== script.sha256) throw new Error(`${script.path}: generated script digest mismatch; refusing hooks phase`);
  }
  const backupDir = join(installRoot, 'backups', 'hooks', randomUUID());
  for (const file of preview.files) if (file.changes.length && file.before !== null) {
    const backup = join(backupDir, file.path.includes(`${sep}.claude${sep}`) ? 'claude-settings.json' : file.kind === 'toml' ? 'codex-config.toml' : 'codex-hooks.json');
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
    await writeFile(backup, file.before, { mode: 0o600, flag: 'wx' });
  }
  for (const skill of preview.skills) if (skill.before) {
    const backup = join(backupDir, 'skills', skill.path.includes(`${sep}.claude${sep}`) ? 'claude' : 'codex', skill.path.split(sep).at(-1));
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
    await writeFile(backup, `${skill.before}\n`, { mode: 0o600, flag: 'wx' });
  }
  for (const script of preview.scripts) if (script.op === 'remove') {
    const backup = join(backupDir, 'herdr', script.id);
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
    await writeFile(backup, await readFile(script.path), { mode: 0o600, flag: 'wx' });
  }
  for (const script of preview.scripts) if (script.op === 'add') {
    await mkdir(dirname(script.path), { recursive: true, mode: 0o700 });
    const temp = `${script.path}.${randomUUID()}.tmp`;
    await writeFile(temp, scripts.get(script.id), { mode: 0o700, flag: 'wx' });
    await chmod(temp, 0o700);
    await rename(temp, script.path);
  }
  for (const file of preview.files) if (file.changes.length) {
    await mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
    const temp = `${file.path}.${randomUUID()}.tmp`;
    await writeFile(temp, file.after, { mode: 0o600, flag: 'wx' });
    await rename(temp, file.path);
  }
  for (const skill of preview.skills) {
    await mkdir(dirname(skill.path), { recursive: true, mode: 0o700 });
    if (skill.after) {
      const temp = `${skill.path}.${randomUUID()}.tmp`;
      await symlink(skill.after, temp);
      await rename(temp, skill.path);
    } else if (skill.before) await unlink(skill.path);
  }
  for (const script of preview.scripts) if (script.op === 'remove') await unlink(script.path);
  receipt.phases.hooks = { state: 'complete', files: preview.files.filter(x => x.changes.length).map(x => ({ path: x.path, kind: x.kind, changes: x.changes.map(c => c.owner || c.path) })),
    skills: preview.skills.map(x => ({ path: x.path, owner: x.owner, target: x.after })), scripts: preview.scripts.map(x => ({ path: x.path, owner: `agent-kit:${x.id}`, action: x.op, sha256: x.sha256 })) };
  await save();
  return { id: 'hooks', status: 'installed', reason: 'kit-owned global hooks and skills merged with private backups' };
}

export function publicHookChanges(preview) {
  return [...preview.files.filter(x => x.changes.length).map(({ path, kind, changes }) => ({ path, kind, changes })),
    ...preview.skills.map(({ path, op, before, after, owner }) => ({ path, kind: 'symlink', changes: [{ op, owner, before, after }] })),
    ...preview.scripts.map(({ path, id, op, sha256 }) => ({ path, kind: 'script', changes: [{ op, owner: `agent-kit:${id}`, sha256 }] }))];
}
