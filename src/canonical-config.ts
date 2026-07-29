import { isProxy } from "node:util/types";
import type { EvidenceLimits, EvidenceValue } from "./evidence.js";
import { redactEvidenceValue } from "./evidence.js";

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
  fields: CanonicalConfigEntry[];
  collections: {
    exposes: CanonicalConfigEntry[];
    remotes: CanonicalConfigEntry[];
    shared: CanonicalConfigEntry[];
  };
}

export type CanonicalConfigDiagnosticCode =
  | "invalid-root"
  | "invalid-collection"
  | "opaque-value"
  | "access-error"
  | "cycle"
  | "limit-depth"
  | "limit-nodes"
  | "limit-bytes"
  | "limit-string"
  | "limit-width";

export interface CanonicalConfigDiagnostic {
  code: CanonicalConfigDiagnosticCode;
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

export interface CanonicalConfigLimits extends EvidenceLimits {
  maxStringBytes?: number;
}

const DEFAULT_LIMITS: Required<CanonicalConfigLimits> = {
  maxDepth: 64,
  maxNodes: 10_000,
  maxBytes: 1_048_576,
  maxWidth: 1_000,
  maxStringBytes: 262_144,
};
const COLLECTIONS = new Set(["exposes", "remotes", "shared"]);
const KNOWN_FIELDS = new Set([
  "name",
  "filename",
  "library",
  "remoteType",
  "shareScope",
  "runtime",
  "runtimePlugins",
  "bridge",
  "async",
  "manifest",
  "dev",
  "dts",
  "experiments",
  "shareStrategy",
  "virtualRuntimeEntry",
  "getPublicPath",
  "implementation",
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
const SENSITIVE_KEY =
  /(?:token|secret|password|passwd|credential|private[-_ ]?key|api[-_]?key|authorization|cookie|session[-_]?id|pem|certificate|cert)/i;

function safeKey(key: string): string {
  return SENSITIVE_KEY.test(key) ? "[REDACTED_KEY]" : key;
}

function limitsWithDefaults(options?: CanonicalConfigLimits): Required<CanonicalConfigLimits> {
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError("Canonical config limits must be positive safe integers.");
    }
  }
  return limits;
}

function safeArray(value: unknown): value is unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function proxyValue(value: unknown): boolean {
  try {
    return isProxy(value);
  } catch {
    return true;
  }
}

function safePrototype(value: object): object | null | undefined {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    return undefined;
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || proxyValue(value) || safeArray(value))
    return false;
  const prototype = safePrototype(value);
  return prototype === null || prototype === Object.prototype;
}

function descriptor(value: object, key: string): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}

function ownKeys(value: object): string[] | undefined {
  try {
    return Object.keys(value).sort();
  } catch {
    return undefined;
  }
}

function opaque(
  value: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  code: CanonicalConfigDiagnosticCode = "opaque-value",
  message = "Value was not persisted because it is executable or non-JSON data.",
): EvidenceValue {
  let objectType: string | undefined;
  if (typeof value === "object" && value !== null) {
    try {
      const tag = Object.prototype.toString.call(value);
      objectType = tag.startsWith("[object ") ? tag.slice(8, -1) : "object";
    } catch {
      objectType = "uninspectable";
    }
  }
  diagnostics.push({ code, path, message });
  return { kind: "opaque", valueType: typeof value, ...(objectType ? { objectType } : {}) };
}

function safeString(
  value: string,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  limits: Required<CanonicalConfigLimits>,
): EvidenceValue {
  if (Buffer.byteLength(value) > limits.maxStringBytes) {
    return opaque(
      value,
      path,
      diagnostics,
      "limit-string",
      `String exceeds maxStringBytes (${limits.maxStringBytes}).`,
    );
  }
  return value;
}

function toJsonValue(
  input: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  limits: Required<CanonicalConfigLimits>,
): EvidenceValue {
  const holder: { value: EvidenceValue | undefined } = { value: undefined };
  const pending: Array<{
    input: unknown;
    path: string;
    depth: number;
    set: (value: EvidenceValue) => void;
  }> = [{ input, path, depth: 0, set: (value) => (holder.value = value) }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) continue;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      task.set(
        opaque(
          task.input,
          task.path,
          diagnostics,
          "limit-nodes",
          `Value exceeds maxNodes (${limits.maxNodes}).`,
        ),
      );
      continue;
    }
    if (task.depth > limits.maxDepth) {
      task.set(
        opaque(
          task.input,
          task.path,
          diagnostics,
          "limit-depth",
          `Value exceeds maxDepth (${limits.maxDepth}).`,
        ),
      );
      continue;
    }
    const value = task.input;
    if (value === null || typeof value === "boolean") {
      task.set(value);
      bytes += 5;
    } else if (typeof value === "number") {
      task.set(Number.isFinite(value) ? value : opaque(value, task.path, diagnostics));
      bytes += 8;
    } else if (typeof value === "string") {
      task.set(safeString(value, task.path, diagnostics, limits));
      bytes += Buffer.byteLength(value) + 2;
    } else if (
      typeof value === "bigint" ||
      typeof value === "function" ||
      typeof value === "symbol"
    ) {
      task.set(opaque(value, task.path, diagnostics));
    } else if (typeof value !== "object") {
      task.set(opaque(value, task.path, diagnostics));
    } else if (proxyValue(value)) {
      task.set(
        opaque(value, task.path, diagnostics, "access-error", "Proxy values are not traversed."),
      );
    } else if (seen.has(value)) {
      task.set(
        opaque(
          value,
          task.path,
          diagnostics,
          "cycle",
          "Cycle or repeated object reference was replaced with an opaque value.",
        ),
      );
    } else if (safeArray(value)) {
      seen.add(value);
      const lengthDescriptor = descriptor(value, "length");
      const length =
        lengthDescriptor &&
        "value" in lengthDescriptor &&
        typeof lengthDescriptor.value === "number"
          ? lengthDescriptor.value
          : -1;
      if (length < 0 || length > limits.maxWidth) {
        task.set(
          opaque(
            value,
            task.path,
            diagnostics,
            length < 0 ? "access-error" : "limit-width",
            length < 0
              ? "Array length could not be read safely."
              : `Array exceeds maxWidth (${limits.maxWidth}).`,
          ),
        );
        continue;
      }
      const output: EvidenceValue[] = [];
      task.set(output);
      for (let index = length - 1; index >= 0; index -= 1) {
        const child = descriptor(value, String(index));
        if (child && !("value" in child)) {
          output[index] = opaque(
            undefined,
            `${task.path}/${index}`,
            diagnostics,
            "access-error",
            "Accessor properties are not executed or persisted.",
          );
          continue;
        }
        const childValue = child && "value" in child ? child.value : undefined;
        const childPath = `${task.path}/${index}`;
        pending.push({
          input: childValue,
          path: childPath,
          depth: task.depth + 1,
          set: (item) => (output[index] = item),
        });
      }
      bytes += 2;
    } else if (plainObject(value)) {
      seen.add(value);
      const keys = ownKeys(value);
      if (!keys) {
        task.set(
          opaque(
            value,
            task.path,
            diagnostics,
            "access-error",
            "Object keys could not be read safely.",
          ),
        );
        continue;
      }
      if (keys.length > limits.maxWidth) {
        task.set(
          opaque(
            value,
            task.path,
            diagnostics,
            "limit-width",
            `Object exceeds maxWidth (${limits.maxWidth}).`,
          ),
        );
        continue;
      }
      const output: Record<string, EvidenceValue> = {};
      task.set(output);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index] ?? "";
        const property = descriptor(value, key);
        const childPath = `${task.path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if (!property || !("value" in property)) {
          output[key] = opaque(
            undefined,
            childPath,
            diagnostics,
            "access-error",
            "Accessor properties are not executed or persisted.",
          );
          continue;
        }
        pending.push({
          input: property.value,
          path: childPath,
          depth: task.depth + 1,
          set: (item) => (output[key] = item),
        });
        bytes += Buffer.byteLength(key) + 3;
      }
      bytes += 2;
    } else {
      task.set(opaque(value, task.path, diagnostics));
    }
    if (bytes > limits.maxBytes) {
      task.set(
        opaque(
          value,
          task.path,
          diagnostics,
          "limit-bytes",
          `Value exceeds maxBytes (${limits.maxBytes}).`,
        ),
      );
    }
  }
  return holder.value ?? null;
}

function cell(
  value: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  limits: Required<CanonicalConfigLimits>,
): CanonicalConfigCell {
  const converted = toJsonValue(value, path, diagnostics, limits);
  return {
    state: "known",
    value: redact(converted, limits),
    origin: "user",
    evidenceIds: [],
  };
}

function redact(value: EvidenceValue, limits: Required<CanonicalConfigLimits>): EvidenceValue {
  return redactEvidenceValue(value, {
    maxDepth: Math.max(limits.maxDepth, 128),
    maxNodes: 50_000,
    maxBytes: 8 * 1_048_576,
    maxWidth: 10_000,
  });
}

function collectionEntries(
  value: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  limits: Required<CanonicalConfigLimits>,
): CanonicalConfigEntry[] {
  if (value === undefined) return [];
  if (!safeArray(value) && !plainObject(value)) {
    diagnostics.push({
      code: "invalid-collection",
      path,
      message: "Expected a plain object or array collection.",
    });
    return [];
  }
  const result: CanonicalConfigEntry[] = [];
  if (safeArray(value)) {
    const lengthDescriptor = descriptor(value, "length");
    const length =
      lengthDescriptor && "value" in lengthDescriptor && typeof lengthDescriptor.value === "number"
        ? lengthDescriptor.value
        : 0;
    for (let index = 0; index < length; index += 1) {
      const property = descriptor(value, String(index));
      if (property && !("value" in property)) {
        result.push({
          id: `${path}/${index}`,
          key: String(index),
          value: {
            state: "unknown",
            origin: "unknown",
            evidenceIds: [],
            value: opaque(
              undefined,
              `${path}/${index}`,
              diagnostics,
              "access-error",
              "Accessor properties are not executed or persisted.",
            ),
          },
        });
        continue;
      }
      const item = property && "value" in property ? property.value : undefined;
      let key = String(index);
      if (typeof item === "string") key = safeKey(item);
      else if (plainObject(item)) {
        const name = descriptor(item, "name")?.value;
        if (typeof name === "string") key = safeKey(name);
      }
      result.push({
        id: `${path}/${index}`,
        key,
        value: cell(item, `${path}/${index}`, diagnostics, limits),
      });
    }
    return result;
  }
  const keys = ownKeys(value) ?? [];
  for (const key of keys) {
    const property = descriptor(value, key);
    result.push({
      id: `${path}/${safeKey(key)}`,
      key: safeKey(key),
      value:
        property && "value" in property
          ? cell(property.value, `${path}/${key}`, diagnostics, limits)
          : {
              state: "unknown",
              origin: "unknown",
              evidenceIds: [],
              value: opaque(
                undefined,
                `${path}/${key}`,
                diagnostics,
                "access-error",
                "Accessor properties are not executed or persisted.",
              ),
            },
    });
  }
  return result;
}

function emptySnapshot(): CanonicalConfigSnapshot {
  return { fields: [], collections: { exposes: [], remotes: [], shared: [] } };
}

function snapshot(
  input: Record<string, unknown>,
  diagnostics: CanonicalConfigDiagnostic[],
  limits: Required<CanonicalConfigLimits>,
): CanonicalConfigSnapshot {
  const fields: CanonicalConfigEntry[] = [];
  const keys = ownKeys(input);
  if (!keys) {
    diagnostics.push({
      code: "access-error",
      path: "/",
      message: "Object keys could not be read safely.",
    });
  }
  for (const key of keys ?? []) {
    if (COLLECTIONS.has(key)) continue;
    const property = descriptor(input, key);
    fields.push({
      id: `/${safeKey(key)}`,
      key: safeKey(key),
      value:
        property && "value" in property
          ? cell(property.value, `/${key}`, diagnostics, limits)
          : {
              state: "unknown",
              origin: "unknown",
              evidenceIds: [],
              value: opaque(
                undefined,
                `/${key}`,
                diagnostics,
                "access-error",
                "Accessor properties are not executed or persisted.",
              ),
            },
    });
  }
  return {
    fields,
    collections: {
      exposes: collectionEntries(
        descriptor(input, "exposes")?.value,
        "/exposes",
        diagnostics,
        limits,
      ),
      remotes: collectionEntries(
        descriptor(input, "remotes")?.value,
        "/remotes",
        diagnostics,
        limits,
      ),
      shared: collectionEntries(descriptor(input, "shared")?.value, "/shared", diagnostics, limits),
    },
  };
}

/** Read a config-shaped value without executing getters or applying adapter defaults. */
export function readCanonicalModuleFederationConfig(
  input: unknown,
  context: CanonicalConfigContext = {},
  options: CanonicalConfigLimits = {},
): CanonicalMFConfigV1 | undefined {
  if (input === undefined) return undefined;
  const limits = limitsWithDefaults(options);
  const diagnostics: CanonicalConfigDiagnostic[] = [];
  if (!plainObject(input)) {
    diagnostics.push({
      code: "invalid-root",
      path: "/",
      message: "Expected a plain Module Federation config object.",
    });
    return {
      schemaVersion: 1,
      contract: contract(context),
      declared: emptySnapshot(),
      effectiveByBuild: {},
      diagnostics,
      extensions: [],
    };
  }
  const declared = snapshot(input, diagnostics, limits);
  const extensions: CanonicalUnknownField[] = [];
  for (const key of ownKeys(input) ?? []) {
    if (KNOWN_FIELDS.has(key)) continue;
    const property = descriptor(input, key);
    extensions.push({
      path: `/${safeKey(key)}`,
      value: redact(
        property && "value" in property
          ? toJsonValue(property.value, `/${key}`, diagnostics, limits)
          : opaque(
              undefined,
              `/${key}`,
              diagnostics,
              "access-error",
              "Accessor properties are not executed or persisted.",
            ),
        limits,
      ),
      reason: "extension",
    });
  }
  return {
    schemaVersion: 1,
    contract: contract(context),
    declared,
    effectiveByBuild: {},
    diagnostics,
    extensions,
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
