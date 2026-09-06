/**
 * Public bundler `externals` names (webpack / rspack / rsbuild / modern).
 * String, array, and object-key forms only — functions and regex are skipped.
 */

const MAX_DEPTH = 8;

function visitPublicExternals(value: unknown, names: Set<string>, depth: number): void {
  if (depth > MAX_DEPTH || value == null) return;
  if (typeof value === "string") {
    if (value.length > 0) names.add(value);
    return;
  }
  if (typeof value === "function" || value instanceof RegExp) return;
  if (Array.isArray(value)) {
    for (const item of value) visitPublicExternals(item, names, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key.length > 0) names.add(key);
    }
  }
}

/** Sorted unique package names from public `externals` (string / array / object keys). */
export function extractPublicExternals(value: unknown): string[] {
  const names = new Set<string>();
  visitPublicExternals(value, names, 0);
  return [...names].sort();
}
