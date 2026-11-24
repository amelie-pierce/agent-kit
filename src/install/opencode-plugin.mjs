import { isAbsolute, join } from 'node:path';

export const opencodePluginPath = (home, env = process.env) => {
  const config = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(config, 'opencode', 'plugins', 'agent-kit-ambient.js');
};

// OpenCode 2 discovers this file directly. Keep the callbacks passive: a failed helper
// must never interrupt a person's model turn or Firstmate's project-owned primary plugins.
export const opencodePluginBody = (root, release, firstmateHome, selected, hasHerdr) => {
  const binaries = Object.fromEntries(['gh-axi', 'chrome-devtools-axi', 'lavish-axi', 'tasks-axi']
    .filter(id => selected.has(id)).map(id => [id, join(root, 'releases', release, 'npm', 'node_modules', '.bin', id)]));
  return `// agent-kit:opencode-ambient - receipt-owned OpenCode 2 helper registration.
// OpenCode discovers this file from the user's config plugins directory.
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';

const firstmateHome = ${JSON.stringify(firstmateHome)};
const binaries = ${JSON.stringify(binaries)};
const hasHerdr = ${hasHerdr};
const sessions = new Map();

function helper(path) {
  return new Promise(resolve => {
    try {
      const child = execFile(path, [], { encoding: 'utf8', timeout: 10000, maxBuffer: 16384, env: process.env },
        (error, stdout) => resolve(error ? '' : String(stdout).trim()));
      child.stdin?.end();
    } catch { resolve(''); }
  });
}

function reportHerdr(sessionID) {
  if (!hasHerdr || process.env.HERDR_ENV !== '1' || !process.env.HERDR_SOCKET_PATH || !process.env.HERDR_PANE_ID) return;
  const request = { id: 'herdr:opencode:' + Date.now(), method: 'pane.report_agent_session', params: {
    pane_id: process.env.HERDR_PANE_ID, source: 'herdr:opencode', agent: 'opencode',
    seq: Date.now() * 1000000, agent_session_id: sessionID, session_start_source: 'startup' } };
  try {
    const socket = createConnection(process.env.HERDR_SOCKET_PATH);
    socket.setTimeout(500, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('connect', () => socket.end(JSON.stringify(request) + '\\n'));
  } catch { /* Herdr state is advisory. */ }
}

export default {
  id: 'agent-kit.ambient',
  async setup(ctx) {
    await ctx.session.hook('context', async (event) => {
      const sessionID = event.sessionID;
      if (!sessionID) return;
      let entry = sessions.get(sessionID);
      if (!entry) {
        const inFirstmate = ctx.location.directory === firstmateHome && process.env.FM_HOME === firstmateHome;
        const paths = Object.entries(binaries).filter(([id]) => inFirstmate || (id !== 'gh-axi' && id !== 'chrome-devtools-axi')).map(([, path]) => path);
        entry = { hint: null };
        entry.ready = Promise.all(paths.map(helper)).then(parts => { entry.hint = parts.filter(Boolean).join('\\n\\n'); });
        sessions.set(sessionID, entry);
        if (inFirstmate) reportHerdr(sessionID);
      }
      if (entry.hint === null) await entry.ready;
      if (entry.hint) event.system.push({ type: 'text', text: entry.hint });
    });
  },
};
`;
};
