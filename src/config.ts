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

const CI_FALSEY = new Set(["", "0", "false", "no", "off"]);

/**
 * Detect CI without requiring `mode: "ci"` in Doctor config.
 * Honors common provider env vars and truthy `CI` values (`true`, `1`, …).
 */
export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const ci = env.CI;
  if (ci !== undefined && !CI_FALSEY.has(ci.trim().toLowerCase())) return true;
  return Boolean(
    env.GITHUB_ACTIONS === "true" ||
    env.GITLAB_CI === "true" ||
    env.CIRCLECI === "true" ||
    env.BUILDKITE === "true" ||
    env.TRAVIS === "true" ||
    env.APPVEYOR === "True" ||
    env.TF_BUILD === "True" ||
    env.TEAMCITY_VERSION ||
    env.JENKINS_URL ||
    env.BITBUCKET_BUILD_NUMBER ||
    env.CODEBUILD_BUILD_ID,
  );
}

export function resolveOptions(options: DoctorOptions = {}): ResolvedDoctorOptions {
  // Auto-infer CI from the environment. Explicit mode wins:
  // - mode: "ci" forces CI defaults
  // - mode: "development" forces local defaults even when CI=* is set
  // - mode omitted → detect from CI / provider env vars
  const ci = options.mode === "ci" || (options.mode === undefined && isCiEnvironment());
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
