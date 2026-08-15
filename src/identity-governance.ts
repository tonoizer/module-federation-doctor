import type {
  IdentityCompleteness,
  IdentityKind,
  IdentityRealm,
  IdentityTarget,
  SemanticIdentity,
} from "./identity.js";
import { IdentityValidationError } from "./identity.js";
import { isSemanticIdentityKey, type IdentityCorrelationScope } from "./identity-correlation.js";
import { compareCodePoint } from "./utils.js";

/** Version of the portable ownership/governance contract. */
export const IDENTITY_GOVERNANCE_SCHEMA_VERSION = 1 as const;
export type IdentityGovernanceSchemaVersion = typeof IDENTITY_GOVERNANCE_SCHEMA_VERSION;

export type IdentityGovernanceResponsibility =
  | "consumer"
  | "producer"
  | "shared-provider"
  | "deployment"
  | "runtime-platform";

export interface IdentityGovernanceSelector {
  identityKey?: string;
  kind?: IdentityKind;
  parentKey?: string;
  containerName?: string;
  target?: IdentityTarget;
  realm?: IdentityRealm;
  environmentKey?: string;
}

export interface IdentityGovernanceRule {
  schemaVersion: IdentityGovernanceSchemaVersion;
  id: string;
  responsibility: IdentityGovernanceResponsibility;
  owner: string;
  selector: IdentityGovernanceSelector;
  priority: number;
  evidenceIds: string[];
  completeness: IdentityCompleteness;
}

export interface DefineIdentityGovernanceRuleOptions {
  id: string;
  responsibility: IdentityGovernanceResponsibility;
  owner: string;
  selector: IdentityGovernanceSelector;
  priority?: number;
  evidenceIds?: readonly string[];
  completeness?: IdentityCompleteness;
}

export type IdentityGovernanceResolutionOutcome = "resolved" | "ambiguous" | "unknown";

export interface IdentityGovernanceResolution {
  schemaVersion: IdentityGovernanceSchemaVersion;
  subjectKey: string;
  subjectKind: IdentityKind;
  outcome: IdentityGovernanceResolutionOutcome;
  owners: string[];
  responsibilities: IdentityGovernanceResponsibility[];
  candidateRuleIds: string[];
  matchedRuleIds: string[];
  evidenceIds: string[];
  completeness: IdentityCompleteness;
  incompleteRuleIds: string[];
  missing: string[];
  conflicts: string[];
  reason: string;
  scope?: IdentityCorrelationScope;
}

export interface IdentityGovernanceOptions {
  scope?: IdentityCorrelationScope;
  maxRules?: number;
}

const RESPONSIBILITIES = new Set<IdentityGovernanceResponsibility>([
  "consumer",
  "producer",
  "shared-provider",
  "deployment",
  "runtime-platform",
]);
const COMPLETENESS = new Set<IdentityCompleteness>(["complete", "partial", "unknown"]);
const TARGETS = new Set<IdentityTarget>(["browser", "ssr", "worker", "mobile", "node", "unknown"]);
const REALMS = new Set<IdentityRealm>([
  "top-frame",
  "iframe",
  "worker",
  "node",
  "react-native",
  "unknown",
]);
const IDENTITY_KINDS = new Set<IdentityKind>([
  "organization",
  "application",
  "container",
  "adapter-target",
  "build-lineage",
  "build",
  "artifact",
  "environment",
  "deployment",
  "runtime-realm",
  "runtime-instance",
]);
const MAX_RULES = 256;
const MAX_ID_LENGTH = 128;
const MAX_OWNER_LENGTH = 256;
const MAX_EVIDENCE_IDS = 32;
const MAX_EVIDENCE_ID_LENGTH = 128;
const UNSAFE_VALUE =
  /(?:[A-Za-z]:[\\/]|\\\\|^\/|[a-z][a-z\d+.-]*:\/\/|[?&](?:token|sig|signature|expires|auth|authorization|password|secret|credential|session|key)(?:=|&|$))/i;
const VOLATILE_VALUE =
  /^(?:\d{10,13}|\d{4}-\d{2}-\d{2}(?:[Tt ]|$)|(?:process|session|tab|pid|sid)(?:[-_:]|$))/i;

function assertSafeValue(value: string, label: string, maxLength: number): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    UNSAFE_VALUE.test(value) ||
    VOLATILE_VALUE.test(value)
  )
    throw new IdentityValidationError(`${label} must be a bounded non-sensitive value.`);
}

function validateScope(scope: IdentityCorrelationScope, label: string): IdentityCorrelationScope {
  if (!scope || typeof scope !== "object")
    throw new IdentityValidationError(`${label} must be an object.`);
  if (scope.target !== undefined && !TARGETS.has(scope.target))
    throw new IdentityValidationError(`${label}.target must be a supported target.`);
  if (scope.realm !== undefined && !REALMS.has(scope.realm))
    throw new IdentityValidationError(`${label}.realm must be a supported realm.`);
  if (scope.environmentKey !== undefined) {
    if (!isSemanticIdentityKey(scope.environmentKey))
      throw new IdentityValidationError(`${label}.environmentKey must be a semantic identity key.`);
    if (!scope.environmentKey.startsWith("mfid:v1:environment:"))
      throw new IdentityValidationError(`${label}.environmentKey must reference an environment.`);
  }
  return {
    ...(scope.target === undefined ? {} : { target: scope.target }),
    ...(scope.realm === undefined ? {} : { realm: scope.realm }),
    ...(scope.environmentKey === undefined ? {} : { environmentKey: scope.environmentKey }),
  };
}

function validateIdentity(identity: SemanticIdentity): void {
  if (!identity || typeof identity !== "object" || identity.schemaVersion !== 1)
    throw new IdentityValidationError("identity must be a v1 semantic identity.");
  if (!isSemanticIdentityKey(identity.key) || !identity.key.startsWith(`mfid:v1:${identity.kind}:`))
    throw new IdentityValidationError("identity.key must match its identity kind.");
  if (identity.parentKey !== undefined && !isSemanticIdentityKey(identity.parentKey))
    throw new IdentityValidationError("identity.parentKey must be a semantic identity key.");
}

function valueOf(identity: SemanticIdentity, name: string): string | undefined {
  const value = (identity as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
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
    ...(target !== undefined && TARGETS.has(target as IdentityTarget)
      ? { target: target as IdentityTarget }
      : {}),
    ...(realm !== undefined && REALMS.has(realm as IdentityRealm)
      ? { realm: realm as IdentityRealm }
      : {}),
    ...(environmentKey !== undefined && isSemanticIdentityKey(environmentKey)
      ? { environmentKey }
      : {}),
  };
}

function scopeConflicts(
  subject: IdentityCorrelationScope,
  requested: IdentityCorrelationScope | undefined,
): string[] {
  if (requested === undefined) return [];
  const conflicts: string[] = [];
  for (const name of ["target", "realm", "environmentKey"] as const)
    if (
      requested[name] !== undefined &&
      subject[name] !== undefined &&
      requested[name] !== subject[name]
    )
      conflicts.push(`scope.${name}`);
  return conflicts.sort(compareCodePoint);
}

function scopeMissing(
  subject: IdentityCorrelationScope,
  requested: IdentityCorrelationScope | undefined,
): string[] {
  if (requested === undefined) return [];
  const missing: string[] = [];
  for (const name of ["target", "realm", "environmentKey"] as const) {
    const expected = requested[name];
    const actual = subject[name];
    if (expected !== undefined && (actual === undefined || actual === "unknown"))
      missing.push(`scope.${name}`);
  }
  return missing.sort(compareCodePoint);
}

function validateSelector(selector: IdentityGovernanceSelector): IdentityGovernanceSelector {
  if (!selector || typeof selector !== "object")
    throw new IdentityValidationError("governance selector must be an object.");
  const entries = Object.entries(selector).filter(([, value]) => value !== undefined);
  if (entries.length === 0 || entries.length > 7)
    throw new IdentityValidationError("governance selector must contain between 1 and 7 fields.");
  if (selector.identityKey !== undefined) {
    if (!isSemanticIdentityKey(selector.identityKey))
      throw new IdentityValidationError("selector.identityKey must be a semantic identity key.");
    if (
      selector.kind !== undefined &&
      !selector.identityKey.startsWith(`mfid:v1:${selector.kind}:`)
    )
      throw new IdentityValidationError("selector.kind must match selector.identityKey.");
  }
  if (selector.parentKey !== undefined && !isSemanticIdentityKey(selector.parentKey))
    throw new IdentityValidationError("selector.parentKey must be a semantic identity key.");
  if (selector.kind !== undefined && !IDENTITY_KINDS.has(selector.kind))
    throw new IdentityValidationError("selector.kind must be a supported identity kind.");
  if (selector.target !== undefined && !TARGETS.has(selector.target))
    throw new IdentityValidationError("selector.target must be a supported target.");
  if (selector.realm !== undefined && !REALMS.has(selector.realm))
    throw new IdentityValidationError("selector.realm must be a supported realm.");
  if (selector.environmentKey !== undefined) {
    if (!isSemanticIdentityKey(selector.environmentKey))
      throw new IdentityValidationError("selector.environmentKey must be a semantic identity key.");
    if (!selector.environmentKey.startsWith("mfid:v1:environment:"))
      throw new IdentityValidationError("selector.environmentKey must reference an environment.");
  }
  if (selector.containerName !== undefined)
    assertSafeValue(selector.containerName, "selector.containerName", MAX_OWNER_LENGTH);
  return {
    ...(selector.identityKey === undefined ? {} : { identityKey: selector.identityKey }),
    ...(selector.kind === undefined ? {} : { kind: selector.kind }),
    ...(selector.parentKey === undefined ? {} : { parentKey: selector.parentKey }),
    ...(selector.containerName === undefined ? {} : { containerName: selector.containerName }),
    ...(selector.target === undefined ? {} : { target: selector.target }),
    ...(selector.realm === undefined ? {} : { realm: selector.realm }),
    ...(selector.environmentKey === undefined ? {} : { environmentKey: selector.environmentKey }),
  };
}

function validateEvidenceIds(evidenceIds: readonly string[]): string[] {
  if (evidenceIds.length > MAX_EVIDENCE_IDS)
    throw new IdentityValidationError("governance evidenceIds exceed maxItems (32).");
  const normalized = [...new Set(evidenceIds)];
  for (const evidenceId of normalized)
    assertSafeValue(evidenceId, "governance evidence ID", MAX_EVIDENCE_ID_LENGTH);
  return normalized.sort(compareCodePoint);
}

/** Define and validate one portable governance rule. */
export function defineIdentityGovernanceRule(
  options: DefineIdentityGovernanceRuleOptions,
): IdentityGovernanceRule {
  assertSafeValue(options.id, "governance rule id", MAX_ID_LENGTH);
  assertSafeValue(options.owner, "governance owner", MAX_OWNER_LENGTH);
  if (!RESPONSIBILITIES.has(options.responsibility))
    throw new IdentityValidationError("Unsupported governance responsibility.");
  const priority = options.priority ?? 0;
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000)
    throw new IdentityValidationError("governance priority must be an integer between 0 and 1000.");
  const completeness = options.completeness ?? "complete";
  if (!COMPLETENESS.has(completeness))
    throw new IdentityValidationError("Unsupported governance completeness.");
  return {
    schemaVersion: IDENTITY_GOVERNANCE_SCHEMA_VERSION,
    id: options.id,
    responsibility: options.responsibility,
    owner: options.owner,
    selector: validateSelector(options.selector),
    priority,
    evidenceIds: validateEvidenceIds(options.evidenceIds ?? []),
    completeness,
  };
}

function selectorMatches(
  identity: SemanticIdentity,
  selector: IdentityGovernanceSelector,
): boolean {
  const scope = identityScope(identity);
  const values: Record<keyof IdentityGovernanceSelector, string | undefined> = {
    identityKey: identity.key,
    kind: identity.kind,
    parentKey: identity.parentKey,
    containerName: valueOf(identity, "containerName"),
    target: scope.target,
    realm: scope.realm,
    environmentKey: scope.environmentKey,
  };
  return Object.entries(selector).every(
    ([name, expected]) => values[name as keyof typeof values] === expected,
  );
}

function selectorSpecificity(selector: IdentityGovernanceSelector): number {
  if (selector.identityKey !== undefined) return 4;
  if (selector.parentKey !== undefined && selector.kind !== undefined) return 3;
  if (selector.containerName !== undefined && selector.kind !== undefined) return 2;
  if (
    selector.parentKey !== undefined ||
    selector.containerName !== undefined ||
    selector.kind !== undefined
  )
    return 1;
  return 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePoint);
}

/**
 * Resolve ownership/responsibility from portable rules. Exact and more specific
 * selectors win; equal-precedence owners remain ambiguous instead of being
 * selected by input or alphabetical order.
 */
export function resolveIdentityGovernance(
  identity: SemanticIdentity,
  rules: readonly IdentityGovernanceRule[],
  options: IdentityGovernanceOptions = {},
): IdentityGovernanceResolution {
  validateIdentity(identity);
  if (rules.length > MAX_RULES)
    throw new IdentityValidationError(`governance rules exceed maxItems (${MAX_RULES}).`);
  const scope = options.scope === undefined ? undefined : validateScope(options.scope, "scope");
  const maxRules = options.maxRules ?? MAX_RULES;
  if (!Number.isInteger(maxRules) || maxRules < 1 || maxRules > MAX_RULES)
    throw new IdentityValidationError(`maxRules must be an integer between 1 and ${MAX_RULES}.`);
  if (rules.length > maxRules)
    throw new IdentityValidationError(
      `governance rules exceed the requested maxRules (${maxRules}).`,
    );
  const normalizedRules = rules
    .slice(0, maxRules)
    .map((rule) => defineIdentityGovernanceRule(rule));
  const subjectScopeConflicts = scopeConflicts(identityScope(identity), scope);
  const subjectScopeMissing = scopeMissing(identityScope(identity), scope);
  const candidates = normalizedRules
    .filter(
      (rule) =>
        subjectScopeConflicts.length === 0 &&
        subjectScopeMissing.length === 0 &&
        selectorMatches(identity, rule.selector),
    )
    .map((rule) => ({ rule, specificity: selectorSpecificity(rule.selector) }));
  const candidateRuleIds = sortedUnique(candidates.map(({ rule }) => rule.id));
  const highestSpecificity = candidates.reduce(
    (highest, candidate) => Math.max(highest, candidate.specificity),
    -1,
  );
  const specificityMatches = candidates.filter(
    ({ specificity }) => specificity === highestSpecificity,
  );
  const highestPriority = specificityMatches.reduce(
    (highest, { rule }) => Math.max(highest, rule.priority),
    -1,
  );
  const selected = specificityMatches.filter(({ rule }) => rule.priority === highestPriority);
  const selectedPairs = sortedUnique(
    selected.map(({ rule }) => `${rule.owner}\u0000${rule.responsibility}`),
  );
  const completeness: IdentityCompleteness =
    selected.length === 0
      ? "unknown"
      : selected.some(({ rule }) => rule.completeness === "unknown")
        ? "unknown"
        : selected.some(({ rule }) => rule.completeness === "partial")
          ? "partial"
          : "complete";
  const incompleteRuleIds = sortedUnique(
    selected.filter(({ rule }) => rule.completeness !== "complete").map(({ rule }) => rule.id),
  );
  const outcome: IdentityGovernanceResolutionOutcome =
    selected.length === 0
      ? "unknown"
      : selectedPairs.length > 1
        ? "ambiguous"
        : completeness === "complete"
          ? "resolved"
          : "unknown";
  const matchedRuleIds = sortedUnique(selected.map(({ rule }) => rule.id));
  const evidenceIds = sortedUnique(selected.flatMap(({ rule }) => rule.evidenceIds));
  const owners = sortedUnique(selected.map(({ rule }) => rule.owner));
  const responsibilities = [...new Set(selected.map(({ rule }) => rule.responsibility))].sort(
    compareCodePoint,
  );
  const conflicts =
    outcome === "ambiguous"
      ? ["equal-precedence-governance-rules"]
      : incompleteRuleIds.length > 0
        ? ["incomplete-governance-evidence"]
        : subjectScopeConflicts.length > 0
          ? subjectScopeConflicts
          : [];
  const missing =
    outcome === "unknown"
      ? sortedUnique([
          ...subjectScopeMissing,
          ...(subjectScopeMissing.length === 0 && incompleteRuleIds.length === 0
            ? ["governance-rule"]
            : []),
          ...(incompleteRuleIds.length > 0 ? ["complete-governance-evidence"] : []),
        ])
      : [];
  const reason =
    outcome === "resolved"
      ? "one highest-precedence governance responsibility resolved"
      : outcome === "ambiguous"
        ? "multiple equal-precedence governance responsibilities remain"
        : incompleteRuleIds.length > 0
          ? "matching governance rule lacks complete evidence"
          : "no in-scope governance rule matched the identity";
  return {
    schemaVersion: IDENTITY_GOVERNANCE_SCHEMA_VERSION,
    subjectKey: identity.key,
    subjectKind: identity.kind,
    outcome,
    owners,
    responsibilities,
    candidateRuleIds,
    matchedRuleIds,
    evidenceIds,
    completeness,
    incompleteRuleIds,
    missing,
    conflicts,
    reason,
    ...(scope === undefined ? {} : { scope }),
  };
}
