import { createHash } from "node:crypto";
import { isDate, isProxy, isRegExp } from "node:util/types";
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

interface TraversalBudget extends Required<CanonicalConfigLimits> {
  nodes: number;
  bytes: number;
  width: number;
  seen: WeakSet<object>;
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
  "ssrEntryLoader",
  "remoteHmr",
  "exposes",
  "remotes",
  "shared",
]);
const SENSITIVE_KEY =
  /(?:token|secret|password|passwd|credential|private[-_ ]?key|api[-_]?key|authorization|cookie|session[-_]?id|pem|certificate|cert)/i;

function safeKey(key: string): string {
  if (!SENSITIVE_KEY.test(key)) return key;
  return `[REDACTED_KEY:${createHash("sha256").update(key).digest("hex")}]`;
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function diagnosticPath(path: string): string {
  return path
    .split("/")
    .map((segment) => safeKey(segment))
    .join("/");
}

function budgetFor(limits: Required<CanonicalConfigLimits>): TraversalBudget {
  return { ...limits, nodes: 0, bytes: 0, width: 0, seen: new WeakSet<object>() };
}

function consumeWidth(
  count: number,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  budget: TraversalBudget,
): boolean {
  budget.width += count;
  if (budget.width <= budget.maxWidth) return true;
  diagnostics.push({
    code: "limit-width",
    path: diagnosticPath(path),
    message: `Document exceeds maxWidth (${budget.maxWidth}).`,
  });
  return false;
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
      if (isRegExp(value)) objectType = "RegExp";
      else if (isDate(value)) objectType = "Date";
      else objectType = "object";
    } catch {
      objectType = "object";
    }
  }
  diagnostics.push({ code, path: diagnosticPath(path), message });
  return { kind: "opaque", valueType: typeof value, ...(objectType ? { objectType } : {}) };
}

function safeString(
  value: string,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  budget: TraversalBudget,
): EvidenceValue {
  if (Buffer.byteLength(value) > budget.maxStringBytes) {
    return opaque(
      value,
      path,
      diagnostics,
      "limit-string",
      `String exceeds maxStringBytes (${budget.maxStringBytes}).`,
    );
  }
  return value;
}

function toJsonValue(
  input: unknown,
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  budget: TraversalBudget,
): EvidenceValue {
  const holder: { value: EvidenceValue | undefined } = { value: undefined };
  const pending: Array<{
    input: unknown;
    path: string;
    depth: number;
    set: (value: EvidenceValue) => void;
  }> = [{ input, path, depth: 0, set: (value) => (holder.value = value) }];
  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) continue;
    budget.nodes += 1;
    if (budget.nodes > budget.maxNodes) {
      task.set(
        opaque(
          task.input,
          task.path,
          diagnostics,
          "limit-nodes",
          `Value exceeds maxNodes (${budget.maxNodes}).`,
        ),
      );
      continue;
    }
    if (task.depth > budget.maxDepth) {
      task.set(
        opaque(
          task.input,
          task.path,
          diagnostics,
          "limit-depth",
          `Value exceeds maxDepth (${budget.maxDepth}).`,
        ),
      );
      continue;
    }
    const value = task.input;
    if (value === null || typeof value === "boolean") {
      task.set(value);
      budget.bytes += 5;
    } else if (typeof value === "number") {
      task.set(Number.isFinite(value) ? value : opaque(value, task.path, diagnostics));
      budget.bytes += 8;
    } else if (typeof value === "string") {
      task.set(safeString(value, task.path, diagnostics, budget));
      budget.bytes += Buffer.byteLength(value) + 2;
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
    } else if (budget.seen.has(value)) {
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
      budget.seen.add(value);
      const lengthDescriptor = descriptor(value, "length");
      const length =
        lengthDescriptor &&
        "value" in lengthDescriptor &&
        typeof lengthDescriptor.value === "number"
          ? lengthDescriptor.value
          : -1;
      if (length < 0 || !consumeWidth(length, task.path, diagnostics, budget)) {
        task.set(
          opaque(
            value,
            task.path,
            diagnostics,
            length < 0 ? "access-error" : "limit-width",
            length < 0
              ? "Array length could not be read safely."
              : `Array exceeds maxWidth (${budget.maxWidth}).`,
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
      budget.bytes += 2;
    } else if (plainObject(value)) {
      budget.seen.add(value);
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
      if (!consumeWidth(keys.length, task.path, diagnostics, budget)) {
        task.set(
          opaque(
            value,
            task.path,
            diagnostics,
            "limit-width",
            `Object exceeds maxWidth (${budget.maxWidth}).`,
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
        budget.bytes += Buffer.byteLength(key) + 3;
      }
      budget.bytes += 2;
    } else {
      task.set(opaque(value, task.path, diagnostics));
    }
    if (budget.bytes > budget.maxBytes) {
      task.set(
        opaque(
          value,
          task.path,
          diagnostics,
          "limit-bytes",
          `Value exceeds maxBytes (${budget.maxBytes}).`,
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
  budget: TraversalBudget,
): CanonicalConfigCell {
  const converted = toJsonValue(value, path, diagnostics, budget);
  return {
    state: "known",
    value: redact(converted, budget),
    origin: "user",
    evidenceIds: [],
  };
}

function redact(value: EvidenceValue, limits: TraversalBudget): EvidenceValue {
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
  budget: TraversalBudget,
): CanonicalConfigEntry[] {
  if (value === undefined) return [];
  if (!safeArray(value) && !plainObject(value)) {
    return [opaqueCollection(path, diagnostics, "invalid-collection")];
  }
  const result: CanonicalConfigEntry[] = [];
  if (safeArray(value)) {
    const lengthDescriptor = descriptor(value, "length");
    const length =
      lengthDescriptor && "value" in lengthDescriptor && typeof lengthDescriptor.value === "number"
        ? lengthDescriptor.value
        : 0;
    if (length < 0) return [opaqueCollection(path, diagnostics)];
    if (!consumeWidth(length, path, diagnostics, budget))
      return [opaqueCollection(path, diagnostics, "limit-width")];
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
      if (typeof item === "string") key = item;
      else if (plainObject(item)) {
        const name = descriptor(item, "name")?.value;
        if (typeof name === "string") {
          const separator = name.indexOf("@");
          key = separator > 0 ? name.slice(0, separator) : name;
        } else {
          const itemKeys = ownKeys(item) ?? [];
          if (itemKeys.length > 0) {
            for (const itemKey of itemKeys) {
              const itemProperty = descriptor(item, itemKey);
              result.push({
                id: `${path}/${index}/${itemKey}`,
                key: itemKey,
                value:
                  itemProperty && "value" in itemProperty
                    ? cell(itemProperty.value, `${path}/${index}/${itemKey}`, diagnostics, budget)
                    : {
                        state: "unknown",
                        origin: "unknown",
                        evidenceIds: [],
                        value: opaque(
                          undefined,
                          `${path}/${index}/${itemKey}`,
                          diagnostics,
                          "access-error",
                          "Accessor properties are not executed or persisted.",
                        ),
                      },
              });
            }
            continue;
          }
        }
      }
      result.push({
        id: `${path}/${index}`,
        key,
        value: cell(item, `${path}/${index}`, diagnostics, budget),
      });
    }
    return result;
  }
  const keys = ownKeys(value);
  if (!keys) return [opaqueCollection(path, diagnostics)];
  if (!consumeWidth(keys.length, path, diagnostics, budget))
    return [opaqueCollection(path, diagnostics, "limit-width")];
  for (const key of keys) {
    const property = descriptor(value, key);
    result.push({
      id: `${path}/${key}`,
      key,
      value:
        property && "value" in property
          ? cell(property.value, `${path}/${key}`, diagnostics, budget)
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

function opaqueCollection(
  path: string,
  diagnostics: CanonicalConfigDiagnostic[],
  code: CanonicalConfigDiagnosticCode = "access-error",
): CanonicalConfigEntry {
  diagnostics.push({
    code,
    path: diagnosticPath(path),
    message:
      code === "access-error"
        ? "Collection could not be read without executing accessors."
        : `Collection is unavailable: ${code}.`,
  });
  return {
    id: `${path}/[opaque]`,
    key: "[opaque]",
    value: {
      state: "unknown",
      origin: "unknown",
      evidenceIds: [],
      value: { kind: "opaque", valueType: "object" },
    },
  };
}

function emptySnapshot(): CanonicalConfigSnapshot {
  return { fields: [], collections: { exposes: [], remotes: [], shared: [] } };
}

function snapshot(
  input: Record<string, unknown>,
  diagnostics: CanonicalConfigDiagnostic[],
  budget: TraversalBudget,
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
  if (keys && !consumeWidth(keys.length, "/", diagnostics, budget))
    return {
      fields: [],
      collections: {
        exposes: [opaqueCollection("/exposes", diagnostics, "limit-width")],
        remotes: [opaqueCollection("/remotes", diagnostics, "limit-width")],
        shared: [opaqueCollection("/shared", diagnostics, "limit-width")],
      },
    };
  for (const key of keys ?? []) {
    if (COLLECTIONS.has(key)) continue;
    const property = descriptor(input, key);
    const safeFieldKey = safeKey(key);
    const fieldPath = `/${pointerSegment(key)}`;
    fields.push({
      id: `/${pointerSegment(safeFieldKey)}`,
      key: safeFieldKey,
      value: SENSITIVE_KEY.test(key)
        ? {
            state: "unknown",
            origin: "unknown",
            evidenceIds: [],
            value: opaque(
              property && "value" in property ? property.value : undefined,
              fieldPath,
              diagnostics,
              "opaque-value",
              "Sensitive values are not persisted.",
            ),
          }
        : property && "value" in property
          ? cell(property.value, fieldPath, diagnostics, budget)
          : {
              state: "unknown",
              origin: "unknown",
              evidenceIds: [],
              value: opaque(
                undefined,
                fieldPath,
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
      exposes: rootCollection(input, "exposes", diagnostics, budget),
      remotes: rootCollection(input, "remotes", diagnostics, budget),
      shared: rootCollection(input, "shared", diagnostics, budget),
    },
  };
}

function rootCollection(
  input: Record<string, unknown>,
  key: string,
  diagnostics: CanonicalConfigDiagnostic[],
  budget: TraversalBudget,
): CanonicalConfigEntry[] {
  const property = descriptor(input, key);
  if (!property) return [];
  if (!("value" in property)) return [opaqueCollection(`/${key}`, diagnostics)];
  return collectionEntries(property.value, `/${key}`, diagnostics, budget);
}

/** Read a config-shaped value without executing getters or applying adapter defaults. */
export function readCanonicalModuleFederationConfig(
  input: unknown,
  context: CanonicalConfigContext = {},
  options: CanonicalConfigLimits = {},
): CanonicalMFConfigV1 | undefined {
  if (input === undefined) return undefined;
  const limits = limitsWithDefaults(options);
  const budget = budgetFor(limits);
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
  const declared = snapshot(input, diagnostics, budget);
  const extensions: CanonicalUnknownField[] = [];
  for (const key of ownKeys(input) ?? []) {
    if (KNOWN_FIELDS.has(key)) continue;
    const field = declared.fields.find((entry) => entry.key === safeKey(key));
    extensions.push({
      path: `/${pointerSegment(safeKey(key))}`,
      value: field?.value.value ?? null,
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
