import { inspectMacOS } from './macos.mjs';
import { inspectLinux } from './linux.mjs';
import { inspectWindows } from './windows.mjs';

export function inspectPlatform(context, manifest, selectedTools, options = {}) {
  if (context.platform === 'darwin') return inspectMacOS(context, manifest, selectedTools);
  if (context.platform === 'linux') return inspectLinux(context, manifest, selectedTools);
  if (context.platform === 'win32') return inspectWindows(context, { distro: options.distro });
  return {
    platform: context.platform, arch: context.arch, supported: false,
    message: `${context.platform} adapter is not yet supported; this release checks macOS, Linux and Windows (Windows installs through WSL2).`,
    prerequisites: [], tools: [], pathConflicts: [],
  };
}
