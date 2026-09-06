import { createHash } from "node:crypto";
import {
  redactEvidenceValue,
  type EvidenceCompletenessInfo,
  type EvidenceProvenance,
  type EvidenceValue,
} from "./evidence.js";
import { importRuntimeCaptureExport } from "./runtime-capture-file.js";
import {
  DEFAULT_RUNTIME_CAPTURE_LIMITS,
  FORBIDDEN_KEYS,
  RUNTIME_CAPTURE_CONTRACT_VERSION,
  RuntimeCaptureExportError,
  SECRET_KEY,
  assertKnownKeys,
  assertLimits,
  capability,
  isObject,
  ownDataEntries,
  relationId,
  runtimeCaptureContentDigest,
  runtimeCaptureRecordId,
  validateRuntimeCaptureEnvelope,
  type RuntimeCaptureCapability,
  type RuntimeCaptureCapabilityInfo,
  type RuntimeCaptureEnvelope,
  type RuntimeCaptureErrorRecord,
  type RuntimeCaptureErrorValue,
  type RuntimeCaptureIdentity,
  type RuntimeCaptureInstanceRecord,
  type RuntimeCaptureInstanceValue,
  type RuntimeCaptureLimits,
  type RuntimeCaptureNetworkRecord,
  type RuntimeCaptureNetworkValue,
  type RuntimeCaptureRelationRecord,
  type RuntimeCaptureSnapshotRecord,
  type RuntimeCaptureSnapshotValue,
  type RuntimeCaptureTransport,
  type RuntimeCaptureTruncation,
} from "./runtime-capture-contract.js";

/**
 * Unused-by-CLI capture transports: read-only snapshot/instance fallback,
 * network/error fallback, and explicit browser-connector capture.
 *
 * Isolated from the `mfdoctor runtime` file-import path. None of these
 * functions inject a doctor into a page, evaluate arbitrary scripts, or run
 * from `check` / bundler adapters. Do not add transports here.
 */

export interface RuntimeCaptureFallbackOptions {
  transport?: RuntimeCaptureTransport;
  captureId?: string;
  navigationId?: string;
  realmId?: string;
  sourceScope?: string;
  capturedAt?: number;
  runtimeVersion?: string;
  hostName?: string;
  /** An explicit runtime/config flag; a true source value always wins. */
  disableSnapshot?: boolean;
  collector?: { name: string; version: string };
  limits?: Partial<RuntimeCaptureLimits>;
  location?: string;
}

export interface RuntimeCaptureNetworkFallbackOptions extends RuntimeCaptureFallbackOptions {
  /** Maximum distance for a relation that remains a time-window candidate. */
  timeWindowMs?: number;
}

const RUNTIME_FALLBACK_SOURCE_VERSION = "runtime-fallback-v1";
const FALLBACK_WRAPPER_KEYS = [
  "state",
  "runtimeState",
  "runtime",
  "globalThis",
  "__FEDERATION__",
  "federation",
  "data",
  "value",
  "export",
  "snapshot",
] as const;
const FALLBACK_INSTANCE_KEYS = [
  "name",
  "hostName",
  "runtimeVersion",
  "remoteNames",
  "shareScopes",
] as const;
const FALLBACK_SNAPSHOT_KEYS = [
  "name",
  "publicPath",
  "remoteEntry",
  "globalName",
  "availableNames",
  "entryCount",
  "entries",
  "totalCount",
  "matchedCount",
  "clipped",
] as const;

interface FallbackProperty {
  present: boolean;
  value?: unknown;
}

interface FallbackStringRead {
  present: boolean;
  value?: string;
  malformed: boolean;
}

interface FallbackNumberRead {
  present: boolean;
  value?: number;
  malformed: boolean;
}

interface FallbackBooleanRead {
  present: boolean;
  value?: boolean;
  malformed: boolean;
}

interface FallbackStringArrayRead {
  present: boolean;
  values: string[];
  malformed: boolean;
  truncated: boolean;
}

interface FallbackSourceRef {
  value: unknown;
  path: string;
}

interface FallbackCollectedSources {
  moduleInfo?: FallbackSourceRef;
  moduleInfoPresent: boolean;
  moduleInfoMalformed: boolean;
  instance?: FallbackSourceRef;
  instancesPresent: boolean;
  instancesMalformed: boolean;
  runtimeVersion?: string;
  hostName?: string;
  disableSnapshot: boolean;
}

interface FallbackSnapshotProjection {
  values: RuntimeCaptureSnapshotValue[];
  sourceEntryCount?: number;
  sourceTotalCount?: number;
  clipped: boolean;
  malformed: boolean;
  truncated: boolean;
}

interface FallbackInstanceItem {
  value: unknown;
  path: string;
  mapName?: string;
}

interface FallbackInstanceProjection {
  values: RuntimeCaptureInstanceValue[];
  declaredCount: number;
  malformed: boolean;
  truncated: boolean;
}

function fallbackPlainRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (!isObject(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new RuntimeCaptureExportError(`${path} must be a plain object`);
    return value;
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError) throw error;
    throw new RuntimeCaptureExportError(`${path} cannot be safely read`);
  }
}

function fallbackProperty(value: unknown, key: string, path: string): FallbackProperty {
  const record = fallbackPlainRecord(value, path);
  if (!record) return { present: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return { present: false };
    if (!("value" in descriptor))
      throw new RuntimeCaptureExportError(`${path}.${key} must be an own data property`);
    return { present: true, value: descriptor.value };
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError) throw error;
    throw new RuntimeCaptureExportError(`${path}.${key} cannot be safely read`);
  }
}

function fallbackArray(
  value: unknown,
  path: string,
): { value: unknown[]; length: number } | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Array.prototype && prototype !== null)
      throw new RuntimeCaptureExportError(`${path} must use an unmodified array prototype`);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    )
      throw new RuntimeCaptureExportError(`${path} has an invalid array length`);
    return { value, length: lengthDescriptor.value };
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError) throw error;
    throw new RuntimeCaptureExportError(`${path} cannot be safely read`);
  }
}

function fallbackSafeStringValue(
  value: unknown,
  path: string,
  limits: RuntimeCaptureLimits,
  maxLength = limits.maxStringLength,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  if (value.length > maxLength)
    throw new RuntimeCaptureExportError(
      `${path} exceeds ${maxLength === limits.maxDiagnosisStringLength ? "maxDiagnosisStringLength" : "maxStringLength"}`,
    );
  const redacted = redactEvidenceValue(value) as unknown;
  if (typeof redacted !== "string" || redacted.length === 0) return undefined;
  if (redacted.length > maxLength)
    throw new RuntimeCaptureExportError(
      `${path} exceeds ${maxLength === limits.maxDiagnosisStringLength ? "maxDiagnosisStringLength" : "maxStringLength"} after redaction`,
    );
  return redacted;
}

function fallbackStringProperty(
  value: unknown,
  key: string,
  path: string,
  limits: RuntimeCaptureLimits,
  maxLength = limits.maxStringLength,
): FallbackStringRead {
  const property = fallbackProperty(value, key, path);
  if (!property.present || property.value === undefined || property.value === null)
    return { present: property.present, malformed: false };
  if (typeof property.value !== "string") return { present: true, malformed: true };
  const safeValue = fallbackSafeStringValue(property.value, `${path}.${key}`, limits, maxLength);
  return {
    present: true,
    ...(safeValue !== undefined ? { value: safeValue } : {}),
    malformed: false,
  };
}

function fallbackNumberProperty(value: unknown, key: string, path: string): FallbackNumberRead {
  const property = fallbackProperty(value, key, path);
  if (!property.present || property.value === undefined || property.value === null)
    return { present: property.present, malformed: false };
  if (!Number.isSafeInteger(property.value) || (property.value as number) < 0)
    return { present: true, malformed: true };
  return { present: true, value: property.value as number, malformed: false };
}

function fallbackFiniteNumberProperty(
  value: unknown,
  key: string,
  path: string,
): FallbackNumberRead {
  const property = fallbackProperty(value, key, path);
  if (!property.present || property.value === undefined || property.value === null)
    return { present: property.present, malformed: false };
  if (typeof property.value !== "number" || !Number.isFinite(property.value))
    return { present: true, malformed: true };
  return { present: true, value: property.value, malformed: false };
}

function fallbackBooleanProperty(value: unknown, key: string, path: string): FallbackBooleanRead {
  const property = fallbackProperty(value, key, path);
  if (!property.present || property.value === undefined || property.value === null)
    return { present: property.present, malformed: false };
  if (typeof property.value !== "boolean") return { present: true, malformed: true };
  return { present: true, value: property.value, malformed: false };
}

function fallbackStringArrayProperty(
  value: unknown,
  key: string,
  path: string,
  limits: RuntimeCaptureLimits,
): FallbackStringArrayRead {
  const property = fallbackProperty(value, key, path);
  if (!property.present || property.value === undefined || property.value === null)
    return { present: property.present, values: [], malformed: false, truncated: false };
  const array = fallbackArray(property.value, `${path}.${key}`);
  if (!array) return { present: true, values: [], malformed: true, truncated: false };
  const maxItems = 100;
  const values: string[] = [];
  let malformed = false;
  for (let index = 0; index < Math.min(array.length, maxItems); index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(array.value, String(index));
    } catch {
      throw new RuntimeCaptureExportError(`${path}.${key}[${index}] cannot be safely read`);
    }
    if (!descriptor) {
      malformed = true;
      continue;
    }
    if (!("value" in descriptor))
      throw new RuntimeCaptureExportError(`${path}.${key}[${index}] must be an own data property`);
    const next = fallbackSafeStringValue(descriptor.value, `${path}.${key}[${index}]`, limits);
    if (next === undefined) malformed = true;
    else values.push(next);
  }
  return {
    present: true,
    values,
    malformed,
    truncated: array.length > maxItems,
  };
}

function fallbackEnumerableKeys(
  value: Record<string, unknown>,
  path: string,
  maxItems: number,
): { keys: string[]; truncated: boolean } {
  try {
    const keys = Object.keys(value);
    return { keys: keys.slice(0, maxItems), truncated: keys.length > maxItems };
  } catch {
    throw new RuntimeCaptureExportError(`${path} keys cannot be safely read`);
  }
}

function fallbackHasOwnKnownKey(value: unknown, keys: readonly string[], path: string): boolean {
  return keys.some((key) => fallbackProperty(value, key, path).present);
}

function fallbackDisableSnapshot(value: unknown, path: string): boolean {
  const direct = fallbackBooleanProperty(value, "disableSnapshot", path);
  let disabled = direct.value === true;
  for (const containerKey of ["experiments", "vite"] as const) {
    const container = fallbackProperty(value, containerKey, path);
    if (!container.present || container.value === undefined || container.value === null) continue;
    const nested = fallbackBooleanProperty(
      container.value,
      "disableSnapshot",
      `${path}.${containerKey}`,
    );
    disabled ||= nested.value === true;
  }
  const config = fallbackProperty(value, "config", path);
  if (config.present && config.value !== undefined && config.value !== null) {
    const configDisabled = fallbackBooleanProperty(
      config.value,
      "disableSnapshot",
      `${path}.config`,
    );
    disabled ||= configDisabled.value === true;
    for (const containerKey of ["experiments", "vite"] as const) {
      const container = fallbackProperty(config.value, containerKey, `${path}.config`);
      if (!container.present || container.value === undefined || container.value === null) continue;
      const nested = fallbackBooleanProperty(
        container.value,
        "disableSnapshot",
        `${path}.config.${containerKey}`,
      );
      disabled ||= nested.value === true;
    }
  }
  return disabled;
}

function fallbackLooksLikeSnapshot(value: unknown, path: string): boolean {
  if (Array.isArray(value)) return true;
  return fallbackHasOwnKnownKey(value, FALLBACK_SNAPSHOT_KEYS, path);
}

function collectRuntimeCaptureFallbackSources(
  input: unknown,
  limits: RuntimeCaptureLimits,
): FallbackCollectedSources {
  if (!fallbackPlainRecord(input, "/"))
    throw new RuntimeCaptureExportError("Runtime fallback state must be a plain object");
  const sources: FallbackCollectedSources = {
    moduleInfoPresent: false,
    moduleInfoMalformed: false,
    instancesPresent: false,
    instancesMalformed: false,
    disableSnapshot: false,
  };
  const visited = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number): void => {
    const record = fallbackPlainRecord(value, path);
    if (!record || depth > 4) return;
    if (visited.has(record)) return;
    visited.add(record);

    const disabledHere = fallbackDisableSnapshot(record, path);
    if (disabledHere) sources.disableSnapshot = true;

    if (sources.runtimeVersion === undefined) {
      const runtimeVersion = fallbackStringProperty(record, "runtimeVersion", path, limits);
      if (runtimeVersion.value !== undefined) sources.runtimeVersion = runtimeVersion.value;
    }
    if (sources.hostName === undefined) {
      const hostName = fallbackStringProperty(record, "hostName", path, limits);
      if (hostName.value !== undefined) sources.hostName = hostName.value;
    }

    if (!sources.moduleInfoPresent && !sources.disableSnapshot && !disabledHere) {
      const moduleInfo = fallbackProperty(record, "moduleInfo", path);
      if (moduleInfo.present) {
        sources.moduleInfoPresent = true;
        sources.moduleInfo = { value: moduleInfo.value, path: `${path}.moduleInfo` };
        if (!fallbackLooksLikeSnapshot(moduleInfo.value, `${path}.moduleInfo`))
          sources.moduleInfoMalformed = true;
      } else {
        const entries = fallbackProperty(record, "entries", path);
        if (entries.present && fallbackLooksLikeSnapshot(entries.value, `${path}.entries`)) {
          sources.moduleInfoPresent = true;
          sources.moduleInfo = { value: entries.value, path: `${path}.entries` };
        } else {
          const snapshot = fallbackProperty(record, "snapshot", path);
          if (snapshot.present && fallbackLooksLikeSnapshot(snapshot.value, `${path}.snapshot`)) {
            sources.moduleInfoPresent = true;
            sources.moduleInfo = { value: snapshot.value, path: `${path}.snapshot` };
          }
        }
      }
    }

    if (!sources.instancesPresent) {
      for (const key of ["instances", "runtimeInstances", "runtimeInstance", "instance"] as const) {
        const instances = fallbackProperty(record, key, path);
        if (!instances.present) continue;
        sources.instancesPresent = true;
        sources.instance = { value: instances.value, path: `${path}.${key}` };
        if (instances.value === undefined || instances.value === null)
          sources.instancesMalformed = true;
        break;
      }
    }

    const needNested =
      (!sources.moduleInfoPresent && !sources.disableSnapshot) ||
      !sources.instancesPresent ||
      sources.runtimeVersion === undefined ||
      sources.hostName === undefined;
    if (!needNested || depth >= 4) return;
    for (const key of FALLBACK_WRAPPER_KEYS) {
      const nested = fallbackProperty(record, key, path);
      if (!nested.present || nested.value === undefined || nested.value === null) continue;
      if (nested.value === value) continue;
      visit(nested.value, `${path}.${key}`, depth + 1);
    }
  };

  visit(input, "/", 0);
  return sources;
}

function fallbackSnapshotValue(
  value: unknown,
  path: string,
  limits: RuntimeCaptureLimits,
  metadata?: { availableNames?: string[]; entryCount?: number },
): {
  value: RuntimeCaptureSnapshotValue;
  malformed: boolean;
  hasValue: boolean;
  truncated: boolean;
} {
  if (Array.isArray(value))
    return { value: {}, malformed: true, hasValue: false, truncated: false };
  const record = fallbackPlainRecord(value, path);
  if (!record) return { value: {}, malformed: true, hasValue: false, truncated: false };
  const result: RuntimeCaptureSnapshotValue = {};
  let malformed = false;
  let truncated = false;
  for (const key of ["name", "publicPath", "remoteEntry", "globalName"] as const) {
    const read = fallbackStringProperty(record, key, path, limits);
    malformed ||= read.malformed;
    if (read.value !== undefined) result[key] = read.value;
  }
  const availableNames = fallbackStringArrayProperty(record, "availableNames", path, limits);
  malformed ||= availableNames.malformed;
  truncated ||= availableNames.truncated;
  if (availableNames.values.length > 0) result.availableNames = availableNames.values;
  const entryCount = fallbackNumberProperty(record, "entryCount", path);
  malformed ||= entryCount.malformed;
  if (entryCount.value !== undefined) result.entryCount = entryCount.value;
  if (metadata?.availableNames?.length && result.availableNames === undefined)
    result.availableNames = [...metadata.availableNames];
  if (metadata?.entryCount !== undefined && result.entryCount === undefined)
    result.entryCount = metadata.entryCount;
  const hasValue = Object.keys(result).length > 0;
  return { value: result, malformed, hasValue, truncated };
}

function projectRuntimeCaptureSnapshots(
  source: FallbackSourceRef | undefined,
  limits: RuntimeCaptureLimits,
): FallbackSnapshotProjection {
  if (!source)
    return {
      values: [],
      clipped: false,
      malformed: false,
      truncated: false,
    };
  const array = fallbackArray(source.value, source.path);
  let malformed = false;
  let truncated = false;
  let sourceEntryCount: number | undefined;
  let sourceTotalCount: number | undefined;
  let clipped = false;
  let availableNames: string[] | undefined;
  let entryCount: number | undefined;
  let entries: unknown[] = [];
  if (array) {
    sourceEntryCount = array.length;
    entries = array.value;
  } else {
    const record = fallbackPlainRecord(source.value, source.path);
    if (!record) {
      return { values: [], clipped: false, malformed: true, truncated: false };
    }
    const names = fallbackStringArrayProperty(record, "availableNames", source.path, limits);
    malformed ||= names.malformed;
    truncated ||= names.truncated;
    if (names.values.length > 0) availableNames = names.values;
    const totalCount = fallbackNumberProperty(record, "totalCount", source.path);
    const matchedCount = fallbackNumberProperty(record, "matchedCount", source.path);
    const directEntryCount = fallbackNumberProperty(record, "entryCount", source.path);
    malformed ||= totalCount.malformed || matchedCount.malformed || directEntryCount.malformed;
    sourceTotalCount = totalCount.value ?? directEntryCount.value;
    entryCount = sourceTotalCount;
    const clippedValue = fallbackBooleanProperty(record, "clipped", source.path);
    malformed ||= clippedValue.malformed;
    clipped = clippedValue.value === true;
    const entriesProperty = fallbackProperty(record, "entries", source.path);
    if (entriesProperty.present) {
      const entriesArray = fallbackArray(entriesProperty.value, `${source.path}.entries`);
      if (!entriesArray) malformed = true;
      else {
        sourceEntryCount = entriesArray.length;
        entries = entriesArray.value;
        source.path = `${source.path}.entries`;
      }
    } else {
      entries = [source.value];
    }
  }
  const values: RuntimeCaptureSnapshotValue[] = [];
  const maxEntries = Math.min(limits.maxSnapshots, 500);
  if (entries.length > maxEntries) truncated = true;
  for (let index = 0; index < Math.min(entries.length, maxEntries); index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
    } catch {
      throw new RuntimeCaptureExportError(`${source.path}[${index}] cannot be safely read`);
    }
    if (!descriptor) {
      malformed = true;
      continue;
    }
    if (!("value" in descriptor))
      throw new RuntimeCaptureExportError(`${source.path}[${index}] must be an own data property`);
    const projected = fallbackSnapshotValue(
      descriptor.value,
      `${source.path}[${index}]`,
      limits,
      availableNames || entryCount !== undefined
        ? {
            ...(availableNames ? { availableNames } : {}),
            ...(entryCount !== undefined ? { entryCount } : {}),
          }
        : undefined,
    );
    malformed ||= projected.malformed;
    truncated ||= projected.truncated;
    if (projected.hasValue) values.push(projected.value);
  }
  if (values.length === 0 && !array) {
    const projected = fallbackSnapshotValue(source.value, source.path, limits, {
      ...(availableNames ? { availableNames } : {}),
      ...(entryCount !== undefined ? { entryCount } : {}),
    });
    malformed ||= projected.malformed;
    truncated ||= projected.truncated;
    if (projected.hasValue) values.push(projected.value);
  }
  return {
    values,
    ...(sourceEntryCount !== undefined ? { sourceEntryCount } : {}),
    ...(sourceTotalCount !== undefined ? { sourceTotalCount } : {}),
    clipped,
    malformed,
    truncated,
  };
}

function collectRuntimeCaptureFallbackInstances(
  source: FallbackSourceRef | undefined,
  limits: RuntimeCaptureLimits,
): {
  items: FallbackInstanceItem[];
  declaredCount: number;
  malformed: boolean;
  truncated: boolean;
} {
  if (!source) return { items: [], declaredCount: 0, malformed: false, truncated: false };
  const array = fallbackArray(source.value, source.path);
  if (array) {
    const maxItems = Math.min(limits.maxInstances, 100);
    const items: FallbackInstanceItem[] = [];
    let malformed = false;
    for (let index = 0; index < Math.min(array.length, maxItems); index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(array.value, String(index));
      } catch {
        throw new RuntimeCaptureExportError(`${source.path}[${index}] cannot be safely read`);
      }
      if (!descriptor) {
        malformed = true;
        continue;
      }
      if (!("value" in descriptor))
        throw new RuntimeCaptureExportError(
          `${source.path}[${index}] must be an own data property`,
        );
      if (!fallbackPlainRecord(descriptor.value, `${source.path}[${index}]`)) malformed = true;
      else items.push({ value: descriptor.value, path: `${source.path}[${index}]` });
    }
    return {
      items,
      declaredCount: array.length,
      malformed,
      truncated: array.length > maxItems,
    };
  }
  const record = fallbackPlainRecord(source.value, source.path);
  if (!record) return { items: [], declaredCount: 0, malformed: true, truncated: false };
  if (fallbackHasOwnKnownKey(record, FALLBACK_INSTANCE_KEYS, source.path))
    return {
      items: [{ value: record, path: source.path }],
      declaredCount: 1,
      malformed: false,
      truncated: false,
    };
  const maxItems = Math.min(limits.maxInstances, limits.maxObjectKeys, 100);
  const { keys, truncated } = fallbackEnumerableKeys(record, source.path, maxItems);
  const items: FallbackInstanceItem[] = [];
  let malformed = false;
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key) || SECRET_KEY.test(key)) {
      malformed = true;
      continue;
    }
    const property = fallbackProperty(record, key, source.path);
    if (!property.present) continue;
    if (!fallbackPlainRecord(property.value, `${source.path}.${key}`)) {
      malformed = true;
      continue;
    }
    items.push({ value: property.value, path: `${source.path}.${key}`, mapName: key });
  }
  return { items, declaredCount: Object.keys(record).length, malformed, truncated };
}

function projectRuntimeCaptureInstances(
  source: FallbackSourceRef | undefined,
  limits: RuntimeCaptureLimits,
  runtimeVersion: string | undefined,
  hostName: string | undefined,
): FallbackInstanceProjection {
  const collected = collectRuntimeCaptureFallbackInstances(source, limits);
  const values: RuntimeCaptureInstanceValue[] = [];
  let malformed = collected.malformed;
  let truncated = collected.truncated;
  for (const item of collected.items) {
    const record = fallbackPlainRecord(item.value, item.path);
    if (!record) {
      malformed = true;
      continue;
    }
    const value: RuntimeCaptureInstanceValue = {};
    const name = fallbackStringProperty(record, "name", item.path, limits);
    const instanceHost = fallbackStringProperty(record, "hostName", item.path, limits);
    const instanceVersion = fallbackStringProperty(record, "runtimeVersion", item.path, limits);
    malformed ||= name.malformed || instanceHost.malformed || instanceVersion.malformed;
    if (name.value !== undefined) value.name = name.value;
    else if (item.mapName !== undefined) {
      const mapName = fallbackSafeStringValue(item.mapName, `${item.path}.<map-key>`, limits);
      if (mapName !== undefined) value.name = mapName;
    }
    if (instanceHost.value !== undefined) value.hostName = instanceHost.value;
    else if (hostName !== undefined) value.hostName = hostName;
    if (instanceVersion.value !== undefined) value.runtimeVersion = instanceVersion.value;
    else if (runtimeVersion !== undefined) value.runtimeVersion = runtimeVersion;
    const remoteNames = fallbackStringArrayProperty(record, "remoteNames", item.path, limits);
    const shareScopes = fallbackStringArrayProperty(record, "shareScopes", item.path, limits);
    malformed ||= remoteNames.malformed || shareScopes.malformed;
    truncated ||= remoteNames.truncated || shareScopes.truncated;
    if (remoteNames.values.length > 0) value.remoteNames = remoteNames.values;
    if (shareScopes.values.length > 0) value.shareScopes = shareScopes.values;
    if (Object.keys(value).length > 0) values.push(value);
    else malformed = true;
  }
  return { values, declaredCount: collected.declaredCount, malformed, truncated };
}

function fallbackRecordCompleteness(
  source: "snapshot" | "instance",
  partial: boolean,
  expectedCount: number | undefined,
  observedCount: number | undefined,
  reason: string,
): EvidenceCompletenessInfo {
  return {
    status: partial ? "partial" : "complete",
    ...(expectedCount !== undefined ? { expectedCount } : {}),
    ...(observedCount !== undefined ? { observedCount } : {}),
    reason: `${source} fallback: ${reason}`,
  };
}

/**
 * Project a supplied runtime global/state snapshot without attaching to a
 * browser or invoking runtime APIs. Only documented, scalar/array fields are
 * copied; unknown runtime objects are intentionally ignored.
 */
export function importRuntimeCaptureFallback(
  input: unknown,
  options: RuntimeCaptureFallbackOptions = {},
): RuntimeCaptureEnvelope {
  try {
    const limits = { ...DEFAULT_RUNTIME_CAPTURE_LIMITS, ...options.limits };
    assertLimits(limits);
    const sources = collectRuntimeCaptureFallbackSources(input, limits);
    const optionRuntimeVersion =
      options.runtimeVersion === undefined
        ? undefined
        : fallbackSafeStringValue(options.runtimeVersion, "/options.runtimeVersion", limits);
    const optionHostName =
      options.hostName === undefined
        ? undefined
        : fallbackSafeStringValue(options.hostName, "/options.hostName", limits);
    const runtimeVersion = optionRuntimeVersion ?? sources.runtimeVersion;
    const hostName = optionHostName ?? sources.hostName;
    const disableSnapshot = options.disableSnapshot === true || sources.disableSnapshot;
    const snapshots = projectRuntimeCaptureSnapshots(
      disableSnapshot ? undefined : sources.moduleInfo,
      limits,
    );
    const instances = projectRuntimeCaptureInstances(
      sources.instance,
      limits,
      runtimeVersion,
      hostName,
    );
    const sourceDigest = createHash("sha256")
      .update(
        JSON.stringify({
          source: RUNTIME_FALLBACK_SOURCE_VERSION,
          runtimeVersion,
          hostName,
          disableSnapshot,
          snapshots: snapshots.values.map((value) =>
            runtimeCaptureContentDigest(value as unknown as EvidenceValue),
          ),
          instances: instances.values.map((value) =>
            runtimeCaptureContentDigest(value as unknown as EvidenceValue),
          ),
        }),
      )
      .digest("hex");
    const captureId =
      options.captureId === undefined
        ? `capture-${sourceDigest.slice(0, 16)}`
        : fallbackSafeStringValue(options.captureId, "/options.captureId", limits);
    if (!captureId) throw new RuntimeCaptureExportError("captureId must be a non-empty string");
    const navigationId =
      options.navigationId === undefined
        ? "navigation-1"
        : fallbackSafeStringValue(options.navigationId, "/options.navigationId", limits);
    const realmId =
      options.realmId === undefined
        ? "realm-top"
        : fallbackSafeStringValue(options.realmId, "/options.realmId", limits);
    const sourceScope =
      options.sourceScope === undefined
        ? "runtime-fallback"
        : fallbackSafeStringValue(options.sourceScope, "/options.sourceScope", limits);
    if (!navigationId || !realmId || !sourceScope)
      throw new RuntimeCaptureExportError("fallback identity fields must be non-empty strings");
    const capturedAt = options.capturedAt ?? 0;
    if (!Number.isFinite(capturedAt) || capturedAt < 0)
      throw new RuntimeCaptureExportError("capturedAt must be a non-negative finite number");
    const collectorName =
      options.collector?.name === undefined
        ? "mfdoctor-capture-fallback"
        : fallbackSafeStringValue(options.collector.name, "/options.collector.name", limits);
    const collectorVersion =
      options.collector?.version === undefined
        ? "1"
        : fallbackSafeStringValue(options.collector.version, "/options.collector.version", limits);
    if (!collectorName || !collectorVersion)
      throw new RuntimeCaptureExportError("collector name and version must be non-empty strings");
    const collector = { name: collectorName, version: collectorVersion };
    const location =
      options.location === undefined
        ? undefined
        : fallbackSafeStringValue(options.location, "/options.location", limits);
    const provenance = (): EvidenceProvenance => ({
      collector: { ...collector },
      inputKind: "runtime-fallback-state",
      source: "runtime-fallback",
      sourceSchemaVersion: RUNTIME_FALLBACK_SOURCE_VERSION,
      contentDigest: sourceDigest,
      ...(location ? { location } : {}),
    });
    let sequence = 0;
    const identity = (
      source: "snapshot" | "instance",
      value: RuntimeCaptureSnapshotValue | RuntimeCaptureInstanceValue,
    ): RuntimeCaptureIdentity => {
      const instanceValue =
        source === "instance" ? (value as RuntimeCaptureInstanceValue) : undefined;
      return {
        captureId,
        navigationId,
        realmId,
        sequence: sequence++,
        sourceScope,
        ...(runtimeVersion ? { runtimeVersion } : {}),
        ...(instanceValue?.hostName ? { hostName: instanceValue.hostName } : {}),
        ...(instanceValue?.name ? { instanceName: instanceValue.name } : {}),
      };
    };
    const snapshotPartial =
      snapshots.malformed ||
      snapshots.truncated ||
      snapshots.clipped ||
      snapshots.sourceEntryCount === undefined ||
      snapshots.sourceTotalCount === undefined ||
      (snapshots.sourceTotalCount !== undefined &&
        snapshots.sourceTotalCount !== snapshots.sourceEntryCount);
    const snapshotCompleteness = fallbackRecordCompleteness(
      "snapshot",
      snapshotPartial,
      snapshots.sourceTotalCount,
      snapshots.sourceEntryCount,
      snapshots.sourceEntryCount === undefined
        ? "the state exposed metadata but not a counted entry collection"
        : snapshots.clipped || snapshots.truncated
          ? "the source marked the snapshot clipped or the snapshot quota was reached"
          : snapshots.malformed
            ? "one or more allowlisted fields were malformed"
            : "the allowlisted snapshot entries matched the supplied source count",
    );
    const instancePartial = instances.malformed || instances.truncated;
    const instanceCompleteness = fallbackRecordCompleteness(
      "instance",
      instancePartial,
      instances.declaredCount,
      instances.values.length,
      instances.truncated
        ? "the runtime-instance collection exceeded the configured quota"
        : instances.malformed
          ? "one or more allowlisted runtime-instance fields were malformed"
          : "the allowlisted runtime-instance collection was read without mutation",
    );
    const snapshotRecords: RuntimeCaptureSnapshotRecord[] = snapshots.values.map((value) => {
      const recordIdentity = identity("snapshot", value);
      return {
        id: runtimeCaptureRecordId("snapshot", recordIdentity, value as unknown as EvidenceValue),
        identity: recordIdentity,
        source: "snapshot",
        capturedAt,
        contentDigest: runtimeCaptureContentDigest(value as unknown as EvidenceValue),
        provenance: provenance(),
        completeness: { ...snapshotCompleteness },
        value,
      };
    });
    const instanceRecords: RuntimeCaptureInstanceRecord[] = instances.values.map((value) => {
      const recordIdentity = identity("instance", value);
      return {
        id: runtimeCaptureRecordId("instance", recordIdentity, value as unknown as EvidenceValue),
        identity: recordIdentity,
        source: "instance",
        capturedAt,
        contentDigest: runtimeCaptureContentDigest(value as unknown as EvidenceValue),
        provenance: provenance(),
        completeness: { ...instanceCompleteness },
        value,
      };
    });
    const truncation: RuntimeCaptureTruncation[] = [];
    if (snapshots.truncated) {
      truncation.push({
        collection: "snapshot",
        dropped: Math.max(
          1,
          (snapshots.sourceEntryCount ?? snapshots.values.length) - limits.maxSnapshots,
        ),
        firstSequence: limits.maxSnapshots,
        reason: "The supplied snapshot entries exceeded maxSnapshots.",
      });
    }
    if (instances.truncated) {
      truncation.push({
        collection: "instance",
        dropped: Math.max(1, instances.declaredCount - limits.maxInstances),
        firstSequence: limits.maxInstances,
        reason: "The supplied runtime instances exceeded maxInstances.",
      });
    }
    const snapshotState: RuntimeCaptureCapability = disableSnapshot
      ? "not-applicable"
      : !sources.moduleInfoPresent
        ? "unavailable"
        : snapshots.values.length > 0 && !snapshotPartial
          ? "exact"
          : snapshots.values.length > 0
            ? "partial"
            : snapshots.malformed || sources.moduleInfoMalformed
              ? "unknown"
              : "partial";
    const instanceState: RuntimeCaptureCapability = !sources.instancesPresent
      ? "unavailable"
      : instances.values.length > 0 || (instances.declaredCount === 0 && !instances.malformed)
        ? instancePartial
          ? "partial"
          : "exact"
        : "unknown";
    const snapshotReason = disableSnapshot
      ? "The supplied runtime/config state explicitly disabled snapshot capability."
      : !sources.moduleInfoPresent
        ? "The supplied runtime state did not expose moduleInfo snapshot data."
        : snapshots.values.length === 0
          ? "moduleInfo was present, but no safe allowlisted snapshot entry was available."
          : snapshotState === "exact"
            ? "Allowlisted moduleInfo entries were read with a matching source count."
            : "Snapshot data was available, but the fallback projection is partial or malformed.";
    const instanceReason = !sources.instancesPresent
      ? "The supplied runtime state did not expose runtime-instance data."
      : instances.values.length === 0 && instances.declaredCount > 0
        ? "Runtime-instance data was present but no safe allowlisted instance could be projected."
        : instanceState === "exact"
          ? "Allowlisted runtime-instance fields were read without mutation."
          : "Runtime-instance data was available, but the fallback projection is partial or malformed.";
    const observations: RuntimeCaptureCapabilityInfo[] = [
      capability(
        "reports",
        "unavailable",
        "observability",
        "The runtime fallback input does not contain an Observability report export.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
      capability(
        "shared-lifecycle",
        "unavailable",
        "observability",
        runtimeVersion && /preview|canary|nightly/i.test(runtimeVersion)
          ? "The runtime version is preview-like; the fallback does not infer shared-lifecycle facts."
          : "The fallback does not infer shared-lifecycle facts from runtime globals.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
      capability(
        "snapshot",
        snapshotState,
        "snapshot",
        snapshotReason,
        sourceScope,
        sources.moduleInfoPresent || disableSnapshot
          ? RUNTIME_FALLBACK_SOURCE_VERSION
          : "not-present",
        runtimeVersion,
      ),
      capability(
        "instance",
        instanceState,
        "instance",
        instanceReason,
        sourceScope,
        sources.instancesPresent ? RUNTIME_FALLBACK_SOURCE_VERSION : "not-present",
        runtimeVersion,
      ),
      capability(
        "network-error",
        "unavailable",
        "network",
        "Network and runtime-error metadata are not inferred from fallback globals.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
      capability(
        "devtools",
        "unavailable",
        "devtools",
        "The fallback input is not an existing DevTools export.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
    ];
    const envelope: RuntimeCaptureEnvelope = {
      schemaVersion: 1,
      contractVersion: RUNTIME_CAPTURE_CONTRACT_VERSION,
      collector,
      transport: options.transport ?? "browser-debug",
      captureId,
      capabilities: { observations },
      limits,
      truncation,
      reports: [],
      events: [],
      devtools: [],
      snapshots: snapshotRecords,
      instances: instanceRecords,
      network: [],
      errors: [],
      relations: [],
    };
    validateRuntimeCaptureEnvelope(envelope);
    return envelope;
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError) throw error;
    throw new RuntimeCaptureExportError(
      `Runtime fallback projection failed capture validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const RUNTIME_NETWORK_FALLBACK_SOURCE_VERSION = "runtime-network-fallback-v1";
const NETWORK_FALLBACK_KIND_VALUES = [
  "manifest",
  "remote-entry",
  "preload",
  "chunk",
  "unknown",
] as const;
const NETWORK_FALLBACK_NETWORK_KEYS = ["network", "networkRecords", "requests", "fetches"] as const;
const NETWORK_FALLBACK_ERROR_KEYS = ["errors", "runtimeErrors", "errorRecords"] as const;

interface FallbackNetworkErrorSources {
  network?: FallbackSourceRef;
  networkPresent: boolean;
  networkMalformed: boolean;
  errors?: FallbackSourceRef;
  errorsPresent: boolean;
  errorsMalformed: boolean;
  runtimeVersion?: string;
  sourceScope?: string;
}

interface FallbackMetadataCollection {
  items: FallbackInstanceItem[];
  declaredCount: number;
  malformed: boolean;
  truncated: boolean;
}

interface FallbackTimestampRead {
  capturedAt: number;
  hasTimestamp: boolean;
  malformed: boolean;
}

interface FallbackNetworkProjection {
  value?: RuntimeCaptureNetworkValue;
  requestId?: string;
  locator?: string;
  capturedAt: number;
  hasTimestamp: boolean;
  partial: boolean;
}

interface FallbackErrorProjection {
  value?: RuntimeCaptureErrorValue;
  requestId?: string;
  locator?: string;
  capturedAt: number;
  hasTimestamp: boolean;
  partial: boolean;
}

interface FallbackLinkMeta {
  id: string;
  requestId?: string;
  locator?: string;
  capturedAt: number;
  hasTimestamp: boolean;
}

function fallbackFirstStringProperty(
  value: unknown,
  keys: readonly string[],
  path: string,
  limits: RuntimeCaptureLimits,
  maxLength = limits.maxStringLength,
): FallbackStringRead {
  let present = false;
  let malformed = false;
  for (const key of keys) {
    const read = fallbackStringProperty(value, key, path, limits, maxLength);
    present ||= read.present;
    malformed ||= read.malformed;
    if (read.value !== undefined) return { present: true, value: read.value, malformed };
  }
  return { present, malformed };
}

function fallbackTimestamp(
  value: unknown,
  path: string,
  defaultCapturedAt: number,
): FallbackTimestampRead {
  let malformed = false;
  for (const key of ["capturedAt", "timestamp", "startedAt"] as const) {
    const read = fallbackNumberProperty(value, key, path);
    malformed ||= read.malformed;
    if (read.value !== undefined) return { capturedAt: read.value, hasTimestamp: true, malformed };
  }
  return { capturedAt: defaultCapturedAt, hasTimestamp: false, malformed };
}

function collectRuntimeCaptureNetworkErrorSources(
  input: unknown,
  limits: RuntimeCaptureLimits,
): FallbackNetworkErrorSources {
  if (!fallbackPlainRecord(input, "/"))
    throw new RuntimeCaptureExportError("Runtime network/error state must be a plain object");
  const sources: FallbackNetworkErrorSources = {
    networkPresent: false,
    networkMalformed: false,
    errorsPresent: false,
    errorsMalformed: false,
  };
  const visited = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number): void => {
    const record = fallbackPlainRecord(value, path);
    if (!record || depth > 4) return;
    if (visited.has(record)) return;
    visited.add(record);
    if (sources.runtimeVersion === undefined) {
      const runtimeVersion = fallbackStringProperty(record, "runtimeVersion", path, limits);
      if (runtimeVersion.value !== undefined) sources.runtimeVersion = runtimeVersion.value;
    }
    if (sources.sourceScope === undefined) {
      const sourceScope = fallbackStringProperty(record, "sourceScope", path, limits);
      if (sourceScope.value !== undefined) sources.sourceScope = sourceScope.value;
    }
    if (!sources.networkPresent) {
      for (const key of NETWORK_FALLBACK_NETWORK_KEYS) {
        const property = fallbackProperty(record, key, path);
        if (!property.present) continue;
        sources.networkPresent = true;
        sources.network = { value: property.value, path: `${path}.${key}` };
        if (property.value === undefined || property.value === null)
          sources.networkMalformed = true;
        break;
      }
    }
    if (!sources.errorsPresent) {
      for (const key of NETWORK_FALLBACK_ERROR_KEYS) {
        const property = fallbackProperty(record, key, path);
        if (!property.present) continue;
        sources.errorsPresent = true;
        sources.errors = { value: property.value, path: `${path}.${key}` };
        if (property.value === undefined || property.value === null) sources.errorsMalformed = true;
        break;
      }
    }
    if (
      sources.networkPresent &&
      sources.errorsPresent &&
      sources.runtimeVersion &&
      sources.sourceScope
    )
      return;
    if (depth >= 4) return;
    for (const key of FALLBACK_WRAPPER_KEYS) {
      const nested = fallbackProperty(record, key, path);
      if (!nested.present || nested.value === undefined || nested.value === null) continue;
      if (nested.value === value) continue;
      visit(nested.value, `${path}.${key}`, depth + 1);
    }
  };
  visit(input, "/", 0);
  return sources;
}

function collectRuntimeCaptureMetadataItems(
  source: FallbackSourceRef | undefined,
  knownKeys: readonly string[],
  maxItems: number,
): FallbackMetadataCollection {
  if (!source) return { items: [], declaredCount: 0, malformed: false, truncated: false };
  const array = fallbackArray(source.value, source.path);
  if (array) {
    const items: FallbackInstanceItem[] = [];
    let malformed = false;
    for (let index = 0; index < Math.min(array.length, maxItems); index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(array.value, String(index));
      } catch {
        throw new RuntimeCaptureExportError(`${source.path}[${index}] cannot be safely read`);
      }
      if (!descriptor) {
        malformed = true;
        continue;
      }
      if (!("value" in descriptor))
        throw new RuntimeCaptureExportError(
          `${source.path}[${index}] must be an own data property`,
        );
      if (!fallbackPlainRecord(descriptor.value, `${source.path}[${index}]`)) {
        malformed = true;
        continue;
      }
      items.push({ value: descriptor.value, path: `${source.path}[${index}]` });
    }
    return {
      items,
      declaredCount: array.length,
      malformed,
      truncated: array.length > maxItems,
    };
  }
  const record = fallbackPlainRecord(source.value, source.path);
  if (!record) return { items: [], declaredCount: 0, malformed: true, truncated: false };
  if (!fallbackHasOwnKnownKey(record, knownKeys, source.path))
    return { items: [], declaredCount: 0, malformed: true, truncated: false };
  return {
    items: [{ value: record, path: source.path }],
    declaredCount: 1,
    malformed: false,
    truncated: false,
  };
}

function projectRuntimeCaptureNetworkRecord(
  item: FallbackInstanceItem,
  limits: RuntimeCaptureLimits,
  defaultCapturedAt: number,
): FallbackNetworkProjection {
  const record = fallbackPlainRecord(item.value, item.path);
  if (!record) return { capturedAt: defaultCapturedAt, hasTimestamp: false, partial: true };
  let partial = false;
  const url = fallbackFirstStringProperty(record, ["url", "requestUrl"], item.path, limits);
  partial ||= url.malformed;
  const timestamp = fallbackTimestamp(record, item.path, defaultCapturedAt);
  partial ||= timestamp.malformed;
  const requestId = fallbackStringProperty(record, "requestId", item.path, limits);
  partial ||= requestId.malformed;
  if (url.value === undefined)
    return {
      capturedAt: timestamp.capturedAt,
      hasTimestamp: timestamp.hasTimestamp,
      partial: true,
    };
  const rawKind = fallbackStringProperty(record, "kind", item.path, limits);
  partial ||= rawKind.malformed || rawKind.value === undefined;
  const kind = NETWORK_FALLBACK_KIND_VALUES.includes(
    rawKind.value as (typeof NETWORK_FALLBACK_KIND_VALUES)[number],
  )
    ? (rawKind.value as RuntimeCaptureNetworkValue["kind"])
    : "unknown";
  if (rawKind.value !== undefined && kind === "unknown" && rawKind.value !== "unknown")
    partial = true;
  const status = fallbackNumberProperty(record, "status", item.path);
  partial ||= status.malformed || (status.value !== undefined && status.value > 999);
  const duration = fallbackFiniteNumberProperty(record, "durationMs", item.path);
  partial ||= duration.malformed || (duration.value !== undefined && duration.value < 0);
  const failureClass = fallbackStringProperty(record, "failureClass", item.path, limits);
  const initiatorClass = fallbackStringProperty(record, "initiatorClass", item.path, limits);
  partial ||= failureClass.malformed || initiatorClass.malformed;
  const value: RuntimeCaptureNetworkValue = {
    url: url.value,
    kind,
    ...(status.value !== undefined && status.value <= 999 ? { status: status.value } : {}),
    ...(failureClass.value ? { failureClass: failureClass.value } : {}),
    ...(duration.value !== undefined && duration.value >= 0 ? { durationMs: duration.value } : {}),
    ...(initiatorClass.value ? { initiatorClass: initiatorClass.value } : {}),
  };
  return {
    value,
    ...(requestId.value ? { requestId: requestId.value } : {}),
    locator: value.url,
    capturedAt: timestamp.capturedAt,
    hasTimestamp: timestamp.hasTimestamp,
    partial,
  };
}

function projectRuntimeCaptureErrorRecord(
  item: FallbackInstanceItem,
  limits: RuntimeCaptureLimits,
  defaultCapturedAt: number,
  defaultRuntimeVersion: string | undefined,
): FallbackErrorProjection {
  const record = fallbackPlainRecord(item.value, item.path);
  if (!record) return { capturedAt: defaultCapturedAt, hasTimestamp: false, partial: true };
  let partial = false;
  const timestamp = fallbackTimestamp(record, item.path, defaultCapturedAt);
  partial ||= timestamp.malformed;
  const requestId = fallbackStringProperty(record, "requestId", item.path, limits);
  const locator = fallbackFirstStringProperty(record, ["url", "requestUrl"], item.path, limits);
  partial ||= requestId.malformed || locator.malformed;
  const code = fallbackFirstStringProperty(record, ["code", "errorCode"], item.path, limits);
  const name = fallbackFirstStringProperty(record, ["name", "errorName"], item.path, limits);
  const message = fallbackFirstStringProperty(
    record,
    ["message", "errorMessage"],
    item.path,
    limits,
    limits.maxDiagnosisStringLength,
  );
  const phase = fallbackFirstStringProperty(record, ["phase", "failedPhase"], item.path, limits);
  const runtimeVersion = fallbackStringProperty(record, "runtimeVersion", item.path, limits);
  partial ||=
    code.malformed ||
    name.malformed ||
    message.malformed ||
    phase.malformed ||
    runtimeVersion.malformed;
  const hasErrorField = Boolean(code.value || name.value || message.value || phase.value);
  const projectedRuntimeVersion =
    runtimeVersion.value ?? (hasErrorField ? defaultRuntimeVersion : undefined);
  const value: RuntimeCaptureErrorValue = {
    ...(code.value ? { code: code.value } : {}),
    ...(name.value ? { name: name.value } : {}),
    ...(message.value ? { message: message.value } : {}),
    ...(phase.value ? { phase: phase.value } : {}),
    ...(projectedRuntimeVersion ? { runtimeVersion: projectedRuntimeVersion } : {}),
  };
  if (Object.keys(value).length === 0)
    return {
      capturedAt: timestamp.capturedAt,
      hasTimestamp: timestamp.hasTimestamp,
      partial: true,
    };
  return {
    value,
    ...(requestId.value ? { requestId: requestId.value } : {}),
    ...(locator.value ? { locator: locator.value } : {}),
    capturedAt: timestamp.capturedAt,
    hasTimestamp: timestamp.hasTimestamp,
    partial,
  };
}

function fallbackMetadataCompleteness(
  source: "network" | "error",
  partial: boolean,
  expectedCount: number,
  observedCount: number,
  reason: string,
): EvidenceCompletenessInfo {
  return {
    status: partial ? "partial" : "complete",
    expectedCount,
    observedCount,
    reason: `${source} fallback: ${reason}`,
  };
}

function fallbackNetworkErrorRelation(
  network: FallbackLinkMeta[],
  error: FallbackLinkMeta,
  timeWindowMs: number,
): RuntimeCaptureRelationRecord | undefined {
  const sameRequest = error.requestId
    ? network.find((item) => item.requestId === error.requestId)
    : undefined;
  if (sameRequest)
    return {
      id: relationId(sameRequest.id, error.id),
      from: sameRequest.id,
      to: error.id,
      relation: "exact-id",
      reason: "The supplied network and error metadata shared an exact requestId.",
    };
  const sameLocator = error.locator
    ? network.find((item) => item.locator === error.locator)
    : undefined;
  if (sameLocator)
    return {
      id: relationId(sameLocator.id, error.id),
      from: sameLocator.id,
      to: error.id,
      relation: "exact-safe-locator",
      reason: "The supplied network and error metadata shared an exact redacted URL locator.",
    };
  if (!error.hasTimestamp) return undefined;
  const candidate = network
    .filter(
      (item) => item.hasTimestamp && Math.abs(item.capturedAt - error.capturedAt) <= timeWindowMs,
    )
    .sort(
      (left, right) =>
        Math.abs(left.capturedAt - error.capturedAt) -
          Math.abs(right.capturedAt - error.capturedAt) || left.id.localeCompare(right.id),
    )[0];
  if (!candidate) return undefined;
  return {
    id: relationId(candidate.id, error.id),
    from: candidate.id,
    to: error.id,
    relation: "time-window-candidate",
    reason: `The supplied records were within the configured ${timeWindowMs}ms window but had no exact identity or locator match.`,
  };
}

/** Project supplied MF-focused network/error metadata without live network access. */
export function importRuntimeCaptureNetworkFallback(
  input: unknown,
  options: RuntimeCaptureNetworkFallbackOptions = {},
): RuntimeCaptureEnvelope {
  try {
    const limits = { ...DEFAULT_RUNTIME_CAPTURE_LIMITS, ...options.limits };
    assertLimits(limits);
    const sources = collectRuntimeCaptureNetworkErrorSources(input, limits);
    const runtimeVersion =
      options.runtimeVersion === undefined
        ? sources.runtimeVersion
        : fallbackSafeStringValue(options.runtimeVersion, "/options.runtimeVersion", limits);
    const sourceScope =
      options.sourceScope === undefined
        ? (sources.sourceScope ?? "runtime-network-fallback")
        : fallbackSafeStringValue(options.sourceScope, "/options.sourceScope", limits);
    if (!sourceScope) throw new RuntimeCaptureExportError("sourceScope must be a non-empty string");
    const capturedAt = options.capturedAt ?? 0;
    if (!Number.isFinite(capturedAt) || capturedAt < 0)
      throw new RuntimeCaptureExportError("capturedAt must be a non-negative finite number");
    const timeWindowMs = options.timeWindowMs ?? 5_000;
    if (!Number.isSafeInteger(timeWindowMs) || timeWindowMs < 0 || timeWindowMs > 60_000)
      throw new RuntimeCaptureExportError("timeWindowMs must be an integer from 0 through 60000");
    const networkItems = collectRuntimeCaptureMetadataItems(
      sources.network,
      ["url", "requestUrl", "kind"],
      limits.maxNetworkRecords,
    );
    const errorItems = collectRuntimeCaptureMetadataItems(
      sources.errors,
      ["code", "errorCode", "name", "errorName", "message", "errorMessage", "phase", "failedPhase"],
      limits.maxErrors,
    );
    const networkProjections = networkItems.items.map((item) =>
      projectRuntimeCaptureNetworkRecord(item, limits, capturedAt),
    );
    const errorProjections = errorItems.items.map((item) =>
      projectRuntimeCaptureErrorRecord(item, limits, capturedAt, runtimeVersion),
    );
    const sourceDigest = createHash("sha256")
      .update(
        JSON.stringify({
          source: RUNTIME_NETWORK_FALLBACK_SOURCE_VERSION,
          runtimeVersion,
          sourceScope,
          network: networkProjections.map((projection) => ({
            value: projection.value,
            requestId: projection.requestId,
            locator: projection.locator,
            capturedAt: projection.capturedAt,
          })),
          errors: errorProjections.map((projection) => ({
            value: projection.value,
            requestId: projection.requestId,
            locator: projection.locator,
            capturedAt: projection.capturedAt,
          })),
        }),
      )
      .digest("hex");
    const captureId =
      options.captureId === undefined
        ? `capture-${sourceDigest.slice(0, 16)}`
        : fallbackSafeStringValue(options.captureId, "/options.captureId", limits);
    if (!captureId) throw new RuntimeCaptureExportError("captureId must be a non-empty string");
    const navigationId =
      options.navigationId === undefined
        ? "navigation-1"
        : fallbackSafeStringValue(options.navigationId, "/options.navigationId", limits);
    const realmId =
      options.realmId === undefined
        ? "realm-top"
        : fallbackSafeStringValue(options.realmId, "/options.realmId", limits);
    if (!navigationId || !realmId)
      throw new RuntimeCaptureExportError("fallback identity fields must be non-empty strings");
    const collectorName =
      options.collector?.name === undefined
        ? "mfdoctor-capture-network-fallback"
        : fallbackSafeStringValue(options.collector.name, "/options.collector.name", limits);
    const collectorVersion =
      options.collector?.version === undefined
        ? "1"
        : fallbackSafeStringValue(options.collector.version, "/options.collector.version", limits);
    if (!collectorName || !collectorVersion)
      throw new RuntimeCaptureExportError("collector name and version must be non-empty strings");
    const collector = { name: collectorName, version: collectorVersion };
    const location =
      options.location === undefined
        ? undefined
        : fallbackSafeStringValue(options.location, "/options.location", limits);
    const provenance = (): EvidenceProvenance => ({
      collector: { ...collector },
      inputKind: "runtime-network-error-fallback",
      source: "runtime-network-fallback",
      sourceSchemaVersion: RUNTIME_NETWORK_FALLBACK_SOURCE_VERSION,
      contentDigest: sourceDigest,
      ...(location ? { location } : {}),
    });
    let sequence = 0;
    const nextIdentity = (
      requestId: string | undefined,
      recordRuntimeVersion?: string,
    ): RuntimeCaptureIdentity => {
      const identityRuntimeVersion = recordRuntimeVersion ?? runtimeVersion;
      return {
        captureId,
        navigationId,
        realmId,
        sequence: sequence++,
        sourceScope,
        ...(identityRuntimeVersion ? { runtimeVersion: identityRuntimeVersion } : {}),
        ...(requestId ? { requestId } : {}),
      };
    };
    const networkPartial =
      sources.networkMalformed ||
      networkItems.malformed ||
      networkItems.truncated ||
      networkProjections.some((item) => item.partial);
    const errorPartial =
      sources.errorsMalformed ||
      errorItems.malformed ||
      errorItems.truncated ||
      errorProjections.some((item) => item.partial);
    const networkCompleteness = fallbackMetadataCompleteness(
      "network",
      networkPartial,
      networkItems.declaredCount,
      networkProjections.filter((item) => item.value).length,
      networkItems.truncated
        ? "the network collection exceeded maxNetworkRecords"
        : networkPartial
          ? "one or more network records were malformed or incompletely classified"
          : "allowlisted network metadata was read without retaining request internals",
    );
    const errorCompleteness = fallbackMetadataCompleteness(
      "error",
      errorPartial,
      errorItems.declaredCount,
      errorProjections.filter((item) => item.value).length,
      errorItems.truncated
        ? "the error collection exceeded maxErrors"
        : errorPartial
          ? "one or more error records were malformed or incomplete"
          : "allowlisted runtime-error metadata was read without retaining raw stacks",
    );
    const networkRecords: RuntimeCaptureNetworkRecord[] = [];
    const networkLinks: FallbackLinkMeta[] = [];
    for (const projection of networkProjections) {
      if (!projection.value) continue;
      const recordIdentity = nextIdentity(projection.requestId);
      const record: RuntimeCaptureNetworkRecord = {
        id: runtimeCaptureRecordId(
          "network",
          recordIdentity,
          projection.value as unknown as EvidenceValue,
        ),
        identity: recordIdentity,
        source: "network",
        capturedAt: projection.capturedAt,
        contentDigest: runtimeCaptureContentDigest(projection.value as unknown as EvidenceValue),
        provenance: provenance(),
        completeness: { ...networkCompleteness },
        value: projection.value,
      };
      networkRecords.push(record);
      networkLinks.push({
        id: record.id,
        ...(projection.requestId ? { requestId: projection.requestId } : {}),
        ...(projection.locator ? { locator: projection.locator } : {}),
        capturedAt: projection.capturedAt,
        hasTimestamp: projection.hasTimestamp,
      });
    }
    const errorRecords: RuntimeCaptureErrorRecord[] = [];
    const errorLinks: FallbackLinkMeta[] = [];
    for (const projection of errorProjections) {
      if (!projection.value) continue;
      const recordIdentity = nextIdentity(projection.requestId, projection.value.runtimeVersion);
      const record: RuntimeCaptureErrorRecord = {
        id: runtimeCaptureRecordId(
          "error",
          recordIdentity,
          projection.value as unknown as EvidenceValue,
        ),
        identity: recordIdentity,
        source: "error",
        capturedAt: projection.capturedAt,
        contentDigest: runtimeCaptureContentDigest(projection.value as unknown as EvidenceValue),
        provenance: provenance(),
        completeness: { ...errorCompleteness },
        value: projection.value,
      };
      errorRecords.push(record);
      errorLinks.push({
        id: record.id,
        ...(projection.requestId ? { requestId: projection.requestId } : {}),
        ...(projection.locator ? { locator: projection.locator } : {}),
        capturedAt: projection.capturedAt,
        hasTimestamp: projection.hasTimestamp,
      });
    }
    const truncation: RuntimeCaptureTruncation[] = [];
    if (networkItems.truncated)
      truncation.push({
        collection: "network",
        dropped: Math.max(1, networkItems.declaredCount - limits.maxNetworkRecords),
        firstSequence: limits.maxNetworkRecords,
        reason: "The supplied network metadata exceeded maxNetworkRecords.",
      });
    if (errorItems.truncated)
      truncation.push({
        collection: "error",
        dropped: Math.max(1, errorItems.declaredCount - limits.maxErrors),
        firstSequence: limits.maxErrors,
        reason: "The supplied error metadata exceeded maxErrors.",
      });
    const networkState: RuntimeCaptureCapability = !sources.networkPresent
      ? "unavailable"
      : networkRecords.length === 0 && networkPartial
        ? "unknown"
        : networkPartial
          ? "partial"
          : "exact";
    const errorState: RuntimeCaptureCapability = !sources.errorsPresent
      ? "unavailable"
      : errorRecords.length === 0 && errorPartial
        ? "unknown"
        : errorPartial
          ? "partial"
          : "exact";
    const observations: RuntimeCaptureCapabilityInfo[] = [
      capability(
        "reports",
        "unavailable",
        "observability",
        "The network/error fallback input does not contain an Observability report export.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
      capability(
        "shared-lifecycle",
        "unavailable",
        "observability",
        "The network/error fallback does not infer shared-lifecycle facts.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
      capability(
        "snapshot",
        "unavailable",
        "snapshot",
        "Snapshot data is not projected by the network/error fallback.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
      capability(
        "instance",
        "unavailable",
        "instance",
        "Runtime-instance data is not projected by the network/error fallback.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
      capability(
        "network-error",
        networkState,
        "network",
        !sources.networkPresent
          ? "The supplied state did not expose network metadata."
          : networkState === "exact"
            ? "Allowlisted network metadata was projected without retaining request internals."
            : "Network metadata was available, but the projection is partial or malformed.",
        sourceScope,
        sources.networkPresent ? RUNTIME_NETWORK_FALLBACK_SOURCE_VERSION : "not-present",
        runtimeVersion,
      ),
      capability(
        "network-error",
        errorState,
        "error",
        !sources.errorsPresent
          ? "The supplied state did not expose runtime-error metadata."
          : errorState === "exact"
            ? "Allowlisted runtime-error metadata was projected without retaining raw stacks."
            : "Runtime-error metadata was available, but the projection is partial or malformed.",
        sourceScope,
        sources.errorsPresent ? RUNTIME_NETWORK_FALLBACK_SOURCE_VERSION : "not-present",
        runtimeVersion,
      ),
      capability(
        "devtools",
        "unavailable",
        "devtools",
        "The network/error fallback input is not an existing DevTools export.",
        sourceScope,
        "not-present",
        runtimeVersion,
      ),
    ];
    const relations = errorLinks.flatMap((error) => {
      const relation = fallbackNetworkErrorRelation(networkLinks, error, timeWindowMs);
      return relation ? [relation] : [];
    });
    const envelope: RuntimeCaptureEnvelope = {
      schemaVersion: 1,
      contractVersion: RUNTIME_CAPTURE_CONTRACT_VERSION,
      collector,
      transport: options.transport ?? "browser-debug",
      captureId,
      capabilities: { observations },
      limits,
      truncation,
      reports: [],
      events: [],
      devtools: [],
      snapshots: [],
      instances: [],
      network: networkRecords,
      errors: errorRecords,
      relations,
    };
    validateRuntimeCaptureEnvelope(envelope);
    return envelope;
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError) throw error;
    throw new RuntimeCaptureExportError(
      `Runtime network/error fallback failed capture validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** An explicitly selected browser target; no target is selected implicitly. */
export interface RuntimeCaptureBrowserTarget {
  id: string;
  url?: string;
}

export type RuntimeCaptureBrowserMode = "attach" | "launch";

export interface RuntimeCaptureBrowserConnectOptions {
  mode: RuntimeCaptureBrowserMode;
  target: RuntimeCaptureBrowserTarget;
  signal?: AbortSignal;
}

/** Session/navigation/realm identity supplied by the external browser connector. */
export interface RuntimeCaptureBrowserScope {
  sessionId: string;
  targetId: string;
  navigationId: string;
  realmId: string;
  sourceScope?: string;
  capturedAt?: number;
}

export interface RuntimeCaptureBrowserReadRequest {
  target: RuntimeCaptureBrowserTarget;
  scope: RuntimeCaptureBrowserScope;
  signal?: AbortSignal;
}

/**
 * Narrow read-only connector contract for an external browser tool. The
 * connector owns Playwright/CDP/browser lifecycle details; MFDoctor receives
 * only an existing official export and never evaluates arbitrary page code.
 */
export interface RuntimeCaptureBrowserConnection {
  scope: RuntimeCaptureBrowserScope | Promise<RuntimeCaptureBrowserScope>;
  readObservabilityExport?: (
    request: RuntimeCaptureBrowserReadRequest,
  ) => Promise<unknown> | unknown;
  readDevtoolsExport?: (request: RuntimeCaptureBrowserReadRequest) => Promise<unknown> | unknown;
  close: () => Promise<void> | void;
}

export interface RuntimeCaptureBrowserConnector {
  attach: (
    options: RuntimeCaptureBrowserConnectOptions,
  ) => Promise<RuntimeCaptureBrowserConnection>;
  launch: (
    options: RuntimeCaptureBrowserConnectOptions,
  ) => Promise<RuntimeCaptureBrowserConnection>;
}

export interface RuntimeCaptureBrowserCaptureOptions {
  mode: RuntimeCaptureBrowserMode;
  target: RuntimeCaptureBrowserTarget;
  /** Capture is never implicit; callers must prove an explicit user approval. */
  userApproved: true;
  adapter?: "observability" | "devtools";
  captureId?: string;
  sourceScope?: string;
  capturedAt?: number;
  collector?: { name: string; version: string };
  limits?: Partial<RuntimeCaptureLimits>;
  signal?: AbortSignal;
}

function browserIdentityValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new RuntimeCaptureExportError(`${label} must be a non-empty string`);
  const redacted = redactEvidenceValue(value);
  if (typeof redacted !== "string" || redacted.length === 0)
    throw new RuntimeCaptureExportError(`${label} is not safe to persist`);
  return redacted;
}

function browserTarget(target: RuntimeCaptureBrowserTarget): RuntimeCaptureBrowserTarget {
  if (!isObject(target)) throw new RuntimeCaptureExportError("browser target must be an object");
  assertKnownKeys(target, new Set(["id", "url"]), "/browser/target");
  ownDataEntries(target, "/browser/target");
  const id = browserIdentityValue(target?.id, "browser target id");
  if (target.url === undefined) return { id };
  if (typeof target.url !== "string" || target.url.length === 0)
    throw new RuntimeCaptureExportError("browser target url must be a non-empty string");
  let parsed: URL;
  try {
    parsed = new URL(target.url);
  } catch {
    throw new RuntimeCaptureExportError("browser target url must be a valid URL");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol))
    throw new RuntimeCaptureExportError("browser target url must use http or https");
  if (parsed.username || parsed.password)
    throw new RuntimeCaptureExportError("browser target url must not contain credentials");
  if ([...parsed.searchParams.keys()].some((key) => SECRET_KEY.test(key)))
    throw new RuntimeCaptureExportError("browser target url must not contain secret query keys");
  return { id, url: parsed.toString() };
}

function browserScope(
  scope: RuntimeCaptureBrowserScope,
  target: RuntimeCaptureBrowserTarget,
): RuntimeCaptureBrowserScope {
  if (!scope || typeof scope !== "object")
    throw new RuntimeCaptureExportError("browser connector did not provide a scope");
  assertKnownKeys(
    scope,
    new Set(["sessionId", "targetId", "navigationId", "realmId", "sourceScope", "capturedAt"]),
    "/browser/scope",
  );
  ownDataEntries(scope, "/browser/scope");
  const targetId = browserIdentityValue(scope.targetId, "browser scope targetId");
  if (targetId !== target.id)
    throw new RuntimeCaptureExportError(
      "browser scope targetId does not match the selected target",
    );
  const normalized: RuntimeCaptureBrowserScope = {
    sessionId: browserIdentityValue(scope.sessionId, "browser scope sessionId"),
    targetId,
    navigationId: browserIdentityValue(scope.navigationId, "browser scope navigationId"),
    realmId: browserIdentityValue(scope.realmId, "browser scope realmId"),
    ...(scope.sourceScope !== undefined
      ? { sourceScope: browserIdentityValue(scope.sourceScope, "browser scope sourceScope") }
      : {}),
  };
  const capturedAt = scope.capturedAt;
  if (capturedAt !== undefined) {
    if (!Number.isFinite(capturedAt) || capturedAt < 0)
      throw new RuntimeCaptureExportError("browser scope capturedAt must be non-negative");
    normalized.capturedAt = capturedAt;
  }
  return normalized;
}

function assertBrowserCaptureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RuntimeCaptureExportError("browser capture was aborted");
}

/**
 * Attach to or launch one explicitly approved browser target and read one
 * existing official export. The connector is deliberately capability-shaped:
 * it has no arbitrary evaluate method, and this function calls only the
 * recognized Observability/DevTools readers before always closing the session.
 */
export async function captureRuntimeBrowserExport(
  connector: RuntimeCaptureBrowserConnector,
  options: RuntimeCaptureBrowserCaptureOptions,
): Promise<RuntimeCaptureEnvelope> {
  if (options.userApproved !== true)
    throw new RuntimeCaptureExportError("browser capture requires explicit user approval");
  const target = browserTarget(options.target);
  assertBrowserCaptureNotAborted(options.signal);
  if (options.mode !== "attach" && options.mode !== "launch")
    throw new RuntimeCaptureExportError("browser capture mode must be attach or launch");
  const connect = connector?.[options.mode];
  if (typeof connect !== "function")
    throw new RuntimeCaptureExportError(`browser connector does not support ${options.mode}`);
  let connection: RuntimeCaptureBrowserConnection;
  try {
    connection = await connect.call(connector, {
      mode: options.mode,
      target,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError) throw error;
    throw new RuntimeCaptureExportError(
      `Unable to ${options.mode} browser target: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let operationError: unknown;
  let operationFailed = false;
  let closeError: unknown;
  let closeFailed = false;
  let result: RuntimeCaptureEnvelope | undefined;
  try {
    assertBrowserCaptureNotAborted(options.signal);
    if (!connection || typeof connection !== "object" || typeof connection.close !== "function")
      throw new RuntimeCaptureExportError("browser connector returned an invalid connection");
    const scope = browserScope(await connection.scope, target);
    assertBrowserCaptureNotAborted(options.signal);
    const requestedAdapter = options.adapter;
    let adapter = requestedAdapter;
    if (adapter === undefined)
      adapter = connection.readObservabilityExport ? "observability" : "devtools";
    const read =
      adapter === "observability"
        ? connection.readObservabilityExport
        : connection.readDevtoolsExport;
    if (!read)
      throw new RuntimeCaptureExportError(`browser target has no ${adapter} export reader`);
    const request: RuntimeCaptureBrowserReadRequest = {
      target,
      scope,
      ...(options.signal ? { signal: options.signal } : {}),
    };
    let rawExport = await read.call(connection, request);
    if (rawExport === undefined && requestedAdapter === undefined && adapter === "observability") {
      if (!connection.readDevtoolsExport)
        throw new RuntimeCaptureExportError("browser target returned no Observability export");
      adapter = "devtools";
      rawExport = await connection.readDevtoolsExport(request);
    }
    assertBrowserCaptureNotAborted(options.signal);
    const captureId = options.captureId
      ? browserIdentityValue(options.captureId, "captureId")
      : `browser-${browserIdentityValue(scope.sessionId, "browser scope sessionId")}`;
    const sourceScope =
      options.sourceScope !== undefined
        ? browserIdentityValue(options.sourceScope, "sourceScope")
        : scope.sourceScope;
    result = await importRuntimeCaptureExport(rawExport, {
      adapter,
      transport: "browser-debug",
      captureId,
      navigationId: scope.navigationId,
      realmId: scope.realmId,
      ...(sourceScope ? { sourceScope } : {}),
      ...(scope.capturedAt !== undefined
        ? { capturedAt: scope.capturedAt }
        : options.capturedAt !== undefined
          ? { capturedAt: options.capturedAt }
          : {}),
      ...(options.collector ? { collector: options.collector } : {}),
      ...(options.limits ? { limits: options.limits } : {}),
    });
  } catch (error) {
    operationFailed = true;
    operationError = error;
  } finally {
    if (connection && typeof connection.close === "function") {
      try {
        await connection.close();
      } catch (error) {
        closeFailed = true;
        closeError = error;
      }
    }
  }
  if (operationFailed) {
    if (operationError instanceof RuntimeCaptureExportError) throw operationError;
    throw new RuntimeCaptureExportError(
      `Unable to capture browser runtime export: ${operationError instanceof Error ? operationError.message : String(operationError)}`,
    );
  }
  if (closeFailed)
    throw new RuntimeCaptureExportError(
      `Unable to close browser capture: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
    );
  if (!result) throw new RuntimeCaptureExportError("Browser capture produced no envelope");
  return result;
}
