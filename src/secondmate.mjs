import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function secondmateTemplate() {
  const charter = readFileSync(new URL('../templates/secondmate/charter.md', import.meta.url), 'utf8');
  return `${charter}\nPreview and adopt from your own Firstmate checkout:\n` +
    `  FM_SECONDMATE_CHARTER='<your responsibility and rules>' FM_SECONDMATE_SCOPE='<your scope>' bin/fm-brief.sh <id> --secondmate --no-projects\n` +
    `  # Or replace --no-projects with your own registered project names. Review the generated charter before seeding.\n` +
    `  bin/fm-home-seed.sh <id> <home|-> --no-projects\n` +
    `  # Or replace --no-projects with the same project names you reviewed above.\n` +
    `  bin/fm-spawn.sh <id> --secondmate\n`;
}

export function charterText(scope) {
  const template = readFileSync(new URL('../templates/secondmate/charter.md', import.meta.url), 'utf8');
  // Firstmate wraps the charter under its own heading, so the template's title line is dropped.
  return template.replace(/^# .*\n+/, '').replace('<describe the work this mate owns>', scope).replace('<describe the projects and decisions this mate may handle>', scope).trim();
}

export const mateRegistry = firstmateHome => join(firstmateHome, 'data', 'secondmates.md');
// The mates the Firstmate home's own registry lists, as "- <id> - <summary> (home: ...)" lines.
export function listMates(firstmateHome) {
  const path = mateRegistry(firstmateHome);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map(line => line.match(/^- ([a-z][a-z0-9-]*) - (.*?)(?: \(home: ([^;)]*).*\))?$/)).filter(Boolean)
    .map(([, id, summary, home]) => ({ id, summary, home: home || null }));
}

// Runs one of the Firstmate home's own scripts with the kit's tools first on PATH; never with the dispatch key.
export function firstmateScript(firstmateHome, args, { env, path = [], extra = {}, stdio } = {}) {
  const { TYPESAFE_API_KEY: _key, ...rest } = env;
  const r = spawnSync('bash', args, { cwd: firstmateHome, env: { ...rest, PATH: [...path, env.PATH].filter(Boolean).join(':'), ...extra }, encoding: 'utf8', timeout: 300000, ...(stdio ? { stdio } : {}) });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${args[0]} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0] || `exit ${r.status}`}`);
  return r;
}

// Writes the charter and seeds the mate's own home with Firstmate's fm-brief.sh --secondmate and fm-home-seed.sh,
// project-less. A mate already in the registry is left as it is.
export function seedMate({ id, scope, firstmateHome, home, env, path = [] }) {
  const registry = mateRegistry(firstmateHome);
  if (listMates(firstmateHome).some(mate => mate.id === id)) return { registered: true, registry, home };
  if (existsSync(home)) throw new Error(`${home} exists but ${id} is not registered; inspect it yourself, the kit leaves it unchanged`);
  const extra = { FM_SECONDMATE_CHARTER: charterText(scope), FM_SECONDMATE_SCOPE: scope };
  if (!existsSync(join(firstmateHome, 'data', id, 'brief.md'))) firstmateScript(firstmateHome, ['bin/fm-brief.sh', id, '--secondmate', '--no-projects'], { env, path, extra });
  firstmateScript(firstmateHome, ['bin/fm-home-seed.sh', id, home, '--no-projects'], { env, path, extra });
  return { registered: false, registry, home };
}
