import type {
  IdentityCompleteness,
  IdentityRealm,
  IdentityTarget,
  SemanticIdentity,
} from "./identity.js";
import { IdentityValidationError } from "./identity.js";
import {
  defineIdentityGovernanceRule,
  type IdentityGovernanceSelector,
} from "./identity-governance.js";
import { assertFindingLineageRecord, type FindingLineageRecord } from "./finding-lineage.js";
import { isSemanticIdentityKey } from "./identity-correlation.js";
import { compareCodePoint } from "./utils.js";

/** Version of the additive governance-waiver and audit contract. */
export const GOVERNANCE_WAIVER_SCHEMA_VERSION = 1 as const;
export type GovernanceWaiverSchemaVersion = typeof GOVERNANCE_WAIVER_SCHEMA_VERSION;

export type GovernanceWaiverDecisionOutcome =
  | "applied"
  | "not-applicable"
  | "expired"
  | "not-active"
  | "out-of-scope"
  | "unknown";

export type GovernanceWaiverResolutionOutcome =
  | "suppressed"
  | "not-suppressed"
  | "ambiguous"
  | "unknown";

export interface GovernanceWaiverInput {
  schemaVersion?: GovernanceWaiverSchemaVersion;
  id: string;
  findingLineageId?: string;
  ruleId: string;
  subjectSelector: IdentityGovernanceSelector;
  owner: string;
  reason: string;
  ticket: string;
  approvedBy: string;
  expiresAt: string;
  environments: readonly string[];
  targetSelectors?: readonly IdentityTarget[];
  createdAt?: string;
}

export interface GovernanceWaiver {
  schemaVersion: GovernanceWaiverSchemaVersion;
  id: string;
  findingLineageId?: string;
  ruleId: string;
  subjectSelector: IdentityGovernanceSelector;
  owner: string;
  reason: string;
  ticket: string;
  approvedBy: string;
  expiresAt: string;
  environments: string[];
  targetSelectors?: IdentityTarget[];
  createdAt?: string;
}

export interface GovernanceWaiverEvaluationContext {
  /** A fixed Date, epoch milliseconds, or ISO timestamp may be injected for reproducible audits. */
  now?: Date | number | string;
  /** Deployment/environment name. It must be supplied when a waiver is evaluated. */
  environment?: string;
  subject?: SemanticIdentity;
  target?: IdentityTarget;
  realm?: IdentityRealm;
  environmentKey?: string;
}

export interface GovernanceWaiverDecision {
  schemaVersion: GovernanceWaiverSchemaVersion;
  waiverId: string;
  findingLineageId: string;
  outcome: GovernanceWaiverDecisionOutcome;
  suppress: boolean;
  reason: string;
  missing: string[];
  conflicts: string[];
  expiresAt: string;
  evaluatedAt: string;
}

export interface GovernanceWaiverResolution {
  schemaVersion: GovernanceWaiverSchemaVersion;
  findingLineageId: string;
  outcome: GovernanceWaiverResolutionOutcome;
  suppressed: boolean;
  candidateWaiverIds: string[];
  appliedWaiverIds: string[];
  expiredWaiverIds: string[];
  outOfScopeWaiverIds: string[];
  unknownWaiverIds: string[];
  decisions: GovernanceWaiverDecision[];
  missing: string[];
  conflicts: string[];
  reason: string;
  evaluatedAt: string;
}

export interface ResolveGovernanceWaiversOptions extends GovernanceWaiverEvaluationContext {
  maxWaivers?: number;
}

type MatchResult =
  | { outcome: "match" }
  | { outcome: "not-applicable"; reason: string }
  | { outcome: "out-of-scope"; reason: string; conflicts?: string[] }
  | { outcome: "unknown"; reason: string; missing: string[] };

const TARGETS = new Set<IdentityTarget>(["browser", "ssr", "worker", "mobile", "node", "unknown"]);
const REALMS = new Set<IdentityRealm>([
  "top-frame",
  "iframe",
  "worker",
  "node",
  "react-native",
  "unknown",
]);
const MAX_WAIVERS = 256;
const MAX_ID_LENGTH = 128;
const MAX_RULE_ID_LENGTH = 256;
const MAX_OWNER_LENGTH = 256;
const MAX_REASON_LENGTH = 1024;
const MAX_TICKET_LENGTH = 256;
const MAX_APPROVER_LENGTH = 256;
const MAX_ENVIRONMENTS = 32;
const MAX_ENVIRONMENT_LENGTH = 128;
const MAX_TARGET_SELECTORS = 6;
const LINEAGE_ID = /^mffinding:v1:[a-f0-9]{24}$/;
const UNSAFE_VALUE =
  /(?:[A-Za-z]:[\\/]|\\\\|^\/|[a-z][a-z\d+.-]*:\/\/|[?&](?:token|sig|signature|expires|auth|authorization|password|secret|credential|session|key)(?:=|&|$))/i;
const VOLATILE_VALUE =
  /^(?:\d{10,13}|\d{4}-\d{2}-\d{2}(?:[Tt ]|$)|(?:process|session|tab|pid|sid)(?:[-_:]|$))/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

function assertSafeValue(value: string, label: string, maxLength: number): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    UNSAFE_VALUE.test(value) ||
    VOLATILE_VALUE.test(value)
  )
    throw new IdentityValidationError(`${label} must be a bounded non-sensitive value.`);
}

function assertNoWildcard(value: string, label: string): void {
  if (/[?*]/.test(value))
    throw new IdentityValidationError(
      `${label} must use an explicit value; wildcards are not allowed.`,
    );
}

function normalizeTimestamp(value: string, label: string): string {
  if (!ISO_TIMESTAMP.test(value))
    throw new IdentityValidationError(`${label} must be an ISO-8601 timestamp with a time zone.`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new IdentityValidationError(`${label} must be a valid timestamp.`);
  return new Date(timestamp).toISOString();
}

function normalizeClock(value: Date | number | string | undefined): {
  milliseconds: number;
  iso: string;
} {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
      throw new IdentityValidationError("waiver evaluation clock must be a valid Date.");
    const milliseconds = value.getTime();
    return { milliseconds, iso: new Date(milliseconds).toISOString() };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new IdentityValidationError("waiver evaluation clock must be finite.");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()))
      throw new IdentityValidationError("waiver evaluation clock must be a valid epoch value.");
    return { milliseconds: date.getTime(), iso: date.toISOString() };
  }
  if (typeof value === "string") {
    const iso = normalizeTimestamp(value, "waiver evaluation clock");
    return { milliseconds: Date.parse(iso), iso };
  }
  const milliseconds = Date.now();
  return { milliseconds, iso: new Date(milliseconds).toISOString() };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePoint);
}

function validateFindingLineageId(value: string, label: string): void {
  if (!LINEAGE_ID.test(value))
    throw new IdentityValidationError(`${label} must be a v1 finding lineage ID.`);
}

function validateEnvironment(value: string, label: string): string {
  assertSafeValue(value, label, MAX_ENVIRONMENT_LENGTH);
  assertNoWildcard(value, label);
  if (value.toLowerCase() === "unknown")
    throw new IdentityValidationError(`${label} must identify an explicit environment.`);
  return value;
}

function normalizeEnvironments(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ENVIRONMENTS)
    throw new IdentityValidationError(
      `waiver environments must contain between 1 and ${MAX_ENVIRONMENTS} values.`,
    );
  return sortedUnique(values.map((value) => validateEnvironment(value, "waiver environment")));
}

function normalizeTargets(
  values: readonly IdentityTarget[] | undefined,
): IdentityTarget[] | undefined {
  if (values === undefined) return undefined;
  if (values.length === 0 || values.length > MAX_TARGET_SELECTORS)
    throw new IdentityValidationError(
      `waiver targetSelectors must contain between 1 and ${MAX_TARGET_SELECTORS} values.`,
    );
  for (const value of values)
    if (!TARGETS.has(value) || value === "unknown")
      throw new IdentityValidationError(
        "waiver targetSelectors must use explicit supported targets.",
      );
  return [...new Set(values)].sort(compareCodePoint);
}

function normalizeSubjectSelector(
  owner: string,
  selector: IdentityGovernanceSelector,
): IdentityGovernanceSelector {
  // Reuse the governance selector validator so both contracts have identical
  // identity-key, scope, and sensitive-value rules.
  const normalized = defineSelectorThroughGovernance(owner, selector);
  if (
    normalized.identityKey === undefined &&
    normalized.parentKey === undefined &&
    normalized.containerName === undefined
  )
    throw new IdentityValidationError(
      "waiver subjectSelector must identify an explicit identity, parent, or container.",
    );
  for (const value of Object.values(normalized))
    if (typeof value === "string") assertNoWildcard(value, "waiver subjectSelector");
  return normalized;
}

function defineSelectorThroughGovernance(
  owner: string,
  selector: IdentityGovernanceSelector,
): IdentityGovernanceSelector {
  // The governance module intentionally owns selector validation. The fixed
  // responsibility is never emitted; only its normalized selector is used.
  const rule = defineIdentityGovernanceRule({
    id: "waiver-selector",
    responsibility: "consumer",
    owner,
    selector,
  });
  return rule.selector;
}

function validateSubject(subject: SemanticIdentity | undefined): void {
  if (subject === undefined) return;
  if (!subject || typeof subject !== "object" || subject.schemaVersion !== 1)
    throw new IdentityValidationError("waiver evaluation subject must be a v1 semantic identity.");
  if (!isSemanticIdentityKey(subject.key) || !subject.key.startsWith(`mfid:v1:${subject.kind}:`))
    throw new IdentityValidationError(
      "waiver evaluation subject key must match its identity kind.",
    );
}

function validateContext(context: GovernanceWaiverEvaluationContext): void {
  if (context.environment !== undefined)
    validateEnvironment(context.environment, "evaluation environment");
  if (context.target !== undefined && !TARGETS.has(context.target))
    throw new IdentityValidationError("evaluation target must be supported.");
  if (context.realm !== undefined && !REALMS.has(context.realm))
    throw new IdentityValidationError("evaluation realm must be supported.");
  if (context.environmentKey !== undefined) {
    if (
      !isSemanticIdentityKey(context.environmentKey) ||
      !context.environmentKey.startsWith("mfid:v1:environment:")
    )
      throw new IdentityValidationError("evaluation environmentKey must reference an environment.");
  }
  validateSubject(context.subject);
}

function identityValue(identity: SemanticIdentity | undefined, name: string): string | undefined {
  const value =
    identity === undefined ? undefined : (identity as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function valueIsUnknown(value: string | undefined): boolean {
  return value === undefined || value === "unknown";
}

function contextScope(
  finding: FindingLineageRecord,
  context: GovernanceWaiverEvaluationContext,
): {
  target?: IdentityTarget;
  realm?: IdentityRealm;
  environmentKey?: string;
  conflicts: string[];
} {
  const findingScope = finding.scope;
  const subjectTarget = identityValue(context.subject, "target") as IdentityTarget | undefined;
  const subjectRealm = identityValue(context.subject, "realm") as IdentityRealm | undefined;
  const subjectEnvironmentKey = identityValue(context.subject, "environmentKey");
  const conflicts: string[] = [];
  const values: Array<
    ["target" | "realm" | "environmentKey", string | undefined, string | undefined]
  > = [
    ["target", findingScope?.target, context.target],
    ["realm", findingScope?.realm, context.realm],
    ["environmentKey", findingScope?.environmentKey, context.environmentKey],
  ];
  for (const [name, findingValue, contextValue] of values)
    if (findingValue !== undefined && contextValue !== undefined && findingValue !== contextValue)
      conflicts.push(`scope.${name}`);
  const target = findingScope?.target ?? context.target ?? subjectTarget;
  const realm = findingScope?.realm ?? context.realm ?? subjectRealm;
  const environmentKey =
    findingScope?.environmentKey ?? context.environmentKey ?? subjectEnvironmentKey;
  return {
    ...(target === undefined ? {} : { target }),
    ...(realm === undefined ? {} : { realm }),
    ...(environmentKey === undefined ? {} : { environmentKey }),
    conflicts: sortedUnique(conflicts),
  };
}

function selectorMatch(
  finding: FindingLineageRecord,
  waiver: GovernanceWaiver,
  context: GovernanceWaiverEvaluationContext,
): MatchResult {
  const scope = contextScope(finding, context);
  if (context.subject !== undefined && context.subject.key !== finding.subjectKey)
    return {
      outcome: "out-of-scope",
      reason: "evaluation subject conflicts with the finding subject",
      conflicts: ["subject.key"],
    };
  if (scope.conflicts.length > 0)
    return {
      outcome: "out-of-scope",
      reason: "evaluation scope conflicts with the finding scope",
      conflicts: scope.conflicts,
    };
  if (context.environment === undefined || context.environment.toLowerCase() === "unknown")
    return {
      outcome: "unknown",
      reason: "evaluation environment is missing",
      missing: ["environment"],
    };
  if (!waiver.environments.includes(context.environment))
    return {
      outcome: "out-of-scope",
      reason: "waiver does not include the evaluation environment",
    };
  if (waiver.targetSelectors !== undefined) {
    if (valueIsUnknown(scope.target))
      return {
        outcome: "unknown",
        reason: "target evidence is missing",
        missing: ["scope.target"],
      };
    if (!waiver.targetSelectors.includes(scope.target as IdentityTarget))
      return { outcome: "out-of-scope", reason: "waiver does not include the evaluation target" };
  }
  if (waiver.findingLineageId !== undefined && waiver.findingLineageId !== finding.findingLineageId)
    return { outcome: "not-applicable", reason: "finding lineage ID does not match" };
  if (waiver.ruleId !== finding.rule.id)
    return { outcome: "not-applicable", reason: "rule ID does not match" };

  const selector = waiver.subjectSelector;
  const subjectKey = finding.subjectKey;
  const subjectKind = subjectKey.split(":")[2];
  if (selector.identityKey !== undefined && selector.identityKey !== subjectKey)
    return { outcome: "not-applicable", reason: "subject identity does not match" };
  if (selector.kind !== undefined && selector.kind !== subjectKind)
    return { outcome: "not-applicable", reason: "subject kind does not match" };
  if (selector.parentKey !== undefined) {
    if (context.subject?.parentKey === undefined)
      return {
        outcome: "unknown",
        reason: "subject parent evidence is missing",
        missing: ["subject.parentKey"],
      };
    if (selector.parentKey !== context.subject.parentKey)
      return { outcome: "not-applicable", reason: "subject parent does not match" };
  }
  if (selector.containerName !== undefined) {
    const containerName = identityValue(context.subject, "containerName");
    if (containerName === undefined)
      return {
        outcome: "unknown",
        reason: "subject container evidence is missing",
        missing: ["subject.containerName"],
      };
    if (selector.containerName !== containerName)
      return { outcome: "not-applicable", reason: "subject container does not match" };
  }
  if (selector.target !== undefined) {
    if (valueIsUnknown(scope.target))
      return {
        outcome: "unknown",
        reason: "target evidence is missing",
        missing: ["scope.target"],
      };
    if (selector.target !== scope.target)
      return { outcome: "out-of-scope", reason: "subject target does not match the waiver scope" };
  }
  if (selector.realm !== undefined) {
    if (valueIsUnknown(scope.realm))
      return { outcome: "unknown", reason: "realm evidence is missing", missing: ["scope.realm"] };
    if (selector.realm !== scope.realm)
      return { outcome: "out-of-scope", reason: "subject realm does not match the waiver scope" };
  }
  if (selector.environmentKey !== undefined) {
    if (valueIsUnknown(scope.environmentKey))
      return {
        outcome: "unknown",
        reason: "environment identity evidence is missing",
        missing: ["scope.environmentKey"],
      };
    if (selector.environmentKey !== scope.environmentKey)
      return {
        outcome: "out-of-scope",
        reason: "environment identity does not match the waiver scope",
      };
  }
  return { outcome: "match" };
}

/** Define and validate one portable governance waiver. */
export function defineGovernanceWaiver(options: GovernanceWaiverInput): GovernanceWaiver {
  if (
    options.schemaVersion !== undefined &&
    options.schemaVersion !== GOVERNANCE_WAIVER_SCHEMA_VERSION
  )
    throw new IdentityValidationError("Unsupported governance waiver schema version.");
  assertSafeValue(options.id, "waiver ID", MAX_ID_LENGTH);
  assertSafeValue(options.ruleId, "waiver rule ID", MAX_RULE_ID_LENGTH);
  assertSafeValue(options.owner, "waiver owner", MAX_OWNER_LENGTH);
  assertSafeValue(options.reason, "waiver reason", MAX_REASON_LENGTH);
  assertSafeValue(options.ticket, "waiver ticket", MAX_TICKET_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(options.ticket))
    throw new IdentityValidationError("waiver ticket must be a bounded ticket reference.");
  assertSafeValue(options.approvedBy, "waiver approver", MAX_APPROVER_LENGTH);
  const expiresAt = normalizeTimestamp(options.expiresAt, "waiver expiresAt");
  const createdAt =
    options.createdAt === undefined
      ? undefined
      : normalizeTimestamp(options.createdAt, "waiver createdAt");
  if (createdAt !== undefined && Date.parse(createdAt) >= Date.parse(expiresAt))
    throw new IdentityValidationError("waiver createdAt must be earlier than expiresAt.");
  if (options.findingLineageId !== undefined)
    validateFindingLineageId(options.findingLineageId, "waiver findingLineageId");
  const subjectSelector = normalizeSubjectSelector(options.owner, options.subjectSelector);
  const targetSelectors = normalizeTargets(options.targetSelectors);
  return {
    schemaVersion: GOVERNANCE_WAIVER_SCHEMA_VERSION,
    id: options.id,
    ...(options.findingLineageId === undefined
      ? {}
      : { findingLineageId: options.findingLineageId }),
    ruleId: options.ruleId,
    subjectSelector,
    owner: options.owner,
    reason: options.reason,
    ticket: options.ticket,
    approvedBy: options.approvedBy,
    expiresAt,
    environments: normalizeEnvironments(options.environments),
    ...(targetSelectors === undefined ? {} : { targetSelectors }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

function decision(
  waiver: GovernanceWaiver,
  finding: FindingLineageRecord,
  clock: { milliseconds: number; iso: string },
  outcome: GovernanceWaiverDecisionOutcome,
  reason: string,
  missing: readonly string[] = [],
  conflicts: readonly string[] = [],
): GovernanceWaiverDecision {
  return {
    schemaVersion: GOVERNANCE_WAIVER_SCHEMA_VERSION,
    waiverId: waiver.id,
    findingLineageId: finding.findingLineageId,
    outcome,
    suppress: outcome === "applied",
    reason,
    missing: sortedUnique(missing),
    conflicts: sortedUnique(conflicts),
    expiresAt: waiver.expiresAt,
    evaluatedAt: clock.iso,
  };
}

/** Evaluate one waiver and return an audit record without changing a finding or baseline. */
export function evaluateGovernanceWaiver(
  finding: FindingLineageRecord,
  waiver: GovernanceWaiverInput,
  context: GovernanceWaiverEvaluationContext = {},
): GovernanceWaiverDecision {
  assertFindingLineageRecord(finding);
  validateContext(context);
  const normalized = defineGovernanceWaiver(waiver);
  const clock = normalizeClock(context.now);
  if (
    finding.outcome !== "fail" ||
    finding.completeness !== ("complete" satisfies IdentityCompleteness)
  )
    return decision(
      normalized,
      finding,
      clock,
      finding.outcome === "unknown" || finding.completeness !== "complete"
        ? "unknown"
        : "not-applicable",
      finding.outcome === "fail"
        ? "finding evidence is not complete enough for waiver application"
        : "waivers apply only to failing findings",
      finding.outcome === "fail" ? ["complete-finding-evidence"] : [],
      [],
    );
  if (Date.parse(normalized.expiresAt) <= clock.milliseconds)
    return decision(normalized, finding, clock, "expired", "waiver expiry has passed");
  if (normalized.createdAt !== undefined && Date.parse(normalized.createdAt) > clock.milliseconds)
    return decision(normalized, finding, clock, "not-active", "waiver is not active yet");
  const match = selectorMatch(finding, normalized, context);
  if (match.outcome === "match")
    return decision(normalized, finding, clock, "applied", "in-scope unexpired waiver matched");
  if (match.outcome === "unknown")
    return decision(normalized, finding, clock, "unknown", match.reason, match.missing);
  if (match.outcome === "out-of-scope")
    return decision(normalized, finding, clock, "out-of-scope", match.reason, [], match.conflicts);
  return decision(normalized, finding, clock, "not-applicable", match.reason);
}

/** Resolve all waivers deterministically and retain every audit decision. */
export function resolveGovernanceWaivers(
  finding: FindingLineageRecord,
  waivers: readonly GovernanceWaiverInput[],
  options: ResolveGovernanceWaiversOptions = {},
): GovernanceWaiverResolution {
  assertFindingLineageRecord(finding);
  validateContext(options);
  const maxWaivers = options.maxWaivers ?? MAX_WAIVERS;
  if (!Number.isInteger(maxWaivers) || maxWaivers < 1 || maxWaivers > MAX_WAIVERS)
    throw new IdentityValidationError(
      `maxWaivers must be an integer between 1 and ${MAX_WAIVERS}.`,
    );
  if (waivers.length > MAX_WAIVERS || waivers.length > maxWaivers)
    throw new IdentityValidationError(`governance waivers exceed maxItems (${maxWaivers}).`);
  const normalized = waivers.map((waiver) => defineGovernanceWaiver(waiver));
  const ids = normalized.map((waiver) => waiver.id);
  if (new Set(ids).size !== ids.length)
    throw new IdentityValidationError("governance waiver IDs must be unique.");
  const clock = normalizeClock(options.now);
  const evaluationOptions: ResolveGovernanceWaiversOptions = {
    ...options,
    now: clock.iso,
  };
  const decisions = normalized
    .map((waiver) => evaluateGovernanceWaiver(finding, waiver, evaluationOptions))
    .sort((left, right) => compareCodePoint(left.waiverId, right.waiverId));
  const appliedWaiverIds = decisions
    .filter((item) => item.outcome === "applied")
    .map((item) => item.waiverId);
  const expiredWaiverIds = decisions
    .filter((item) => item.outcome === "expired")
    .map((item) => item.waiverId);
  const outOfScopeWaiverIds = decisions
    .filter((item) => item.outcome === "out-of-scope")
    .map((item) => item.waiverId);
  const unknownWaiverIds = decisions
    .filter((item) => item.outcome === "unknown")
    .map((item) => item.waiverId);
  const decisionConflicts = decisions.flatMap((item) => item.conflicts);
  const conflicts = sortedUnique(decisionConflicts);
  const applied = normalized.filter((waiver) => appliedWaiverIds.includes(waiver.id));
  const approvalShapes = new Set(
    applied.map((waiver) => `${waiver.owner}\u0000${waiver.reason}\u0000${waiver.ticket}`),
  );
  if (applied.length > 1 && approvalShapes.size > 1) conflicts.push("overlapping-waiver-decisions");
  if (applied.length > 0 && unknownWaiverIds.length > 0)
    conflicts.push("overlapping-waiver-scope-unknown");
  const normalizedConflicts = sortedUnique(conflicts);
  const missing = sortedUnique(decisions.flatMap((item) => item.missing));
  const ambiguous = normalizedConflicts.length > 0;
  const outcome: GovernanceWaiverResolutionOutcome = ambiguous
    ? "ambiguous"
    : applied.length > 0
      ? "suppressed"
      : unknownWaiverIds.length > 0
        ? "unknown"
        : "not-suppressed";
  const reason =
    outcome === "suppressed"
      ? applied.length === 1
        ? "one in-scope governance waiver applied"
        : "multiple equivalent in-scope governance waivers applied"
      : outcome === "ambiguous"
        ? "overlapping waiver decisions require explicit resolution"
        : outcome === "unknown"
          ? "waiver scope or finding evidence is incomplete"
          : "no in-scope unexpired governance waiver applied";
  return {
    schemaVersion: GOVERNANCE_WAIVER_SCHEMA_VERSION,
    findingLineageId: finding.findingLineageId,
    outcome,
    suppressed: outcome === "suppressed",
    candidateWaiverIds: sortedUnique(ids),
    appliedWaiverIds: sortedUnique(appliedWaiverIds),
    expiredWaiverIds: sortedUnique(expiredWaiverIds),
    outOfScopeWaiverIds: sortedUnique(outOfScopeWaiverIds),
    unknownWaiverIds: sortedUnique(unknownWaiverIds),
    decisions,
    missing,
    conflicts: normalizedConflicts,
    reason,
    evaluatedAt: clock.iso,
  };
}
