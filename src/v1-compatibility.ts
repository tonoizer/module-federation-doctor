import type { GovernanceWaiverResolution } from "./governance-waivers.js";
import { entryMatchesFinding, type BaselineEntry, type BaselineFile } from "./baseline.js";
import type { DoctorFinding } from "./types.js";
import { IdentityValidationError } from "./identity.js";

/** Version of the additive V1 suppression compatibility projection. */
export const V1_COMPATIBILITY_SCHEMA_VERSION = 1 as const;
export type V1CompatibilitySchemaVersion = typeof V1_COMPATIBILITY_SCHEMA_VERSION;

export type V1SuppressionSource = "none" | "baseline" | "waiver" | "baseline+waiver";
export type V1WaiverDecisionState =
  | GovernanceWaiverResolution["outcome"]
  | "not-evaluated"
  | "lineage-mismatch";

export interface V1SuppressionProjectionInput {
  finding: DoctorFinding;
  /** Required to connect a waiver decision to the legacy finding safely. */
  findingLineageId?: string;
  baseline?: BaselineFile;
  waiver?: GovernanceWaiverResolution;
  failOnSuppressed?: boolean;
}

export interface V1SuppressionProjection {
  schemaVersion: V1CompatibilitySchemaVersion;
  fingerprint: string;
  ruleId: string;
  project: string;
  suppressed: boolean;
  suppressionSource: V1SuppressionSource;
  suppressionReason?: string;
  baselineMatched: boolean;
  waiverApplied: boolean;
  waiverOutcome: V1WaiverDecisionState;
  policyRelevant: boolean;
}

const FINDING_LINEAGE_ID = /^mffinding:v1:[a-f0-9]{24}$/;
const WAIVER_OUTCOMES = new Set<GovernanceWaiverResolution["outcome"]>([
  "suppressed",
  "not-suppressed",
  "ambiguous",
  "unknown",
]);

function validateWaiverResolution(
  waiver: GovernanceWaiverResolution | undefined,
): GovernanceWaiverResolution | undefined {
  if (waiver === undefined) return undefined;
  if (
    waiver.schemaVersion !== V1_COMPATIBILITY_SCHEMA_VERSION ||
    !WAIVER_OUTCOMES.has(waiver.outcome) ||
    typeof waiver.suppressed !== "boolean" ||
    (waiver.suppressed && waiver.outcome !== "suppressed")
  )
    throw new IdentityValidationError("waiver resolution must be a valid v1 governance decision.");
  if (!FINDING_LINEAGE_ID.test(waiver.findingLineageId))
    throw new IdentityValidationError("waiver resolution must reference a v1 finding lineage ID.");
  return waiver;
}

function matchingBaselineEntry(
  finding: DoctorFinding,
  baseline: BaselineFile | undefined,
): BaselineEntry | undefined {
  return baseline?.entries.find((entry) => entryMatchesFinding(entry, finding));
}

/**
 * Project baseline and governed-waiver decisions onto the unchanged V1
 * suppression fields. Baseline matching is delegated to the existing matcher;
 * this helper never edits a baseline or mutates the finding.
 */
export function projectV1Suppression(input: V1SuppressionProjectionInput): V1SuppressionProjection {
  const { finding, baseline, failOnSuppressed = false } = input;
  const waiver = validateWaiverResolution(input.waiver);
  if (input.findingLineageId !== undefined && !FINDING_LINEAGE_ID.test(input.findingLineageId))
    throw new IdentityValidationError("findingLineageId must be a v1 finding lineage ID.");

  const baselineEntry = matchingBaselineEntry(finding, baseline);
  const baselineMatched = baselineEntry !== undefined;
  const waiverLineageMatches =
    waiver !== undefined &&
    input.findingLineageId !== undefined &&
    waiver.findingLineageId === input.findingLineageId;
  const waiverApplied = waiverLineageMatches && waiver.suppressed;
  const waiverOutcome: V1WaiverDecisionState =
    waiver === undefined
      ? "not-evaluated"
      : !waiverLineageMatches
        ? "lineage-mismatch"
        : waiver.outcome;
  const suppressed = baselineMatched || waiverApplied;
  const suppressionSource: V1SuppressionSource =
    baselineMatched && waiverApplied
      ? "baseline+waiver"
      : baselineMatched
        ? "baseline"
        : waiverApplied
          ? "waiver"
          : "none";
  const waiverReason =
    waiverApplied && waiver !== undefined
      ? `Governance waiver ${waiver.appliedWaiverIds.join(", ")}`
      : undefined;
  const suppressionReason = baselineEntry?.reason ?? waiverReason;
  return {
    schemaVersion: V1_COMPATIBILITY_SCHEMA_VERSION,
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    project: finding.project,
    suppressed,
    suppressionSource,
    ...(suppressionReason === undefined ? {} : { suppressionReason }),
    baselineMatched,
    waiverApplied,
    waiverOutcome,
    policyRelevant: failOnSuppressed || !suppressed,
  };
}
