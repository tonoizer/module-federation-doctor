import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  assertEvidenceValue,
  canonicalizeEvidenceValue,
  redactEvidenceValue,
  type EvidenceCompletenessInfo,
  type EvidenceProvenance,
  type EvidenceValue,
} from "./evidence.js";
import type { RuntimeTraceReport } from "./types.js";

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
/** Sources that can make each capability claim. Keep this in lockstep with the shipped schema. */
const CAPABILITY_SOURCES: Readonly<
  Record<RuntimeCaptureCapabilityKind, readonly RuntimeCaptureSource[]>
> = Object.freeze({
  reports: ["observability", "devtools"],
  "shared-lifecycle": ["observability", "devtools"],
  snapshot: ["snapshot", "devtools"],
  instance: ["instance", "devtools"],
  "network-error": ["network", "error", "devtools"],
  devtools: ["devtools"],
});
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

function ownDataEntries(
  value: Record<string, unknown>,
  path: string,
  rejectSensitive = true,
): [string, unknown][] {
  try {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new RuntimeCaptureValidationError(`${path} must be a plain object`);
    }
    return Object.keys(value).map((key) => {
      if (FORBIDDEN_KEYS.has(key) || (rejectSensitive && SECRET_KEY.test(key))) {
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
  rejectSensitive = true,
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
        result.push(
          parseSafeValue(
            descriptor.value,
            limits,
            `${path}[${index}]`,
            depth + 1,
            seen,
            rejectSensitive,
          ),
        );
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
  const entries = ownDataEntries(value, path, rejectSensitive);
  if (entries.length > limits.maxObjectKeys)
    throw new RuntimeCaptureValidationError(`${path} exceeds maxObjectKeys`);
  return Object.fromEntries(
    entries.map(([key, child]) => [
      key,
      parseSafeValue(child, limits, `${path}.${key}`, depth + 1, seen, rejectSensitive),
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
      !CAPABILITY_SOURCES[observation.capabilityKind as RuntimeCaptureCapabilityKind]?.includes(
        observation.source as RuntimeCaptureSource,
      ) ||
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

/** File/export adapter kinds supported without attaching to a live runtime. */
export type RuntimeCaptureExportAdapter = "observability" | "devtools" | "app" | "node";
export type RuntimeCaptureExportKind = "capture" | RuntimeCaptureExportAdapter | "unknown";

export interface RuntimeCaptureExportOptions {
  adapter?: RuntimeCaptureExportAdapter;
  transport?: RuntimeCaptureTransport;
  captureId?: string;
  navigationId?: string;
  realmId?: string;
  sourceScope?: string;
  capturedAt?: number;
  collector?: { name: string; version: string };
  limits?: Partial<RuntimeCaptureLimits>;
  location?: string;
}

/** Options for projecting an already supplied runtime state without attachment. */
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

export class RuntimeCaptureExportError extends Error {
  readonly fileLabel: string | undefined;

  constructor(message: string, fileLabel?: string) {
    super(message);
    this.name = "RuntimeCaptureExportError";
    this.fileLabel = fileLabel;
  }
}

const EXPORT_KIND_TAGS: Record<RuntimeCaptureExportAdapter, string[]> = {
  observability: ["observability", "observability-export", "runtime-trace"],
  devtools: ["devtools", "devtools-export", "module-federation-devtools"],
  app: ["app", "app-export", "application-export", "onreport", "onevent"],
  node: ["node", "node-file", "ssr", "ssr-export", "node-ssr"],
};

function exportRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function normalizedTag(value: unknown): string | undefined {
  return typeof value === "string" ? value.toLowerCase().replace(/[_\s]+/g, "-") : undefined;
}

function hasReportShape(value: unknown): boolean {
  const record = exportRecord(value);
  return Boolean(
    record &&
    [
      "traceId",
      "summary",
      "remote",
      "shared",
      "events",
      "diagnosis",
      "moduleInfo",
      "errorCode",
    ].some((key) => Object.prototype.hasOwnProperty.call(record, key)),
  );
}

function extractExportReports(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const record = exportRecord(value);
  if (!record) return undefined;
  if (Array.isArray(record.reports)) return record.reports;
  if (Object.prototype.hasOwnProperty.call(record, "report")) return [record.report];
  for (const key of ["observability", "export", "data"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
    const nestedReports = extractExportReports(nested);
    if (nestedReports) return nestedReports;
  }
  return hasReportShape(record) ? [record] : undefined;
}

function detectSafeRuntimeCaptureExport(value: unknown): RuntimeCaptureExportKind {
  const record = exportRecord(value);
  if (
    record &&
    record.schemaVersion === 1 &&
    record.contractVersion !== undefined &&
    Array.isArray(record.reports) &&
    Array.isArray(record.events) &&
    Array.isArray(record.devtools) &&
    Array.isArray(record.snapshots) &&
    Array.isArray(record.instances) &&
    Array.isArray(record.network) &&
    Array.isArray(record.errors)
  )
    return "capture";

  const tags = record
    ? [record.adapter, record.kind, record.documentKind, record.source, record.transport]
        .map(normalizedTag)
        .filter((tag): tag is string => Boolean(tag))
    : [];
  for (const adapter of ["devtools", "node", "app", "observability"] as const) {
    if (tags.some((tag) => EXPORT_KIND_TAGS[adapter].includes(tag))) return adapter;
  }
  if (
    record &&
    (Array.isArray(record.scopes) ||
      record.config !== undefined ||
      record.hasUserObservabilityPlugin !== undefined ||
      record.devtools !== undefined)
  )
    return "devtools";
  if (extractExportReports(value)) return "observability";
  return "unknown";
}

function safeRuntimeExportInput(input: unknown): unknown {
  const safe = parseSafeValue(input, HARD_RUNTIME_CAPTURE_LIMITS, "/", 0, new WeakSet(), false);
  if (!Array.isArray(safe) && !isObject(safe))
    throw new RuntimeCaptureExportError("Runtime capture export must be an object or array");
  return safe;
}

/** Detect a canonical capture or a supported file/export adapter without live attachment. */
export function detectRuntimeCaptureExport(input: unknown): RuntimeCaptureExportKind {
  try {
    return detectSafeRuntimeCaptureExport(safeRuntimeExportInput(input));
  } catch {
    return "unknown";
  }
}

/** Return a safe plain-object copy of an already validated capture envelope. */
export function normalizeRuntimeCaptureEnvelope(input: unknown): RuntimeCaptureEnvelope {
  const safe = parseSafeValue(input, HARD_RUNTIME_CAPTURE_LIMITS, "/");
  validateRuntimeCaptureEnvelope(safe);
  return safe as RuntimeCaptureEnvelope;
}

function adapterTransport(adapter: RuntimeCaptureExportAdapter): RuntimeCaptureTransport {
  if (adapter === "devtools") return "devtools-export";
  if (adapter === "node") return "node-file";
  if (adapter === "app") return "app-export";
  return "file";
}

function adapterSource(adapter: RuntimeCaptureExportAdapter): string {
  if (adapter === "devtools") return "official-devtools-export";
  if (adapter === "node") return "node-ssr-export";
  if (adapter === "app") return "app-owned-export";
  return "official-observability";
}

function adapterInputKind(adapter: RuntimeCaptureExportAdapter): string {
  if (adapter === "devtools") return "devtools-export";
  if (adapter === "node") return "node-ssr-file";
  if (adapter === "app") return "app-owned-export";
  return "observability-export";
}

function safeExportString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function safeExportLocation(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const redacted = redactEvidenceValue(value);
  return typeof redacted === "string" ? redacted : undefined;
}

function reportValue(trace: RuntimeTraceReport): RuntimeCaptureReportValue {
  const value: RuntimeCaptureReportValue = {};
  if (trace.traceId) value.traceId = trace.traceId;
  if (trace.requestId) value.requestId = trace.requestId;
  if (trace.requestAlias) value.requestAlias = trace.requestAlias;
  if (trace.hostName) value.hostName = trace.hostName;
  if (trace.runtimeVersion) value.runtimeVersion = trace.runtimeVersion;
  if (trace.outcome) value.outcome = trace.outcome;
  if (trace.lastPhase) value.phase = trace.lastPhase;
  if (trace.errorCode) value.errorCode = trace.errorCode;
  if (trace.ownerHint) value.ownerHint = trace.ownerHint;
  if (typeof trace.loadedBefore === "boolean") value.loadedBefore = trace.loadedBefore;
  if (trace.diagnosis?.title) value.diagnosisTitle = trace.diagnosis.title;
  if (trace.moduleInfo?.reason) value.moduleInfoReason = trace.moduleInfo.reason;
  if (trace.moduleInfo?.availableNames?.length)
    value.moduleInfoNames = trace.moduleInfo.availableNames;
  return value;
}

function eventValue(
  trace: RuntimeTraceReport,
  event: RuntimeTraceReport["events"][number],
): RuntimeCaptureReportValue {
  const value: RuntimeCaptureReportValue = {};
  if (trace.traceId) value.traceId = trace.traceId;
  if (trace.requestId) value.requestId = trace.requestId;
  if (trace.hostName) value.hostName = trace.hostName;
  if (trace.runtimeVersion) value.runtimeVersion = trace.runtimeVersion;
  if (event.phase) value.phase = event.phase;
  if (event.status) value.outcome = event.status;
  if (event.errorCode) value.errorCode = event.errorCode;
  return value;
}

function runtimeIdentity(
  captureId: string,
  navigationId: string,
  realmId: string,
  sequence: number,
  trace: RuntimeTraceReport | undefined,
  scope: string,
): RuntimeCaptureIdentity {
  return {
    captureId,
    navigationId,
    realmId,
    sequence,
    sourceScope: scope,
    ...(trace?.runtimeVersion ? { runtimeVersion: trace.runtimeVersion } : {}),
    ...(trace?.traceId ? { traceId: trace.traceId } : {}),
    ...(trace?.requestId ? { requestId: trace.requestId } : {}),
    ...(trace?.hostName ? { hostName: trace.hostName } : {}),
    ...(trace?.moduleInfo?.name ? { instanceName: trace.moduleInfo.name } : {}),
    ...(trace?.remote?.name ? { remoteName: trace.remote.name } : {}),
    ...(trace?.remote?.alias ? { remoteAlias: trace.remote.alias } : {}),
    ...(trace?.shared?.package ? { sharedPackage: trace.shared.package } : {}),
  };
}

function runtimeCompleteness(
  trace: RuntimeTraceReport | undefined,
  partialReason: string | undefined,
): EvidenceCompletenessInfo {
  if (partialReason || trace?.evidenceClipped)
    return {
      status: "partial",
      reason: partialReason ?? "The source report was clipped before export.",
    };
  return { status: "complete", reason: "The validated export contained the projected fields." };
}

function capability(
  capabilityKind: RuntimeCaptureCapabilityKind,
  state: RuntimeCaptureCapability,
  source: RuntimeCaptureSource,
  reason: string,
  scope: string,
  sourceSchemaVersion: string,
  runtimeVersion?: string,
): RuntimeCaptureCapabilityInfo {
  return {
    capabilityKind,
    state,
    reason,
    source,
    scope,
    priority: SOURCE_PRIORITIES[source],
    sourceSchemaVersion,
    ...(runtimeVersion ? { runtimeVersion } : {}),
  };
}

function relationId(from: string, to: string): string {
  return `relation:${createHash("sha256").update(`${from}\0${to}`).digest("hex").slice(0, 24)}`;
}

function runtimeExportSourceVersion(
  reports: RuntimeTraceReport[],
  adapter: RuntimeCaptureExportAdapter,
): string {
  const versions = [...new Set(reports.map((report) => report.sourceContract).filter(Boolean))];
  return versions.join(",") || (adapter === "devtools" ? "devtools-export-v1" : "unknown");
}

function runtimeSharedCapability(
  reports: RuntimeTraceReport[],
  source: RuntimeCaptureSource,
  scope: string,
  sourceSchemaVersion: string,
  runtimeVersion?: string,
  truncated = false,
): RuntimeCaptureCapabilityInfo {
  const states = reports.map((report) => report.sharedCompleteness ?? "unknown");
  const inferredState: RuntimeCaptureCapability =
    states.length > 0 && states.every((item) => item === "complete")
      ? "exact"
      : states.some((item) => item === "partial")
        ? "partial"
        : "unknown";
  const state = truncated && inferredState === "exact" ? "partial" : inferredState;
  return capability(
    "shared-lifecycle",
    state,
    source,
    state === "exact"
      ? "Every projected report carried complete shared-lifecycle evidence."
      : truncated && inferredState === "exact"
        ? "The export was truncated before all report/event evidence could be retained."
        : "The adapter does not infer missing shared-lifecycle evidence; absent fields remain unknown.",
    scope,
    sourceSchemaVersion,
    runtimeVersion,
  );
}

/**
 * Adapt an existing export into the versioned offline envelope. This function
 * only reads the supplied value; it never attaches to a browser or calls a
 * Module Federation runtime API.
 */
export async function importRuntimeCaptureExport(
  input: unknown,
  options: RuntimeCaptureExportOptions = {},
): Promise<RuntimeCaptureEnvelope> {
  const safeInput = safeRuntimeExportInput(input);
  const detected = detectSafeRuntimeCaptureExport(safeInput);
  const kind = detected === "capture" ? "capture" : (options.adapter ?? detected);
  if (kind === "unknown")
    throw new RuntimeCaptureExportError(
      "Unsupported runtime export: expected a capture envelope, Observability report/export, DevTools export, app-owned export, or Node/SSR export.",
    );
  if (kind === "capture") return normalizeRuntimeCaptureEnvelope(safeInput);

  const reportsInput = extractExportReports(safeInput) ?? [];
  const limits = { ...DEFAULT_RUNTIME_CAPTURE_LIMITS, ...options.limits };
  const adapter = kind;
  const transport = options.transport ?? adapterTransport(adapter);
  const scope = safeExportString(
    options.sourceScope,
    adapter === "node" ? "node-ssr" : "external-export",
  );
  const navigationId = safeExportString(options.navigationId, "navigation-1");
  const realmId = safeExportString(options.realmId, adapter === "node" ? "node-ssr" : "realm-top");
  const capturedAt = options.capturedAt ?? 0;
  if (!Number.isFinite(capturedAt) || capturedAt < 0)
    throw new RuntimeCaptureExportError("capturedAt must be a non-negative finite number");
  const collector = {
    name: safeExportString(options.collector?.name, "mfdoctor-capture-adapter"),
    version: safeExportString(options.collector?.version, "1"),
  };
  const rawDigest = runtimeCaptureContentDigest(safeInput as EvidenceValue);
  const captureId = safeExportString(options.captureId, `capture-${rawDigest.slice(0, 16)}`);
  const reportSource: RuntimeCaptureSource = adapter === "devtools" ? "devtools" : "observability";
  const sourceLabel = adapterSource(adapter);
  const inputKind = adapterInputKind(adapter);
  const location = safeExportLocation(options.location);
  const parsedReports: RuntimeTraceReport[] = [];
  const maxReports = limits.maxReports;
  for (const [index, rawReport] of reportsInput.slice(0, maxReports).entries()) {
    try {
      const { parseRuntimeTraces } = await import("./runtime-trace.js");
      const parsed = parseRuntimeTraces(rawReport);
      if (parsed[0]) parsedReports.push(parsed[0]);
    } catch (error) {
      throw new RuntimeCaptureExportError(
        `Unable to adapt ${adapter} report ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const runtimeVersion = parsedReports.find((report) => report.runtimeVersion)?.runtimeVersion;
  const reportSchemaVersion = runtimeExportSourceVersion(parsedReports, adapter);
  const totalEvents = parsedReports.reduce((total, report) => total + report.events.length, 0);
  const reportsTruncated = reportsInput.length > maxReports;
  const eventsTruncated = totalEvents > limits.maxEvents;
  const truncation: RuntimeCaptureTruncation[] = [];
  if (reportsTruncated) {
    truncation.push({
      collection: "observability",
      dropped: reportsInput.length - maxReports,
      firstSequence: maxReports,
      lastSequence: reportsInput.length - 1,
      reason: "The source export exceeded maxReports.",
    });
  }
  const records: RuntimeCaptureObservabilityRecord[] = [];
  const events: RuntimeCaptureObservabilityRecord[] = [];
  const devtools: RuntimeCaptureDevtoolsRecord[] = [];
  let sequence = 0;
  const nextIdentity = (trace?: RuntimeTraceReport): RuntimeCaptureIdentity =>
    runtimeIdentity(captureId, navigationId, realmId, sequence++, trace, scope);
  const provenance = (trace: RuntimeTraceReport | undefined): EvidenceProvenance => ({
    collector: { ...collector },
    inputKind,
    source: sourceLabel,
    sourceSchemaVersion: trace?.sourceContract ?? reportSchemaVersion,
    contentDigest: rawDigest,
    ...(location ? { location } : {}),
  });
  let devtoolsRecord: RuntimeCaptureDevtoolsRecord | undefined;
  const devtoolsIdentity = adapter === "devtools" ? nextIdentity() : undefined;
  const reportPartialReason =
    adapter === "devtools"
      ? "The DevTools projection is partial by source contract."
      : reportsTruncated
        ? "The source export exceeded maxReports; the report collection is truncated."
        : undefined;
  const eventPartialReason = eventsTruncated
    ? "The source export exceeded maxEvents; the event collection is truncated."
    : "Events are projected from the normalized report.";
  for (const trace of parsedReports) {
    const value = reportValue(trace);
    const identity = nextIdentity(trace);
    const record: RuntimeCaptureObservabilityRecord = {
      id: runtimeCaptureRecordId("observability", identity, value as unknown as EvidenceValue),
      identity,
      source: "observability",
      capturedAt,
      contentDigest: runtimeCaptureContentDigest(value as unknown as EvidenceValue),
      provenance: provenance(trace),
      completeness: runtimeCompleteness(trace, reportPartialReason),
      value,
    };
    records.push(record);
    for (const event of trace.events.slice(0, Math.max(0, limits.maxEvents - events.length))) {
      const eventValueProjected = eventValue(trace, event);
      const eventIdentity = nextIdentity(trace);
      events.push({
        id: runtimeCaptureRecordId(
          "observability",
          eventIdentity,
          eventValueProjected as unknown as EvidenceValue,
        ),
        identity: eventIdentity,
        source: "observability",
        capturedAt,
        contentDigest: runtimeCaptureContentDigest(eventValueProjected as unknown as EvidenceValue),
        provenance: provenance(trace),
        completeness: runtimeCompleteness(trace, eventPartialReason),
        value: eventValueProjected,
      });
    }
  }
  if (adapter === "devtools" && devtoolsIdentity) {
    const metadata = exportRecord(safeInput);
    const value: RuntimeCaptureDevtoolsValue = {
      ...(typeof metadata?.recordId === "string" ? { recordId: metadata.recordId } : {}),
      ...(typeof metadata?.scope === "string"
        ? { scope: metadata.scope }
        : Array.isArray(metadata?.scopes) && typeof metadata.scopes[0] === "string"
          ? { scope: metadata.scopes[0] }
          : {}),
      ...(runtimeVersion ? { runtimeVersion } : {}),
      ...(records.length ? { reportIds: records.map((record) => record.id) } : {}),
      fields: [
        ...(Array.isArray(metadata?.reports) ? ["reports"] : []),
        ...(Array.isArray(metadata?.scopes) ? ["scopes"] : []),
        ...(metadata?.config !== undefined ? ["config"] : []),
      ],
    };
    devtoolsRecord = {
      id: runtimeCaptureRecordId("devtools", devtoolsIdentity, value as unknown as EvidenceValue),
      identity: devtoolsIdentity,
      source: "devtools",
      capturedAt,
      contentDigest: runtimeCaptureContentDigest(value as unknown as EvidenceValue),
      provenance: {
        ...provenance(undefined),
        sourceSchemaVersion: "devtools-export-v1",
      },
      completeness: {
        status: "complete",
        reason: "The existing DevTools export metadata was projected without attachment.",
      },
      value,
    };
    for (const record of [...records, ...events]) record.provenanceRefs = [devtoolsRecord.id];
    devtools.push(devtoolsRecord);
  }
  if (eventsTruncated) {
    truncation.push({
      collection: "observability",
      dropped: totalEvents - limits.maxEvents,
      firstSequence: limits.maxEvents,
      lastSequence: totalEvents - 1,
      reason: "The source events exceeded maxEvents.",
    });
  }
  const observations: RuntimeCaptureCapabilityInfo[] = [
    capability(
      "reports",
      parsedReports.length > 0
        ? adapter === "devtools" || reportsTruncated
          ? "partial"
          : "exact"
        : "unavailable",
      reportSource,
      parsedReports.length > 0
        ? adapter === "devtools"
          ? "Reports came from an existing DevTools export and remain source-partial."
          : reportsTruncated
            ? "Reports were read from an existing export, but the report collection was truncated."
            : "Reports were read from an existing export and normalized through the runtime reader."
        : "The export did not contain a supported report.",
      scope,
      reportSchemaVersion,
      runtimeVersion,
    ),
    runtimeSharedCapability(
      parsedReports,
      reportSource,
      scope,
      reportSchemaVersion,
      runtimeVersion,
      reportsTruncated || eventsTruncated,
    ),
    capability(
      "snapshot",
      "unavailable",
      adapter === "devtools" ? "devtools" : "snapshot",
      "Snapshot projection is not part of the file/export adapter slice.",
      scope,
      "not-present",
      runtimeVersion,
    ),
    capability(
      "instance",
      "unavailable",
      adapter === "devtools" ? "devtools" : "instance",
      "Runtime-instance projection is not part of the file/export adapter slice.",
      scope,
      "not-present",
      runtimeVersion,
    ),
    capability(
      "network-error",
      "unavailable",
      adapter === "devtools" ? "devtools" : "network",
      "Network and error fallback is not part of the file/export adapter slice.",
      scope,
      "not-present",
      runtimeVersion,
    ),
    capability(
      "devtools",
      adapter === "devtools" ? "exact" : "unavailable",
      "devtools",
      adapter === "devtools"
        ? "Existing DevTools metadata was projected without enabling or attaching to DevTools."
        : "The input was not an existing DevTools export.",
      scope,
      adapter === "devtools" ? "devtools-export-v1" : "not-present",
      runtimeVersion,
    ),
  ];
  const relations: RuntimeCaptureRelationRecord[] = devtoolsRecord
    ? records.map((record) => ({
        id: relationId(devtoolsRecord!.id, record.id),
        from: devtoolsRecord!.id,
        to: record.id,
        relation: "source-supplied" as const,
        reason: "The existing DevTools export supplied the report record.",
      }))
    : [];
  const envelope: RuntimeCaptureEnvelope = {
    schemaVersion: 1,
    contractVersion: RUNTIME_CAPTURE_CONTRACT_VERSION,
    collector,
    transport,
    captureId,
    capabilities: { observations },
    limits,
    truncation,
    reports: records,
    events,
    devtools,
    snapshots: [],
    instances: [],
    network: [],
    errors: [],
    relations,
  };
  try {
    validateRuntimeCaptureEnvelope(envelope);
  } catch (error) {
    throw new RuntimeCaptureExportError(
      `Adapted runtime export failed capture validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return envelope;
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

/** Read one bounded JSON export file and adapt it without starting a runtime. */
export async function loadRuntimeCaptureExportFile(
  filePath: string,
  options: RuntimeCaptureExportOptions = {},
): Promise<RuntimeCaptureEnvelope> {
  const resolved = nodePath.resolve(filePath);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(resolved, "r");
    const stat = await handle.stat();
    if (stat.size > HARD_RUNTIME_CAPTURE_LIMITS.maxBytes)
      throw new RuntimeCaptureExportError(
        `Runtime capture export exceeds the ${HARD_RUNTIME_CAPTURE_LIMITS.maxBytes} byte input limit`,
        resolved,
      );
    const buffer = Buffer.allocUnsafe(
      Math.min(stat.size + 1, HARD_RUNTIME_CAPTURE_LIMITS.maxBytes + 1),
    );
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (
      bytesRead > HARD_RUNTIME_CAPTURE_LIMITS.maxBytes ||
      (await handle.stat()).size > HARD_RUNTIME_CAPTURE_LIMITS.maxBytes
    )
      throw new RuntimeCaptureExportError(
        `Runtime capture export exceeds the ${HARD_RUNTIME_CAPTURE_LIMITS.maxBytes} byte input limit`,
        resolved,
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString("utf8", 0, bytesRead)) as unknown;
    } catch {
      throw new RuntimeCaptureExportError("Runtime capture export is not valid JSON", resolved);
    }
    return await importRuntimeCaptureExport(parsed, {
      ...options,
      location: options.location ?? resolved,
    });
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError && error.fileLabel === resolved) {
      throw error;
    }
    if (error instanceof RuntimeCaptureExportError) {
      throw new RuntimeCaptureExportError(`${resolved}: ${error.message}`, resolved);
    }
    throw new RuntimeCaptureExportError(
      `Unable to read runtime capture export: ${resolved}`,
      resolved,
    );
  } finally {
    await handle?.close().catch(() => undefined);
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
