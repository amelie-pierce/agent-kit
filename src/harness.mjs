// A harness is one agent CLI profile ('claude' or 'codex') or 'both'. Manifest tools carry a single profile.
export function parseHarness(value) {
  const parts = [...new Set(String(value || '').split(',').map(part => part.trim()))];
  if (parts.length === 1 && ['claude', 'codex', 'both'].includes(parts[0])) return parts[0];
  if (parts.length === 2 && parts.every(part => ['claude', 'codex'].includes(part))) return 'both';
  return null;
}

export const harnessProfiles = harness => harness === 'both' ? ['claude', 'codex'] : [harness || 'claude'];
export const usesProfile = (harness, profile) => harnessProfiles(harness).includes(profile);
export const harnessLabel = harness => harness === 'both' ? 'claude,codex' : harness || 'claude';
export const defaultCaptain = harness => harness === 'codex' ? 'codex' : 'claude';
export const parseCaptain = (value, harness) => value === 'opencode' || value === defaultCaptain(harness) ? value : null;
export const captainOf = (captain, harness) => captain === 'opencode' ? 'opencode' : defaultCaptain(harness);
export const receiptCaptain = (receipt, harness) => captainOf(receipt?.setup?.answers?.captain
  ?? (receipt?.phases?.['npm-opencode'] || receipt?.phases?.hooks?.plugins?.length ? 'opencode' : null), harness);
export const opencodePinned = manifest => /^2\./.test(manifest.tools.find(tool => tool.id === 'opencode')?.version?.value || '');
export const isOpenCode2 = version => /(?:^|\s)v?2\./.test(version || '');
export const towerIds = new Set(['zoe-fleet', 'zoe-fleet-runtime', 'zoetrope-herdr-plugin']);
