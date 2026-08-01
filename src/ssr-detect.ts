/**
 * SSR dual-environment helpers for `ssr/*` rules (#122).
 * Silent on browser-only apps unless `ssrMode` forces apply.
 */
import type { NormalizedMFConfig, ProjectFacts } from "./types.js";

export type SsrModeOption = "browser-only" | "dual" | "node";

const NODE_RUNTIME_PLUGIN = "@module-federation/node/runtimePlugin";
const COMMONJS_LIBRARY_TYPES = new Set([
  "commonjs",
  "commonjs2",
  "commonjs-module",
  "commonjs-static",
  "node-commonjs",
]);

export function optionSsrMode(options: Record<string, unknown>): SsrModeOption | undefined {
  const value = options.ssrMode;
  if (value === "browser-only" || value === "dual" || value === "node") return value;
  return undefined;
}

/**
 * True when Doctor should apply node/SSR dual-env rules.
 *
 * Dual web+node build records alone are not enough — Vite often records a
 * `targetKind=node` build from default `ssr.target` on browser hosts. Require an
 * explicit MF node target, pure node/SSR builds, or `ssrMode: "node" | "dual"`.
 */
export function isSsrNodeEnvApplicable(facts: ProjectFacts, ssrMode?: SsrModeOption): boolean {
  if (ssrMode === "browser-only") return false;
  if (ssrMode === "node" || ssrMode === "dual") return true;

  const config = facts.moduleFederation;
  if (config?.experiments?.target === "node") return true;
  if (config?.vite?.target === "node") return true;

  const builds = facts.builds ?? [];
  if (builds.length === 0) return false;
  const nodeLike = builds.filter(
    (build) => build.targetKind === "node" || build.targetKind === "ssr" || build.target === "node",
  );
  if (nodeLike.length === 0) return false;
  // Mixed web + node/SSR without an explicit MF node target stays quiet
  // (partial facts / Vite default SSR target noise). Force with `ssrMode`.
  const hasWeb = builds.some(
    (build) =>
      build.targetKind === "web" ||
      build.targetKind === "unknown" ||
      (build.target !== undefined && build.target !== "node"),
  );
  if (hasWeb && nodeLike.length < builds.length) return false;
  return nodeLike.length === builds.length;
}

/** Remote entries that already look SSR/env-specific (or non-manifest). */
export function isSsrAwareRemoteEntry(entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return true;
  if (/\/ssr\//i.test(trimmed)) return true;
  if (/[?&](?:env|target)=(?:ssr|node)\b/i.test(trimmed)) return true;
  if (/-(?:ssr|node)(?:\/|\.|$)/i.test(trimmed)) return true;
  return false;
}

/**
 * Browser-oriented mf-manifest URL used from a node/SSR consumer.
 * Pass-unknown for non-manifest entries (remoteEntry.js, fragments, opaque aliases).
 */
export function isBrowserOnlyManifestRemoteEntry(entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  if (!/mf-manifest\.json(?:[?#]|$)/i.test(trimmed)) return false;
  if (isSsrAwareRemoteEntry(trimmed)) return false;
  return true;
}

export function hasNodeRuntimePlugin(runtimePlugins: string[] | undefined): boolean {
  if (!runtimePlugins?.length) return false;
  return runtimePlugins.some((plugin) => {
    const normalized = plugin.replaceAll("\\", "/");
    return (
      normalized === NODE_RUNTIME_PLUGIN ||
      normalized.includes("@module-federation/node/runtimePlugin") ||
      /@module-federation\/node\/(?:dist\/)?(?:src\/)?runtimePlugin(?:\.[cm]?js)?(?:[?#]|$)/.test(
        normalized,
      )
    );
  });
}

export function isCommonjsLikeLibraryType(type: string | undefined): boolean {
  if (!type) return false;
  return COMMONJS_LIBRARY_TYPES.has(type);
}

export function nodeLibraryDtsProblems(config: NormalizedMFConfig | undefined): string[] {
  if (!config) return [];
  const exposes = Object.keys(config.exposes ?? {});
  if (exposes.length === 0) return [];
  const problems: string[] = [];
  if (!isCommonjsLikeLibraryType(config.library?.type)) {
    problems.push(
      config.library?.type
        ? `library.type="${config.library.type}" (want commonjs-like)`
        : "library.type missing (want commonjs-like)",
    );
  }
  if (config.dts?.enabled !== false) {
    problems.push("dts not disabled (prefer dts: false on node/SSR producers)");
  }
  return problems;
}

export { NODE_RUNTIME_PLUGIN };
