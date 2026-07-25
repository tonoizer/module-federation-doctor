/**
 * Shared-dependency governance defaults (MFDOCTOR-122).
 * Lists extend `@mf-toolkit/shared-inspector` policy packs without duplicating
 * RS Doctor treemap / chunk-graph analysis.
 */

import type { DoctorSharedPolicy, ImportDepth } from "./types.js";

export type { DoctorSharedPolicy, ImportDepth };

export const DEFAULT_IMPORT_DEPTH: ImportDepth = "local-graph";

/** Packages never flagged as unused / host-gap by default (JSX may omit explicit imports). */
export const DEFAULT_ALWAYS_SHARED: readonly string[] = ["react", "react-dom"];

/**
 * Packages with global state — should be shared with `singleton: true`.
 * Built-in list is broader than the historic react/vue/angular regex.
 */
export const DEFAULT_SINGLETON_RISK_PACKAGES: readonly string[] = [
  "react",
  "react-dom",
  "vue",
  "@angular/core",
  "react-router",
  "react-router-dom",
  "vue-router",
  "mobx",
  "mobx-react",
  "mobx-react-lite",
  "redux",
  "react-redux",
  "@reduxjs/toolkit",
  "zustand",
  "jotai",
  "recoil",
  "@tanstack/react-query",
  "swr",
  "@apollo/client",
  "urql",
  "styled-components",
  "@emotion/react",
  "@emotion/styled",
];

/** Packages typically shared across microfrontends (candidate heuristic). */
export const DEFAULT_SHARE_CANDIDATE_PACKAGES: readonly string[] = [
  "react",
  "react-dom",
  "vue",
  "@angular/core",
  "svelte",
  "solid-js",
  "react-router",
  "react-router-dom",
  "vue-router",
  "mobx",
  "mobx-react",
  "mobx-react-lite",
  "redux",
  "react-redux",
  "@reduxjs/toolkit",
  "zustand",
  "jotai",
  "recoil",
  "@tanstack/react-query",
  "swr",
  "@apollo/client",
  "urql",
  "styled-components",
  "@emotion/react",
  "@emotion/styled",
];

/** Subpath specifiers excluded from deep-import bypass (JSX + React DOM entries). */
export const DEFAULT_DEEP_IMPORT_ALLOWLIST: readonly string[] = [
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "react-dom/server",
];

export interface ResolvedSharedPolicy {
  importDepth: ImportDepth;
  alwaysShared: Set<string>;
  singletonRisks: Set<string>;
  shareCandidates: Set<string>;
  deepImportAllowlist: Set<string>;
}

function isImportDepth(value: unknown): value is ImportDepth {
  return value === "direct" || value === "local-graph";
}

/** Merge built-in lists with pack / local knobs. Later layers extend sets; importDepth replaces. */
export function mergeSharedPolicy(
  layers: Array<DoctorSharedPolicy | undefined>,
): ResolvedSharedPolicy {
  const alwaysShared = new Set<string>(DEFAULT_ALWAYS_SHARED);
  const singletonRisks = new Set<string>(DEFAULT_SINGLETON_RISK_PACKAGES);
  const shareCandidates = new Set<string>(DEFAULT_SHARE_CANDIDATE_PACKAGES);
  const deepImportAllowlist = new Set<string>(DEFAULT_DEEP_IMPORT_ALLOWLIST);
  let importDepth: ImportDepth = DEFAULT_IMPORT_DEPTH;

  for (const layer of layers) {
    if (!layer) continue;
    if (isImportDepth(layer.importDepth)) importDepth = layer.importDepth;
    for (const pkg of layer.alwaysShared ?? []) alwaysShared.add(pkg);
    for (const pkg of layer.additionalSingletonRisks ?? []) singletonRisks.add(pkg);
    for (const pkg of layer.additionalCandidates ?? []) shareCandidates.add(pkg);
    for (const spec of layer.deepImportAllowlist ?? []) deepImportAllowlist.add(spec);
  }

  return { importDepth, alwaysShared, singletonRisks, shareCandidates, deepImportAllowlist };
}

export function isDeepImportSpecifier(specifier: string, packageName: string): boolean {
  return specifier !== packageName && specifier.startsWith(`${packageName}/`);
}

export function serializeSharedPolicy(policy: ResolvedSharedPolicy): {
  importDepth: ImportDepth;
  alwaysShared: string[];
  singletonRisks: string[];
  shareCandidates: string[];
  deepImportAllowlist: string[];
} {
  return {
    importDepth: policy.importDepth,
    alwaysShared: [...policy.alwaysShared].sort(),
    singletonRisks: [...policy.singletonRisks].sort(),
    shareCandidates: [...policy.shareCandidates].sort(),
    deepImportAllowlist: [...policy.deepImportAllowlist].sort(),
  };
}
