import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { atomicJson, lock } from './install/macos.mjs';
import { envManaged, keyPaused, keyStatus, writeKey } from './keys.mjs';
import { firstmateScript } from './secondmate.mjs';
import { starterFile } from './dispatch.mjs';

// agent-kit jev on|off|status: the owner's fm-jev, through the kit's guarded .env writer. off comments the
// TYPESAFE_API_KEY line out (the value stays in .env), on puts it back; both push the change to live second mates
// with Firstmate's own bin/fm-config-push.sh. Routing rules stay Firstmate's (its strategy owns them).
export const jevUsage = 'usage: agent-kit jev on|off|status [--root <root> | --install-root <dir>]';

export async function runJev(argv, { kitDir, output = process.stdout, env = process.env } = {}) {
  let command = null, installRoot = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--install-root') installRoot = argv[++i];
    else if (argv[i] === '--root') installRoot = argv[++i] && join(argv[i], '.tools');
    else if (!command && ['on', 'off', 'status'].includes(argv[i])) command = argv[i];
    else throw new Error(jevUsage);
  }
  const found = kitDir && existsSync(join(dirname(dirname(kitDir)), 'receipt.json')) ? dirname(dirname(kitDir)) : null;
  installRoot ||= found;
  if (!installRoot || !isAbsolute(installRoot)) throw new Error(`${jevUsage} (an absolute kit install root is needed)`);
  installRoot = resolve(installRoot);
  const receiptPath = join(installRoot, 'receipt.json'), receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const home = receipt.setup?.paths?.firstmateHome || receipt.phases?.firstmate?.path;
  if (!home) throw new Error('the kit receipt names no Firstmate home');
  if (!envManaged(home)) throw new Error(`${join(home, '.env')} is not a plain file; the kit leaves it alone`);
  const state = () => keyStatus(home) ? 'on' : keyPaused(home) ? 'off (key kept, commented out)' : 'not set';
  const say = () => output.write(`jev: key=${state()} rules=${existsSync(join(home, starterFile)) ? 'present' : 'absent'}\n`);
  if (!command || command === 'status') { say(); return 0; }
  if (command === 'on' && !keyStatus(home) && !keyPaused(home)) { output.write('No TYPESAFE_API_KEY in .env yet; add it from your own terminal with agent-kit keys.\n'); return 1; }
  const unlock = await lock(installRoot, '.setup.lock');
  try {
    const set = await writeKey(home, command === 'on' ? 'resume' : 'pause');
    const current = JSON.parse(readFileSync(receiptPath, 'utf8'));
    current.setup ||= {}; current.setup.keys = { TYPESAFE_API_KEY: set };
    await atomicJson(receiptPath, current);
  } finally { await unlock(); }
  if (existsSync(join(home, 'bin', 'fm-config-push.sh'))) {
    try { firstmateScript(home, ['bin/fm-config-push.sh'], { env }); output.write('Pushed to live second mates.\n'); }
    catch (error) { output.write(`Second mates were not all updated (${error.message}); run bin/fm-config-push.sh in ${home} again.\n`); }
  }
  say();
  return 0;
}
