import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { link, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { harnessProfiles } from './harness.mjs';
import { envManaged, keyName, keyStatus } from './keys.mjs';

// Starter worker routing for a teammate who turns on Jev (TYPESAFE_API_KEY). When the home's fm-strategy.sh
// accepts --plans, the kit selects the strategy there and Firstmate renders every file; the receipt records
// that selection (via: 'fm-strategy') by the digests of crew-dispatch.json and config/strategy. An older
// Firstmate without --plans gets the bridge: the kit renders the chosen mode's template from the home,
// fitted to the person's plans from manifests/plan-models.json, and writes only config/crew-dispatch.json,
// never config/strategy, secondmate-harness or fresh-start.json. An unchanged bridge file moves to the
// native selection once the home takes --plans; an edited one stays the person's.
export const starterFile = 'config/crew-dispatch.json';
const strategyFile = 'config/strategy';
export const modes = ['lean', 'balanced', 'full'];
const sha = data => createHash('sha256').update(data).digest('hex');
const stat = path => lstatSync(path, { throwIfNoEntry: false });
const plainOrLink = path => { try { return lstatSync(path, { throwIfNoEntry: false }) !== undefined && statSync(path).isFile(); } catch { return false; } };
const plainFile = path => { const s = stat(path); return !!s && s.isFile() && !s.isSymbolicLink() && s.nlink === 1; };

export const plansOf = receipt => receipt?.setup?.answers?.plans || {};
export const modeOf = receipt => receipt?.setup?.answers?.dispatchMode;
export const harnessOf = receipt => receipt?.setup?.answers?.harness || (receipt?.phases?.['npm-codex'] ? 'codex' : 'claude');
export const providersOf = harness => harnessProfiles(harness).join(',');

// The plan-to-model table is one reviewed data file. Plan ids match Firstmate's fm-strategy.sh --plans names;
// "not-sure" (shown as skip) is kit-only and keeps Firstmate's template unchanged.
const tablePath = new URL('../manifests/plan-models.json', import.meta.url);
const roles = ['coordinator', 'light', 'standard', 'hard', 'requested', 'validation'];
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
export function loadPlanTable(path = tablePath) {
  const table = JSON.parse(readFileSync(path, 'utf8'));
  if (table?.schemaVersion !== 2 || typeof table.harnesses !== 'object') throw new Error('plan-models.json has an unexpected shape');
  const route = value => typeof value?.model === 'string' && efforts.includes(value.effort);
  for (const [harness, entry] of Object.entries(table.harnesses)) {
    const ids = new Set();
    for (const row of entry?.plans || []) {
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(row?.id || '') || ids.has(row.id) || !modes.includes(row.modes?.default)
        || (row.profile !== null && !entry.profiles?.[row.profile]) || (row.id === 'not-sure') !== (row.profile === null)
        || Object.values(row.substitute || {}).some(model => typeof model !== 'string'))
        throw new Error(`plan-models.json: bad ${harness} plan row ${row?.id}`);
      ids.add(row.id);
    }
    if (!ids.has('not-sure')) throw new Error(`plan-models.json: ${harness} needs a not-sure row`);
    for (const [name, profile] of Object.entries(entry.profiles || {})) for (const mode of modes) {
      const p = profile?.modes?.[mode];
      if (!p || roles.some(role => !route(p[role])) || (p.secondmates !== null && typeof p.secondmates !== 'object')
        || (p.floors !== null && !(Number.isInteger(p.floors?.light) && Number.isInteger(p.floors?.standard))))
        throw new Error(`plan-models.json: ${harness} profile ${name} ${mode} needs every role with a model and effort`);
    }
  }
  return table;
}
export const planIds = (table, harness) => (table.harnesses[harness]?.plans || []).map(row => row.id);
const planRow = (table, harness, id) => (table.harnesses[harness]?.plans || []).find(row => row.id === id && row.profile) || null;
export const effectivePlans = (providers, plans = {}, table = loadPlanTable()) =>
  Object.fromEntries(providers.split(',').map(h => [h, planRow(table, h, plans?.[h]) ? plans[h] : 'not-sure']));

// The plan's roles at one mode, with the row's substitutes applied (Enterprise/Edu without 6.1 Sol).
function planRoles(table, harness, id, mode) {
  const row = planRow(table, harness, id);
  if (!row) return null;
  const profile = table.harnesses[harness].profiles[row.profile], swap = route => route && route.model ? { ...route, model: row.substitute?.[route.model] || route.model } : route;
  return { ...Object.fromEntries(Object.entries(profile.modes[mode]).map(([role, value]) => [role, ['floors'].includes(role) ? value : swap(value)])), fableNote: profile.fableNote || null };
}

// Default mode: lean when any chosen plan defaults to lean (small plans, API keys), else balanced. Full
// is warned about on Pro, Team Standard, Enterprise standard, Plus and Business Standard.
export function defaultMode(providers, plans = {}, table = loadPlanTable()) {
  const rows = Object.entries(effectivePlans(providers, plans, table)).map(([h, id]) => (table.harnesses[h].plans || []).find(row => row.id === id));
  return rows.some(row => row?.modes.default === 'lean') ? 'lean' : 'balanced';
}
export function fullWarnings(providers, plans = {}, table = loadPlanTable()) {
  return Object.entries(effectivePlans(providers, plans, table)).map(([h, id]) => planRow(table, h, id)).filter(row => row?.modes.warnFull)
    .map(row => row.label);
}

const slotRole = { 'claude-model-requested': 'model-requested', 'codex-model-requested': 'model-requested', 'claude-requested': 'requested', 'codex-requested': 'requested',
  light: 'light', standard: 'standard', hard: 'hard' };

// Same result as fm-strategy.sh render_dispatch for a home with no crew-dispatch.json: every template rule
// with its profiles narrowed to the person's agent CLIs, rules left without a profile dropped, and the
// default narrowed the same way. A harness with a plan then takes that plan's model and effort for the
// rule's slot: the exact-model rule at high, Claude floors on light and standard, and standard as default.
export function renderStarter(template, providers, plans = {}, table = loadPlanTable(), mode = 'balanced') {
  const allowed = providers.split(','), chosen = effectivePlans(providers, plans, table);
  const byHarness = Object.fromEntries(allowed.map(h => [h, planRoles(table, h, chosen[h], mode)]));
  const fit = (profile, role) => {
    const p = byHarness[profile.harness];
    if (!p || !role) return profile;
    if (role === 'model-requested') return { harness: profile.harness, model: p.requested.model, effort: 'high' };
    const floor = ['light', 'standard'].includes(role) && p.floors ? { floor: { scope: 'all_models', min_percent: p.floors[role] } } : {};
    return { harness: profile.harness, model: p[role].model, effort: p[role].effort, ...floor };
  };
  const keep = (list, role) => list.filter(profile => allowed.includes(profile?.harness)).map(profile => fit(profile, role));
  const narrow = (use, role) => Array.isArray(use) ? keep(use, role) : keep([use], role)[0] ?? [];
  const rules = template?.dispatch?.rules;
  if (!Array.isArray(rules) || rules.some(rule => typeof rule?.when !== 'string' || typeof rule?.strategy !== 'string' || !rule.use))
    throw new Error('Firstmate strategy template has an unexpected dispatch shape');
  const note = rule => rule.strategy === 'claude-model-requested' && byHarness.claude?.fableNote ? { why: `${rule.why ? `${rule.why} ` : ''}${byHarness.claude.fableNote}` } : {};
  const rendered = { rules: rules.map(rule => ({ ...rule, use: narrow(rule.use, slotRole[rule.strategy]), ...note(rule) })).filter(rule => !Array.isArray(rule.use) || rule.use.length),
    default: narrow(template.dispatch.default ?? [], 'standard').map(profile => { const { floor, ...rest } = profile; return byHarness[profile.harness] ? rest : profile; }) };
  // Firstmate rejects an empty default array; an absent default falls back to its normal harness choice.
  if (Array.isArray(rendered.default) && !rendered.default.length) delete rendered.default;
  return `${JSON.stringify(rendered, null, 2)}\n`;
}

// The owner's two extra tiers, added after the rendered rules as custom rules (no strategy key, so
// fm-strategy.sh set keeps them on every re-render): check runs the rendered light route at low effort and
// research the rendered hard route, so they follow the plans already fitted and add no new model or spend.
export const ownerTiers = [
  { id: 'check', when: 'Quick checks that change nothing: confirm a fact, read state, rerun an existing check or test, answer a lookup', from: 'light', effort: 'low',
    why: 'A check needs no deep reasoning; the light route at low effort keeps it cheap.' },
  { id: 'research', when: 'Open-ended research or investigation across several sources before any change is planned', from: 'hard',
    why: 'Research rewards the strongest route the plan already uses for hard work.' },
];
export function withOwnerTiers(body) {
  const value = JSON.parse(body), rules = Array.isArray(value.rules) ? value.rules : null;
  if (!rules) return body;
  for (const tier of ownerTiers) {
    if (rules.some(rule => rule.when === tier.when)) continue;
    const source = rules.find(rule => rule.strategy === tier.from);
    if (!source) continue;
    const use = [source.use].flat().map(profile => ({ ...profile, ...(tier.effort ? { effort: tier.effort } : {}) }));
    rules.push({ when: tier.when, use: Array.isArray(source.use) ? use : use[0], why: tier.why });
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Settings Firstmate leaves to the person, printed as fm-strategy.sh show does: the coordinator launch,
// the no-mistakes validation model, and the second mate launch. The kit edits none of them.
export function starterAdvice(template, providers, plans = {}, table = loadPlanTable(), mode = 'balanced') {
  const chosen = effectivePlans(providers, plans, table);
  return providers.split(',').map(harness => {
    const p = planRoles(table, harness, chosen[harness], mode);
    const pick = (role, base) => p ? p[role] : base?.[harness] ? { model: base[harness].model, effort: base[harness].effort } : null;
    const mates = p ? (p.secondmates?.model ? `${p.secondmates.model} effort ${p.secondmates.effort}${p.secondmates.recommend === 'off' ? ' if created (off recommended)' : ''}` : 'off')
      : template?.secondmates?.allowed ? `${template.secondmates[harness]?.model} effort ${template.secondmates[harness]?.effort}` : 'off';
    return { harness, coordinator: pick('coordinator', template?.coordinator), validation: pick('validation', template?.validation), secondmates: mates };
  });
}

function readTemplate(firstmateHome, mode) {
  const path = join(firstmateHome, 'bin', 'strategies', `${mode}.json`);
  return plainFile(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function ignored(firstmateHome) {
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', starterFile], {
    cwd: firstmateHome, env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8', timeout: 10000 });
  return r.status === 0;
}

// A Firstmate whose fm-strategy.sh documents --plans renders plan-aware rules itself.
export function strategyTakesPlans(firstmateHome) {
  const script = join(firstmateHome, 'bin', 'fm-strategy.sh');
  if (!plainFile(script)) return false;
  const r = spawnSync('bash', [script, '--help'], { cwd: firstmateHome, env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', FM_HOME: firstmateHome }, encoding: 'utf8', timeout: 10000 });
  return r.status === 0 && /--plans\b/.test(`${r.stdout}${r.stderr}`);
}
export const plansArg = plans => Object.entries(plans).filter(([, id]) => id !== 'not-sure').map(([h, id]) => `${h}=${id}`).join(',');
const setArgv = (mode, providers, plans) => ['set', mode, '--providers', providers, ...(plansArg(plans) ? ['--plans', plansArg(plans)] : [])];
const nativeRecord = record => record?.via === 'fm-strategy';
const fileSha = path => plainFile(path) ? sha(readFileSync(path)) : null;
// A strategy the kit selected stays the kit's to refresh only while neither file it recorded has changed.
const nativeUnchanged = (firstmateHome, record) => !!record.sha256 && !!record.strategySha256
  && fileSha(join(firstmateHome, starterFile)) === record.sha256 && fileSha(join(firstmateHome, strategyFile)) === record.strategySha256;

// What the kit would do with the starter rules, without writing. record is receipt.setup.dispatch.
// create: write when no rules exist and the kit never wrote any; restore: rewrite kit rules that went missing.
export function planStarter(firstmateHome, { harness, plans = {}, mode, table = loadPlanTable(), record = null, create = false, restore = false } = {}) {
  const path = join(firstmateHome, starterFile), strategy = join(firstmateHome, strategyFile);
  const providers = providersOf(harness), chosen = effectivePlans(providers, plans, table);
  mode = modes.includes(mode) ? mode : defaultMode(providers, plans, table);
  const keep = (action, detail) => ({ action, path, providers, mode, record: action === 'skip' ? record : null, detail });
  const native = (action, extra = {}) => ({ action, path, providers, plans: chosen, mode, record, argv: setArgv(mode, providers, chosen), ...extra });
  const home = stat(firstmateHome), config = stat(join(firstmateHome, 'config'));
  if (!home?.isDirectory() || home.isSymbolicLink() || (config && (!config.isDirectory() || config.isSymbolicLink()))) return keep('skip', 'Firstmate home or its config folder is not a plain directory');
  if (stat(strategy)) {
    if (!nativeRecord(record)) return keep('keep', 'a Firstmate token strategy (config/strategy) owns the routing');
    if (!nativeUnchanged(firstmateHome, record)) return keep('keep', 'the Firstmate strategy the kit selected was changed since; Firstmate owns it');
    if (!strategyTakesPlans(firstmateHome)) return { action: 'verify', path, providers, mode, record };
    return native('reselect');
  }
  const current = stat(path);
  if (current) {
    if (!plainFile(path)) return keep('keep', 'existing rules are not a plain file');
    if (!record || record.sha256 !== sha(readFileSync(path))) {
      const hint = record && !nativeRecord(record) && strategyTakesPlans(firstmateHome)
        ? `; bin/fm-strategy.sh ${setArgv(mode, providers, chosen).join(' ')} switches them to Firstmate's plan-aware strategy` : '';
      return keep('keep', `existing rules are yours${hint}`);
    }
    if (nativeRecord(record)) return keep('keep', 'config/strategy was removed since the kit selected the strategy; the rules are yours');
  } else if (!(record ? restore : create)) return { action: 'none', path, providers, mode, record };
  // Here the rules are absent, or are the kit's unchanged bridge file.
  if (strategyTakesPlans(firstmateHome)) return current ? native('migrate', { prior: record.sha256 }) : native('strategy');
  const template = readTemplate(firstmateHome, mode);
  if (!template) return keep('skip', `this Firstmate has no bin/strategies/${mode}.json template`);
  if (!ignored(firstmateHome)) return keep('skip', `${starterFile} is not gitignored in the Firstmate home`);
  const body = withOwnerTiers(renderStarter(template, providers, plans, table, mode));
  const next = { file: starterFile, template: mode, providers, plans: chosen, sha256: sha(body) };
  const extra = { path, providers, plans: chosen, mode, record: next, body, advice: starterAdvice(template, providers, plans, table, mode) };
  if (current) return { action: next.sha256 === record.sha256 ? 'verify' : 'refresh', ...extra, prior: record.sha256 };
  return { action: record ? 'restore' : 'write', ...extra };
}

// Applies a planStarter result. A new file is linked into place so it never replaces rules that
// appeared after planning; a refresh replaces only the unchanged kit file it planned against.
export async function applyStarter(plan) {
  if (['strategy', 'migrate', 'reselect'].includes(plan.action)) return selectStrategy(plan);
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

// Runs the home's fm-strategy.sh without the key. A migration first moves the unchanged bridge file aside so
// Firstmate renders from its template alone, and puts it back when no strategy was selected. A reselect asks
// for a dry run first and leaves an already matching home untouched.
async function selectStrategy(plan) {
  const home = join(plan.path, '..', '..'), strategy = join(home, strategyFile);
  const { [keyName]: _key, ...env } = process.env;
  const run = extra => spawnSync('bash', [join(home, 'bin', 'fm-strategy.sh'), ...plan.argv, ...extra], { cwd: home, env: { ...env, FM_HOME: home }, encoding: 'utf8', timeout: 120000 });
  const last = r => (r.stderr || r.stdout || '').trim().split('\n').pop() || `exit ${r.status}`;
  if (plan.action === 'reselect') {
    const dry = run(['--dry-run']);
    if (dry.status === 0 && /^no change:/m.test(dry.stdout)) return { ...plan, action: 'verify' };
  }
  let aside = null;
  if (plan.action === 'migrate') {
    if (fileSha(plan.path) !== plan.prior) return { ...plan, action: 'keep', record: null, detail: 'rules changed while updating; kept them' };
    aside = join(home, 'config', `.crew-dispatch.agent-kit-${randomUUID()}.bridge`);
    await rename(plan.path, aside);
  }
  const r = run(['--yes']);
  const selected = !!stat(strategy);
  if (aside) {
    if (selected) await rm(aside, { force: true });
    else {
      try { await link(aside, plan.path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await rm(aside, { force: true });
    }
  }
  if (!selected) return { ...plan, action: 'skip', detail: `fm-strategy.sh ${plan.argv.slice(0, 2).join(' ')} failed: ${last(r)}` };
  if (plainFile(plan.path)) {
    const before = readFileSync(plan.path, 'utf8'), after = withOwnerTiers(before);
    if (after !== before) { const temp = `${plan.path}.agent-kit-${randomUUID()}.tmp`; await writeFile(temp, after, { flag: 'wx' }); await rename(temp, plan.path); }
  }
  const sha256 = fileSha(plan.path), strategySha256 = fileSha(strategy);
  const record = sha256 && strategySha256 ? { file: starterFile, via: 'fm-strategy', template: plan.mode, providers: plan.providers, plans: plan.plans, sha256, strategySha256 } : null;
  return { ...plan, record, ...(r.status === 0 ? {} : { detail: `fm-strategy.sh selected the strategy but then reported: ${last(r)}` }) };
}

// Uninstall removes the starter rules only while they are exactly what the kit wrote and no strategy took over.
// A strategy the kit selected through fm-strategy.sh is Firstmate's configuration and stays.
export function starterRemovable(firstmateHome, record) {
  const path = join(firstmateHome, starterFile);
  if (!record?.sha256 || nativeRecord(record) || stat(join(firstmateHome, strategyFile)) || !plainFile(path)) return null;
  return sha(readFileSync(path)) === record.sha256 ? path : null;
}

const planText = plans => plans && Object.values(plans).some(id => id !== 'not-sure') ? ` fitted to your plan (${Object.entries(plans).map(([h, id]) => `${h} ${id}`).join(', ')})` : '';
const route = r => r ? `${r.model} effort ${r.effort}` : 'harness default';
const adviceText = advice => advice?.length ? advice.map(a => `\n  ${a.harness}: start the coordinator on ${route(a.coordinator)}; set no-mistakes agent_config validation to ${route(a.validation)}; second mates ${a.secondmates} (set these by hand; the kit never edits them)`).join('') : '';
export function describeStarter(plan) {
  const where = plan.path;
  const warning = plan.detail ? `; ${plan.detail}` : '';
  const command = () => `bin/fm-strategy.sh ${plan.argv.join(' ')} --yes`;
  switch (plan.action) {
    case 'strategy': return `Starter dispatch rules: selected Firstmate's ${plan.mode} strategy for ${plan.providers}${planText(plan.plans)} with ${command()}; Firstmate owns the routing files${warning}`;
    case 'migrate': return `Starter dispatch rules: replaced the kit's unchanged bridge rules at ${where} with Firstmate's ${plan.mode} strategy for ${plan.providers}${planText(plan.plans)} (${command()}); Firstmate owns the routing files${warning}`;
    case 'reselect': return `Starter dispatch rules: refreshed Firstmate's ${plan.mode} strategy the kit selected, for ${plan.providers}${planText(plan.plans)}, with ${command()}${warning}`;
    case 'write': return `Starter dispatch rules: wrote Firstmate's ${plan.mode} rules for ${plan.providers}${planText(plan.plans)} to ${where} (Jev uses them to pick each worker's tier)${adviceText(plan.advice)}`;
    case 'restore': return `Starter dispatch rules: restored the kit's ${plan.mode} rules at ${where}`;
    case 'refresh': return `Starter dispatch rules: refreshed the unchanged kit rules at ${where} from Firstmate's ${plan.mode} template${planText(plan.plans)}${adviceText(plan.advice)}`;
    case 'verify': return nativeRecord(plan.record) ? `Starter dispatch rules: Firstmate's ${plan.mode} strategy the kit selected is unchanged` : `Starter dispatch rules: unchanged kit rules at ${where}`;
    case 'keep': return `Starter dispatch rules: kept ${where}; ${plan.detail}`;
    case 'skip': return `Starter dispatch rules: not written; ${plan.detail}`;
    default: return null;
  }
}

// Summary-screen text before anything is written; the home may not exist yet on a first install.
export function previewStarter(firstmateHome, { harness, plans = {}, mode, table = loadPlanTable(), record = null, keySet = false } = {}) {
  const path = join(firstmateHome, starterFile), providers = providersOf(harness);
  mode = modes.includes(mode) ? mode : defaultMode(providers, plans, table);
  if (stat(join(firstmateHome, strategyFile))) return nativeRecord(record) && nativeUnchanged(firstmateHome, record)
    ? `keep Firstmate's strategy the kit selected; refreshed with bin/fm-strategy.sh for ${providers}${planText(effectivePlans(providers, plans, table))}`
    : `keep ${path}; a Firstmate token strategy owns the routing`;
  const current = stat(path), unchanged = !!record?.sha256 && plainFile(path) && sha(readFileSync(path)) === record.sha256;
  if (current) return unchanged && !nativeRecord(record) && strategyTakesPlans(firstmateHome)
    ? `switch the kit's unchanged rules at ${path} to Firstmate's ${mode} strategy with bin/fm-strategy.sh --plans`
    : unchanged && !nativeRecord(record) ? `keep the kit's unchanged rules at ${path}` : `keep your existing ${path}`;
  if (!keySet) return `not written; the kit writes them only once TYPESAFE_API_KEY is set`;
  if (strategyTakesPlans(firstmateHome)) return `will select Firstmate's ${mode} strategy for ${providers}${planText(effectivePlans(providers, plans, table))} with bin/fm-strategy.sh --plans`;
  return `will write Firstmate's ${mode} rules for ${providers}${planText(effectivePlans(providers, plans, table))} to ${path}`;
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
