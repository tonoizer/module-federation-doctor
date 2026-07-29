import type { EvidenceValue } from "./evidence.js";

export type CanonicalConfigState = "known" | "absent" | "unknown" | "invalid";
export type CanonicalEffectiveState =
  | "known"
  | "defaulted"
  | "mutated"
  | "not-observed"
  | "unknown";
export type CanonicalConfigOrigin =
  | "user"
  | "adapter-default"
  | "adapter-mutation"
  | "bundler-default"
  | "artifact-inference"
  | "unknown";

export interface CanonicalConfigCell<T extends EvidenceValue = EvidenceValue> {
  state: CanonicalConfigState;
  value?: T;
  origin: CanonicalConfigOrigin;
  evidenceIds: string[];
}

export interface CanonicalEffectiveCell<T extends EvidenceValue = EvidenceValue> {
  state: CanonicalEffectiveState;
  value?: T;
  origin: CanonicalConfigOrigin;
  evidenceIds: string[];
}

export interface CanonicalConfigEntry {
  id: string;
  key: string;
  value: CanonicalConfigCell;
}

export interface CanonicalConfigSnapshot {
  /** Top-level fields. Keys stay sorted; collection order lives in `collections`. */
  fields: CanonicalConfigEntry[];
  /** Exposes, remotes, and shared entries retain outer and fallback array order. */
  collections: {
    exposes: CanonicalConfigEntry[];
    remotes: CanonicalConfigEntry[];
    shared: CanonicalConfigEntry[];
  };
}

export interface CanonicalConfigDiagnostic {
  code: "invalid-root" | "invalid-collection" | "opaque-value";
  path: string;
  message: string;
}

export interface CanonicalUnknownField {
  path: string;
  value: EvidenceValue;
  reason: "extension" | "opaque";
}

export interface CanonicalMFConfigV1 {
  schemaVersion: 1;
  contract: {
    family: string;
    sourceVersion: string;
    adapter: { name: string; version: string; packId: string };
    bundler: { name: string; version: string };
    target: string;
  };
  declared: CanonicalConfigSnapshot;
  effectiveByBuild: Record<string, CanonicalConfigSnapshot>;
  diagnostics: CanonicalConfigDiagnostic[];
  extensions: CanonicalUnknownField[];
}

export interface CanonicalConfigContext {
  family?: string;
  sourceVersion?: string;
  adapter?: { name?: string; version?: string; packId?: string };
  bundler?: { name?: string; version?: string };
  target?: string;
}

const COLLECTIONS = new Set(["exposes", "remotes", "shared"]);
const KNOWN_FIELDS = new Set([
  "name",
  "filename",
  "library",
  "remoteType",
  "shareScope",
  "runtimePlugins",
  "getPublicPath",
  "implementation",
  "manifest",
  "dev",
  "dts",
  "shareStrategy",
  "virtualRuntimeEntry",
  "experiments",
  "injectTreeShakingUsedExports",
  "treeShakingDir",
  "treeShakingSharedPlugins",
  "treeShakingSharedExcludePlugins",
  "publicPath",
  "bundleAllCSS",
  "ignoreOrigin",
  "virtualModuleDir",
  "hostInitInjectLocation",
  "moduleParseTimeout",
  "moduleParseIdleTimeout",
  "varFilename",
  "target",
  "disableRemote",
  "disableShared",
  "disableSnapshot",
  "ssrExternals",
  "exposes",
  "remotes",
  "shared",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValue(
  value: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
): EvidenceValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : opaque(value, path, diagnostics);
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol")
    return opaque(value, path, diagnostics);
  if (Array.isArray(value))
    return value.map((_item, index) => {
      const item = Object.getOwnPropertyDescriptor(value, String(index));
      return item && "value" in item
        ? jsonValue(item.value, `${path}/${index}`, diagnostics)
        : opaque(undefined, `${path}/${index}`, diagnostics);
    });
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => {
          const property = Object.getOwnPropertyDescriptor(value, key);
          return [
            key,
            property && "value" in property
              ? jsonValue(property.value, `${path}/${key}`, diagnostics)
              : opaque(undefined, `${path}/${key}`, diagnostics),
          ];
        }),
    );
  return opaque(value, path, diagnostics);
}

function opaque(
  value: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
): EvidenceValue {
  diagnostics.push({
    code: "opaque-value",
    path,
    message: "Value was not persisted because it is executable or non-JSON data.",
  });
  return { kind: "opaque", valueType: typeof value };
}

function cell(
  value: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
): CanonicalConfigCell {
  return {
    state: "known",
    value: jsonValue(value, path, diagnostics),
    origin: "user",
    evidenceIds: [],
  };
}

function entries(
  value: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
): CanonicalConfigEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) && !isRecord(value)) {
    diagnostics.push({
      code: "invalid-collection",
      path,
      message: "Expected an object or array collection.",
    });
    return [];
  }
  const outerArray = Array.isArray(value);
  const keys = outerArray ? value.map((_item, index) => String(index)) : Object.keys(value);
  return keys.map((key, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const item = descriptor && "value" in descriptor ? descriptor.value : undefined;
    const [entryKey, entry] = outerArray && Array.isArray(item) ? item : [key, item];
    return {
      id: `${path}/${index}`,
      key: entryKey,
      value: cell(entry, `${path}/${index}`, diagnostics),
    };
  });
}

function snapshot(
  input: Record<string, unknown>,
  diagnostics: CanonicalConfigDiagnostic[],
): CanonicalConfigSnapshot {
  const fields = Object.keys(input)
    .filter((key) => !COLLECTIONS.has(key))
    .sort()
    .map((key) => ({
      id: `/${key}`,
      key,
      value: cell(Object.getOwnPropertyDescriptor(input, key)?.value, `/${key}`, diagnostics),
    }));
  return {
    fields,
    collections: {
      exposes: entries(input.exposes, "/exposes", diagnostics),
      remotes: entries(input.remotes, "/remotes", diagnostics),
      shared: entries(input.shared, "/shared", diagnostics),
    },
  };
}

/** Read a config-shaped value without executing it or applying adapter defaults. */
export function readCanonicalModuleFederationConfig(
  input: unknown,
  context: CanonicalConfigContext = {},
): CanonicalMFConfigV1 | undefined {
  if (input === undefined) return undefined;
  const diagnostics: CanonicalConfigDiagnostic[] = [];
  if (!isRecord(input)) {
    diagnostics.push({
      code: "invalid-root",
      path: "/",
      message: "Expected a Module Federation config object.",
    });
    return {
      schemaVersion: 1,
      contract: contract(context),
      declared: { fields: [], collections: { exposes: [], remotes: [], shared: [] } },
      effectiveByBuild: {},
      diagnostics,
      extensions: [],
    };
  }
  return {
    schemaVersion: 1,
    contract: contract(context),
    declared: snapshot(input, diagnostics),
    effectiveByBuild: {},
    diagnostics,
    extensions: Object.keys(input)
      .filter((key) => !KNOWN_FIELDS.has(key))
      .map((key) => ({
        path: `/${key}`,
        value: jsonValue(
          Object.getOwnPropertyDescriptor(input, key)?.value,
          `/${key}`,
          diagnostics,
        ),
        reason: "extension" as const,
      })),
  };
}

function contract(context: CanonicalConfigContext): CanonicalMFConfigV1["contract"] {
  return {
    family: context.family ?? "module-federation",
    sourceVersion: context.sourceVersion ?? "unknown",
    adapter: {
      name: context.adapter?.name ?? "unknown",
      version: context.adapter?.version ?? "unknown",
      packId: context.adapter?.packId ?? "unknown",
    },
    bundler: {
      name: context.bundler?.name ?? "unknown",
      version: context.bundler?.version ?? "unknown",
    },
    target: context.target ?? "unknown",
  };
}
