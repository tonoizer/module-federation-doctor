/**
 * Pure helper: rewrite targets (aliases / transformImport libraries) ∩ shared keys.
 * Trailing-slash share keys (`react/`) are prefix shares.
 */

export function rewriteOverlapsShareKey(rewriteTarget: string, shareKey: string): boolean {
  if (rewriteTarget === shareKey) return true;
  if (shareKey.endsWith("/")) {
    const prefix = shareKey.slice(0, -1);
    if (!prefix) return false;
    return rewriteTarget === prefix || rewriteTarget.startsWith(shareKey);
  }
  return rewriteTarget === shareKey || rewriteTarget.startsWith(`${shareKey}/`);
}

/** Overlapping package names for alias / transformImport vs shared findings. */
export function findShareRewriteOverlaps(
  rewriteTargets: readonly string[],
  sharedKeys: readonly string[],
  allowPackages: readonly string[] = [],
): string[] {
  const allow = new Set(allowPackages);
  const overlaps = new Set<string>();
  for (const target of rewriteTargets) {
    if (!target || allow.has(target)) continue;
    for (const shareKey of sharedKeys) {
      if (!shareKey || allow.has(shareKey)) continue;
      if (rewriteOverlapsShareKey(target, shareKey)) overlaps.add(target);
    }
  }
  return [...overlaps].sort();
}
