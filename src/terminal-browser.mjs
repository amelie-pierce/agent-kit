import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { detectEnvironment, detectTerminal } from './browser.mjs';
import { libraryReport, packageManager, runCommand } from './libraries.mjs';

// terminal-browser (https://github.com/zenbu-labs/terminal-browser) draws a Chromium page in a terminal that supports kitty graphics.
// The kit prints the steps for this machine and runs nothing except, after an explicit yes, the vendor's own install command.
const installScript = 'curl -fsSL https://terminal-browser.sh/install | bash';
const herdrPlugin = 'herdr plugin install zenbu-labs/terminal-browser/herdr-plugin';

const onPath = (context, name) => (context.env?.PATH || '').split(':').filter(Boolean).map(dir => posix.join(dir, name)).find(context.exists) || null;

// Where terminal-browser's own install script puts things.
export function terminalBrowserPaths(env = {}) {
  const home = env.HOME || '~';
  const dataHome = env.XDG_DATA_HOME || posix.join(home, '.local', 'share');
  const binHome = env.XDG_BIN_HOME || posix.join(home, '.local', 'bin');
  return { launcher: posix.join(binHome, 'terminal-browser'), engine: posix.join(dataHome, 'terminal-browser', 'app', 'electron', 'pixel') };
}

function terminalRoute(environment, terminal) {
  const manager = packageManager(environment);
  const kitty = manager ? `${manager.install} kitty` : null;
  const title = terminal.kitty === 'no' ? `Switch to a terminal that draws kitty graphics (${terminal.name}: ${terminal.note}).`
    : `Make sure your terminal draws kitty graphics (${terminal.name}: ${terminal.note}; unsupported terminals show a blank screen). If it does not, switch:`;
  if (environment.os === 'macos') return { title, commands: ['brew install --cask kitty'], note: 'Ghostty and WezTerm also work.', check: 'A kitty window opens; run the next steps in it.' };
  if (environment.os === 'wsl') return { title, commands: [kitty || 'install kitty with your package manager', 'kitty -o linux_display_server=x11'],
    note: 'WSLg shows kitty as a window; without the x11 option it fails with "Wayland: Failed to connect to display".', check: 'A kitty window opens; run the next steps in it.' };
  return { title, commands: [kitty || 'install kitty, Ghostty or WezTerm with your package manager', ...(kitty ? ['kitty'] : [])], check: 'A kitty window opens; run the next steps in it.' };
}

// One short list: only the steps that apply to this machine, each with a one-line check.
export function terminalBrowserPlan(context = {}) {
  const c = { env: process.env, platform: process.platform, exists: existsSync, run: runCommand, ...context };
  const environment = detectEnvironment(c), terminal = detectTerminal(c.env);
  const plan = { command: 'terminal-browser', environment: { os: environment.os, label: environment.label, wsl: environment.wsl }, terminal, installed: null, libraries: null, steps: [] };
  const add = step => plan.steps.push(step);
  if (environment.unsupported) { plan.status = 'unsupported'; plan.exitCode = 1; plan.steps.push({ id: 'platform', title: `${c.platform} is not supported; the kit covers macOS, Linux, WSL and Windows.`, commands: [] }); return plan; }
  plan.status = 'steps'; plan.exitCode = 0;
  if (environment.os === 'windows') {
    add({ id: 'wsl', title: 'terminal-browser runs inside WSL2 on Windows, not natively. Open your Ubuntu (WSL2) terminal and run this there:', commands: ['agent-kit terminal-browser'],
      note: 'Few Windows terminals draw kitty graphics; its README names https://noctty.com/.', check: 'The steps for WSL2 print.' });
    return plan;
  }
  const paths = terminalBrowserPaths(c.env);
  plan.installed = c.exists(paths.launcher) ? paths.launcher : onPath(c, 'terminal-browser');
  if (terminal.kitty !== 'yes') add({ id: 'terminal', ...terminalRoute(environment, terminal) });
  if (!plan.installed) {
    const brew = environment.os === 'macos' && onPath(c, 'brew');
    add({ id: 'install', title: 'Install terminal-browser (a third-party install script; the kit prints it and runs it only if you pass --install and answer y).',
      commands: [brew ? 'brew install terminal-browser' : installScript], check: 'command -v terminal-browser prints a path.',
      ...(['linux', 'wsl'].includes(environment.os) ? { note: 'Run agent-kit terminal-browser again afterwards: it then lists any missing system libraries.' } : {}) });
  } else if (['linux', 'wsl'].includes(environment.os) && c.exists(paths.engine)) {
    plan.libraries = libraryReport(c, environment, paths.engine);
    const libs = plan.libraries;
    if (libs.status === 'missing') add({ id: 'libraries', title: `Install the system libraries its engine cannot find (${libs.missing.join(', ')}). The kit never runs sudo.`,
      commands: libs.command ? [libs.command] : [], note: libs.fallback || undefined, check: `ldd ${paths.engine} | grep 'not found' prints nothing.` });
  }
  add({ id: 'open', title: 'Open a page.', commands: ['terminal-browser open terminal-browser.com'], check: 'A page appears; a blank screen means the terminal cannot draw kitty graphics.',
    ...(terminal.kitty === 'yes' ? {} : { note: 'No graphics terminal? "terminal-browser action -- snapshot" prints the page as text (its engine ran and answered it on WSL2).' }) });
  if (onPath(c, 'herdr')) add({ id: 'herdr', title: 'Optional: add the herdr plugin.', commands: [herdrPlugin], note: 'herdr passing kitty graphics through to your terminal is unverified.',
    check: "herdr's open-split action opens terminal-browser to the right." });
  add({ id: 'verify', title: 'Check the browser tooling the kit installs.', commands: ['agent-kit browser-check'], check: 'It prints PASS for every step.' });
  return plan;
}

export function formatTerminalBrowser(plan) {
  const lines = [`Agent Kit terminal-browser: ${plan.environment.label}`, `Terminal: ${plan.terminal.name}, ${plan.terminal.kitty === 'yes' ? 'draws kitty graphics' : plan.terminal.kitty === 'no' ? 'cannot draw kitty graphics' : 'kitty graphics unknown'}`];
  if (plan.installed) lines.push(`terminal-browser: installed at ${plan.installed}`);
  for (const [index, step] of plan.steps.entries()) {
    lines.push('', `${index + 1}. ${step.title}`);
    for (const command of step.commands) lines.push(`   $ ${command}`);
    if (step.note) lines.push(`   ${step.note}`);
    if (step.check) lines.push(`   Check: ${step.check}`);
  }
  return `${lines.join('\n')}\n`;
}

// The only place the kit may run the vendor's install command: after the person types y, never silently and never without a terminal.
export async function installTerminalBrowser(context, plan) {
  const step = plan.steps.find(x => x.id === 'install');
  if (!step) return { ran: false, reason: 'terminal-browser is already installed, or this machine has no install step' };
  const interactive = context.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) return { ran: false, reason: '--install asks for a yes, so it needs a terminal; run the command above yourself' };
  const question = `Run "${step.commands[0]}" now? It downloads and runs a third-party script. [y/N] `;
  const ask = context.ask || (async text => { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(text); } finally { rl.close(); } });
  if (!['y', 'yes'].includes((await ask(question)).trim().toLowerCase())) return { ran: false, reason: 'not confirmed, so nothing was run' };
  const result = (context.runInstall || (command => spawnSync('sh', ['-c', command], { stdio: 'inherit' })))(step.commands[0]);
  return { ran: true, status: result.status };
}
