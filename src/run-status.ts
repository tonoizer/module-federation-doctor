import type { DoctorRunStatus, IncompleteReasonCode, ProjectFacts } from "./types.js";
import type { WorkspaceProjectDiagnostic } from "./workspace.js";

/**
 * Stable incompleteness reason codes on `report.status.incompleteReasons`.
 * Empty when the run is complete. Documented in report-schemas.md.
 */
export const INCOMPLETE_REASON_CODES = [
  "missing-emit",
  "partial-bundler",
  "probe-skipped",
  "evidence-unknown",
] as const satisfies readonly IncompleteReasonCode[];

export type { DoctorRunStatus, IncompleteReasonCode };

export interface ComputeRunStatusOptions {
  /** Workspace discovery diagnostics (probe failures/skips). */
  workspaceDiagnostics?: readonly WorkspaceProjectDiagnostic[];
}

/** Empty complete status for hand-built reports and evidence projections. */
export function emptyRunStatus(): DoctorRunStatus {
  return { complete: true, incompleteReasons: [] };
}

/**
 * Bundler cells that the public matrix treats as partial (not full smoke).
 * Kept explicit here so report status does not load the matrix fixture at runtime.
 */
function isPartialBundler(project: ProjectFacts): boolean {
  if (project.bundler.name === "modern" || project.bundler.name === "unknown") return true;
  const flavor = project.bundler.lifecycle?.flavor;
  return flavor === "rolldown-vite" || flavor === "vite-plus";
}

function hasEvidenceUnknown(project: ProjectFacts): boolean {
  const analysis = project.analysis;
  if (analysis && (analysis.status !== "complete" || analysis.exceeded.length > 0)) return true;
  if ((project.imports.sourceReadFailures?.length ?? 0) > 0) return true;
  if (project.imports.sourceScope === "partial") return true;
  if ((project.imports.unresolvedDynamic?.length ?? 0) > 0) return true;
  if (project.federationInstances?.some((instance) => instance.imports?.sourceScope === "partial"))
    return true;
  return false;
}

/**
 * Derive additive run completeness for agents and CI.
 * Does not change rule evaluation, exit codes, or fingerprints.
 */
export function computeRunStatus(
  projects: readonly ProjectFacts[],
  options: ComputeRunStatusOptions = {},
): DoctorRunStatus {
  const reasons = new Set<IncompleteReasonCode>();

  for (const project of projects) {
    if (!project.capabilities.emittedAssets) reasons.add("missing-emit");
    if (isPartialBundler(project)) reasons.add("partial-bundler");
    if (hasEvidenceUnknown(project)) reasons.add("evidence-unknown");
  }

  if ((options.workspaceDiagnostics ?? []).some((diagnostic) => diagnostic.kind === "probe")) {
    reasons.add("probe-skipped");
  }

  const incompleteReasons = INCOMPLETE_REASON_CODES.filter((code) => reasons.has(code));
  return {
    complete: incompleteReasons.length === 0,
    incompleteReasons: [...incompleteReasons],
  };
}
