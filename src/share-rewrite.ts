/**
 * Pure helper: rewrite targets (aliases / transformImport libraries) ∩ shared keys.
 * Trailing-slash share keys (`react/`) are prefix shares.
 */

/** Public `resolve.alias` observation. Function aliases are never invoked. */
export interface ResolveAliasObservation {
  aliases: Record<string, string>;
  functionAlias: boolean;
}

function stringAliasTarget(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function aliasEntryKey(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.find === "string" && entry.find.length > 0) return entry.find;
  if (typeof entry.name === "string" && entry.name.length > 0) return entry.name;
  return undefined;
}

function aliasEntryTarget(entry: Record<string, unknown>): string | undefined {
  return stringAliasTarget(entry.replacement) ?? stringAliasTarget(entry.alias);
}

/**
 * Extract static string `resolve.alias` object/array entries.
 * Function aliases (and function array items) set `functionAlias` and are not called.
 */
export function observeResolveAlias(alias: unknown): ResolveAliasObservation | undefined {
  if (alias === undefined || alias === null) return undefined;
  if (typeof alias === "function") return { aliases: {}, functionAlias: true };

  const aliases: Record<string, string> = {};
  let functionAlias = false;

  if (Array.isArray(alias)) {
    for (const entry of alias) {
      if (typeof entry === "function") {
        functionAlias = true;
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const key = aliasEntryKey(record);
      const target = aliasEntryTarget(record);
      if (key && target) aliases[key] = target;
    }
    return { aliases, functionAlias };
  }

  if (typeof alias === "object") {
    for (const [key, value] of Object.entries(alias as Record<string, unknown>)) {
      if (typeof value === "function") {
        functionAlias = true;
        continue;
      }
      const target = stringAliasTarget(value);
      if (target) aliases[key] = target;
    }
    return { aliases, functionAlias };
  }

  return undefined;
}

/**
 * Public `source.transformImport` library names (Rsbuild / Modern.js).
 * Functions are never invoked. `false` is observed as an empty list.
 * Absent or unknown shapes stay undefined so conflict rules skip honestly.
 */
export function observeTransformImportLibraries(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "function") return undefined;
  if (value === false) return [];
  if (!Array.isArray(value)) return undefined;
  const names = new Set<string>();
  for (const item of value) {
    if (typeof item === "string") {
      if (item.length > 0) names.add(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const libraryName = (item as { libraryName?: unknown }).libraryName;
    if (typeof libraryName === "string" && libraryName.length > 0) names.add(libraryName);
  }
  return [...names].sort();
}

/** Read `source.transformImport` from a public Rsbuild / Modern.js config object. */
function observeSourceTransformImport(config: unknown): string[] | undefined {
  if (!config || typeof config !== "object") return undefined;
  const source = (config as { source?: unknown }).source;
  if (!source || typeof source !== "object") return undefined;
  if (!("transformImport" in source)) return undefined;
  return observeTransformImportLibraries((source as { transformImport?: unknown }).transformImport);
}

/** First defined observation wins (normalized config before user config). */
export function observeSourceTransformImportFromConfigs(
  ...configs: unknown[]
): string[] | undefined {
  for (const config of configs) {
    const observed = observeSourceTransformImport(config);
    if (observed !== undefined) return observed;
  }
  return undefined;
}

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
