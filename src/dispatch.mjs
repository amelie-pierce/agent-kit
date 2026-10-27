import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { link, mkdir, open, rename, rm } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { harnessProfiles } from './harness.mjs';
import { envManaged, keyStatus } from './keys.mjs';

// Starter worker routing for a teammate who turns on Jev (TYPESAFE_API_KEY). The kit writes only
// config/crew-dispatch.json, rendered from the pinned Firstmate's own balanced strategy template, and
// never config/strategy, secondmate-harness or fresh-start.json, so no autonomy setting changes.
export const starterTemplate = 'balanced';
export const starterFile = 'config/crew-dispatch.json';
const sha = data => createHash('sha256').update(data).digest('hex');
const stat = path => lstatSync(path, { throwIfNoEntry: false });
const plainOrLink = path => { try { return lstatSync(path, { throwIfNoEntry: false }) !== undefined && statSync(path).isFile(); } catch { return false; } };
const plainFile = path => { const s = stat(path); return !!s && s.isFile() && !s.isSymbolicLink() && s.nlink === 1; };

export const plansOf = receipt => receipt?.setup?.answers?.plans || {};
export const harnessOf = receipt => receipt?.setup?.answers?.harness || (receipt?.phases?.['npm-codex'] ? 'codex' : 'claude');
export const providersOf = harness => harnessProfiles(harness).join(',');

// The plan-to-model table is one reviewed data file. Only ready rows are offered or applied; "not-sure"
// keeps Firstmate's template unchanged, and a saved plan whose row is not ready falls back to it.
const tablePath = new URL('../manifests/plan-models.json', import.meta.url);
export function loadPlanTable(path = tablePath) {
  const table = JSON.parse(readFileSync(path, 'utf8'));
  if (table?.schemaVersion !== 1 || typeof table.harnesses !== 'object') throw new Error('plan-models.json has an unexpected shape');
  for (const [harness, entry] of Object.entries(table.harnesses)) {
    const ids = new Set();
    for (const row of entry?.plans || []) {
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(row?.id || '') || ids.has(row.id) || !['ready', 'todo'].includes(row.status)) throw new Error(`plan-models.json: bad ${harness} plan row ${row?.id}`);
      ids.add(row.id);
      if (row.status !== 'ready' || row.id === 'not-sure') continue;
      const models = row.models, inPlan = model => Array.isArray(models) && models.includes(model);
      if (!Array.isArray(models) || !models.length || models.some(m => typeof m !== 'string') || typeof row.source !== 'string'
        || Object.values(row.substitute || {}).some(m => !inPlan(m)) || (row.validation && !inPlan(row.validation.model)))
        throw new Error(`plan-models.json: ready ${harness} plan ${row.id} needs a source, its models, and substitutes and validation from those models`);
    }
    if (!ids.has('not-sure')) throw new Error(`plan-models.json: ${harness} needs a not-sure row`);
  }
  return table;
}
export const readyPlans = (table, harness) => (table.harnesses[harness]?.plans || []).filter(row => row.status === 'ready');
const planRow = (table, harness, id) => readyPlans(table, harness).find(row => row.id === id && id !== 'not-sure') || null;
export const effectivePlans = (providers, plans = {}, table = loadPlanTable()) =>
  Object.fromEntries(providers.split(',').map(h => [h, planRow(table, h, plans?.[h]) ? plans[h] : 'not-sure']));

// A profile the plan cannot run is moved to the plan's substitute model, or dropped.
function fitPlan(profile, table, plans) {
  const row = planRow(table, profile?.harness, plans[profile?.harness]);
  if (!row || profile.model === undefined || row.models.includes(profile.model)) return profile;
  return row.substitute?.[profile.model] ? { ...profile, model: row.substitute[profile.model] } : null;
}

// Same result as fm-strategy.sh render_dispatch for a home with no crew-dispatch.json: every template
// rule with its profiles narrowed to the person's agent CLIs, rules left without a profile dropped,
// and the default narrowed the same way. With a ready plan, each profile is then fitted to that plan.
export function renderStarter(template, providers, plans = {}, table = loadPlanTable()) {
  const allowed = providers.split(','), chosen = effectivePlans(providers, plans, table);
  const keep = list => list.filter(profile => allowed.includes(profile?.harness)).map(profile => fitPlan(profile, table, chosen)).filter(Boolean);
  const narrow = use => Array.isArray(use) ? keep(use) : keep([use])[0] ?? [];
  const rules = template?.dispatch?.rules;
  if (!Array.isArray(rules) || rules.some(rule => typeof rule?.when !== 'string' || typeof rule?.strategy !== 'string' || !rule.use))
    throw new Error('Firstmate balanced strategy template has an unexpected dispatch shape');
  const rendered = { rules: rules.map(rule => ({ ...rule, use: narrow(rule.use) })).filter(rule => !Array.isArray(rule.use) || rule.use.length),
    default: narrow(template.dispatch.default ?? []) };
  // Firstmate rejects an empty default array; an absent default falls back to its normal harness choice.
  if (Array.isArray(rendered.default) && !rendered.default.length) delete rendered.default;
  return `${JSON.stringify(rendered, null, 2)}\n`;
}

// Firstmate prints the validation model for the person to set by hand in no-mistakes; the kit does the same.
export function starterValidation(template, providers, plans = {}, table = loadPlanTable()) {
  const chosen = effectivePlans(providers, plans, table);
  return providers.split(',').map(harness => {
    const row = planRow(table, harness, chosen[harness]), base = template?.validation?.[harness];
    const pick = row?.validation || (base ? fitPlan({ harness, ...base }, table, chosen) : null);
    return pick ? { harness, model: pick.model, effort: pick.effort } : null;
  }).filter(Boolean);
}

function readTemplate(firstmateHome) {
  const path = join(firstmateHome, 'bin', 'strategies', `${starterTemplate}.json`);
  return plainFile(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function ignored(firstmateHome) {
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', starterFile], {
    cwd: firstmateHome, env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8', timeout: 10000 });
  return r.status === 0;
}

// What the kit would do with the starter rules, without writing. record is receipt.setup.dispatch.
// create: write when no rules exist and the kit never wrote any; restore: rewrite kit rules that went missing.
export function planStarter(firstmateHome, { harness, plans = {}, table = loadPlanTable(), record = null, create = false, restore = false } = {}) {
  const path = join(firstmateHome, starterFile), strategy = join(firstmateHome, 'config', 'strategy');
  const providers = providersOf(harness);
  const keep = (action, detail) => ({ action, path, providers, record: action === 'skip' ? record : null, detail });
  const home = stat(firstmateHome), config = stat(join(firstmateHome, 'config'));
  if (!home?.isDirectory() || home.isSymbolicLink() || (config && (!config.isDirectory() || config.isSymbolicLink()))) return keep('skip', 'Firstmate home or its config folder is not a plain directory');
  if (stat(strategy)) return keep('keep', 'a Firstmate token strategy (config/strategy) owns the routing');
  const current = stat(path);
  if (current) {
    if (!plainFile(path)) return keep('keep', 'existing rules are not a plain file');
    if (!record || record.sha256 !== sha(readFileSync(path))) return keep('keep', 'existing rules are yours');
  } else if (!(record ? restore : create)) return { action: 'none', path, providers, record };
  const template = readTemplate(firstmateHome);
  if (!template) return keep('skip', `this Firstmate has no bin/strategies/${starterTemplate}.json template`);
  if (!ignored(firstmateHome)) return keep('skip', `${starterFile} is not gitignored in the Firstmate home`);
  const body = renderStarter(template, providers, plans, table), chosen = effectivePlans(providers, plans, table);
  const next = { file: starterFile, template: starterTemplate, providers, plans: chosen, sha256: sha(body) };
  const extra = { path, providers, plans: chosen, record: next, body, validation: starterValidation(template, providers, plans, table) };
  if (current) return { action: next.sha256 === record.sha256 ? 'verify' : 'refresh', ...extra, prior: record.sha256 };
  return { action: record ? 'restore' : 'write', ...extra };
}

// Applies a planStarter result. A new file is linked into place so it never replaces rules that
// appeared after planning; a refresh replaces only the unchanged kit file it planned against.
export async function applyStarter(plan) {
  if (!['write', 'restore', 'refresh'].includes(plan.action)) return plan;
  const dir = join(plan.path, '..');
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.crew-dispatch.agent-kit-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temp, 'wx', 0o644);
    await file.writeFile(plan.body);
    await file.sync();
    await file.close(); file = null;
    if (plan.action === 'refresh') {
      if (!plainFile(plan.path) || sha(readFileSync(plan.path)) !== plan.prior) return { ...plan, action: 'keep', record: null, detail: 'rules changed while updating; kept them' };
      await rename(temp, plan.path);
    } else {
      try { await link(temp, plan.path); }
      catch (error) { if (error.code === 'EEXIST') return { ...plan, action: 'keep', record: null, detail: 'rules appeared while installing; kept them' }; throw error; }
    }
  } finally {
    if (file) await file.close();
    await rm(temp, { force: true });
  }
  return plan;
}

// Uninstall removes the starter rules only while they are exactly what the kit wrote and no strategy took over.
export function starterRemovable(firstmateHome, record) {
  const path = join(firstmateHome, starterFile);
  if (!record?.sha256 || stat(join(firstmateHome, 'config', 'strategy')) || !plainFile(path)) return null;
  return sha(readFileSync(path)) === record.sha256 ? path : null;
}

const planText = plans => plans && Object.values(plans).some(id => id !== 'not-sure') ? ` fitted to your plan (${Object.entries(plans).map(([h, id]) => `${h} ${id}`).join(', ')})` : '';
const validationText = validation => validation?.length ? `\n  Validation model, set by hand in no-mistakes agent_config (the kit never edits it): ${validation.map(v => `${v.harness} ${v.model}${v.effort ? ` effort ${v.effort}` : ''}`).join('; ')}` : '';
export function describeStarter(plan) {
  const where = plan.path;
  switch (plan.action) {
    case 'write': return `Starter dispatch rules: wrote Firstmate's ${starterTemplate} rules for ${plan.providers}${planText(plan.plans)} to ${where} (recommended; Jev uses them to pick each worker's tier)${validationText(plan.validation)}`;
    case 'restore': return `Starter dispatch rules: restored the kit's ${starterTemplate} rules at ${where}`;
    case 'refresh': return `Starter dispatch rules: refreshed the unchanged kit rules at ${where} from Firstmate's ${starterTemplate} template${planText(plan.plans)}${validationText(plan.validation)}`;
    case 'verify': return `Starter dispatch rules: unchanged kit rules at ${where}`;
    case 'keep': return `Starter dispatch rules: kept ${where}; ${plan.detail}`;
    case 'skip': return `Starter dispatch rules: not written; ${plan.detail}`;
    default: return null;
  }
}

// Summary-screen text before anything is written; the home may not exist yet on a first install.
export function previewStarter(firstmateHome, { harness, plans = {}, table = loadPlanTable(), record = null, keySet = false } = {}) {
  const path = join(firstmateHome, starterFile), providers = providersOf(harness);
  if (stat(join(firstmateHome, 'config', 'strategy'))) return `keep ${path}; a Firstmate token strategy owns the routing`;
  const current = stat(path);
  if (current) return record?.sha256 && plainFile(path) && sha(readFileSync(path)) === record.sha256 ? `keep the kit's unchanged rules at ${path}` : `keep your existing ${path}`;
  if (!keySet) return `not written; the kit writes them only once TYPESAFE_API_KEY is set`;
  return `will write Firstmate's ${starterTemplate} rules for ${providers}${planText(effectivePlans(providers, plans, table))} to ${path} (recommended)`;
}

// Everything Firstmate's bin/fm-dispatch-resolve.sh needs before it routes with Jev, checked without reading
// or printing the key value: the key line in the home's .env, at least one well-formed rule, a usable
// never-send list when present, and the tools the resolver calls on PATH.
export function jevReadiness(firstmateHome, env = process.env) {
  const reasons = [], has = name => (env.PATH || '').split(delimiter).some(dir => dir && plainOrLink(join(dir, name)));
  if (!envManaged(firstmateHome)) reasons.push(`${join(firstmateHome, '.env')} is not a plain file`);
  else if (!keyStatus(firstmateHome)) reasons.push('TYPESAFE_API_KEY is not set; add it from your own terminal with agent-kit keys');
  if (!plainFile(join(firstmateHome, 'bin', 'fm-dispatch-resolve.sh'))) reasons.push('this Firstmate has no bin/fm-dispatch-resolve.sh');
  const rules = join(firstmateHome, starterFile);
  let parsed = null;
  try { parsed = plainFile(rules) ? JSON.parse(readFileSync(rules, 'utf8')) : null; } catch { /* reported below */ }
  if (!stat(rules)) reasons.push(`no ${starterFile}`);
  else if (!Array.isArray(parsed?.rules) || !parsed.rules.length || parsed.rules.some(rule => typeof rule?.when !== 'string' || ![rule?.use].flat().every(p => typeof p?.harness === 'string')))
    reasons.push(`${starterFile} has no well-formed rules`);
  const neverSend = join(firstmateHome, 'config', 'dispatch-never-send');
  if (stat(neverSend) && !plainFile(neverSend)) reasons.push('config/dispatch-never-send is not a regular file, so the resolver stays off');
  const missing = ['jq', 'curl', 'quota-axi', 'awk', 'grep', 'sed', 'tr'].filter(name => !has(name));
  if (missing.length) reasons.push(`not on PATH: ${missing.join(', ')}`);
  return { ready: !reasons.length, reasons };
}
