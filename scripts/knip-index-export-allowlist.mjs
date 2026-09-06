/**
 * BL-25 knip preprocessor: keep unused *value* exports from `src/index.ts`
 * and drop names on the documented allowlist.
 *
 * The allowlist is library-only public `.` surface (ADR 0086) that later
 * slim PRs should remove. Do not add a name here to land a new unused
 * export — import it from a test via `src/index.js`, or omit it from `.`.
 */

/** @typedef {import("knip").ReporterOptions} ReporterOptions */

export const INDEX_UNUSED_EXPORT_ALLOWLIST = Object.freeze([
  // BL-27 — identity schema helpers still on `.` after #399 dropped factories.
  "IDENTITY_SCHEMA_VERSION",
  "IdentityValidationError",
  "unknownIdentity",
  // BL-39 / ADR 0086 — correlation, governance, lineage, waivers (library-only).
  "BUILD_ARTIFACT_DEPLOYMENT_SCHEMA_VERSION",
  "FINDING_LINEAGE_SCHEMA_VERSION",
  "FindingLineageValidationError",
  "GOVERNANCE_WAIVER_SCHEMA_VERSION",
  "IDENTITY_CORRELATION_SCHEMA_VERSION",
  "IDENTITY_GOVERNANCE_SCHEMA_VERSION",
  "RUNTIME_IDENTITY_CORRELATION_SCHEMA_VERSION",
  "assertFindingLineageRecord",
  "assessIdentityCapabilityCoverage",
  "correlateBuildArtifactDeployment",
  "correlateDeploymentRelationship",
  "correlateSemanticIdentity",
  "createFindingHistorySnapshot",
  "createFindingLineage",
  "defineGovernanceWaiver",
  "defineIdentityGovernanceRule",
  "diffFindingHistory",
  "diffFindingHistorySeries",
  "evaluateGovernanceWaiver",
  "isIdentityCapabilityEdgeId",
  "isSemanticIdentityKey",
  "projectRuntimeCaptureIdentity",
  "resolveGovernanceWaivers",
  "resolveIdentityGovernance",
  // BL-49 — V1 suppression projection is unused on the CLI path.
  "V1_COMPATIBILITY_SCHEMA_VERSION",
  "projectV1Suppression",
  // BL-52 — semantic-graph stays experimental on `.`; schema const is unused.
  "SEMANTIC_GRAPH_SCHEMA_VERSION",
  // BL-55 — migrated-group inventory lists are not a product API.
  "ALL_MIGRATED_RULE_IDS",
  "MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS",
  "MIGRATED_GROUP1_CONFIG_RULE_IDS",
  "MIGRATED_GROUP2_RULE_IDS",
  "MIGRATED_GROUP3_RULE_IDS",
  "MIGRATED_GROUP4_RULE_IDS",
  "MIGRATED_GROUP5_RULE_IDS",
  "MIGRATED_GROUP6_RULE_IDS",
  // BL-58 — cache defaults are internal; keep exporting until that slim.
  "DEFAULT_ANALYSIS_CACHE_OPTIONS",
]);

const allowlist = new Set(INDEX_UNUSED_EXPORT_ALLOWLIST);

const ISSUE_TYPES = [
  "files",
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "exports",
  "nsExports",
  "types",
  "nsTypes",
  "duplicates",
  "enumMembers",
  "namespaceMembers",
  "catalog",
  "catalogReferences",
  "cycles",
];

function isPublicIndexFile(filePath) {
  return filePath === "src/index.ts" || filePath.endsWith("/src/index.ts");
}

/**
 * @param {ReporterOptions} options
 * @returns {ReporterOptions}
 */
export default function knipPublicIndexAllowlist(options) {
  const exportFiles = options.issues.exports ?? {};
  const remaining = {};
  for (const [filePath, symbols] of Object.entries(exportFiles)) {
    if (!isPublicIndexFile(filePath)) continue;
    for (const [name, issue] of Object.entries(symbols)) {
      const exportName = issue.symbol ?? name.replace(/^root\./, "");
      if (!allowlist.has(exportName)) remaining[name] = issue;
    }
  }

  for (const type of ISSUE_TYPES) {
    options.issues[type] = {};
  }
  const remainingCount = Object.keys(remaining).length;
  if (remainingCount > 0) {
    options.issues.exports = { "src/index.ts": remaining };
  }

  for (const type of ISSUE_TYPES) {
    options.counters[type] = 0;
  }
  options.counters.exports = remainingCount;
  options.counters.total = remainingCount;
  return options;
}
