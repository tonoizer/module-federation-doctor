import { ruleGuidance } from "./rule-guidance.js";
import type { DoctorFinding, HealthScoreLabel, Severity } from "./types.js";

export type { HealthScoreLabel };

export interface HealthScoreResult {
  score: number | null;
  scoreLabel: HealthScoreLabel | null;
}

const PARTIAL_ANALYSIS_RULE = "doctor/partial-analysis";

/**
 * Whether a finding is excluded from the default score surface.
 * Info, tooling category, and `doctor/*` advisory rules do not penalize.
 * Suppressed / baseline-muted findings are also excluded.
 */
export function isExcludedFromScore(finding: DoctorFinding): boolean {
  if (finding.suppressed) return true;
  if (finding.severity === "info") return true;
  if (finding.ruleId.startsWith("doctor/")) return true;
  if (ruleGuidance[finding.ruleId]?.category === "tooling") return true;
  return false;
}

function uniqueRuleIds(findings: DoctorFinding[], severity: Severity): Set<string> {
  const ids = new Set<string>();
  for (const finding of findings) {
    if (finding.severity !== severity) continue;
    if (isExcludedFromScore(finding)) continue;
    ids.add(finding.ruleId);
  }
  return ids;
}

/**
 * Label bands:
 * - ≥75 Great
 * - ≥50 OK
 * - else Needs work
 *
 * `computeHealthScore` also uses Needs work for any non-suppressed
 * blocking error, even when the numeric band would otherwise be Great or OK.
 */
export function labelForScore(score: number): HealthScoreLabel {
  if (score >= 75) return "Great";
  if (score >= 50) return "OK";
  return "Needs work";
}

/**
 * Deterministic offline federation health score.
 *
 * `score = clamp(0, round(100 − 1.5×|unique error rules| − 0.75×|unique warning rules|))`
 *
 * Returns `null` when a non-suppressed `doctor/partial-analysis` finding is present
 * (analysis too incomplete to score). Does not change `failOn` semantics.
 */
export function computeHealthScore(findings: DoctorFinding[]): HealthScoreResult {
  const hasPartial = findings.some(
    (finding) => finding.ruleId === PARTIAL_ANALYSIS_RULE && !finding.suppressed,
  );
  if (hasPartial) return { score: null, scoreLabel: null };

  const errorRules = uniqueRuleIds(findings, "error");
  const warningRules = uniqueRuleIds(findings, "warning");
  const raw = 100 - 1.5 * errorRules.size - 0.75 * warningRules.size;
  const score = Math.max(0, Math.round(raw));
  // The unique-rule formula intentionally keeps the numeric score stable, but
  // One blocking error must not present a project as healthy just because the
  // numeric score is still in a higher band.
  const hasBlockingError = findings.some(
    (finding) => finding.severity === "error" && !finding.suppressed,
  );
  return { score, scoreLabel: hasBlockingError ? "Needs work" : labelForScore(score) };
}
