import { createHash } from "node:crypto";
import type {
  IdentityConfidence,
  IdentityCompleteness,
  IdentityKind,
  IdentityRealm,
  IdentityTarget,
  SemanticIdentity,
} from "./identity.js";
import { IdentityValidationError } from "./identity.js";
import { compareCodePoint } from "./utils.js";

/** Version of the additive semantic-correlation contract. */
export const IDENTITY_CORRELATION_SCHEMA_VERSION = 1 as const;
export type IdentityCorrelationSchemaVersion = typeof IDENTITY_CORRELATION_SCHEMA_VERSION;

export type IdentityCorrelationOutcome = "exact" | "strong" | "weak" | "ambiguous" | "unknown";

export interface IdentityCorrelationScope {
  target?: IdentityTarget;
  realm?: IdentityRealm;
  environmentKey?: string;
}

export interface IdentityCorrelationCandidate {
  identityKey: string;
  kind: IdentityKind;
  outcome: Exclude<IdentityCorrelationOutcome, "ambiguous">;
  matchedDimensions: string[];
  missingDimensions: string[];
  conflicts: string[];
}

export interface IdentityCorrelationResult {
  schemaVersion: IdentityCorrelationSchemaVersion;
  subjectKey: string;
  subjectKind: IdentityKind;
  outcome: IdentityCorrelationOutcome;
  candidateKeys: string[];
  candidates: IdentityCorrelationCandidate[];
  matchedDimensions: string[];
  missingDimensions: string[];
  conflicts: string[];
  reason: string;
  truncated: boolean;
  scope?: IdentityCorrelationScope;
}

export interface IdentityCorrelationOptions {
  scope?: IdentityCorrelationScope;
  maxCandidates?: number;
}

export type IdentityCapabilityEdgeKind = "producer" | "consumer" | "shared-provider" | "runtime";

export interface IdentityCapabilityEdge {
  schemaVersion: IdentityCorrelationSchemaVersion;
  id: string;
  kind: IdentityCapabilityEdgeKind;
  fromKey: string;
  toKey: string;
  scope: IdentityCorrelationScope;
  outcome: IdentityCorrelationOutcome;
  completeness: IdentityCompleteness;
  evidenceIds: string[];
}

export interface CreateIdentityCapabilityEdgeOptions {
  kind: IdentityCapabilityEdgeKind;
  fromKey: string;
  toKey: string;
  scope: IdentityCorrelationScope;
  outcome?: IdentityCorrelationOutcome;
  completeness?: IdentityCompleteness;
  evidenceIds?: readonly string[];
}

export type IdentityCapabilityCoverageState = "complete" | "partial" | "unknown";

export interface IdentityCapabilityCoverage {
  schemaVersion: IdentityCorrelationSchemaVersion;
  scope: IdentityCorrelationScope;
  expectedKinds: IdentityCapabilityEdgeKind[];
  observedKinds: IdentityCapabilityEdgeKind[];
  missingKinds: IdentityCapabilityEdgeKind[];
  weakKinds: IdentityCapabilityEdgeKind[];
  unresolvedKinds: IdentityCapabilityEdgeKind[];
  observedEdges: number;
  state: IdentityCapabilityCoverageState;
  reason: string;
}

export interface IdentityCapabilityCoverageOptions {
  scope: IdentityCorrelationScope;
  expectedKinds?: readonly IdentityCapabilityEdgeKind[];
}

const IDENTITY_KEY = /^mfid:v1:[a-z-]+:[a-f0-9]{24}$/;
const EDGE_ID = /^mfedge:v1:[a-f0-9]{24}$/;
const TARGETS = new Set<IdentityTarget>(["browser", "ssr", "worker", "mobile", "node", "unknown"]);
const REALMS = new Set<IdentityRealm>([
  "top-frame",
  "iframe",
  "worker",
  "node",
  "react-native",
  "unknown",
]);
const OUTCOMES = new Set<IdentityCorrelationOutcome>([
  "exact",
  "strong",
  "weak",
  "ambiguous",
  "unknown",
]);
const COMPLETENESS = new Set<IdentityCompleteness>(["complete", "partial", "unknown"]);
const EDGE_KINDS = new Set<IdentityCapabilityEdgeKind>([
  "producer",
  "consumer",
  "shared-provider",
  "runtime",
]);
const MAX_CANDIDATES = 100;
const DEFAULT_MAX_CANDIDATES = 32;
const MAX_EVIDENCE_IDS = 32;
const MAX_EVIDENCE_ID_LENGTH = 128;
const MAX_SCOPE_KEY_LENGTH = 128;
const UNSAFE_VALUE =
  /(?:[A-Za-z]:[\\/]|\\\\|^\/|[a-z][a-z\d+.-]*:\/\/|[?&](?:token|sig|signature|expires|auth|authorization|password|secret|credential|session|key)(?:=|&|$))/i;
const DIMENSIONS: Record<IdentityKind, readonly string[]> = {
  organization: ["organizationId"],
  application: ["organizationId", "applicationId"],
  container: ["organizationId", "applicationId", "containerName"],
  "adapter-target": [
    "organizationId",
    "applicationId",
    "containerName",
    "adapter",
    "bundler",
    "bundlerVersion",
    "target",
    "mode",
    "buildEnvironment",
  ],
  "build-lineage": [
    "organizationId",
    "applicationId",
    "adapterTargetKey",
    "lane",
    "target",
    "environment",
  ],
  build: ["buildLineageKey", "buildId"],
  artifact: ["buildKey", "artifactKind", "digest"],
  environment: ["organizationId", "environment"],
  deployment: ["environmentKey", "deploymentId", "artifactSetDigest", "artifactKeys"],
  "runtime-realm": ["deploymentKey", "realm", "realmId"],
  "runtime-instance": ["realmKey", "runtimeInstanceId", "runtimePackage", "runtimeVersion"],
};
const OUTCOME_RANK: Record<Exclude<IdentityCorrelationOutcome, "ambiguous">, number> = {
  exact: 4,
  strong: 3,
  weak: 2,
  unknown: 0,
};

function assertIdentityKey(value: string, label: string): void {
  if (!IDENTITY_KEY.test(value))
    throw new IdentityValidationError(`${label} must be a semantic identity key.`);
}

function assertSafeBoundedString(
  value: string,
  label: string,
  maxLength = MAX_SCOPE_KEY_LENGTH,
): void {
  if (value.length === 0 || value.length > maxLength || UNSAFE_VALUE.test(value))
    throw new IdentityValidationError(`${label} must be a bounded safe value.`);
}

function assertScope(scope: IdentityCorrelationScope, label = "scope"): IdentityCorrelationScope {
  if (!scope || typeof scope !== "object")
    throw new IdentityValidationError(`${label} must be an object.`);
  if (scope.target !== undefined && !TARGETS.has(scope.target))
    throw new IdentityValidationError(`${label}.target must be a supported target.`);
  if (scope.realm !== undefined && !REALMS.has(scope.realm))
    throw new IdentityValidationError(`${label}.realm must be a supported realm.`);
  if (scope.environmentKey !== undefined) {
    assertIdentityKey(scope.environmentKey, `${label}.environmentKey`);
    if (!scope.environmentKey.startsWith("mfid:v1:environment:"))
      throw new IdentityValidationError(`${label}.environmentKey must reference an environment.`);
  }
  return {
    ...(scope.target === undefined ? {} : { target: scope.target }),
    ...(scope.realm === undefined ? {} : { realm: scope.realm }),
    ...(scope.environmentKey === undefined ? {} : { environmentKey: scope.environmentKey }),
  };
}

function assertIdentity(identity: SemanticIdentity, label: string): void {
  if (!identity || typeof identity !== "object")
    throw new IdentityValidationError(`${label} must be an identity object.`);
  if (identity.schemaVersion !== 1)
    throw new IdentityValidationError(`${label} has an unsupported schema version.`);
  if (!IDENTITY_KEY.test(identity.key) || !identity.key.startsWith(`mfid:v1:${identity.kind}:`))
    throw new IdentityValidationError(`${label}.key must match its identity kind.`);
  if (identity.parentKey !== undefined) assertIdentityKey(identity.parentKey, `${label}.parentKey`);
}

function valueOf(identity: SemanticIdentity, name: string): string | string[] | undefined {
  const value = (identity as unknown as Record<string, unknown>)[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return [...value] as string[];
  return undefined;
}

function normalizedValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? [...new Set(value)].sort(compareCodePoint).join("\u0000") : value;
}

function isUnknownValue(value: string | string[] | undefined): boolean {
  return (
    value === "unknown" ||
    (Array.isArray(value) && value.length > 0 && value.every((item) => item === "unknown"))
  );
}

function identityScope(identity: SemanticIdentity): IdentityCorrelationScope {
  const target = valueOf(identity, "target");
  const realm = valueOf(identity, "realm");
  const environmentKey =
    identity.kind === "environment"
      ? identity.key
      : identity.kind === "deployment"
        ? identity.parentKey
        : valueOf(identity, "environmentKey");
  return {
    ...(typeof target === "string" && TARGETS.has(target as IdentityTarget)
      ? { target: target as IdentityTarget }
      : {}),
    ...(typeof realm === "string" && REALMS.has(realm as IdentityRealm)
      ? { realm: realm as IdentityRealm }
      : {}),
    ...(typeof environmentKey === "string" && IDENTITY_KEY.test(environmentKey)
      ? { environmentKey }
      : {}),
  };
}

function scopeConflicts(
  subject: IdentityCorrelationScope,
  candidate: IdentityCorrelationScope,
  requested: IdentityCorrelationScope | undefined,
): string[] {
  const conflicts: string[] = [];
  for (const name of ["target", "realm", "environmentKey"] as const) {
    const expected = requested?.[name];
    const subjectValue = subject[name];
    const candidateValue = candidate[name];
    if (expected !== undefined && subjectValue !== undefined && subjectValue !== expected)
      conflicts.push(`scope.${name}`);
    if (expected !== undefined && candidateValue !== undefined && candidateValue !== expected)
      conflicts.push(`scope.${name}`);
    if (
      requested === undefined &&
      subjectValue !== undefined &&
      candidateValue !== undefined &&
      subjectValue !== candidateValue
    )
      conflicts.push(`scope.${name}`);
  }
  return [...new Set(conflicts)].sort(compareCodePoint);
}

function dimensionComparison(
  subject: SemanticIdentity,
  candidate: SemanticIdentity,
): {
  matched: string[];
  missing: string[];
  conflicts: string[];
} {
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicts: string[] = [];
  if (subject.parentKey !== undefined && candidate.parentKey !== undefined) {
    if (subject.parentKey === candidate.parentKey) matched.push("parentKey");
    else conflicts.push("parentKey");
  } else {
    missing.push("parentKey");
  }
  for (const name of DIMENSIONS[subject.kind]) {
    const left = valueOf(subject, name);
    const right = valueOf(candidate, name);
    if (
      left === undefined ||
      right === undefined ||
      isUnknownValue(left) ||
      isUnknownValue(right)
    ) {
      missing.push(name);
      continue;
    }
    if (normalizedValue(left) === normalizedValue(right)) matched.push(name);
    else conflicts.push(name);
  }
  const subjectAlias = new Set(subject.aliases);
  if (candidate.aliases.some((alias) => subjectAlias.has(alias))) matched.push("alias");
  if (subject.displayName !== undefined && subject.displayName === candidate.displayName)
    matched.push("displayName");
  return {
    matched: [...new Set(matched)].sort(compareCodePoint),
    missing: [...new Set(missing)].sort(compareCodePoint),
    conflicts: [...new Set(conflicts)].sort(compareCodePoint),
  };
}

function classifyCandidate(
  subject: SemanticIdentity,
  candidate: SemanticIdentity,
  requestedScope: IdentityCorrelationScope | undefined,
): IdentityCorrelationCandidate {
  assertIdentity(candidate, "candidate");
  if (subject.kind !== candidate.kind) {
    return {
      identityKey: candidate.key,
      kind: candidate.kind,
      outcome: "unknown",
      matchedDimensions: [],
      missingDimensions: [],
      conflicts: ["kind"],
    };
  }
  const scopeConflictList = scopeConflicts(
    identityScope(subject),
    identityScope(candidate),
    requestedScope,
  );
  if (subject.key === candidate.key) {
    return {
      identityKey: candidate.key,
      kind: candidate.kind,
      outcome: scopeConflictList.length === 0 ? "exact" : "unknown",
      matchedDimensions: scopeConflictList.length === 0 ? ["key"] : [],
      missingDimensions: [],
      conflicts: scopeConflictList,
    };
  }
  const comparison = dimensionComparison(subject, candidate);
  const conflicts = [...new Set([...comparison.conflicts, ...scopeConflictList])].sort(
    compareCodePoint,
  );
  const parentMatch = comparison.matched.includes("parentKey");
  const stableMatches = comparison.matched.filter(
    (name) =>
      name !== "parentKey" && name !== "alias" && name !== "displayName" && !name.endsWith("Key"),
  );
  const aliasOrNameMatch =
    comparison.matched.includes("alias") || comparison.matched.includes("displayName");
  let outcome: Exclude<IdentityCorrelationOutcome, "ambiguous"> = "unknown";
  if (conflicts.length === 0) {
    if (parentMatch && stableMatches.length > 0) outcome = "strong";
    else if (stableMatches.length >= 2) outcome = "strong";
    else if (parentMatch || stableMatches.length > 0 || aliasOrNameMatch) outcome = "weak";
  }
  return {
    identityKey: candidate.key,
    kind: candidate.kind,
    outcome,
    matchedDimensions: comparison.matched,
    missingDimensions: comparison.missing,
    conflicts,
  };
}

function correlationReason(outcome: IdentityCorrelationOutcome, truncated: boolean): string {
  if (truncated) return "candidate limit reached; inspect retained candidates before acting";
  switch (outcome) {
    case "exact":
      return "stable semantic key matched exactly";
    case "strong":
      return "same semantic kind and stable parent/dimensions matched without conflicts";
    case "weak":
      return "candidate shares limited stable evidence; ownership and causality remain unproven";
    case "ambiguous":
      return "multiple candidates share the strongest available evidence";
    case "unknown":
      return "required evidence is missing, incompatible, or out of scope";
  }
}

/** Return whether a value has the public semantic identity-key grammar. */
export function isSemanticIdentityKey(value: unknown): value is string {
  return typeof value === "string" && IDENTITY_KEY.test(value);
}

/**
 * Correlate one semantic identity against bounded offline candidates.
 * The function never selects an arbitrary winner: ties are returned as ambiguous.
 */
export function correlateSemanticIdentity(
  subject: SemanticIdentity,
  candidates: readonly SemanticIdentity[],
  options: IdentityCorrelationOptions = {},
): IdentityCorrelationResult {
  assertIdentity(subject, "subject");
  const scope = options.scope === undefined ? undefined : assertScope(options.scope);
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > MAX_CANDIDATES)
    throw new IdentityValidationError(
      `maxCandidates must be an integer between 1 and ${MAX_CANDIDATES}.`,
    );
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        Number(right.candidate.key === subject.key) - Number(left.candidate.key === subject.key) ||
        compareCodePoint(left.candidate.key, right.candidate.key) ||
        left.index - right.index,
    );
  const truncated = ordered.length > maxCandidates;
  const evaluated = ordered
    .slice(0, maxCandidates)
    .map(({ candidate }) => classifyCandidate(subject, candidate, scope));
  const candidatesOut = evaluated.sort(
    (left, right) =>
      OUTCOME_RANK[right.outcome] - OUTCOME_RANK[left.outcome] ||
      compareCodePoint(left.identityKey, right.identityKey) ||
      compareCodePoint(left.conflicts.join("\u0000"), right.conflicts.join("\u0000")),
  );
  const qualified = candidatesOut.filter((candidate) => candidate.outcome !== "unknown");
  const topRank = qualified.length === 0 ? 0 : OUTCOME_RANK[qualified[0]!.outcome];
  const strongest = qualified.filter((candidate) => OUTCOME_RANK[candidate.outcome] === topRank);
  const outcome: IdentityCorrelationOutcome =
    strongest.length === 0 ? "unknown" : strongest.length > 1 ? "ambiguous" : strongest[0]!.outcome;
  const common = (field: "matchedDimensions" | "missingDimensions" | "conflicts"): string[] => {
    if (strongest.length === 0) return [];
    const intersection = new Set(strongest[0]![field]);
    for (const candidate of strongest.slice(1)) {
      const values = new Set(candidate[field]);
      for (const value of intersection) if (!values.has(value)) intersection.delete(value);
    }
    return [...intersection].sort(compareCodePoint);
  };
  const allConflicts = [...new Set(candidatesOut.flatMap((candidate) => candidate.conflicts))].sort(
    compareCodePoint,
  );
  return {
    schemaVersion: IDENTITY_CORRELATION_SCHEMA_VERSION,
    subjectKey: subject.key,
    subjectKind: subject.kind,
    outcome,
    candidateKeys: candidatesOut.map((candidate) => candidate.identityKey),
    candidates: candidatesOut,
    matchedDimensions: common("matchedDimensions"),
    missingDimensions:
      strongest.length === 0
        ? []
        : [...new Set(strongest.flatMap((candidate) => candidate.missingDimensions))].sort(
            compareCodePoint,
          ),
    conflicts: allConflicts,
    reason: correlationReason(outcome, truncated),
    truncated,
    ...(scope === undefined ? {} : { scope }),
  };
}

function canonicalScope(scope: IdentityCorrelationScope): string {
  return JSON.stringify({
    ...(scope.environmentKey === undefined ? {} : { environmentKey: scope.environmentKey }),
    ...(scope.realm === undefined ? {} : { realm: scope.realm }),
    ...(scope.target === undefined ? {} : { target: scope.target }),
  });
}

function canonicalEdgeInput(options: CreateIdentityCapabilityEdgeOptions): string {
  return JSON.stringify({
    completeness: options.completeness ?? "unknown",
    evidenceIds: [...new Set(options.evidenceIds ?? [])].sort(compareCodePoint),
    fromKey: options.fromKey,
    kind: options.kind,
    outcome: options.outcome ?? "unknown",
    scope: JSON.parse(canonicalScope(options.scope)) as IdentityCorrelationScope,
    toKey: options.toKey,
  });
}

function validateEvidenceIds(evidenceIds: readonly string[]): string[] {
  if (evidenceIds.length > MAX_EVIDENCE_IDS)
    throw new IdentityValidationError("evidenceIds exceed maxItems (32).");
  const normalized = [...new Set(evidenceIds)];
  for (const evidenceId of normalized)
    assertSafeBoundedString(evidenceId, "evidenceIds", MAX_EVIDENCE_ID_LENGTH);
  return normalized.sort(compareCodePoint);
}

/** Create a deterministic, scoped capability edge. IDs contain only a digest. */
export function createIdentityCapabilityEdge(
  options: CreateIdentityCapabilityEdgeOptions,
): IdentityCapabilityEdge {
  if (!EDGE_KINDS.has(options.kind))
    throw new IdentityValidationError("Unsupported capability edge kind.");
  assertIdentityKey(options.fromKey, "fromKey");
  assertIdentityKey(options.toKey, "toKey");
  if (options.fromKey === options.toKey)
    throw new IdentityValidationError("Capability edge endpoints must be distinct.");
  const scope = assertScope(options.scope);
  const outcome = options.outcome ?? "unknown";
  const completeness = options.completeness ?? "unknown";
  if (!OUTCOMES.has(outcome))
    throw new IdentityValidationError("Unsupported capability edge outcome.");
  if (!COMPLETENESS.has(completeness))
    throw new IdentityValidationError("Unsupported edge completeness.");
  const evidenceIds = validateEvidenceIds(options.evidenceIds ?? []);
  const normalized = { ...options, scope, outcome, completeness, evidenceIds };
  const digest = createHash("sha256")
    .update(canonicalEdgeInput(normalized))
    .digest("hex")
    .slice(0, 24);
  return {
    schemaVersion: IDENTITY_CORRELATION_SCHEMA_VERSION,
    id: `mfedge:v1:${digest}`,
    kind: options.kind,
    fromKey: options.fromKey,
    toKey: options.toKey,
    scope,
    outcome,
    completeness,
    evidenceIds,
  };
}

function edgeMatchesScope(edge: IdentityCapabilityEdge, scope: IdentityCorrelationScope): boolean {
  for (const name of ["target", "realm", "environmentKey"] as const) {
    const expected = scope[name];
    if (expected !== undefined && edge.scope[name] !== expected) return false;
  }
  return true;
}

function scopeIsBounded(scope: IdentityCorrelationScope): boolean {
  return (
    scope.target !== undefined || scope.realm !== undefined || scope.environmentKey !== undefined
  );
}

/** Assess capability coverage without allowing one target or realm to upgrade another. */
export function assessIdentityCapabilityCoverage(
  edges: readonly IdentityCapabilityEdge[],
  options: IdentityCapabilityCoverageOptions,
): IdentityCapabilityCoverage {
  const scope = assertScope(options.scope);
  const expectedKinds = [...new Set(options.expectedKinds ?? [...EDGE_KINDS])].sort(
    compareCodePoint,
  );
  for (const kind of expectedKinds)
    if (!EDGE_KINDS.has(kind))
      throw new IdentityValidationError("Unsupported expected capability edge kind.");
  const scoped = edges.filter((edge) => edgeMatchesScope(edge, scope));
  const observedKinds = [...new Set(scoped.map((edge) => edge.kind))].sort(compareCodePoint);
  const missingKinds = expectedKinds.filter((kind) => !observedKinds.includes(kind));
  const weakKinds = expectedKinds.filter((kind) =>
    scoped.some(
      (edge) => edge.kind === kind && (edge.outcome === "weak" || edge.completeness !== "complete"),
    ),
  );
  const unresolvedKinds = expectedKinds.filter((kind) =>
    scoped.some(
      (edge) => edge.kind === kind && (edge.outcome === "unknown" || edge.outcome === "ambiguous"),
    ),
  );
  const completeKinds = expectedKinds.filter((kind) =>
    scoped.some(
      (edge) =>
        edge.kind === kind &&
        (edge.outcome === "exact" || edge.outcome === "strong") &&
        edge.completeness === "complete",
    ),
  );
  const state: IdentityCapabilityCoverageState =
    !scopeIsBounded(scope) || scoped.length === 0
      ? "unknown"
      : missingKinds.length > 0 || weakKinds.length > 0 || unresolvedKinds.length > 0
        ? "partial"
        : completeKinds.length === expectedKinds.length
          ? "complete"
          : "partial";
  const reason =
    state === "complete"
      ? "all expected capability kinds are complete in the requested scope"
      : state === "partial"
        ? "some capability evidence is missing, weak, ambiguous, or incomplete in the requested scope"
        : "the requested scope has no bounded, usable capability evidence";
  return {
    schemaVersion: IDENTITY_CORRELATION_SCHEMA_VERSION,
    scope,
    expectedKinds,
    observedKinds,
    missingKinds,
    weakKinds,
    unresolvedKinds,
    observedEdges: scoped.length,
    state,
    reason,
  };
}

/** Small validation helper for callers that receive a serialized edge. */
export function isIdentityCapabilityEdgeId(value: unknown): value is string {
  return typeof value === "string" && EDGE_ID.test(value);
}

/** Keep the public type surface honest for consumers that discriminate identity confidence. */
export type IdentityCorrelationConfidence = IdentityConfidence;
