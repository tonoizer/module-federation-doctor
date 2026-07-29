import { createHash } from "node:crypto";
import {
  assertEvidenceValue,
  canonicalizeEvidenceValue,
  redactEvidenceValue,
  type EvidenceCompletenessInfo,
  type EvidenceProvenance,
  type EvidenceValue,
} from "./evidence.js";

/** Version of the external runtime-capture document, independent of MF runtime version. */
export const RUNTIME_CAPTURE_CONTRACT_VERSION = 1 as const;
export type RuntimeCaptureContractVersion = typeof RUNTIME_CAPTURE_CONTRACT_VERSION;

export type RuntimeCaptureTransport =
  | "file"
  | "browser-debug"
  | "devtools-export"
  | "node-file"
  | "app-export";
export type RuntimeCaptureSource =
  | "observability"
  | "devtools"
  | "snapshot"
  | "instance"
  | "network"
  | "error";
export type RuntimeCaptureCapability =
  | "exact"
  | "partial"
  | "unavailable"
  | "not-applicable"
  | "unknown";
export type RuntimeCaptureRelation =
  | "exact-id"
  | "exact-safe-locator"
  | "source-supplied"
  | "time-window-candidate"
  | "unknown";

export interface RuntimeCaptureLimits {
  maxBytes: number;
  maxReports: number;
  maxEvents: number;
  maxSnapshots: number;
  maxInstances: number;
  maxNetworkRecords: number;
  maxErrors: number;
  maxStringLength: number;
  maxDiagnosisStringLength: number;
  maxDepth: number;
  maxObjectKeys: number;
}

export const DEFAULT_RUNTIME_CAPTURE_LIMITS: RuntimeCaptureLimits = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxReports: 100,
  maxEvents: 5_000,
  maxSnapshots: 500,
  maxInstances: 100,
  maxNetworkRecords: 2_000,
  maxErrors: 200,
  maxStringLength: 4 * 1024,
  maxDiagnosisStringLength: 16 * 1024,
  maxDepth: 12,
  maxObjectKeys: 100,
});

export const HARD_RUNTIME_CAPTURE_LIMITS: RuntimeCaptureLimits = Object.freeze({
  maxBytes: 25 * 1024 * 1024,
  maxReports: 100,
  maxEvents: 5_000,
  maxSnapshots: 500,
  maxInstances: 100,
  maxNetworkRecords: 2_000,
  maxErrors: 200,
  maxStringLength: 4 * 1024,
  maxDiagnosisStringLength: 16 * 1024,
  maxDepth: 12,
  maxObjectKeys: 100,
});

export interface RuntimeCaptureCapabilityInfo {
  state: RuntimeCaptureCapability;
  reason: string;
  source: RuntimeCaptureSource;
  scope: string;
  priority: 1 | 2 | 3 | 4;
  runtimeVersion?: string;
}

export interface RuntimeCaptureCapabilities {
  observations: RuntimeCaptureCapabilityInfo[];
}

export interface RuntimeCaptureIdentity {
  captureId: string;
  navigationId: string;
  realmId: string;
  sequence: number;
  runtimeVersion?: string;
  sourceScope?: string;
  traceId?: string;
  requestId?: string;
  hostName?: string;
  instanceName?: string;
  remoteName?: string;
  remoteAlias?: string;
  sharedPackage?: string;
}

export interface RuntimeCaptureReportValue {
  traceId?: string;
  requestId?: string;
  requestAlias?: string;
  hostName?: string;
  runtimeVersion?: string;
  outcome?: string;
  phase?: string;
  errorCode?: string;
  ownerHint?: string;
  loadedBefore?: boolean;
  diagnosisTitle?: string;
  moduleInfoReason?: string;
  moduleInfoNames?: string[];
}

export interface RuntimeCaptureDevtoolsValue {
  recordId?: string;
  scope?: string;
  runtimeVersion?: string;
  reportIds?: string[];
  fields?: string[];
}

export interface RuntimeCaptureSnapshotValue {
  name?: string;
  publicPath?: string;
  remoteEntry?: string;
  globalName?: string;
  availableNames?: string[];
  entryCount?: number;
}

export interface RuntimeCaptureInstanceValue {
  name?: string;
  hostName?: string;
  runtimeVersion?: string;
  remoteNames?: string[];
  shareScopes?: string[];
}

export interface RuntimeCaptureNetworkValue {
  url: string;
  kind: "manifest" | "remote-entry" | "preload" | "chunk" | "unknown";
  status?: number;
  failureClass?: string;
  durationMs?: number;
  initiatorClass?: string;
}

export interface RuntimeCaptureErrorValue {
  code?: string;
  name?: string;
  message?: string;
  phase?: string;
  runtimeVersion?: string;
}

interface RuntimeCaptureRecordBase<T extends object, S extends RuntimeCaptureSource> {
  id: string;
  identity: RuntimeCaptureIdentity;
  source: S;
  capturedAt: number;
  contentDigest: string;
  provenance: EvidenceProvenance;
  completeness: EvidenceCompletenessInfo;
  value: T;
}

export type RuntimeCaptureObservabilityRecord = RuntimeCaptureRecordBase<
  RuntimeCaptureReportValue,
  "observability"
>;
export type RuntimeCaptureDevtoolsRecord = RuntimeCaptureRecordBase<
  RuntimeCaptureDevtoolsValue,
  "devtools"
>;
export type RuntimeCaptureSnapshotRecord = RuntimeCaptureRecordBase<
  RuntimeCaptureSnapshotValue,
  "snapshot"
>;
export type RuntimeCaptureInstanceRecord = RuntimeCaptureRecordBase<
  RuntimeCaptureInstanceValue,
  "instance"
>;
export type RuntimeCaptureNetworkRecord = RuntimeCaptureRecordBase<
  RuntimeCaptureNetworkValue,
  "network"
>;
export type RuntimeCaptureErrorRecord = RuntimeCaptureRecordBase<RuntimeCaptureErrorValue, "error">;

export interface RuntimeCaptureRelationRecord {
  id: string;
  from: string;
  to: string;
  relation: RuntimeCaptureRelation;
  reason: string;
}

export interface RuntimeCaptureTruncation {
  collection: RuntimeCaptureSource | "total";
  dropped: number;
  firstSequence?: number;
  lastSequence?: number;
  reason: string;
}

export interface RuntimeCaptureEnvelope {
  schemaVersion: 1;
  contractVersion: RuntimeCaptureContractVersion;
  collector: { name: string; version: string };
  transport: RuntimeCaptureTransport;
  captureId: string;
  capabilities: RuntimeCaptureCapabilities;
  limits: RuntimeCaptureLimits;
  truncation: RuntimeCaptureTruncation[];
  reports: RuntimeCaptureObservabilityRecord[];
  events: RuntimeCaptureObservabilityRecord[];
  devtools: RuntimeCaptureDevtoolsRecord[];
  snapshots: RuntimeCaptureSnapshotRecord[];
  instances: RuntimeCaptureInstanceRecord[];
  network: RuntimeCaptureNetworkRecord[];
  errors: RuntimeCaptureErrorRecord[];
  relations: RuntimeCaptureRelationRecord[];
}

export class RuntimeCaptureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeCaptureValidationError";
  }
}

const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "stack",
  "rawStack",
  "headers",
  "body",
  "cookies",
]);
const SECRET_KEY = /token|secret|password|credential|authorization|cookie|api[-_]?key/i;
const COLLECTION_LIMITS: Record<RuntimeCaptureSource, keyof RuntimeCaptureLimits> = {
  observability: "maxReports",
  devtools: "maxReports",
  snapshot: "maxSnapshots",
  instance: "maxInstances",
  network: "maxNetworkRecords",
  error: "maxErrors",
};
const VALUE_KEYS: Record<RuntimeCaptureSource, ReadonlySet<string>> = {
  observability: new Set([
    "traceId",
    "requestId",
    "requestAlias",
    "hostName",
    "runtimeVersion",
    "outcome",
    "phase",
    "errorCode",
    "ownerHint",
    "loadedBefore",
    "diagnosisTitle",
    "moduleInfoReason",
    "moduleInfoNames",
  ]),
  devtools: new Set(["recordId", "scope", "runtimeVersion", "reportIds", "fields"]),
  snapshot: new Set([
    "name",
    "publicPath",
    "remoteEntry",
    "globalName",
    "availableNames",
    "entryCount",
  ]),
  instance: new Set(["name", "hostName", "runtimeVersion", "remoteNames", "shareScopes"]),
  network: new Set(["url", "kind", "status", "failureClass", "durationMs", "initiatorClass"]),
  error: new Set(["code", "name", "message", "phase", "runtimeVersion"]),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownDataEntries(value: Record<string, unknown>, path: string): [string, unknown][] {
  try {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new RuntimeCaptureValidationError(`${path} must be a plain object`);
    }
    return Object.keys(value).map((key) => {
      if (FORBIDDEN_KEYS.has(key) || SECRET_KEY.test(key)) {
        throw new RuntimeCaptureValidationError(`${path}.${key} is forbidden or sensitive`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new RuntimeCaptureValidationError(`${path}.${key} must be an own data property`);
      }
      return [key, descriptor.value];
    });
  } catch (error) {
    if (error instanceof RuntimeCaptureValidationError) throw error;
    throw new RuntimeCaptureValidationError(`${path} cannot be safely read`);
  }
}

function assertSafeValue(value: unknown, limits: RuntimeCaptureLimits, path: string): void {
  const pending: Array<{ value: unknown; depth: number; path: string }> = [
    { value, depth: 0, path },
  ];
  const seen = new WeakSet<object>();
  let bytes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > limits.maxDepth)
      throw new RuntimeCaptureValidationError(`${item.path} exceeds maxDepth`);
    if (typeof item.value === "string") {
      if (item.value.length > limits.maxStringLength)
        throw new RuntimeCaptureValidationError(`${item.path} exceeds maxStringLength`);
      bytes += Buffer.byteLength(item.value);
    } else if (
      item.value === null ||
      typeof item.value === "boolean" ||
      typeof item.value === "number"
    ) {
      if (typeof item.value === "number" && !Number.isFinite(item.value))
        throw new RuntimeCaptureValidationError(`${item.path} has non-finite number`);
      bytes += 8;
    } else if (Array.isArray(item.value)) {
      if (seen.has(item.value))
        throw new RuntimeCaptureValidationError(`${item.path} contains a cycle`);
      seen.add(item.value);
      if (item.value.length > limits.maxObjectKeys)
        throw new RuntimeCaptureValidationError(`${item.path} exceeds maxObjectKeys`);
      for (let i = item.value.length - 1; i >= 0; i--)
        pending.push({ value: item.value[i], depth: item.depth + 1, path: `${item.path}[${i}]` });
    } else if (isObject(item.value)) {
      if (seen.has(item.value))
        throw new RuntimeCaptureValidationError(`${item.path} contains a cycle`);
      seen.add(item.value);
      const entries = ownDataEntries(item.value, item.path);
      if (entries.length > limits.maxObjectKeys)
        throw new RuntimeCaptureValidationError(`${item.path} exceeds maxObjectKeys`);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, child] = entries[i]!;
        pending.push({ value: child, depth: item.depth + 1, path: `${item.path}.${key}` });
      }
    } else {
      throw new RuntimeCaptureValidationError(`${item.path} contains an unsupported value`);
    }
    if (bytes > limits.maxBytes)
      throw new RuntimeCaptureValidationError(`${path} exceeds maxBytes`);
  }
}

function assertLimits(limits: RuntimeCaptureLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RuntimeCaptureValidationError(`${name} must be positive`);
    const ceiling = HARD_RUNTIME_CAPTURE_LIMITS[name as keyof RuntimeCaptureLimits];
    if (value > ceiling) throw new RuntimeCaptureValidationError(`${name} exceeds hard ceiling`);
  }
}

function assertRecordValue(source: RuntimeCaptureSource, value: unknown, path: string): void {
  if (!isObject(value)) throw new RuntimeCaptureValidationError(`${path} must be an object`);
  for (const [key] of ownDataEntries(value, path)) {
    if (!VALUE_KEYS[source].has(key))
      throw new RuntimeCaptureValidationError(`${path}.${key} is not allowed for ${source}`);
  }
  if (source === "network" && (typeof value.url !== "string" || typeof value.kind !== "string"))
    throw new RuntimeCaptureValidationError(`${path} network records need url and kind`);
}

function recordId(record: RuntimeCaptureRecordBase<object, RuntimeCaptureSource>): string {
  return record.id;
}

function allRecords(
  envelope: RuntimeCaptureEnvelope,
): RuntimeCaptureRecordBase<object, RuntimeCaptureSource>[] {
  return [
    ...envelope.reports,
    ...envelope.events,
    ...envelope.devtools,
    ...envelope.snapshots,
    ...envelope.instances,
    ...envelope.network,
    ...envelope.errors,
  ] as RuntimeCaptureRecordBase<object, RuntimeCaptureSource>[];
}

/** Validate a capture before it crosses the offline handoff boundary. */
export function validateRuntimeCaptureEnvelope(
  input: unknown,
): asserts input is RuntimeCaptureEnvelope {
  if (!isObject(input)) throw new RuntimeCaptureValidationError("capture must be an object");
  const envelope = input as unknown as RuntimeCaptureEnvelope;
  if (envelope.schemaVersion !== 1 || envelope.contractVersion !== 1)
    throw new RuntimeCaptureValidationError("unsupported capture contract version");
  if (typeof envelope.captureId !== "string" || envelope.captureId.length === 0)
    throw new RuntimeCaptureValidationError("captureId is required");
  if (!envelope.limits) throw new RuntimeCaptureValidationError("limits are required");
  assertLimits(envelope.limits);
  assertSafeValue(input, envelope.limits, "/");
  if (!isObject(envelope.capabilities) || !Array.isArray(envelope.capabilities.observations))
    throw new RuntimeCaptureValidationError("capability observations are required");
  for (const [index, observation] of envelope.capabilities.observations.entries()) {
    if (
      !isObject(observation) ||
      typeof observation.source !== "string" ||
      typeof observation.scope !== "string" ||
      !Number.isInteger(observation.priority) ||
      observation.priority < 1 ||
      observation.priority > 4
    )
      throw new RuntimeCaptureValidationError(`capabilities.observations[${index}] is invalid`);
  }
  const collections = [
    "reports",
    "events",
    "devtools",
    "snapshots",
    "instances",
    "network",
    "errors",
  ] as const;
  for (const collection of collections) {
    const records = envelope[collection];
    if (!Array.isArray(records))
      throw new RuntimeCaptureValidationError(`${collection} must be an array`);
    const source =
      collection === "reports" || collection === "events"
        ? "observability"
        : collection === "devtools"
          ? "devtools"
          : collection === "snapshots"
            ? "snapshot"
            : collection === "instances"
              ? "instance"
              : collection === "network"
                ? "network"
                : "error";
    const collectionLimit =
      collection === "events"
        ? envelope.limits.maxEvents
        : envelope.limits[COLLECTION_LIMITS[source]];
    if (records.length > collectionLimit)
      throw new RuntimeCaptureValidationError(`${collection} exceeds its quota`);
    for (const [index, record] of records.entries()) {
      if (!isObject(record) || record.source !== source)
        throw new RuntimeCaptureValidationError(`${collection}[${index}] has the wrong source`);
      assertRecordValue(source, record.value, `${collection}[${index}].value`);
      if (
        !isObject(record.identity) ||
        (record.identity as RuntimeCaptureIdentity).captureId !== envelope.captureId
      )
        throw new RuntimeCaptureValidationError(`${collection}[${index}] crosses captureId`);
      if (
        typeof record.id !== "string" ||
        typeof record.contentDigest !== "string" ||
        typeof record.capturedAt !== "number" ||
        !Number.isFinite(record.capturedAt) ||
        record.capturedAt < 0
      )
        throw new RuntimeCaptureValidationError(`${collection}[${index}] lacks integrity fields`);
      if (
        !isObject(record.provenance) ||
        typeof record.provenance.source !== "string" ||
        record.provenance.source.length === 0 ||
        typeof record.provenance.sourceSchemaVersion !== "string" ||
        record.provenance.sourceSchemaVersion.length === 0
      )
        throw new RuntimeCaptureValidationError(
          `${collection}[${index}] lacks provenance source version`,
        );
    }
  }
  const records = allRecords(envelope);
  const ids = new Set<string>();
  const sequences = new Set<string>();
  const lastSequence = new Map<string, number>();
  for (const record of records) {
    if (ids.has(recordId(record)))
      throw new RuntimeCaptureValidationError(`duplicate record id: ${record.id}`);
    ids.add(recordId(record));
    const identity = record.identity;
    if (!Number.isSafeInteger(identity.sequence) || identity.sequence < 0)
      throw new RuntimeCaptureValidationError(`invalid realm sequence: ${record.id}`);
    const sequenceKey = `${identity.navigationId}:${identity.realmId}:${identity.sequence}`;
    if (sequences.has(sequenceKey))
      throw new RuntimeCaptureValidationError(`duplicate realm sequence: ${sequenceKey}`);
    sequences.add(sequenceKey);
    const realmKey = `${identity.navigationId}:${identity.realmId}`;
    const previous = lastSequence.get(realmKey);
    if (previous !== undefined && identity.sequence <= previous)
      throw new RuntimeCaptureValidationError(`realm sequence is not increasing: ${realmKey}`);
    lastSequence.set(realmKey, identity.sequence);
    const value = redactEvidenceValue(record.value as EvidenceValue);
    assertEvidenceValue(value);
    if (record.contentDigest !== runtimeCaptureContentDigest(record.value as EvidenceValue))
      throw new RuntimeCaptureValidationError(
        `content digest does not match redacted value: ${record.id}`,
      );
    if (
      record.id !== runtimeCaptureRecordId(record.source, identity, record.value as EvidenceValue)
    )
      throw new RuntimeCaptureValidationError(
        `record id does not match stable identity: ${record.id}`,
      );
  }
  if (!Array.isArray(envelope.relations))
    throw new RuntimeCaptureValidationError("relations must be an array");
  const relationIds = new Set<string>();
  for (const relation of envelope.relations) {
    if (relationIds.has(relation.id))
      throw new RuntimeCaptureValidationError(`duplicate relation id: ${relation.id}`);
    relationIds.add(relation.id);
    if (!ids.has(relation.from) || !ids.has(relation.to))
      throw new RuntimeCaptureValidationError(`dangling relation: ${relation.id}`);
    if (relation.relation === "exact-id" && (!relation.from || !relation.to))
      throw new RuntimeCaptureValidationError(`exact-id relation needs anchors: ${relation.id}`);
  }
}

/** Digest only the redacted, bounded record value. */
export function runtimeCaptureContentDigest(value: EvidenceValue): string {
  const redacted = redactEvidenceValue(value);
  assertEvidenceValue(redacted);
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeEvidenceValue(redacted)))
    .digest("hex");
}

export function runtimeCaptureRecordId(
  source: RuntimeCaptureSource,
  identity: RuntimeCaptureIdentity,
  value: EvidenceValue,
): string {
  const anchor = {
    captureId: identity.captureId,
    navigationId: identity.navigationId,
    realmId: identity.realmId,
    sequence: identity.sequence,
    source,
    value: redactEvidenceValue(value),
  };
  return `${source}:${createHash("sha256")
    .update(JSON.stringify(canonicalizeEvidenceValue(anchor)))
    .digest("hex")
    .slice(0, 24)}`;
}
