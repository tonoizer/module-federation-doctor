import type { EvidenceCompleteness, EvidenceProvenance } from "./evidence.js";

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

/** Safe defaults. These are ceilings for PR A and may only be lowered by callers. */
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
  source?: RuntimeCaptureSource;
  runtimeVersion?: string;
}

export interface RuntimeCaptureCapabilities {
  reports: RuntimeCaptureCapabilityInfo;
  sharedLifecycle: RuntimeCaptureCapabilityInfo;
  snapshot: RuntimeCaptureCapabilityInfo;
  instance: RuntimeCaptureCapabilityInfo;
  networkError: RuntimeCaptureCapabilityInfo;
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

export interface RuntimeCaptureRecord<T extends Record<string, unknown> = Record<string, unknown>> {
  identity: RuntimeCaptureIdentity;
  source: RuntimeCaptureSource;
  provenance: EvidenceProvenance;
  completeness: EvidenceCompleteness;
  value: T;
}

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

/** External, bounded evidence handoff. It contains no executable or arbitrary runtime objects. */
export interface RuntimeCaptureEnvelope {
  schemaVersion: 1;
  contractVersion: RuntimeCaptureContractVersion;
  collector: { name: string; version: string };
  transport: RuntimeCaptureTransport;
  captureId: string;
  capabilities: RuntimeCaptureCapabilities;
  limits: RuntimeCaptureLimits;
  truncation: RuntimeCaptureTruncation[];
  reports: RuntimeCaptureRecord[];
  events: RuntimeCaptureRecord[];
  devtools: RuntimeCaptureRecord[];
  snapshots: RuntimeCaptureRecord[];
  instances: RuntimeCaptureRecord[];
  network: RuntimeCaptureRecord[];
  errors: RuntimeCaptureRecord[];
  relations: RuntimeCaptureRelationRecord[];
}
