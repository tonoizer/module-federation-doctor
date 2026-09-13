import type { AnalysisBudgetReport } from "./analysis-budgets.js";
import type { DoctorFinding } from "./types.js";
import { redact } from "./utils.js";

/**
 * Versioned, machine-readable finding detail payloads (#136).
 *
 * `detailsSchema` + `details` are top-level finding fields only. They are never
 * written into `evidence` and are never inputs to `fingerprint()` — baselines,
 * SARIF partial fingerprints, and fingerprint stability stay unchanged.
 */

export const FINDING_DETAILS_SCHEMAS = {
  SHARED_UNUSED: "shared.unused.v1",
  SHARED_SINGLETON: "shared.singleton.v1",
  SHARED_VERSION_MISMATCH: "shared.version-mismatch.v1",
  REMOTES_CONFIG: "remotes.config.v1",
  ARTIFACT: "artifact.v1",
  DOCTOR_PARTIAL_ANALYSIS: "doctor.partial-analysis.v1",
} as const;

export type FindingDetailsSchemaId =
  (typeof FINDING_DETAILS_SCHEMAS)[keyof typeof FINDING_DETAILS_SCHEMAS];

/** Stable top-level family extracted from a rule id such as `shared/unused`. */
export type FindingRuleFamily = string;

/** Return the stable rule-family prefix without interpreting individual leaves. */
export function findingRuleFamily(ruleId: string): FindingRuleFamily {
  const separator = ruleId.indexOf("/");
  const family = separator === -1 ? ruleId : ruleId.slice(0, separator);
  return family.trim() || "unknown";
}

/** Compatibility aliases for callers that prefer a noun-first helper name. */
export const ruleFamilyForFinding = findingRuleFamily;
export const ruleFamily = findingRuleFamily;

/** Bounds shared by repair context and rendered agent evidence. */
export const MAX_REPAIR_EVIDENCE_KEYS = 8;
export const MAX_REPAIR_EVIDENCE_VALUE_CHARS = 120;
export const MAX_REPAIR_EVIDENCE_KEY_CHARS = 120;

/** Inventory of built-in rule IDs that emit typed details in the first batch. */
export const TYPED_DETAILS_RULE_IDS = [
  "shared/unused",
  "shared/singleton-risk",
  "shared/eager-without-singleton",
  "shared/version-unsatisfied",
  "shared/singleton-mismatch",
  "config/remote-entry-invalid",
  "config/remote-http-insecure",
  "config/remote-localhost-in-production",
  "config/remote-alias-prefix-collision",
  "config/remote-manifest-recommended",
  "config/js-remote-without-type-urls",
  "config/remote-capability-disabled",
  "artifact/public-path-non-string-manifest",
  "artifact/manifest-assets-disabled",
  "artifact/manifest-disabled",
  "artifact/dts-disabled",
  "artifact/manifest-invalid",
  "artifact/manifest-name-mismatch",
  "artifact/manifest-remote-entry-missing",
  "artifact/manifest-expose-assets-empty",
  "artifact/manifest-shared-version-mismatch",
  "artifact/types-metadata-missing",
  "artifact/remote-entry-missing",
  "artifact/expose-missing",
  "artifact/public-path-suspicious",
  "artifact/react-dom-server-in-web",
  "artifact/types-missing",
  "doctor/partial-analysis",
] as const;

export type TypedDetailsRuleId = (typeof TYPED_DETAILS_RULE_IDS)[number];

export interface SharedUnusedDetailsV1 {
  package: string;
  evidenceSources?: string[];
  dynamicPackages?: string[];
  importDepth?: string | number;
}

export interface SharedSingletonDetailsV1 {
  package: string;
  kind: "risk" | "eager-without-singleton" | "mismatch";
}

export interface SharedVersionMismatchDetailsV1 {
  package: string;
  source: "requiredVersion" | "manifest";
  installed?: string;
  requiredVersion?: string;
  manifestVersion?: string;
}

export interface RemotesConfigDetailsV1 {
  remote?: string;
  entry?: string;
  alias?: string;
  collision?: string;
  collisionAlias?: string;
  mode?: string;
  remotes?: string[];
}

export interface ArtifactDetailsV1 {
  path?: string;
  expected?: string;
  key?: string;
  expose?: string;
  package?: string;
  configName?: string;
  manifestName?: string;
  installed?: string;
  manifestVersion?: string;
  outputPublicPathKind?: string;
  exposes?: string[];
  remoteEntry?: unknown;
  /** Specifiers or asset paths that triggered an artifact shape finding. */
  entries?: string[];
}

export interface DoctorPartialAnalysisDetailsV1 {
  missing: string[];
  unresolvedDynamic?: Array<Record<string, unknown>>;
  sourceReadFailures?: string[];
  evidenceSources?: string[];
  analysisBudget?: AnalysisBudgetReport;
  projectAnalysis?: Array<{
    project: string;
    analysis: AnalysisBudgetReport;
  }>;
  workspaceDiagnostics?: Array<{
    kind: string;
    files: string[];
    message: string;
  }>;
}

export interface FindingRepairContextOptions {
  /** Project root used by the common redactor to hide local absolute paths. */
  projectDirectory?: string;
  reportPath?: string;
  jsonPointer?: string;
}

/**
 * Bounded, redacted evidence for copyable repair handoffs.
 * Values are rendered strings so nested objects cannot bypass the size bound.
 */
export function boundSafeEvidence(
  evidence: Record<string, unknown>,
  projectDirectory?: string,
): Record<string, string> {
  const safe = redact(evidence, projectDirectory) as Record<string, unknown>;
  const entries = Object.entries(safe).sort(([left], [right]) => left.localeCompare(right));
  const bounded: Record<string, string> = {};
  for (const [key, value] of entries.slice(0, MAX_REPAIR_EVIDENCE_KEYS)) {
    const boundedKey =
      key.length > MAX_REPAIR_EVIDENCE_KEY_CHARS
        ? `${key.slice(0, MAX_REPAIR_EVIDENCE_KEY_CHARS)}…`
        : key;
    let rendered: string;
    if (value === undefined) rendered = "undefined";
    else if (value === null) rendered = "null";
    else if (typeof value === "string") rendered = value;
    else {
      try {
        rendered = JSON.stringify(value) ?? String(value);
      } catch {
        rendered = String(value);
      }
    }
    bounded[boundedKey] =
      rendered.length > MAX_REPAIR_EVIDENCE_VALUE_CHARS
        ? `${rendered.slice(0, MAX_REPAIR_EVIDENCE_VALUE_CHARS)}…`
        : rendered;
  }
  return bounded;
}

export interface FindingRepairContextV1 {
  schemaVersion: 1;
  ruleFamily: FindingRuleFamily;
  ruleId: string;
  fingerprint: string;
  reportPath?: string;
  jsonPointer?: string;
  evidence: Record<string, string>;
  detailsSchema?: string;
  details?: Record<string, string>;
}

type FindingRepairInput = Pick<DoctorFinding, "ruleId" | "fingerprint"> & {
  evidence?: unknown;
  detailsSchema?: unknown;
  details?: unknown;
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Build stable metadata plus bounded evidence without changing report fingerprints. */
export function buildFindingRepairContext(
  finding: FindingRepairInput,
  options: FindingRepairContextOptions = {},
): FindingRepairContextV1 {
  const evidence = recordValue(finding.evidence) ?? {};
  const details = recordValue(finding.details);
  return {
    schemaVersion: 1,
    ruleFamily: findingRuleFamily(finding.ruleId),
    ruleId: finding.ruleId,
    fingerprint: finding.fingerprint,
    ...(options.reportPath ? { reportPath: options.reportPath } : {}),
    ...(options.jsonPointer ? { jsonPointer: options.jsonPointer } : {}),
    evidence: boundSafeEvidence(evidence, options.projectDirectory),
    ...(typeof finding.detailsSchema === "string" && finding.detailsSchema.length > 0
      ? { detailsSchema: finding.detailsSchema }
      : {}),
    ...(details ? { details: boundSafeEvidence(details, options.projectDirectory) } : {}),
  };
}

export type FindingDetailsV1 =
  | SharedUnusedDetailsV1
  | SharedSingletonDetailsV1
  | SharedVersionMismatchDetailsV1
  | RemotesConfigDetailsV1
  | ArtifactDetailsV1
  | DoctorPartialAnalysisDetailsV1;

export type FindingDetailsAttachment = {
  detailsSchema: FindingDetailsSchemaId;
  details: FindingDetailsV1;
};

export function findingDetails(
  detailsSchema: FindingDetailsSchemaId,
  details: FindingDetailsV1,
): FindingDetailsAttachment {
  return { detailsSchema, details };
}

/**
 * Safe reader for agents/CI: missing fields and unknown schema versions are
 * tolerated (returns undefined rather than throwing).
 */
export function readFindingDetails(finding: {
  detailsSchema?: unknown;
  details?: unknown;
}): { detailsSchema: string; details: Record<string, unknown> } | undefined {
  if (typeof finding.detailsSchema !== "string" || finding.detailsSchema.length === 0)
    return undefined;
  if (!finding.details || typeof finding.details !== "object" || Array.isArray(finding.details))
    return undefined;
  return {
    detailsSchema: finding.detailsSchema,
    details: finding.details as Record<string, unknown>,
  };
}

export function isKnownFindingDetailsSchema(schema: string): schema is FindingDetailsSchemaId {
  return (Object.values(FINDING_DETAILS_SCHEMAS) as string[]).includes(schema);
}
