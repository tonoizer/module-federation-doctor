#!/usr/bin/env bash
# Publish independent policy/completeness outputs for the workspace gate.
#
# Env:
#   MFDOCTOR_REPORT_JSON       Report path (default: .mf/doctor/report.json).
#   MFDOCTOR_REQUIRE_COMPLETE  Enforce completeness when "true".
#   GITHUB_OUTPUT              GitHub Actions output file; stdout when unset.
set -u

report_path="${MFDOCTOR_REPORT_JSON:-.mf/doctor/report.json}"
require_complete="${MFDOCTOR_REQUIRE_COMPLETE:-false}"

REPORT_STATUS_PATH="${report_path}" REPORT_STATUS_REQUIRE_COMPLETE="${require_complete}" \
  node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const reportPath = process.env.REPORT_STATUS_PATH ?? ".mf/doctor/report.json";
const requireComplete = process.env.REPORT_STATUS_REQUIRE_COMPLETE === "true";
const outputPath = process.env.GITHUB_OUTPUT;
const reasonCodes = new Set([
  "missing-emit",
  "missing-stats",
  "partial-bundler",
  "probe-skipped",
  "evidence-unknown",
]);
const outputs = {
  "policy-result": "unknown",
  completeness: "incomplete",
  complete: "false",
  "incomplete-reasons": "missing-report",
};

function publish(key, value) {
  const line = `${key}=${value}\n`;
  if (outputPath) fs.appendFileSync(outputPath, line, "utf8");
  else process.stdout.write(line);
}

try {
  const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), "utf8"));
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw new Error("report root is not an object");

  if (Array.isArray(report.findings)) {
    const policyFailure = report.findings.some(
      (finding) =>
        finding &&
        typeof finding === "object" &&
        finding.suppressed !== true &&
        finding.severity === "error",
    );
    outputs["policy-result"] = policyFailure ? "fail" : "pass";
  }

  const reasons = [];
  const status = report.status;
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    reasons.push("missing-status");
  } else if (
    typeof status.complete !== "boolean" ||
    !Array.isArray(status.incompleteReasons) ||
    status.incompleteReasons.some((reason) => typeof reason !== "string" || !reasonCodes.has(reason))
  ) {
    reasons.push("invalid-status");
  } else {
    reasons.push(...status.incompleteReasons);
    if (!status.complete && reasons.length === 0) reasons.push("status-incomplete");
  }

  if (
    !report.summary ||
    typeof report.summary !== "object" ||
    !Number.isSafeInteger(report.summary.projects) ||
    report.summary.projects <= 0
  ) {
    reasons.push("missing-projects");
  }
  if (
    !report.capabilities ||
    typeof report.capabilities !== "object" ||
    report.capabilities.emittedAssets !== true
  ) {
    reasons.push("missing-emit");
  }
  if (!Array.isArray(report.findings)) reasons.push("missing-findings");

  const uniqueReasons = [...new Set(reasons)];
  const complete = uniqueReasons.length === 0;
  outputs.completeness = complete ? "complete" : "incomplete";
  outputs.complete = String(complete);
  outputs["incomplete-reasons"] = uniqueReasons.join(",");
} catch (error) {
  process.stderr.write(
    `MFDoctor report status unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

for (const [key, value] of Object.entries(outputs)) publish(key, value);
process.exitCode = requireComplete && outputs.completeness !== "complete" ? 1 : 0;
NODE
