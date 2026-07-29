import {
  stableEvidenceId,
  type EvidenceCompleteness,
  type EvidenceConfidence,
  type EvidenceLayer,
  type EvidenceSubjectKind,
} from "./evidence.js";

/** A small, declarative selector for evidence a rule needs before it can judge. */
export interface EvidenceSelector {
  predicate: string;
  layer?: EvidenceLayer;
  subjectKind?: EvidenceSubjectKind;
  minimumConfidence?: EvidenceConfidence;
  minimumCompleteness?: EvidenceCompleteness;
}

/** Rule prerequisites intentionally support only small allOf/anyOf groups. */
export type EvidenceRequirement =
  | EvidenceSelector
  | { allOf: EvidenceRequirement[] }
  | { anyOf: EvidenceRequirement[] };

export interface RuleApplicability {
  adapters?: Array<{ name: string; version?: string }>;
  bundlers?: Array<{ name: string; version?: string }>;
  targets?: string[];
  buildModes?: string[];
  projectRoles?: string[];
}

export interface RuleOwner {
  name: string;
  contact?: string;
}

export interface RuleRemediation {
  summary: string;
  documentation: string;
  fix?: string;
}

export interface EvidenceAwareRuleMeta {
  id: string;
  version: string;
  owner: RuleOwner;
  remediation: RuleRemediation;
  prerequisites: EvidenceRequirement;
  applicability: RuleApplicability;
  confidenceCeiling: EvidenceConfidence;
  defaultSeverity: "error" | "warning" | "info";
}

export type RuleReasonCode =
  | "prerequisite-missing"
  | "prerequisite-incomplete"
  | "prerequisite-below-confidence"
  | "unsupported"
  | "applicability-unknown"
  | "not-applicable"
  | "rule-result";

interface RuleEvaluationBase {
  id: string;
  rule: { id: string; version: string };
  subject: string;
  evidenceIds: string[];
}

interface RuleConclusiveEvaluationBase extends RuleEvaluationBase {
  confidence: Exclude<EvidenceConfidence, "unknown">;
  completeness: "complete";
}

interface RuleNonConclusiveEvaluationBase extends RuleEvaluationBase {
  confidence: EvidenceConfidence;
  completeness: EvidenceCompleteness;
}

export type RulePassResult = RuleConclusiveEvaluationBase & {
  outcome: "pass";
  reasonCode: "rule-result";
  reason: string;
};

export type RuleFailResult = RuleConclusiveEvaluationBase & {
  outcome: "fail";
  reasonCode: "rule-result";
  reason: string;
};

export type RuleUnknownResult = RuleNonConclusiveEvaluationBase & {
  outcome: "unknown";
  reasonCode:
    | "prerequisite-missing"
    | "prerequisite-incomplete"
    | "prerequisite-below-confidence"
    | "unsupported"
    | "applicability-unknown";
  reason: string;
  missingRequirements: EvidenceRequirement[];
};

export type RuleNotApplicableResult = RuleNonConclusiveEvaluationBase & {
  outcome: "not-applicable";
  reasonCode: "not-applicable";
  reason: string;
};

/** A rule result has exactly one valid outcome-specific shape. */
export type RuleEvaluationResult =
  | RulePassResult
  | RuleFailResult
  | RuleUnknownResult
  | RuleNotApplicableResult;

export interface RuleDisabledState {
  state: "disabled";
  rule: { id: string; version: string };
  reason: string;
}

export interface RuleEngineErrorState {
  state: "engine-error";
  rule: { id: string; version: string };
  reason: string;
  error: string;
}

/** Execution states are not rule evaluation outcomes. */
export type RuleExecutionState = RuleDisabledState | RuleEngineErrorState;

/** Inputs used to derive an evaluation ID. Do not add messages, paths, or timestamps. */
export interface RuleEvaluationIdentity {
  ruleId: string;
  ruleVersion: string;
  subjectId: string;
  scope: {
    project?: string;
    workspace?: string;
    buildId?: string;
    compilationId?: string;
    artifactDigest?: string;
    runtimeInstanceId?: string;
  };
}

/** Stable across ordering, output formats, machines, and message changes. */
export function stableEvaluationId(identity: RuleEvaluationIdentity): string {
  return stableEvidenceId("evaluation", {
    ruleId: identity.ruleId,
    ruleVersion: identity.ruleVersion,
    subjectId: identity.subjectId,
    scope: identity.scope,
  });
}

const CONFIDENCE_ORDER: EvidenceConfidence[] = ["unknown", "low", "medium", "high", "exact"];

/** Return the weaker of two confidence levels. Unknown is weaker than every known level. */
export function weakestConfidence(
  left: EvidenceConfidence,
  right: EvidenceConfidence,
): EvidenceConfidence {
  return CONFIDENCE_ORDER[
    Math.min(CONFIDENCE_ORDER.indexOf(left), CONFIDENCE_ORDER.indexOf(right))
  ]!;
}

/** Apply a rule's declared ceiling without changing severity or outcome. */
export function capConfidence(
  confidence: EvidenceConfidence,
  ceiling: EvidenceConfidence,
): EvidenceConfidence {
  return weakestConfidence(confidence, ceiling);
}
