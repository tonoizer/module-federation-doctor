import { createHash } from "node:crypto";

/** Values that can be safely persisted in an evidence document. */
export type EvidenceValue =
  | null
  | boolean
  | number
  | string
  | EvidenceValue[]
  | { [key: string]: EvidenceValue };

export type EvidenceProtocolVersion = 2;
export type EvidenceLayer = "declared" | "effective" | "artifact" | "deployment" | "runtime";
export type EvidenceConfidence = "exact" | "high" | "medium" | "low" | "unknown";
export type EvidenceCompleteness = "complete" | "partial" | "unknown" | "not-collected";
export type EvidenceSubjectKind =
  | "project"
  | "dependency"
  | "remote"
  | "expose"
  | "shared-package"
  | "build"
  | "artifact"
  | "deployment"
  | "runtime-instance";
export type EvidenceEdgeKind = "derived-from" | "conflicts-with" | "supersedes" | "identity";
export type RuleOutcome = "pass" | "fail" | "unknown" | "not-applicable";

export interface EvidenceProtocolIdentity {
  protocolVersion: EvidenceProtocolVersion;
  schemaVersion: EvidenceProtocolVersion;
  producer: { name: string; version: string };
  source: { kind: string; schemaVersion: string };
}

export interface EvidenceScope {
  adapter: string;
  bundler: { name: string; version?: string };
  target: "web" | "node" | "browser" | "ssr" | "unknown";
}

export interface EvidenceIdentity {
  project?: string;
  workspace?: string;
  buildId?: string;
  artifactDigest?: string;
  deploymentId?: string;
  releaseId?: string;
  runtimeInstanceId?: string;
  sessionId?: string;
  traceId?: string;
}

export interface EvidenceProvenance {
  collector: { name: string; version: string };
  inputKind: string;
  source?: string;
  sourceSchemaVersion?: string;
  location?: string;
  contentDigest?: string;
  parentEvidenceIds?: string[];
}

export interface EvidenceCompletenessInfo {
  status: EvidenceCompleteness;
  expectedCount?: number;
  observedCount?: number;
  missing?: string[];
  reason: string;
}

export interface EvidenceConfidenceInfo {
  level: EvidenceConfidence;
  reason: string;
}

export interface EvidenceSubject {
  id: string;
  kind: EvidenceSubjectKind;
  name: string;
  attributes?: Record<string, EvidenceValue>;
}

export interface EvidenceAssertion {
  id: string;
  subject: string;
  predicate: string;
  value: EvidenceValue;
  layer: EvidenceLayer;
  scope: EvidenceScope;
  identity?: EvidenceIdentity;
  provenance: EvidenceProvenance;
  confidence: EvidenceConfidenceInfo;
  completeness: EvidenceCompletenessInfo;
}

export interface EvidenceEdge {
  id: string;
  kind: EvidenceEdgeKind;
  from: string;
  to: string;
}

export interface EvidenceRuleEvaluation {
  id: string;
  rule: { id: string; version: string };
  subject: string;
  outcome: RuleOutcome;
  evidenceIds: string[];
  reason: string;
  completeness: EvidenceCompletenessInfo;
}

export interface EvidenceGraphV2 {
  protocol: EvidenceProtocolIdentity;
  scope: EvidenceScope;
  identity: EvidenceIdentity;
  subjects: EvidenceSubject[];
  assertions: EvidenceAssertion[];
  edges: EvidenceEdge[];
  evaluations: EvidenceRuleEvaluation[];
}

function isRecord(value: EvidenceValue): value is { [key: string]: EvidenceValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return a JSON-safe value with object keys sorted recursively. */
export function canonicalizeEvidenceValue(value: EvidenceValue): EvidenceValue {
  if (Array.isArray(value)) return value.map(canonicalizeEvidenceValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeEvidenceValue(value[key] ?? null)]),
  );
}

const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|authorization|cookie)/i;
const SECRET_VALUE = /(?:bearer\s+)[^\s]+|(?:token|secret|password|apikey)=([^&\s]+)/gi;
const ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp|var)\/)[^\s"']+/g;

/** Redact common secrets and machine-specific absolute paths before persistence. */
export function redactEvidenceValue(value: EvidenceValue, key?: string): EvidenceValue {
  if (key && SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(SECRET_VALUE, (_match, captured: string | undefined) =>
        captured ? _match.replace(captured, "[REDACTED]") : "[REDACTED]",
      )
      .replace(ABSOLUTE_PATH, "[PATH]");
  }
  if (Array.isArray(value)) return value.map((item) => redactEvidenceValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactEvidenceValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function stableJson(value: EvidenceValue): string {
  return JSON.stringify(canonicalizeEvidenceValue(redactEvidenceValue(value)));
}

/** Create a deterministic ID from a semantic evidence value. */
export function stableEvidenceId(prefix: string, value: EvidenceValue): string {
  const digest = createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 16);
  return `${prefix}:${digest}`;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

/** Return a redacted graph with all ID-bearing collections sorted for stable output. */
export function normalizeEvidenceGraph(graph: EvidenceGraphV2): EvidenceGraphV2 {
  const redacted = redactEvidenceValue(
    graph as unknown as EvidenceValue,
  ) as unknown as EvidenceGraphV2;
  const canonical = canonicalizeEvidenceValue(
    redacted as unknown as EvidenceValue,
  ) as unknown as EvidenceGraphV2;
  return {
    ...canonical,
    identity: canonical.identity,
    subjects: canonical.subjects.sort(byId),
    assertions: canonical.assertions.sort(byId),
    edges: canonical.edges.sort(byId),
    evaluations: canonical.evaluations
      .sort(byId)
      .map((evaluation) =>
        Object.assign({}, evaluation, { evidenceIds: evaluation.evidenceIds.slice().sort() }),
      ),
  };
}
