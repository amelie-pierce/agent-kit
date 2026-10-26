import { inspectMacOS } from './macos.mjs';
import { inspectLinux } from './linux.mjs';

export function inspectPlatform(context, manifest, selectedTools) {
  if (context.platform === 'darwin') return inspectMacOS(context, manifest, selectedTools);
  if (context.platform === 'linux') return inspectLinux(context, manifest, selectedTools);
  const platform = context.platform === 'win32' ? 'windows' : context.platform;
  const message = platform === 'windows'
    ? 'Windows personal-device flow is planned: run native PowerShell/Node preflight, check or guide WSL2 and a Linux distro, then hand off installation to Linux inside WSL. This skeleton does not perform that handoff.'
    : `${platform} adapter is not yet supported; this release only checks macOS.`;
  return {
    platform, arch: context.arch, supported: false,
    message,
    prerequisites: [], tools: [], pathConflicts: [],
  };
}
