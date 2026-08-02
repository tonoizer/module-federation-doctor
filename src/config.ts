import path from "node:path";
import { resolveBaselineOptions } from "./baseline.js";
import { resolveAnalysisBudgets } from "./analysis-budgets.js";
import { resolvePolicy } from "./policy.js";
import { mergeSharedPolicy, serializeSharedPolicy } from "./shared-policy.js";
import type { DoctorOptions, DoctorPrintLog, ResolvedDoctorOptions } from "./types.js";

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
 * Resolve quiet-success for terminal output.
 * Precedence: `MFDOCTOR_QUIET` env → explicit `quiet` / `printLog.success` → default quiet.
 */
export function resolveQuiet(
  options: Pick<DoctorOptions, "quiet" | "printLog"> = {},
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.MFDOCTOR_QUIET;
  if (raw !== undefined) {
    return !CI_FALSEY.has(raw.trim().toLowerCase());
  }
  if (options.quiet !== undefined) return options.quiet;
  if (options.printLog?.success === true) return false;
  return true;
}

export function resolvePrintLog(
  options: Pick<DoctorOptions, "quiet" | "printLog"> = {},
  env: NodeJS.ProcessEnv = process.env,
): Required<DoctorPrintLog> {
  const quiet = resolveQuiet(options, env);
  return {
    success: options.printLog?.success ?? !quiet,
  };
}

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

/**
 * Resolve Doctor options, including preset / policy-pack `extends`.
 *
 * Severity precedence (later wins):
 * 1. Built-in rule `defaultSeverity`
 * 2. Preset maps from `extends`
 * 3. Pack maps from `extends`
 * 4. Local `rules` on DoctorOptions (config file)
 * 5. CLI / adapter flags merged onto DoctorOptions before this call
 */
export async function resolveOptions(options: DoctorOptions = {}): Promise<ResolvedDoctorOptions> {
  // Auto-infer CI from the environment. Explicit mode wins:
  // - mode: "ci" forces CI defaults
  // - mode: "development" forces local defaults even when CI=* is set
  // - mode omitted → detect from CI / provider env vars
  const ci = options.mode === "ci" || (options.mode === undefined && isCiEnvironment());
  const root = path.resolve(options.root ?? process.cwd());
  const policy = await resolvePolicy(options.extends, root);
  // Local / CLI `rules` override pack and preset maps.
  const rules = { ...policy.rules, ...options.rules };
  const sharedPolicy = serializeSharedPolicy(
    mergeSharedPolicy([
      ...policy.sharedPolicyLayers,
      {
        ...(options.importDepth !== undefined ? { importDepth: options.importDepth } : {}),
        ...(options.additionalCandidates !== undefined
          ? { additionalCandidates: options.additionalCandidates }
          : {}),
        ...(options.additionalSingletonRisks !== undefined
          ? { additionalSingletonRisks: options.additionalSingletonRisks }
          : {}),
        ...(options.alwaysShared !== undefined ? { alwaysShared: options.alwaysShared } : {}),
        ...(options.deepImportAllowlist !== undefined
          ? { deepImportAllowlist: options.deepImportAllowlist }
          : {}),
      },
    ]),
  );
  const printLog = resolvePrintLog(options);
  const quiet = resolveQuiet(options);
  const resolved: ResolvedDoctorOptions = {
    analysisBudgets: resolveAnalysisBudgets(options.analysisBudgets),
    bundler: options.bundler ?? "unknown",
    artifactNames: {
      manifest: options.artifactNames?.manifest ?? ["mf-manifest.json"],
      stats: options.artifactNames?.stats ?? ["mf-stats.json"],
    },
    mode: ci ? "ci" : "development",
    root,
    output: {
      directory: path.resolve(root, options.output?.directory ?? ".mf/doctor"),
      formats:
        options.output?.formats ?? (ci ? ["terminal", "json", "sarif"] : ["terminal", "json"]),
    },
    failOn: options.failOn ?? (ci ? "error" : "never"),
    quiet,
    printLog,
    include: options.include ?? DEFAULT_INCLUDE,
    exclude: options.exclude ?? DEFAULT_EXCLUDE,
    rules,
    extends: policy.plugins,
    appliedPolicies: policy.applied,
    sharedPolicy,
  };
  const baseline = resolveBaselineOptions(options.baseline, root);
  if (baseline) resolved.baseline = baseline;
  if (options.moduleFederation !== undefined) resolved.moduleFederation = options.moduleFederation;
  if (options.bundlerVersion !== undefined) resolved.bundlerVersion = options.bundlerVersion;
  if (options.viteLifecycle !== undefined) resolved.viteLifecycle = options.viteLifecycle;
  if (options.runtimeTrace !== undefined)
    resolved.runtimeTrace = path.resolve(root, options.runtimeTrace);
  return resolved;
}
