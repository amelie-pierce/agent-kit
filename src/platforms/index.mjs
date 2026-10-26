import { inspectMacOS } from './macos.mjs';

export function inspectPlatform(context, manifest, selectedTools) {
  if (context.platform === 'darwin') return inspectMacOS(context, manifest, selectedTools);
  const isWsl = context.platform === 'linux' && Boolean(context.env.WSL_INTEROP || context.env.WSL_DISTRO_NAME);
  const platform = isWsl ? 'wsl2' : context.platform === 'linux' ? 'linux' : context.platform === 'win32' ? 'windows' : context.platform;
  const message = platform === 'windows'
    ? 'Windows personal-device flow is planned: run native PowerShell/Node preflight, check or guide WSL2 and a Linux distro, then hand off installation to Linux inside WSL. This skeleton does not perform that handoff.'
    : `${platform} adapter is not yet supported; this release only checks macOS.`;
  return {
    platform, arch: context.arch, supported: false,
    message,
    prerequisites: [], tools: [], pathConflicts: [],
  };
}
