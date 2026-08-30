/**
 * Helpers for `artifact/react-dom-server-in-web` (#329).
 * Flags react-dom/server (and server entry variants) on web/client MF targets.
 */
import type { ArtifactManifest, BuildRecord, NormalizedShared, ProjectFacts } from "./types.js";
import type { SsrModeOption } from "./ssr-detect.js";

/** Specifiers that are react-dom server renderer entry points. */
export function isReactDomServerSpecifier(specifier: string): boolean {
  const normalized = specifier.trim();
  if (!normalized) return false;
  return (
    normalized === "react-dom/server" ||
    normalized.startsWith("react-dom/server/") ||
    normalized.startsWith("react-dom/server.")
  );
}

/** Emitted asset names that look like a bundled react-dom/server chunk. */
export function isReactDomServerAssetPath(asset: string): boolean {
  const normalized = asset.replaceAll("\\", "/");
  return /react-dom[/._-]server/i.test(normalized);
}

export interface ReactDomServerSignalInput {
  specifiers?: readonly string[] | undefined;
  deepImports?: readonly string[] | undefined;
  shared?: Record<string, NormalizedShared> | undefined;
  manifest?: ArtifactManifest | undefined;
  emittedAssets?: readonly string[] | undefined;
}

/** Deterministic list of react-dom/server signals from imports, shared, and artifacts. */
export function collectReactDomServerSignals(input: ReactDomServerSignalInput): string[] {
  const hits = new Set<string>();
  for (const signal of [...(input.specifiers ?? []), ...(input.deepImports ?? [])]) {
    if (isReactDomServerSpecifier(signal)) hits.add(signal);
  }
  for (const key of Object.keys(input.shared ?? {})) {
    if (isReactDomServerSpecifier(key)) hits.add(key);
  }
  for (const shared of input.manifest?.shared ?? []) {
    if (isReactDomServerSpecifier(shared.name)) hits.add(shared.name);
  }
  for (const asset of input.emittedAssets ?? []) {
    if (isReactDomServerAssetPath(asset)) hits.add(asset);
  }
  return [...hits].sort((a, b) => a.localeCompare(b));
}

function isNodeLikeBuild(build: BuildRecord): boolean {
  return build.targetKind === "node" || build.targetKind === "ssr" || build.target === "node";
}

function isWebLikeBuild(build: BuildRecord): boolean {
  return build.targetKind === "web" || build.targetKind === "worker";
}

/**
 * True when facts describe a web/client MF artifact target where react-dom/server
 * must not land. Quiet for node/SSR and dual web+SSR workspaces (pass-unknown).
 */
export function isWebClientArtifactTarget(facts: ProjectFacts, ssrMode?: SsrModeOption): boolean {
  if (ssrMode === "node" || ssrMode === "dual") return false;
  if (ssrMode === "browser-only") return true;

  const config = facts.moduleFederation;
  if (config?.experiments?.target === "node") return false;
  if (config?.vite?.target === "node") return false;

  const builds = facts.builds ?? [];
  if (builds.length === 0) {
    // Default MF remote/host artifact is browser/web unless proven otherwise.
    return true;
  }

  const nodeLike = builds.filter(isNodeLikeBuild);
  const webLike = builds.filter(isWebLikeBuild);
  if (nodeLike.length === builds.length) return false;
  if (webLike.length === builds.length) return true;
  // Mixed dual-env records: server entries are expected for the SSR half.
  if (nodeLike.length > 0 && webLike.length > 0) return false;
  return true;
}
