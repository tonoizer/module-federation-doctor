import path from "node:path";
import type { DoctorOptions, ResolvedDoctorOptions } from "./types.js";

export const DEFAULT_INCLUDE = ["src/**/*.{ts,tsx,js,jsx,mts,mjs}"];
export const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.mf/**",
  "**/*.generated.*",
];

export function resolveOptions(options: DoctorOptions = {}): ResolvedDoctorOptions {
  // Auto-infer CI when CI=true (GitHub Actions, etc.) or mode: "ci" is set.
  // CI defaults: failOn "error", formats include sarif.
  const ci = options.mode === "ci" || (options.mode === undefined && process.env.CI === "true");
  const root = path.resolve(options.root ?? process.cwd());
  const resolved: ResolvedDoctorOptions = {
    bundler: options.bundler ?? "unknown",
    mode: ci ? "ci" : "development",
    root,
    output: {
      directory: path.resolve(root, options.output?.directory ?? ".mf/doctor"),
      formats:
        options.output?.formats ?? (ci ? ["terminal", "json", "sarif"] : ["terminal", "json"]),
    },
    failOn: options.failOn ?? (ci ? "error" : "never"),
    include: options.include ?? DEFAULT_INCLUDE,
    exclude: options.exclude ?? DEFAULT_EXCLUDE,
    rules: options.rules ?? {},
    extends: options.extends ?? [],
  };
  if (options.moduleFederation !== undefined) resolved.moduleFederation = options.moduleFederation;
  if (options.bundlerVersion !== undefined) resolved.bundlerVersion = options.bundlerVersion;
  if (options.runtimeTrace !== undefined)
    resolved.runtimeTrace = path.resolve(root, options.runtimeTrace);
  return resolved;
}
