// A harness is a non-empty set of worker CLI profiles. Keep 'both' as the legacy Claude/Codex name.
export function parseHarness(value) {
  const parts = [...new Set(String(value || '').split(',').map(part => part.trim()))];
  if (parts.length === 1 && parts[0] === 'both') return 'both';
  if (parts.length && parts.every(part => ['claude', 'codex', 'opencode'].includes(part))) {
    const ordered = ['claude', 'codex', 'opencode'].filter(profile => parts.includes(profile));
    return ordered.length === 2 && !ordered.includes('opencode') ? 'both' : ordered.join(',');
  }
  return null;
}

export const harnessProfiles = harness => harness === 'both' ? ['claude', 'codex'] : (harness || 'claude').split(',');
export const usesProfile = (harness, profile) => harnessProfiles(harness).includes(profile);
export const harnessLabel = harness => harness === 'both' ? 'claude,codex' : harness || 'claude';
export const defaultCaptain = harness => usesProfile(harness, 'claude') ? 'claude' : usesProfile(harness, 'codex') ? 'codex' : 'opencode';
export const parseCaptain = (value, harness) => value === 'opencode' || value === defaultCaptain(harness) ? value : null;
export const captainOf = (captain, harness) => captain === 'opencode' ? 'opencode' : defaultCaptain(harness);
export const receiptCaptain = (receipt, harness) => captainOf(receipt?.setup?.answers?.captain
  ?? (receipt?.phases?.['npm-opencode'] && !usesProfile(harness, 'opencode') ? 'opencode' : null), harness);
export const opencodePinned = manifest => /^2\./.test(manifest.tools.find(tool => tool.id === 'opencode')?.version?.value || '');
export const isOpenCode2 = version => /(?:^|\s)v?2\./.test(version || '');
export const towerIds = new Set(['zoe-fleet', 'zoe-fleet-runtime', 'zoetrope-herdr-plugin']);
