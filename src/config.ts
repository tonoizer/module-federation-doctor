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

type CiProviderCheck = { key: string; equals: string } | { key: string; truthy: true };

const CI_PROVIDER_CHECKS: readonly CiProviderCheck[] = [
  { key: "GITHUB_ACTIONS", equals: "true" },
  { key: "GITLAB_CI", equals: "true" },
  { key: "CIRCLECI", equals: "true" },
  { key: "BUILDKITE", equals: "true" },
  { key: "TRAVIS", equals: "true" },
  { key: "APPVEYOR", equals: "True" },
  { key: "TF_BUILD", equals: "True" },
  { key: "TEAMCITY_VERSION", truthy: true },
  { key: "JENKINS_URL", truthy: true },
  { key: "BITBUCKET_BUILD_NUMBER", truthy: true },
  { key: "CODEBUILD_BUILD_ID", truthy: true },
];

/** Provider env vars that imply CI even when `CI` is unset or falsey. */
export const CI_PROVIDER_ENV_KEYS = CI_PROVIDER_CHECKS.map((check) => check.key);

function hasCiProviderSignal(env: NodeJS.ProcessEnv): boolean {
  return CI_PROVIDER_CHECKS.some((check) => {
    const value = env[check.key];
    if ("equals" in check) return value === check.equals;
    return Boolean(value);
  });
}

/**
 * Detect CI without requiring `mode: "ci"` in Doctor config.
 * Honors common provider env vars and truthy `CI` values (`true`, `1`, …).
 * A falsey `CI` does not opt out of provider detection.
 */
export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const ci = env.CI;
  if (ci !== undefined && !CI_FALSEY.has(ci.trim().toLowerCase())) return true;
  return hasCiProviderSignal(env);
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
