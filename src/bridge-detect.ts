import { isShareKeyUsed } from "./shared-policy.js";
import type { NormalizedMFConfig, NormalizedShared, ProjectFacts } from "./types.js";

export const BRIDGE_REACT_PKG = "@module-federation/bridge-react";
export const BRIDGE_REACT_PLUGIN = "@module-federation/bridge-react/plugin";
export const BRIDGE_VUE3_PKG = "@module-federation/bridge-vue3";

export type ReactBridgeEntryMajor = 18 | 19 | "bare" | undefined;

export interface BridgeOptions {
  enableBridgeRouter?: boolean;
  disableAlias?: boolean;
  raw: Record<string, unknown>;
}

function dependencyKeys(facts: ProjectFacts): string[] {
  return [
    ...Object.keys(facts.dependencies.declared),
    ...Object.keys(facts.dependencies.installed),
  ];
}

function importSignals(facts: ProjectFacts): string[] {
  return [
    ...(facts.imports.packages ?? []),
    ...(facts.imports.dynamicPackages ?? []),
    ...(facts.imports.specifiers ?? []),
    ...(facts.imports.deepImports ?? []),
  ];
}

function allSignals(facts: ProjectFacts): string[] {
  const plugins = facts.moduleFederation?.runtimePlugins ?? [];
  return [...dependencyKeys(facts), ...importSignals(facts), ...plugins];
}

function mentionsPackage(signals: string[], pkg: string): boolean {
  return signals.some((signal) => signal === pkg || signal.startsWith(`${pkg}/`));
}

/** True when the project shows React Bridge usage (deps, imports, plugin, or bridge config). */
export function isReactBridgeProject(facts: ProjectFacts): boolean {
  const signals = allSignals(facts);
  if (mentionsPackage(signals, BRIDGE_REACT_PKG)) return true;
  if (hasBridgeReactPlugin(facts.moduleFederation?.runtimePlugins)) return true;
  const bridge = facts.moduleFederation?.bridge;
  if (bridge && Object.keys(bridge).length > 0 && !isVueBridgeProject(facts)) {
    const hasReact =
      dependencyKeys(facts).some((name) => name === "react" || name.startsWith("react/")) ||
      importSignals(facts).some((name) => name === "react" || name.startsWith("react/"));
    if (hasReact) return true;
  }
  return false;
}

/** True when the project shows Vue Bridge (`bridge-vue3`) usage. */
export function isVueBridgeProject(facts: ProjectFacts): boolean {
  return mentionsPackage(allSignals(facts), BRIDGE_VUE3_PKG);
}

export function hasSharedPackage(
  shared: Record<string, NormalizedShared> | undefined,
  pkg: string,
): boolean {
  if (!shared) return false;
  return Object.keys(shared).some((key) => key === pkg || key.startsWith(`${pkg}/`));
}

/** True when `vue-router` appears in deps/imports (share check only when used). */
export function usesVueRouter(facts: ProjectFacts): boolean {
  return mentionsPackage(allSignals(facts), "vue-router");
}

export function hasBridgeVueServerEntry(facts: ProjectFacts): boolean {
  return [...(facts.imports.specifiers ?? []), ...(facts.imports.deepImports ?? [])].some(
    (signal) =>
      signal === `${BRIDGE_VUE3_PKG}/server` || signal.startsWith(`${BRIDGE_VUE3_PKG}/server/`),
  );
}

/** Soft SSR freshness signals for Vue Bridge (createSSRApp / hydration registry / per-request app). */
export function hasVueBridgeSsrFreshContextHints(source: string): boolean {
  return (
    /\bcreateSSRApp\b/.test(source) ||
    /\bprovideBridgeHydrationRegistry\b/.test(source) ||
    /\bfresh(?:App|Context|Router|Store)\b/i.test(source) ||
    /\bper[- ]?request\b/i.test(source)
  );
}

function classifyBridgeReactSignal(signal: string): ReactBridgeEntryMajor {
  if (signal === `${BRIDGE_REACT_PKG}/v19` || signal.startsWith(`${BRIDGE_REACT_PKG}/v19/`))
    return 19;
  if (signal === `${BRIDGE_REACT_PKG}/v18` || signal.startsWith(`${BRIDGE_REACT_PKG}/v18/`))
    return 18;
  if (signal === BRIDGE_REACT_PKG) return "bare";
  // Ignore plugin and other subpaths when classifying the public entry major.
  if (signal.startsWith(`${BRIDGE_REACT_PKG}/`)) return undefined;
  return undefined;
}

/**
 * Resolve the Bridge React entry major.
 * Versioned `/v18` `/v19` may come from deps or import paths.
 * `"bare"` only when an import/specifier exactly uses the unversioned package — not merely
 * because the package is installed or appears as an `imports.packages` root.
 */
export function reactBridgeEntryMajor(facts: ProjectFacts): ReactBridgeEntryMajor {
  const versionSignals = [
    ...dependencyKeys(facts),
    ...(facts.imports.specifiers ?? []),
    ...(facts.imports.deepImports ?? []),
    ...(facts.imports.dynamicPackages ?? []),
    ...(facts.moduleFederation?.runtimePlugins ?? []),
  ];
  for (const signal of versionSignals) {
    const classified = classifyBridgeReactSignal(signal);
    if (classified === 18 || classified === 19) return classified;
  }
  // Bare entry: exact unversioned import/specifier only (ignore package roots from analyze).
  const entrySignals = [...(facts.imports.specifiers ?? []), ...(facts.imports.deepImports ?? [])];
  if (entrySignals.some((signal) => classifyBridgeReactSignal(signal) === "bare")) return "bare";
  return undefined;
}

/** Detect React major from installed/declared `react` when available. */
export function detectedReactMajor(facts: ProjectFacts): 18 | 19 | undefined {
  const versions = [facts.dependencies.installed.react, facts.dependencies.declared.react].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  for (const version of versions) {
    const match = version.match(/(?:^|[^\d])(18|19)(?:\D|$)/);
    if (match?.[1] === "19") return 19;
    if (match?.[1] === "18") return 18;
  }
  return undefined;
}

export function hasBridgeReactPlugin(runtimePlugins: string[] | undefined): boolean {
  if (!runtimePlugins?.length) return false;
  return runtimePlugins.some(
    (plugin) =>
      plugin === BRIDGE_REACT_PLUGIN ||
      plugin.includes(`${BRIDGE_REACT_PKG}/plugin`) ||
      /bridge-react[/\\]plugin/.test(plugin),
  );
}

/**
 * Bridge v18/v19 expects a trailing-slash or client share key so react-dom subpaths
 * negotiate through the shared scope (`react-dom/` or `react-dom/client`).
 */
export function hasReactDomPrefixShare(
  shared: Record<string, NormalizedShared> | undefined,
): boolean {
  if (!shared) return false;
  // Only the Bridge-documented share keys — not e.g. `react-dom/server`.
  return Object.keys(shared).some((key) => key === "react-dom/" || key === "react-dom/client");
}

/** Whether scanned imports would satisfy a trailing-slash `react-dom/` share key. */
export function reactDomShareAppearsUsed(facts: ProjectFacts): boolean {
  return isShareKeyUsed("react-dom/", {
    packages: facts.imports.packages,
    dynamicPackages: facts.imports.dynamicPackages,
    specifiers: facts.imports.specifiers,
    deepImports: facts.imports.deepImports,
  });
}

export function bridgeOptions(config: NormalizedMFConfig | undefined): BridgeOptions | undefined {
  const raw = config?.bridge;
  if (!raw) return undefined;
  return {
    ...(typeof raw.enableBridgeRouter === "boolean"
      ? { enableBridgeRouter: raw.enableBridgeRouter }
      : {}),
    ...(typeof raw.disableAlias === "boolean" ? { disableAlias: raw.disableAlias } : {}),
    raw,
  };
}

/**
 * Bridge router is active when explicitly enabled, or when the Bridge package is
 * present and `enableBridgeRouter` is omitted (Rspack auto-enable).
 */
export function isBridgeRouterEnabled(facts: ProjectFacts): boolean {
  if (!isReactBridgeProject(facts)) return false;
  const options = bridgeOptions(facts.moduleFederation);
  if (options?.enableBridgeRouter === false) return false;
  // Deprecated escape hatch: disableAlias turns off Bridge router aliasing.
  if (options?.disableAlias === true) return false;
  if (options?.enableBridgeRouter === true) return true;
  // Omitted → Rspack may auto-enable when Bridge is present.
  return true;
}

const REACT_ROUTER_SHARE_KEYS = ["react-router", "react-router-dom"] as const;

/** Shared keys that conflict with Bridge's router aliasing. */
export function sharedReactRouterKeys(
  shared: Record<string, NormalizedShared> | undefined,
): string[] {
  if (!shared) return [];
  return Object.keys(shared).filter((key) =>
    REACT_ROUTER_SHARE_KEYS.some((pkg) => key === pkg || key.startsWith(`${pkg}/`)),
  );
}

export function hasSharedReactRouter(
  shared: Record<string, NormalizedShared> | undefined,
): boolean {
  return sharedReactRouterKeys(shared).length > 0;
}

/**
 * True when facts indicate a node/SSR-only build where browser-only Bridge entries must not load.
 * Dual web+node workspaces stay quiet unless `ssrMode` forces apply (`node` / `dual`).
 */
export function isNodeOrSsrTarget(
  facts: ProjectFacts,
  ssrMode?: "browser-only" | "dual" | "node",
): boolean {
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
  // Mixed web + node/SSR records → dual-env; leave to `ssrMode` / #122 rather than Bridge leak.
  const hasWeb = builds.some(
    (build) =>
      build.targetKind === "web" ||
      build.targetKind === "unknown" ||
      (build.target !== undefined && build.target !== "node"),
  );
  if (hasWeb && nodeLike.length < builds.length) return false;
  return nodeLike.length === builds.length;
}

/** Specifiers that are browser-only Bridge React entries (not `/server`). */
export function browserBridgeReactEntries(facts: ProjectFacts): string[] {
  const hits: string[] = [];
  // Use specifiers/deepImports only — `imports.packages` are package roots via
  // packageName(), so `@module-federation/bridge-react/server` collapses to the
  // bare package and would false-positive as a browser leak.
  for (const signal of [
    ...(facts.imports.specifiers ?? []),
    ...(facts.imports.deepImports ?? []),
  ]) {
    if (!signal.startsWith(BRIDGE_REACT_PKG)) continue;
    if (signal === BRIDGE_REACT_PKG) continue;
    if (signal.includes("/server")) continue;
    if (signal.includes("/plugin")) continue;
    hits.push(signal);
  }
  return [...new Set(hits)];
}

export function hasBridgeServerEntry(facts: ProjectFacts): boolean {
  return [...(facts.imports.specifiers ?? []), ...(facts.imports.deepImports ?? [])].some(
    (signal) =>
      signal === `${BRIDGE_REACT_PKG}/server` || signal.startsWith(`${BRIDGE_REACT_PKG}/server/`),
  );
}

const BRIDGE_PROVIDER_APIS = ["createBridgeComponent", "createRemoteAppComponent"] as const;

/**
 * Heuristic: Bridge provider/consumer factory calls with an empty or clearly incomplete options object.
 * Returns undefined when no Bridge API usage is visible or the call shape is too nested to judge (pass-unknown).
 */
export function detectInvalidBridgeProviderShape(source: string): string | undefined {
  for (const api of BRIDGE_PROVIDER_APIS) {
    if (!source.includes(api)) continue;
    const emptyCall = new RegExp(`${api}\\s*\\(\\s*\\{\\s*\\}\\s*\\)`);
    if (emptyCall.test(source)) return `${api}({})`;
    // Only inspect flat option objects (no nested `{}`) to avoid false positives on loaders.
    const flat = new RegExp(`${api}\\s*\\(\\s*\\{([^{}]*)\\}\\s*\\)`, "s");
    const match = source.match(flat);
    if (!match) continue;
    const body = match[1] ?? "";
    const hasLoader = /\b(?:loader|module|remote)\b/.test(body);
    // Fallback/loading UX is owned by bridge/missing-fallback-loading (warning), not this error.
    if (api === "createRemoteAppComponent") {
      if (!hasLoader) return `${api} missing loader/module`;
    }
    if (api === "createBridgeComponent") {
      if (!/\b(?:rootComponent|root|app|component|App)\b/.test(body) && body.trim().length < 8)
        return `${api} incomplete options`;
    }
  }
  return undefined;
}
