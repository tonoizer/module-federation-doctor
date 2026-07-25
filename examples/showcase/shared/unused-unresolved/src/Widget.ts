declare function loadShare(id: string): Promise<unknown>;

// Non-literal loadShare → unresolvedDynamic; prefer doctor/partial-analysis
// over a confident shared/unused finding for lodash.
export async function ensureShared(name: string) {
  return loadShare(name);
}
