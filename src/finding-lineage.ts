import { createHash } from "node:crypto";
import type { IdentityRealm, IdentityTarget } from "./identity.js";
import { isSemanticIdentityKey } from "./identity-correlation.js";
import { compareCodePoint } from "./utils.js";

/** Version of the additive finding lineage and history contract. */
export const FINDING_LINEAGE_SCHEMA_VERSION = 1 as const;
export type FindingLineageSchemaVersion = typeof FINDING_LINEAGE_SCHEMA_VERSION;

export type FindingLineageOutcome = "pass" | "fail" | "unknown" | "not-applicable";
export type FindingLineageCompleteness = "complete" | "partial" | "unknown";
export type FindingLineageConfidence = "exact" | "strong" | "weak" | "unknown";
export type FindingLineageSeverity = "info" | "warning" | "error";
export type FindingOccurrenceBasis = "explicit" | "evidence" | "lineage";

export type FindingHistoryState =
  | "new"
  | "persistent"
  | "resolved"
  | "regressed"
  | "improved"
  | "unknown/unconfirmed";

export interface FindingLineageScope {
  target?: IdentityTarget;
  realm?: IdentityRealm;
  environmentKey?: string;
  buildLineageKey?: string;
  buildKey?: string;
  artifactKey?: string;
  deploymentKey?: string;
  runtimeRealmKey?: string;
  runtimeInstanceKey?: string;
  edgeKey?: string;
}

export type FindingIdentityDimensionValue = string | readonly string[];

export interface FindingLineageInput {
  ruleId: string;
  ruleVersion: string;
  /** Rule-owned identity schema version; it is not the V1 finding fingerprint version. */
  identitySchemaVersion?: 1;
  /** A semantic identity or capability-edge key, never a project display name. */
  subjectKey: string;
  /** Stable rule-defined key such as a package, expose, remote, or contract field. */
  violationKey: string;
  /** Only dimensions explicitly declared by the rule may affect lineage. */
  identityDimensions?: Readonly<Record<string, FindingIdentityDimensionValue>>;
  /** Scope dimensions are lineage material only when the caller supplies them explicitly. */
  scope?: FindingLineageScope;
  outcome: FindingLineageOutcome;
  completeness: FindingLineageCompleteness;
  confidence: FindingLineageConfidence;
  evidenceIds?: readonly string[];
  /** Trusted build/deployment/evaluation occurrence identity when supplied by the caller. */
  occurrenceKey?: string;
  severity?: FindingLineageSeverity;
}

export interface FindingLineageRecord {
  schemaVersion: FindingLineageSchemaVersion;
  findingLineageId: string;
  findingOccurrenceId: string;
  identitySchemaVersion: 1;
  rule: { id: string; version: string };
  subjectKey: string;
  violationKey: string;
  identityDimensions: Record<string, string | string[]>;
  scope?: FindingLineageScope;
  outcome: FindingLineageOutcome;
  completeness: FindingLineageCompleteness;
  confidence: FindingLineageConfidence;
  evidenceIds: string[];
  occurrenceBasis: FindingOccurrenceBasis;
  occurrenceKey?: string;
  severity?: FindingLineageSeverity;
}

export interface FindingHistorySnapshotInput {
  snapshotId: string;
  evaluations: readonly FindingLineageRecord[];
  completeness: FindingLineageCompleteness;
  /** False means that absence cannot prove resolution or a new finding. */
  comparable: boolean;
  missing?: readonly string[];
}

export interface FindingHistorySnapshot {
  schemaVersion: FindingLineageSchemaVersion;
  snapshotId: string;
  completeness: FindingLineageCompleteness;
  comparable: boolean;
  evaluations: FindingLineageRecord[];
  missing: string[];
}

export interface FindingHistoryChange {
  schemaVersion: FindingLineageSchemaVersion;
  findingLineageId: string;
  state: FindingHistoryState;
  reason: string;
  previousOutcome?: FindingLineageOutcome;
  currentOutcome?: FindingLineageOutcome;
  previousOccurrenceId?: string;
  currentOccurrenceId?: string;
}

export interface FindingHistoryDiff {
  schemaVersion: FindingLineageSchemaVersion;
  fromSnapshotId: string;
  toSnapshotId: string;
  comparable: boolean;
  changes: FindingHistoryChange[];
}

export class FindingLineageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FindingLineageValidationError";
  }
}

const TARGETS = new Set<IdentityTarget>(["browser", "ssr", "worker", "mobile", "node", "unknown"]);
const REALMS = new Set<IdentityRealm>([
  "top-frame",
  "iframe",
  "worker",
  "node",
  "react-native",
  "unknown",
]);
const OUTCOMES = new Set<FindingLineageOutcome>(["pass", "fail", "unknown", "not-applicable"]);
const COMPLETENESS = new Set<FindingLineageCompleteness>(["complete", "partial", "unknown"]);
const CONFIDENCE = new Set<FindingLineageConfidence>(["exact", "strong", "weak", "unknown"]);
const SEVERITIES = new Set<FindingLineageSeverity>(["info", "warning", "error"]);
const EDGE_KEY = /^mfedge:v1:[a-f0-9]{24}$/;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const URL_VALUE = /[a-z][a-z\d+.-]*:\/\//i;
const SENSITIVE_QUERY =
  /[?&](?:token|sig|signature|expires|auth|authorization|password|secret|credential|session|key)(?:=|&|$)/i;
const VOLATILE_VALUE =
  /^(?:\d{10,13}|\d{4}-\d{2}-\d{2}[Tt ]|(?:process|session|tab|pid|sid)(?:[-_:]|$))/i;
const UNSAFE_DIMENSION_NAME =
  /^(?:message|severity|reason|suggestion|timestamp|time|createdAt|updatedAt|path|line|column|location|owner|displayName)$/i;
const MAX_TEXT_LENGTH = 256;
const MAX_EVIDENCE_IDS = 32;
const MAX_DIMENSIONS = 32;
const MAX_DIMENSION_VALUES = 32;

type NormalizedScope = FindingLineageScope;

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FindingLineageValidationError(`${label} must be an object.`);
}

function safeText(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength)
    throw new FindingLineageValidationError(`${label} must be a bounded non-empty string.`);
  if (
    value.includes("\0") ||
    ABSOLUTE_PATH.test(value) ||
    URL_VALUE.test(value) ||
    SENSITIVE_QUERY.test(value) ||
    VOLATILE_VALUE.test(value)
  )
    throw new FindingLineageValidationError(`${label} contains unsafe or volatile data.`);
  return value;
}

function safeRuleId(value: unknown): string {
  const result = safeText(value, "ruleId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(result))
    throw new FindingLineageValidationError("ruleId contains unsupported characters.");
  return result;
}

function safeDimensionName(value: unknown): string {
  const result = safeText(value, "identity dimension name", 64);
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(result) || UNSAFE_DIMENSION_NAME.test(result))
    throw new FindingLineageValidationError(`Unsupported identity dimension name: ${result}.`);
  return result;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): T {
  if (typeof value !== "string" || !allowed.has(value as T))
    throw new FindingLineageValidationError(`${label} is unsupported.`);
  return value as T;
}

function identityReference(value: unknown, label: string, kind?: string): string {
  if (
    typeof value !== "string" ||
    !isSemanticIdentityKey(value) ||
    (kind && !value.startsWith(`mfid:v1:${kind}:`))
  )
    throw new FindingLineageValidationError(`${label} must be a semantic identity key.`);
  return value;
}

function subjectReference(value: unknown): string {
  if (typeof value !== "string" || (!isSemanticIdentityKey(value) && !EDGE_KEY.test(value)))
    throw new FindingLineageValidationError("subjectKey must be a semantic identity or edge key.");
  return value;
}

function normalizeDimensions(
  input: Readonly<Record<string, FindingIdentityDimensionValue>> | undefined,
): Record<string, string | string[]> {
  if (input === undefined) return {};
  assertObject(input, "identityDimensions");
  const entries = Object.entries(input);
  if (entries.length > MAX_DIMENSIONS)
    throw new FindingLineageValidationError("identityDimensions exceed maxProperties (32).");
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of entries) {
    const safeName = safeDimensionName(name);
    const values = Array.isArray(value) ? [...value] : [value];
    if (values.length === 0 || values.length > MAX_DIMENSION_VALUES)
      throw new FindingLineageValidationError(
        `identityDimensions.${safeName} exceeds maxItems (32) or is empty.`,
      );
    const safeValues = values.map((item) => safeText(item, `identityDimensions.${safeName}`));
    const unique = [...new Set(safeValues)].sort(compareCodePoint);
    result[safeName] = Array.isArray(value) ? unique : unique[0]!;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => compareCodePoint(left, right)),
  );
}

function normalizeScope(input: FindingLineageScope | undefined): NormalizedScope | undefined {
  if (input === undefined) return undefined;
  assertObject(input, "scope");
  const allowed = new Set([
    "target",
    "realm",
    "environmentKey",
    "buildLineageKey",
    "buildKey",
    "artifactKey",
    "deploymentKey",
    "runtimeRealmKey",
    "runtimeInstanceKey",
    "edgeKey",
  ]);
  for (const key of Object.keys(input))
    if (!allowed.has(key))
      throw new FindingLineageValidationError(`Unsupported scope field: ${key}.`);
  const scope: NormalizedScope = {};
  if (input.target !== undefined) scope.target = enumValue(input.target, TARGETS, "scope.target");
  if (input.realm !== undefined) scope.realm = enumValue(input.realm, REALMS, "scope.realm");
  if (input.environmentKey !== undefined)
    scope.environmentKey = identityReference(
      input.environmentKey,
      "scope.environmentKey",
      "environment",
    );
  if (input.buildLineageKey !== undefined)
    scope.buildLineageKey = identityReference(
      input.buildLineageKey,
      "scope.buildLineageKey",
      "build-lineage",
    );
  if (input.buildKey !== undefined)
    scope.buildKey = identityReference(input.buildKey, "scope.buildKey", "build");
  if (input.artifactKey !== undefined)
    scope.artifactKey = identityReference(input.artifactKey, "scope.artifactKey", "artifact");
  if (input.deploymentKey !== undefined)
    scope.deploymentKey = identityReference(
      input.deploymentKey,
      "scope.deploymentKey",
      "deployment",
    );
  if (input.runtimeRealmKey !== undefined)
    scope.runtimeRealmKey = identityReference(
      input.runtimeRealmKey,
      "scope.runtimeRealmKey",
      "runtime-realm",
    );
  if (input.runtimeInstanceKey !== undefined)
    scope.runtimeInstanceKey = identityReference(
      input.runtimeInstanceKey,
      "scope.runtimeInstanceKey",
      "runtime-instance",
    );
  if (input.edgeKey !== undefined) {
    if (typeof input.edgeKey !== "string" || !EDGE_KEY.test(input.edgeKey))
      throw new FindingLineageValidationError(
        "scope.edgeKey must be an identity capability edge key.",
      );
    scope.edgeKey = input.edgeKey;
  }
  return Object.keys(scope).length > 0 ? scope : undefined;
}

function normalizeEvidenceIds(input: readonly string[] | undefined): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_EVIDENCE_IDS)
    throw new FindingLineageValidationError("evidenceIds exceed maxItems (32).");
  return [...new Set(input.map((id) => safeText(id, "evidenceId", 128)))].sort(compareCodePoint);
}

function digest(prefix: string, value: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function occurrenceBasis(
  occurrenceKey: string | undefined,
  evidenceIds: readonly string[],
  scope: FindingLineageScope | undefined,
): FindingOccurrenceBasis {
  if (occurrenceKey !== undefined) return "explicit";
  if (
    evidenceIds.length > 0 ||
    scope?.buildKey ||
    scope?.artifactKey ||
    scope?.deploymentKey ||
    scope?.runtimeInstanceKey
  )
    return "evidence";
  return "lineage";
}

/** Create a stable semantic finding lineage and a separate occurrence identity. */
export function createFindingLineage(input: FindingLineageInput): FindingLineageRecord {
  if ((input.identitySchemaVersion ?? 1) !== 1)
    throw new FindingLineageValidationError("Only finding identity schema version 1 is supported.");
  const ruleId = safeRuleId(input.ruleId);
  const ruleVersion = safeText(input.ruleVersion, "ruleVersion", 64);
  const subjectKey = subjectReference(input.subjectKey);
  const violationKey = safeText(input.violationKey, "violationKey");
  const identityDimensions = normalizeDimensions(input.identityDimensions);
  const scope = normalizeScope(input.scope);
  const outcome = enumValue(input.outcome, OUTCOMES, "outcome");
  const completeness = enumValue(input.completeness, COMPLETENESS, "completeness");
  const confidence = enumValue(input.confidence, CONFIDENCE, "confidence");
  const evidenceIds = normalizeEvidenceIds(input.evidenceIds);
  const occurrenceKey =
    input.occurrenceKey === undefined ? undefined : safeText(input.occurrenceKey, "occurrenceKey");
  const severity =
    input.severity === undefined ? undefined : enumValue(input.severity, SEVERITIES, "severity");
  const identitySchemaVersion = 1 as const;
  const material = {
    ruleId,
    identitySchemaVersion,
    subjectKey,
    violationKey,
    identityDimensions,
    ...(scope ? { scope } : {}),
  };
  const findingLineageId = digest("mffinding:v1", material);
  const basis = occurrenceBasis(occurrenceKey, evidenceIds, scope);
  const findingOccurrenceId = digest("mffinding-occurrence:v1", {
    findingLineageId,
    outcome,
    ...(occurrenceKey ? { occurrenceKey } : {}),
    evidenceIds,
    ...(scope ? { scope } : {}),
  });
  return {
    schemaVersion: FINDING_LINEAGE_SCHEMA_VERSION,
    findingLineageId,
    findingOccurrenceId,
    identitySchemaVersion,
    rule: { id: ruleId, version: ruleVersion },
    subjectKey,
    violationKey,
    identityDimensions,
    ...(scope ? { scope } : {}),
    outcome,
    completeness,
    confidence,
    evidenceIds,
    occurrenceBasis: basis,
    ...(occurrenceKey ? { occurrenceKey } : {}),
    ...(severity ? { severity } : {}),
  };
}

function inputFromRecord(record: FindingLineageRecord): FindingLineageInput {
  return {
    ruleId: record.rule.id,
    ruleVersion: record.rule.version,
    identitySchemaVersion: record.identitySchemaVersion,
    subjectKey: record.subjectKey,
    violationKey: record.violationKey,
    identityDimensions: record.identityDimensions,
    ...(record.scope ? { scope: record.scope } : {}),
    outcome: record.outcome,
    completeness: record.completeness,
    confidence: record.confidence,
    evidenceIds: record.evidenceIds,
    ...(record.occurrenceKey ? { occurrenceKey: record.occurrenceKey } : {}),
    ...(record.severity ? { severity: record.severity } : {}),
  };
}

function normalizeRecord(record: FindingLineageRecord): FindingLineageRecord {
  if (!record || typeof record !== "object")
    throw new FindingLineageValidationError("Finding lineage evaluation must be an object.");
  if (record.schemaVersion !== FINDING_LINEAGE_SCHEMA_VERSION)
    throw new FindingLineageValidationError("Unsupported finding lineage schema version.");
  const normalized = createFindingLineage(inputFromRecord(record));
  if (
    normalized.findingLineageId !== record.findingLineageId ||
    normalized.findingOccurrenceId !== record.findingOccurrenceId ||
    normalized.occurrenceBasis !== record.occurrenceBasis
  )
    throw new FindingLineageValidationError(
      "Finding lineage IDs do not match canonical identity material.",
    );
  return normalized;
}

/** Validate a record supplied by a persisted history consumer. */
export function assertFindingLineageRecord(value: unknown): asserts value is FindingLineageRecord {
  normalizeRecord(value as FindingLineageRecord);
}

/** Normalize and validate one bounded offline history snapshot. */
export function createFindingHistorySnapshot(
  input: FindingHistorySnapshotInput,
): FindingHistorySnapshot {
  const snapshotId = safeText(input.snapshotId, "snapshotId", 128);
  const completeness = enumValue(input.completeness, COMPLETENESS, "snapshot.completeness");
  if (typeof input.comparable !== "boolean")
    throw new FindingLineageValidationError("snapshot.comparable must be boolean.");
  const missing = [
    ...new Set((input.missing ?? []).map((item) => safeText(item, "snapshot.missing", 128))),
  ].sort(compareCodePoint);
  if (completeness === "complete" && missing.length > 0)
    throw new FindingLineageValidationError("Complete snapshots cannot declare missing fields.");
  if (!Array.isArray(input.evaluations) || input.evaluations.length > 10_000)
    throw new FindingLineageValidationError("snapshot.evaluations exceed maxItems (10000).");
  const evaluations = input.evaluations
    .map(normalizeRecord)
    .sort((left, right) => compareCodePoint(left.findingLineageId, right.findingLineageId));
  for (let index = 1; index < evaluations.length; index += 1) {
    if (evaluations[index - 1]!.findingLineageId === evaluations[index]!.findingLineageId)
      throw new FindingLineageValidationError(
        `Duplicate evaluation for lineage ${evaluations[index]!.findingLineageId}.`,
      );
  }
  return {
    schemaVersion: FINDING_LINEAGE_SCHEMA_VERSION,
    snapshotId,
    completeness,
    comparable: input.comparable,
    evaluations,
    missing,
  };
}

function fullyComparable(
  previous: FindingHistorySnapshot,
  current: FindingHistorySnapshot,
): boolean {
  return (
    previous.comparable &&
    current.comparable &&
    previous.completeness === "complete" &&
    current.completeness === "complete" &&
    previous.missing.length === 0 &&
    current.missing.length === 0
  );
}

function severityRank(value: FindingLineageSeverity | undefined): number {
  return value === "error" ? 3 : value === "warning" ? 2 : value === "info" ? 1 : 0;
}

function change(
  findingLineageId: string,
  state: FindingHistoryState,
  reason: string,
  previous: FindingLineageRecord | undefined,
  current: FindingLineageRecord | undefined,
): FindingHistoryChange {
  return {
    schemaVersion: FINDING_LINEAGE_SCHEMA_VERSION,
    findingLineageId,
    state,
    reason,
    ...(previous
      ? { previousOutcome: previous.outcome, previousOccurrenceId: previous.findingOccurrenceId }
      : {}),
    ...(current
      ? { currentOutcome: current.outcome, currentOccurrenceId: current.findingOccurrenceId }
      : {}),
  };
}

function classifyHistory(
  previous: FindingLineageRecord | undefined,
  current: FindingLineageRecord | undefined,
  comparable: boolean,
): { state: FindingHistoryState; reason: string } | undefined {
  if (!previous && !current) return undefined;
  if (!comparable)
    return { state: "unknown/unconfirmed", reason: "snapshots are not fully comparable" };
  if (!previous) {
    if (current?.outcome === "fail")
      return { state: "new", reason: "a complete snapshot contains a new failure" };
    if (current?.outcome === "unknown")
      return {
        state: "unknown/unconfirmed",
        reason: "the first comparable snapshot is inconclusive",
      };
    return undefined;
  }
  if (!current) {
    if (previous.outcome === "fail")
      return {
        state: "resolved",
        reason: "a complete later snapshot no longer contains the failure",
      };
    return undefined;
  }
  if (previous.completeness !== "complete" || current.completeness !== "complete")
    return { state: "unknown/unconfirmed", reason: "finding prerequisites are incomplete" };
  if (previous.outcome === "fail" && current.outcome === "fail") {
    const before = severityRank(previous.severity);
    const after = severityRank(current.severity);
    if (before > 0 && after > 0 && after < before)
      return { state: "improved", reason: "the failure persists at a lower declared severity" };
    if (before > 0 && after > before)
      return { state: "regressed", reason: "the failure persists at a higher declared severity" };
    return { state: "persistent", reason: "the failure remains in the comparable snapshot" };
  }
  if (
    previous.outcome === "fail" &&
    (current.outcome === "pass" || current.outcome === "not-applicable")
  )
    return { state: "resolved", reason: "a complete later snapshot is healthy or not applicable" };
  if (
    (previous.outcome === "pass" || previous.outcome === "not-applicable") &&
    current.outcome === "fail"
  )
    return { state: "regressed", reason: "a complete later snapshot contains a new failure" };
  if (previous.outcome === "unknown" || current.outcome === "unknown")
    return { state: "unknown/unconfirmed", reason: "one comparable evaluation is inconclusive" };
  return undefined;
}

/** Diff two validated offline snapshots without changing V1 reports or fingerprints. */
export function diffFindingHistory(
  previousInput: FindingHistorySnapshot,
  currentInput: FindingHistorySnapshot,
): FindingHistoryDiff {
  const previous = createFindingHistorySnapshot(previousInput);
  const current = createFindingHistorySnapshot(currentInput);
  const previousByLineage = new Map(
    previous.evaluations.map((item) => [item.findingLineageId, item]),
  );
  const currentByLineage = new Map(
    current.evaluations.map((item) => [item.findingLineageId, item]),
  );
  const lineageIds = [...new Set([...previousByLineage.keys(), ...currentByLineage.keys()])].sort(
    compareCodePoint,
  );
  const comparable = fullyComparable(previous, current);
  const changes: FindingHistoryChange[] = [];
  for (const lineageId of lineageIds) {
    const before = previousByLineage.get(lineageId);
    const after = currentByLineage.get(lineageId);
    const result = classifyHistory(before, after, comparable);
    if (!result) continue;
    changes.push(change(lineageId, result.state, result.reason, before, after));
  }
  return {
    schemaVersion: FINDING_LINEAGE_SCHEMA_VERSION,
    fromSnapshotId: previous.snapshotId,
    toSnapshotId: current.snapshotId,
    comparable,
    changes,
  };
}

/** Diff every adjacent pair in a deterministic multi-snapshot history. */
export function diffFindingHistorySeries(
  snapshots: readonly FindingHistorySnapshot[],
): FindingHistoryDiff[] {
  if (snapshots.length < 2)
    throw new FindingLineageValidationError("History requires at least two snapshots.");
  const normalized = snapshots.map((snapshot) => createFindingHistorySnapshot(snapshot));
  return normalized
    .slice(1)
    .map((snapshot, index) => diffFindingHistory(normalized[index]!, snapshot));
}
