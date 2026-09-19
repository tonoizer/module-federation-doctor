#!/usr/bin/env bash
# Publish independent policy/completeness outputs for the workspace gate.
#
# Env:
#   MFDOCTOR_REPORT_JSON       Report path (default: .mf/doctor/report.json).
#   MFDOCTOR_REQUIRE_COMPLETE  Enforce completeness when "true".
#   REPORT_STATUS_RUN_ID       Per-action run identity written to the marker.
#   REPORT_STATUS_STARTED_AT   Unix epoch milliseconds when the action started.
#   REPORT_STATUS_RUN_MARKER   Marker path containing REPORT_STATUS_RUN_ID.
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
const validationReasons = new Set([
  "missing-report",
  "missing-status",
  "invalid-status",
  "missing-projects",
  "missing-emit",
  "missing-findings",
  "invalid-report",
  "invalid-capabilities",
  "invalid-summary",
  "invalid-finding",
  "stale-report",
  "run-identity",
  "status-incomplete",
  "inconsistent-status",
]);
const runFailureCodes = {
  rule: "rule-execution-failed",
  evidence: "evidence-execution-failed",
  analysis: "analysis-failed",
};
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.has(key));
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function validFindingDetails(finding) {
  if (finding.detailsSchema !== "doctor.run-failure.v1") return true;
  const details = finding.details;
  if (!isRecord(details)) return false;
  const allowed = new Set(["phase", "errorCode", "runId", "ruleId", "error"]);
  if (!hasOnlyKeys(details, allowed) || !isUuid(details.runId)) return false;
  if (details.error !== undefined && typeof details.error !== "string") return false;
  if (details.phase === "rule")
    return (
      details.errorCode === runFailureCodes.rule &&
      typeof details.ruleId === "string" &&
      details.ruleId.length > 0
    );
  if (details.phase === "evidence")
    return (
      details.errorCode === runFailureCodes.evidence &&
      (details.ruleId === undefined ||
        (typeof details.ruleId === "string" && details.ruleId.length > 0))
    );
  if (details.phase === "analysis")
    return (
      details.errorCode === runFailureCodes.analysis &&
      (details.ruleId === undefined ||
        (typeof details.ruleId === "string" && details.ruleId.length > 0))
    );
  return false;
}

function validFinding(finding) {
  if (!isRecord(finding)) return false;
  const allowed = new Set([
    "schemaVersion",
    "ruleId",
    "severity",
    "message",
    "project",
    "federationInstanceId",
    "location",
    "evidence",
    "suggestion",
    "documentation",
    "fingerprint",
    "detailsSchema",
    "details",
    "suppressed",
    "suppressionReason",
  ]);
  if (!hasOnlyKeys(finding, allowed)) return false;
  if (
    finding.schemaVersion !== 1 ||
    typeof finding.ruleId !== "string" ||
    finding.ruleId.length === 0 ||
    !["info", "warning", "error"].includes(finding.severity) ||
    typeof finding.message !== "string" ||
    typeof finding.project !== "string" ||
    !isRecord(finding.evidence) ||
    typeof finding.fingerprint !== "string" ||
    finding.fingerprint.length === 0
  )
    return false;
  if (
    finding.federationInstanceId !== undefined &&
    (typeof finding.federationInstanceId !== "string" ||
      !/^mfid:v1:federation-instance:[a-f0-9]{24}$/.test(finding.federationInstanceId))
  )
    return false;
  if (finding.location !== undefined) {
    if (
      !isRecord(finding.location) ||
      !hasOnlyKeys(finding.location, new Set(["path", "line", "column"]))
    )
      return false;
    if (
      typeof finding.location.path !== "string" ||
      (finding.location.line !== undefined &&
        (!Number.isSafeInteger(finding.location.line) || finding.location.line < 1)) ||
      (finding.location.column !== undefined &&
        (!Number.isSafeInteger(finding.location.column) || finding.location.column < 1))
    )
      return false;
  }
  for (const key of ["suggestion", "documentation", "suppressionReason"])
    if (finding[key] !== undefined && typeof finding[key] !== "string") return false;
  if (finding.detailsSchema !== undefined && typeof finding.detailsSchema !== "string") return false;
  if (finding.details !== undefined && !isRecord(finding.details)) return false;
  if (finding.suppressed !== undefined && typeof finding.suppressed !== "boolean") return false;
  return validFindingDetails(finding);
}

function validateReport(report, reasons) {
  if (
    !isRecord(report) ||
    !hasOnlyKeys(report, new Set(["schemaVersion", "capabilities", "status", "summary", "findings"]))
  ) {
    reasons.push("invalid-report");
    return false;
  }
  let valid = report.schemaVersion === 1;
  if (!valid) reasons.push("invalid-report");
  const capabilities = report.capabilities;
  const capabilityKeys = new Set([
    "config",
    "sourceImports",
    "manifest",
    "stats",
    "emittedAssets",
    "installedVersions",
  ]);
  if (
    !isRecord(capabilities) ||
    !hasOnlyKeys(capabilities, capabilityKeys) ||
    [...capabilityKeys].some((key) => typeof capabilities[key] !== "boolean")
  ) {
    reasons.push("invalid-capabilities");
    valid = false;
  }

  const summary = report.summary;
  const summaryKeys = new Set([
    "projects",
    "info",
    "warnings",
    "errors",
    "suppressed",
    "score",
    "scoreLabel",
  ]);
  if (
    !isRecord(summary) ||
    !hasOnlyKeys(summary, summaryKeys) ||
    !["projects", "info", "warnings", "errors"].every((key) => isSafeCount(summary[key])) ||
    (summary.suppressed !== undefined && !isSafeCount(summary.suppressed)) ||
    (summary.score !== undefined &&
      summary.score !== null &&
      (!Number.isSafeInteger(summary.score) || summary.score < 0 || summary.score > 100)) ||
    (summary.scoreLabel !== undefined &&
      summary.scoreLabel !== null &&
      !["Great", "OK", "Needs work"].includes(summary.scoreLabel))
  ) {
    reasons.push("invalid-summary");
    valid = false;
  }

  if (!Array.isArray(report.findings)) {
    reasons.push("missing-findings");
    valid = false;
  } else if (!report.findings.every(validFinding)) {
    reasons.push("invalid-finding");
    valid = false;
  }

  const status = report.status;
  if (!isRecord(status) || !hasOnlyKeys(status, new Set(["complete", "incompleteReasons"]))) {
    reasons.push("missing-status");
    valid = false;
  } else if (
    typeof status.complete !== "boolean" ||
    !Array.isArray(status.incompleteReasons) ||
    status.incompleteReasons.some(
      (reason) => typeof reason !== "string" || !reasonCodes.has(reason),
    )
  ) {
    reasons.push("invalid-status");
    valid = false;
  } else {
    const unique = [...new Set(status.incompleteReasons)];
    reasons.push(...unique);
    if (status.complete && unique.length > 0) reasons.push("inconsistent-status");
    if (!status.complete && unique.length === 0) reasons.push("status-incomplete");
  }

  if (isRecord(summary) && isSafeCount(summary.projects) && summary.projects <= 0)
    reasons.push("missing-projects");
  if (isRecord(capabilities) && capabilities.emittedAssets !== true) reasons.push("missing-emit");
  return valid;
}

function validateRunOwnership(reasons) {
  const expectedRunId = process.env.REPORT_STATUS_RUN_ID;
  const startedAt = Number(process.env.REPORT_STATUS_STARTED_AT);
  const markerPath = process.env.REPORT_STATUS_RUN_MARKER;
  if (expectedRunId === undefined && markerPath === undefined && !Number.isFinite(startedAt)) return;
  if (
    typeof expectedRunId !== "string" ||
    expectedRunId.length === 0 ||
    typeof markerPath !== "string" ||
    !Number.isFinite(startedAt)
  ) {
    reasons.push("run-identity");
    return;
  }
  try {
    const marker = fs.readFileSync(path.resolve(markerPath), "utf8").trim();
    if (marker !== expectedRunId) reasons.push("run-identity");
  } catch {
    reasons.push("run-identity");
  }
  try {
    const stat = fs.statSync(path.resolve(reportPath));
    if (!stat.isFile() || stat.mtimeMs < startedAt) reasons.push("stale-report");
  } catch {
    reasons.push("stale-report");
  }
}

try {
  const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), "utf8"));
  const reasons = [];
  const valid = validateReport(report, reasons);
  validateRunOwnership(reasons);
  const uniqueReasons = [...new Set(reasons)].filter((reason) => validationReasons.has(reason));
  if (valid && Array.isArray(report.findings)) {
    const policyFailure = report.findings.some(
      (finding) => finding.suppressed !== true && finding.severity === "error",
    );
    outputs["policy-result"] = policyFailure ? "fail" : "pass";
  }
  const complete = uniqueReasons.length === 0;
  outputs.completeness = complete ? "complete" : "incomplete";
  outputs.complete = String(complete);
  outputs["incomplete-reasons"] = uniqueReasons.join(",");
} catch (error) {
  process.stderr.write(
    `mfdoctor report status unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

for (const [key, value] of Object.entries(outputs)) publish(key, value);
process.exitCode = requireComplete && outputs.completeness !== "complete" ? 1 : 0;
NODE
