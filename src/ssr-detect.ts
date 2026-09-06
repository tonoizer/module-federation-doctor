/**
 * SSR dual-environment helpers for `ssr/*` rules (#122).
 * Silent on browser-only apps unless `ssrMode` forces apply.
 */
import type { NormalizedMFConfig, ProjectFacts } from "./types.js";

export type SsrModeOption = "browser-only" | "dual" | "node";

/** Browser vs SSR as implied by remoteEntry suffix or consumer target facts. */
export type RemoteEntryTargetKind = "web" | "ssr";

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
 * True when MFDoctor should apply node/SSR dual-env rules.
 *
 * Do not trust `builds[].targetKind` alone — Vite browser builds often record a
 * single `targetKind=node` output from default `ssr.target`. Require an explicit
 * MF node target (`experiments.target` / `vite.target`) or `ssrMode`.
 */
export function isSsrNodeEnvApplicable(facts: ProjectFacts, ssrMode?: SsrModeOption): boolean {
  if (ssrMode === "browser-only") return false;
  if (ssrMode === "node" || ssrMode === "dual") return true;

  const config = facts.moduleFederation;
  if (config?.experiments?.target === "node") return true;
  if (config?.vite?.target === "node") return true;
  return false;
}

/** Remote entries that already look SSR/env-specific (or non-manifest). */
export function isSsrAwareRemoteEntry(entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return true;
  if (/\/ssr\//i.test(trimmed)) return true;
  if (/[?&](?:env|target)=(?:ssr|node)\b/i.test(trimmed)) return true;
  if (/-(?:ssr|node)(?:\/|\.|$)/i.test(trimmed)) return true;
  // SvelteKit / Vite SSR container: remoteEntry.ssr.js (dot suffix, not `-ssr`).
  if (/\.(?:ssr|node)\.[cm]?js(?:[?#]|$)/i.test(trimmed)) return true;
  return false;
}

function remoteEntryBasename(entry: string): string {
  const withoutQuery = entry.split(/[?#]/)[0] ?? entry;
  const parts = withoutQuery.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * Infer browser vs SSR from a remote URL suffix or path when the signal is
 * unambiguous. Opaque aliases, fragment remotes, and browser `mf-manifest.json`
 * (owned by `ssr/node-remote-manifest`) return `undefined`.
 */
export function remoteEntryImpliedTarget(entry: string): RemoteEntryTargetKind | undefined {
  const trimmed = entry.trim();
  if (!trimmed) return undefined;
  if (/\.(?:ssr|node)\.[cm]?js(?:[?#]|$)/i.test(trimmed)) return "ssr";
  if (isSsrAwareRemoteEntry(trimmed)) return "ssr";
  if (isBrowserOnlyManifestRemoteEntry(trimmed)) return undefined;
  const basename = remoteEntryBasename(trimmed);
  if (/^remote[-.]?entry(?:-[^/]+)?\.[cm]?js$/i.test(basename)) return "web";
  if (/^remote[-.]?entry$/i.test(basename)) return "web";
  return undefined;
}

/**
 * Consumer target for remoteEntry pairing. Requires an explicit MF target,
 * `ssrMode`, or unambiguous `builds.targetKind`. Mixed web+ssr/node outputs
 * (dual-env Nitro pairing) and bare `targetKind=node` (Vite default `ssr.target`)
 * are skipped — not a producer/consumer contract.
 */
export function consumerRemoteTargetKind(
  facts: ProjectFacts,
  ssrMode?: SsrModeOption,
): RemoteEntryTargetKind | undefined {
  if (ssrMode === "browser-only") return "web";
  if (ssrMode === "dual") return undefined;
  if (ssrMode === "node") return "ssr";

  const kinds = new Set(
    (facts.builds ?? [])
      .map((build) => build.targetKind)
      .filter((kind): kind is NonNullable<typeof kind> => Boolean(kind) && kind !== "unknown"),
  );
  const hasWeb = kinds.has("web") || kinds.has("worker");
  const hasSsr = kinds.has("ssr");
  const hasNode = kinds.has("node");
  // Dual-env Nitro pairing writes web + node/ssr outputs into one report.
  if (hasWeb && (hasSsr || hasNode)) return undefined;

  const experimentsTarget = facts.moduleFederation?.experiments?.target;
  const viteTarget = facts.moduleFederation?.vite?.target;
  if (experimentsTarget === "node" || viteTarget === "node") return "ssr";
  if (experimentsTarget === "web" || viteTarget === "web") return "web";

  if (hasSsr && !hasWeb) return "ssr";
  if (hasWeb && !hasSsr && !hasNode) return "web";
  return undefined;
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
