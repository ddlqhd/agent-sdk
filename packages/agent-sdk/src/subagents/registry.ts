import type { SubagentProfile } from './types.js';
import { getBuiltinSubagentProfiles } from './builtin/index.js';

/**
 * Merge profiles: later entries with the same `name` override earlier ones.
 */
export function mergeSubagentProfiles(layers: SubagentProfile[][]): Map<string, SubagentProfile> {
  const map = new Map<string, SubagentProfile>();
  for (const layer of layers) {
    for (const p of layer) {
      map.set(p.name, p);
    }
  }
  return map;
}

export function getDefaultBuiltinProfileMap(): Map<string, SubagentProfile> {
  return mergeSubagentProfiles([getBuiltinSubagentProfiles()]);
}

/**
 * Stable list for tool description: general-purpose, explore, then rest sorted by name.
 */
export function profilesMapToSortedList(map: Map<string, SubagentProfile>): SubagentProfile[] {
  const all = [...map.values()];
  const preferred = ['general-purpose', 'explore'];
  const preferredProfiles = preferred.map(n => map.get(n)).filter((p): p is SubagentProfile => p !== undefined);
  const preferredSet = new Set(preferredProfiles.map(p => p.name));
  const rest = all
    .filter(p => !preferredSet.has(p.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...preferredProfiles, ...rest];
}
