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
export type RuntimeCaptureCapabilityKind =
  | "reports"
  | "shared-lifecycle"
  | "snapshot"
  | "instance"
  | "network-error"
  | "devtools";
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
  capabilityKind: RuntimeCaptureCapabilityKind;
  state: RuntimeCaptureCapability;
  reason: string;
  source: RuntimeCaptureSource;
  scope: string;
  priority: 1 | 2 | 3 | 4;
  sourceSchemaVersion: string;
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
  provenanceRefs?: string[];
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
const SOURCE_PRIORITIES: Record<RuntimeCaptureSource, 1 | 2 | 3 | 4> = {
  observability: 1,
  devtools: 2,
  snapshot: 3,
  instance: 3,
  network: 4,
  error: 4,
};
const CAPABILITY_STATES = new Set<RuntimeCaptureCapability>([
  "exact",
  "partial",
  "unavailable",
  "not-applicable",
  "unknown",
]);
const CAPABILITY_KINDS = new Set<RuntimeCaptureCapabilityKind>([
  "reports",
  "shared-lifecycle",
  "snapshot",
  "instance",
  "network-error",
  "devtools",
]);
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
const ROOT_KEYS = new Set([
  "schemaVersion",
  "contractVersion",
  "collector",
  "transport",
  "captureId",
  "capabilities",
  "limits",
  "truncation",
  "reports",
  "events",
  "devtools",
  "snapshots",
  "instances",
  "network",
  "errors",
  "relations",
]);
const LIMIT_KEYS = new Set(Object.keys(DEFAULT_RUNTIME_CAPTURE_LIMITS));
const RECORD_KEYS = new Set([
  "id",
  "identity",
  "source",
  "capturedAt",
  "contentDigest",
  "provenance",
  "provenanceRefs",
  "completeness",
  "value",
]);
const IDENTITY_KEYS = new Set([
  "captureId",
  "navigationId",
  "realmId",
  "sequence",
  "runtimeVersion",
  "sourceScope",
  "traceId",
  "requestId",
  "hostName",
  "instanceName",
  "remoteName",
  "remoteAlias",
  "sharedPackage",
]);
const PROVENANCE_KEYS = new Set([
  "collector",
  "inputKind",
  "source",
  "sourceSchemaVersion",
  "location",
  "contentDigest",
  "parentEvidenceIds",
]);
const COMPLETENESS_KEYS = new Set([
  "status",
  "expectedCount",
  "observedCount",
  "missing",
  "reason",
]);
const RELATION_KEYS = new Set(["id", "from", "to", "relation", "reason"]);

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

function parseSafeValue(
  value: unknown,
  limits: RuntimeCaptureLimits,
  path: string,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > limits.maxDepth) throw new RuntimeCaptureValidationError(`${path} exceeds maxDepth`);
  if (typeof value === "string") {
    const maxLength = /(?:diagnosisTitle|message)$/.test(path)
      ? limits.maxDiagnosisStringLength
      : limits.maxStringLength;
    if (value.length > maxLength)
      throw new RuntimeCaptureValidationError(
        `${path} exceeds ${maxLength === limits.maxDiagnosisStringLength ? "maxDiagnosisStringLength" : "maxStringLength"}`,
      );
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new RuntimeCaptureValidationError(`${path} has non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    try {
      if (seen.has(value)) throw new RuntimeCaptureValidationError(`${path} contains a cycle`);
      seen.add(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const maxArrayLength = Math.max(
        limits.maxObjectKeys,
        limits.maxReports,
        limits.maxEvents,
        limits.maxSnapshots,
        limits.maxInstances,
        limits.maxNetworkRecords,
        limits.maxErrors,
        10_000,
      );
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        lengthDescriptor.value > maxArrayLength
      )
        throw new RuntimeCaptureValidationError(`${path} exceeds collection array limit`);
      const result: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor))
          throw new RuntimeCaptureValidationError(`${path}[${index}] must be an own data property`);
        result.push(parseSafeValue(descriptor.value, limits, `${path}[${index}]`, depth + 1, seen));
      }
      return result;
    } catch (error) {
      if (error instanceof RuntimeCaptureValidationError) throw error;
      throw new RuntimeCaptureValidationError(`${path} cannot be safely read`);
    }
  }
  if (!isObject(value))
    throw new RuntimeCaptureValidationError(`${path} contains an unsupported value`);
  if (seen.has(value)) throw new RuntimeCaptureValidationError(`${path} contains a cycle`);
  seen.add(value);
  const entries = ownDataEntries(value, path);
  if (entries.length > limits.maxObjectKeys)
    throw new RuntimeCaptureValidationError(`${path} exceeds maxObjectKeys`);
  return Object.fromEntries(
    entries.map(([key, child]) => [
      key,
      parseSafeValue(child, limits, `${path}.${key}`, depth + 1, seen),
    ]),
  );
}

function normalizedJson(value: unknown): string {
  return JSON.stringify(canonicalizeEvidenceValue(value as EvidenceValue));
}

function assertKnownKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new RuntimeCaptureValidationError(`${path} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new RuntimeCaptureValidationError(`${path}.${key} is unknown`);
  }
}

function assertFinalEncodedBytes(value: unknown, limits: RuntimeCaptureLimits): void {
  const bytes = Buffer.byteLength(normalizedJson(value), "utf8");
  if (bytes > limits.maxBytes)
    throw new RuntimeCaptureValidationError(`/ exceeds maxBytes (${limits.maxBytes})`);
}

function assertCanonicalPart(value: unknown, limits: RuntimeCaptureLimits, path: string): void {
  const redacted = redactEvidenceValue(value as EvidenceValue, {
    maxDepth: limits.maxDepth,
    maxNodes: 10_000,
    maxBytes: Math.min(limits.maxBytes, 8 * 1_048_576),
  });
  if (normalizedJson(value) !== normalizedJson(redacted))
    throw new RuntimeCaptureValidationError(
      `${path} contains values that are not canonically redacted`,
    );
}

function assertDiagnosisLimits(
  source: RuntimeCaptureSource,
  value: object,
  limits: RuntimeCaptureLimits,
  path: string,
): void {
  const diagnosisKeys =
    source === "observability" ? ["diagnosisTitle"] : source === "error" ? ["message"] : [];
  for (const key of diagnosisKeys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.length > limits.maxDiagnosisStringLength)
      throw new RuntimeCaptureValidationError(`${path}.${key} exceeds maxDiagnosisStringLength`);
  }
}

function assertString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.length === 0)
    throw new RuntimeCaptureValidationError(`${path} must be a non-empty string`);
}

function assertIdentity(
  identity: unknown,
  path: string,
): asserts identity is RuntimeCaptureIdentity {
  assertKnownKeys(identity, IDENTITY_KEYS, path);
  const safeIdentity = identity as unknown as RuntimeCaptureIdentity;
  const identityFields = safeIdentity as unknown as Record<string, unknown>;
  for (const key of ["captureId", "navigationId", "realmId"])
    assertString(identityFields[key], `${path}.${key}`);
  if (!Number.isSafeInteger(safeIdentity.sequence) || safeIdentity.sequence < 0)
    throw new RuntimeCaptureValidationError(`${path}.sequence is invalid`);
  for (const key of [
    "runtimeVersion",
    "sourceScope",
    "traceId",
    "requestId",
    "hostName",
    "instanceName",
    "remoteName",
    "remoteAlias",
    "sharedPackage",
  ])
    if (identityFields[key] !== undefined) assertString(identityFields[key], `${path}.${key}`);
}

function assertProvenance(
  provenance: unknown,
  path: string,
): asserts provenance is EvidenceProvenance {
  assertKnownKeys(provenance, PROVENANCE_KEYS, path);
  assertKnownKeys(provenance.collector, new Set(["name", "version"]), `${path}.collector`);
  assertString(provenance.collector.name, `${path}.collector.name`);
  assertString(provenance.collector.version, `${path}.collector.version`);
  for (const key of ["inputKind", "source", "sourceSchemaVersion"])
    assertString(provenance[key], `${path}.${key}`);
  if (provenance.location !== undefined) assertString(provenance.location, `${path}.location`);
  if (provenance.contentDigest !== undefined) {
    assertString(provenance.contentDigest, `${path}.contentDigest`);
    const digest = provenance.contentDigest as unknown as string;
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new RuntimeCaptureValidationError(`${path}.contentDigest is invalid`);
  }
  if (
    provenance.parentEvidenceIds !== undefined &&
    (!Array.isArray(provenance.parentEvidenceIds) ||
      provenance.parentEvidenceIds.length > 100 ||
      provenance.parentEvidenceIds.some((item) => typeof item !== "string" || item.length === 0))
  )
    throw new RuntimeCaptureValidationError(`${path}.parentEvidenceIds is invalid`);
}

function assertCompleteness(
  completeness: unknown,
  path: string,
): asserts completeness is EvidenceCompletenessInfo {
  assertKnownKeys(completeness, COMPLETENESS_KEYS, path);
  if (!["complete", "partial", "unknown", "not-collected"].includes(completeness.status as string))
    throw new RuntimeCaptureValidationError(`${path}.status is invalid`);
  assertString(completeness.reason, `${path}.reason`);
  for (const key of ["expectedCount", "observedCount"])
    if (
      completeness[key] !== undefined &&
      (!Number.isSafeInteger(completeness[key]) || (completeness[key] as number) < 0)
    )
      throw new RuntimeCaptureValidationError(`${path}.${key} is invalid`);
  if (
    completeness.missing !== undefined &&
    (!Array.isArray(completeness.missing) ||
      completeness.missing.length > 100 ||
      completeness.missing.some((item) => typeof item !== "string" || item.length === 0))
  )
    throw new RuntimeCaptureValidationError(`${path}.missing is invalid`);
}

function assertLimits(limits: RuntimeCaptureLimits): void {
  for (const name of Object.keys(
    DEFAULT_RUNTIME_CAPTURE_LIMITS,
  ) as (keyof RuntimeCaptureLimits)[]) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RuntimeCaptureValidationError(`${name} must be positive`);
    const ceiling = HARD_RUNTIME_CAPTURE_LIMITS[name];
    if (value > ceiling) throw new RuntimeCaptureValidationError(`${name} exceeds hard ceiling`);
  }
}

function assertRecordValue(source: RuntimeCaptureSource, value: unknown, path: string): void {
  if (!isObject(value)) throw new RuntimeCaptureValidationError(`${path} must be an object`);
  for (const [key] of ownDataEntries(value, path)) {
    if (!VALUE_KEYS[source].has(key))
      throw new RuntimeCaptureValidationError(`${path}.${key} is not allowed for ${source}`);
  }
  const stringKeys = new Set([
    "traceId",
    "requestId",
    "requestAlias",
    "hostName",
    "runtimeVersion",
    "outcome",
    "phase",
    "errorCode",
    "ownerHint",
    "diagnosisTitle",
    "moduleInfoReason",
    "recordId",
    "scope",
    "name",
    "publicPath",
    "remoteEntry",
    "globalName",
    "failureClass",
    "initiatorClass",
    "code",
    "message",
  ]);
  for (const [key, child] of ownDataEntries(value, path)) {
    if (stringKeys.has(key) && typeof child !== "string")
      throw new RuntimeCaptureValidationError(`${path}.${key} must be a string`);
    if (
      [
        "moduleInfoNames",
        "reportIds",
        "fields",
        "availableNames",
        "remoteNames",
        "shareScopes",
      ].includes(key) &&
      (!Array.isArray(child) ||
        child.length > 100 ||
        child.some((item) => typeof item !== "string" || item.length === 0))
    )
      throw new RuntimeCaptureValidationError(`${path}.${key} must be a string array`);
    if (
      ["entryCount", "status"].includes(key) &&
      (!Number.isInteger(child) || (child as number) < 0)
    )
      throw new RuntimeCaptureValidationError(`${path}.${key} must be a non-negative integer`);
    if (key === "durationMs" && (typeof child !== "number" || !Number.isFinite(child) || child < 0))
      throw new RuntimeCaptureValidationError(`${path}.${key} must be a non-negative number`);
    if (key === "loadedBefore" && typeof child !== "boolean")
      throw new RuntimeCaptureValidationError(`${path}.${key} must be a boolean`);
  }
  if (source === "network") {
    if (typeof value.url !== "string" || typeof value.kind !== "string")
      throw new RuntimeCaptureValidationError(`${path} network records need url and kind`);
    if (!["manifest", "remote-entry", "preload", "chunk", "unknown"].includes(value.kind))
      throw new RuntimeCaptureValidationError(`${path}.kind is invalid`);
    const status = value.status;
    if (
      status !== undefined &&
      (!Number.isInteger(status) || (status as number) < 0 || (status as number) > 999)
    )
      throw new RuntimeCaptureValidationError(`${path}.status is invalid`);
  }
  if (source === "snapshot") {
    const entryCount = value.entryCount;
    if (entryCount !== undefined && (!Number.isInteger(entryCount) || (entryCount as number) < 0))
      throw new RuntimeCaptureValidationError(`${path}.entryCount is invalid`);
  }
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
  const hardInput = parseSafeValue(input, HARD_RUNTIME_CAPTURE_LIMITS, "/");
  if (!isObject(hardInput)) throw new RuntimeCaptureValidationError("capture must be an object");
  assertKnownKeys(hardInput, ROOT_KEYS, "/");
  const root = hardInput;
  if (root.schemaVersion !== 1 || root.contractVersion !== 1)
    throw new RuntimeCaptureValidationError("unsupported capture contract version");
  if (!isObject(root.limits)) throw new RuntimeCaptureValidationError("limits are required");
  assertKnownKeys(root.limits, LIMIT_KEYS, "/limits");
  assertLimits(root.limits as unknown as RuntimeCaptureLimits);
  const normalizedInput = parseSafeValue(
    hardInput,
    root.limits as unknown as RuntimeCaptureLimits,
    "/",
  );
  if (!isObject(normalizedInput))
    throw new RuntimeCaptureValidationError("capture must be an object");
  const limits = root.limits as unknown as RuntimeCaptureLimits;
  for (const key of [
    "collector",
    "transport",
    "captureId",
    "capabilities",
    "limits",
    "truncation",
    "relations",
  ])
    assertCanonicalPart(normalizedInput[key], limits, `/${key}`);
  for (const key of [
    "reports",
    "events",
    "devtools",
    "snapshots",
    "instances",
    "network",
    "errors",
  ])
    for (const [index, record] of (normalizedInput[key] as unknown[]).entries())
      assertCanonicalPart(record, limits, `/${key}/${index}`);
  assertFinalEncodedBytes(normalizedInput, limits);
  const envelope = normalizedInput as unknown as RuntimeCaptureEnvelope;
  if (envelope.schemaVersion !== 1 || envelope.contractVersion !== 1)
    throw new RuntimeCaptureValidationError("unsupported capture contract version");
  if (typeof envelope.captureId !== "string" || envelope.captureId.length === 0)
    throw new RuntimeCaptureValidationError("captureId is required");
  if (
    !new Set(["file", "browser-debug", "devtools-export", "node-file", "app-export"]).has(
      envelope.transport,
    )
  )
    throw new RuntimeCaptureValidationError("transport is invalid");
  assertKnownKeys(envelope.collector, new Set(["name", "version"]), "/collector");
  assertString(envelope.collector.name, "/collector.name");
  assertString(envelope.collector.version, "/collector.version");
  if (!isObject(envelope.capabilities) || !Array.isArray(envelope.capabilities.observations))
    throw new RuntimeCaptureValidationError("capability observations are required");
  assertKnownKeys(envelope.capabilities, new Set(["observations"]), "/capabilities");
  if (envelope.capabilities.observations.length > 20)
    throw new RuntimeCaptureValidationError("capability observations exceed maxItems");
  for (const [index, observation] of envelope.capabilities.observations.entries()) {
    assertKnownKeys(
      observation,
      new Set([
        "capabilityKind",
        "state",
        "reason",
        "source",
        "scope",
        "priority",
        "sourceSchemaVersion",
        "runtimeVersion",
      ]),
      `/capabilities.observations[${index}]`,
    );
    if (
      !isObject(observation) ||
      typeof observation.capabilityKind !== "string" ||
      !CAPABILITY_KINDS.has(observation.capabilityKind as RuntimeCaptureCapabilityKind) ||
      typeof observation.state !== "string" ||
      !CAPABILITY_STATES.has(observation.state as RuntimeCaptureCapability) ||
      typeof observation.source !== "string" ||
      typeof observation.scope !== "string" ||
      typeof observation.sourceSchemaVersion !== "string" ||
      observation.sourceSchemaVersion.length === 0 ||
      !Number.isInteger(observation.priority) ||
      observation.priority < 1 ||
      observation.priority > 4 ||
      SOURCE_PRIORITIES[observation.source as RuntimeCaptureSource] !== observation.priority
    )
      throw new RuntimeCaptureValidationError(`capabilities.observations[${index}] is invalid`);
    assertString(observation.reason, `/capabilities.observations[${index}].reason`);
    assertString(observation.scope, `/capabilities.observations[${index}].scope`);
    assertString(
      observation.sourceSchemaVersion,
      `/capabilities.observations[${index}].sourceSchemaVersion`,
    );
    if (observation.runtimeVersion !== undefined)
      assertString(
        observation.runtimeVersion,
        `/capabilities.observations[${index}].runtimeVersion`,
      );
  }
  if (!Array.isArray(envelope.truncation))
    throw new RuntimeCaptureValidationError("truncation must be an array");
  for (const [index, item] of envelope.truncation.entries()) {
    assertKnownKeys(
      item,
      new Set(["collection", "dropped", "firstSequence", "lastSequence", "reason"]),
      `/truncation/${index}`,
    );
    if (
      !new Set([
        "observability",
        "devtools",
        "snapshot",
        "instance",
        "network",
        "error",
        "total",
      ]).has(item.collection) ||
      !Number.isSafeInteger(item.dropped) ||
      item.dropped < 1
    )
      throw new RuntimeCaptureValidationError(`/truncation/${index} is invalid`);
    for (const key of ["firstSequence", "lastSequence"])
      if (
        item[key] !== undefined &&
        (!Number.isSafeInteger(item[key]) || (item[key] as number) < 0)
      )
        throw new RuntimeCaptureValidationError(`/truncation/${index}.${key} is invalid`);
    assertString(item.reason, `/truncation/${index}.reason`);
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
      assertKnownKeys(record, RECORD_KEYS, `${collection}[${index}]`);
      if (!isObject(record) || record.source !== source)
        throw new RuntimeCaptureValidationError(`${collection}[${index}] has the wrong source`);
      assertRecordValue(source, record.value, `${collection}[${index}].value`);
      assertDiagnosisLimits(source, record.value, envelope.limits, `${collection}[${index}].value`);
      assertIdentity(record.identity, `${collection}[${index}].identity`);
      assertProvenance(record.provenance, `${collection}[${index}].provenance`);
      if (
        record.provenanceRefs !== undefined &&
        (!Array.isArray(record.provenanceRefs) ||
          record.provenanceRefs.length > 20 ||
          record.provenanceRefs.some((ref) => typeof ref !== "string" || ref.length === 0))
      )
        throw new RuntimeCaptureValidationError(
          `${collection}[${index}].provenanceRefs is invalid`,
        );
      assertCompleteness(record.completeness, `${collection}[${index}].completeness`);
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
      if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 100)
        throw new RuntimeCaptureValidationError(`${collection}[${index}].id is invalid`);
      if (typeof record.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.contentDigest))
        throw new RuntimeCaptureValidationError(`${collection}[${index}].contentDigest is invalid`);
    }
  }
  const records = allRecords(envelope).sort((left, right) => {
    const a = left.identity;
    const b = right.identity;
    return (
      a.navigationId.localeCompare(b.navigationId) ||
      a.realmId.localeCompare(b.realmId) ||
      a.sequence - b.sequence ||
      left.id.localeCompare(right.id)
    );
  });
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
    const sequenceKey = JSON.stringify([
      identity.navigationId,
      identity.realmId,
      identity.sequence,
    ]);
    if (sequences.has(sequenceKey))
      throw new RuntimeCaptureValidationError(`duplicate realm sequence: ${sequenceKey}`);
    sequences.add(sequenceKey);
    const realmKey = JSON.stringify([identity.navigationId, identity.realmId]);
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
  for (const [index, relation] of envelope.relations.entries()) {
    assertKnownKeys(relation, RELATION_KEYS, `/relations/${index}`);
    assertString(relation.id, `/relations/${index}.id`);
    assertString(relation.from, `/relations/${index}.from`);
    assertString(relation.to, `/relations/${index}.to`);
    assertString(relation.reason, `/relations/${index}.reason`);
    if (
      !new Set([
        "exact-id",
        "exact-safe-locator",
        "source-supplied",
        "time-window-candidate",
        "unknown",
      ]).has(relation.relation)
    )
      throw new RuntimeCaptureValidationError(`/relations/${index}.relation is invalid`);
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
