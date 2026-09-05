import type { DoctorFinding } from "./types.js";

/** Published MFDoctor docs origin. */
export const DOCTOR_DOCS_ORIGIN = "https://mfdoctor.kevinbeier.com";

/** Absolute docs URL for a finding's rule page. */
export function doctorRuleDocUrl(finding: Pick<DoctorFinding, "documentation" | "ruleId">): string {
  const docPath = finding.documentation?.startsWith("/")
    ? finding.documentation
    : `/rules/${finding.ruleId}`;
  return `${DOCTOR_DOCS_ORIGIN}${docPath}`;
}
