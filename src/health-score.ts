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
 * Label bands (settled Wave 4 design; overrides the issue’s 90/70 sketch):
 * - ≥75 Great
 * - ≥50 OK
 * - else Needs work
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
  return { score, scoreLabel: labelForScore(score) };
}
