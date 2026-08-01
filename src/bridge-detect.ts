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
 * Resolve the Bridge React entry major from declared/installed deps and import specifiers.
 * Returns `18` / `19` for versioned entries, `"bare"` for the unversioned package, else undefined.
 */
export function reactBridgeEntryMajor(facts: ProjectFacts): ReactBridgeEntryMajor {
  let sawBare = false;
  for (const signal of allSignals(facts)) {
    const classified = classifyBridgeReactSignal(signal);
    if (classified === 18 || classified === 19) return classified;
    if (classified === "bare") sawBare = true;
  }
  return sawBare ? "bare" : undefined;
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
  for (const key of Object.keys(shared)) {
    if (key === "react-dom/" || key === "react-dom/client") return true;
    if (key.startsWith("react-dom/")) return true;
  }
  return false;
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
