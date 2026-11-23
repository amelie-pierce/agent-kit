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
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';

const firstmateHome = ${JSON.stringify(firstmateHome)};
const binaries = ${JSON.stringify(binaries)};
const hasHerdr = ${hasHerdr};
const once = new Map();

function helper(path) {
  try {
    return execFileSync(path, [], { encoding: 'utf8', timeout: 10000, maxBuffer: 16384,
      env: process.env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
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
    await ctx.session.hook('context', (event) => {
      const sessionID = event.sessionID;
      if (!sessionID) return;
      if (!once.has(sessionID)) {
        const inFirstmate = ctx.location.directory === firstmateHome && process.env.FM_HOME === firstmateHome;
        const output = [];
        for (const [id, path] of Object.entries(binaries)) {
          if ((id === 'gh-axi' || id === 'chrome-devtools-axi') && !inFirstmate) continue;
          const hint = helper(path);
          if (hint) output.push(hint);
        }
        if (inFirstmate) reportHerdr(sessionID);
        once.set(sessionID, output.join('\\n\\n'));
      }
      const hint = once.get(sessionID);
      if (hint) event.system.push({ type: 'text', text: hint });
    });
  },
};
`;
};
