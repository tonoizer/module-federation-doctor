import type { AnalysisBudgetReport } from "./analysis-budgets.js";

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
