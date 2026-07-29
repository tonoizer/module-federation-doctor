import type {
  EvidenceAwareRuleMeta,
  EvidenceRequirement,
  RuleApplicability,
} from "./rule-contract.js";

export type RuleMigrationGroup = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RuleMigrationStatus = "legacy" | "migrated";

export interface RuleInventoryEntry extends EvidenceAwareRuleMeta {
  group: RuleMigrationGroup;
  status: RuleMigrationStatus;
  migrationNote: string;
}

const ids = [
  "artifact/dts-disabled",
  "artifact/expose-missing",
  "artifact/manifest-assets-disabled",
  "artifact/manifest-disabled",
  "artifact/manifest-expose-assets-empty",
  "artifact/manifest-invalid",
  "artifact/manifest-name-mismatch",
  "artifact/manifest-remote-entry-missing",
  "artifact/manifest-shared-version-mismatch",
  "artifact/public-path-non-string-manifest",
  "artifact/public-path-suspicious",
  "artifact/remote-entry-missing",
  "artifact/types-metadata-missing",
  "artifact/types-missing",
  "config/dts-output-dir-mismatch",
  "config/duplicate-plugin-registration",
  "config/eager-tree-shaking-conflict",
  "config/expose-key-invalid",
  "config/expose-path-missing",
  "config/external-runtime-conflict",
  "config/external-runtime-with-exposes",
  "config/filename-invalid",
  "config/get-public-path-invalid",
  "config/get-public-path-unused",
  "config/implementation-suspicious",
  "config/library-remote-type-mismatch",
  "config/name-required",
  "config/nested-producer-dts-extract",
  "config/plugin-package-mismatch",
  "config/remote-alias-prefix-collision",
  "config/remote-capability-disabled",
  "config/remote-entry-invalid",
  "config/remote-http-insecure",
  "config/remote-localhost-in-production",
  "config/remote-manifest-recommended",
  "config/remote-type-urls-missing",
  "config/runtime-plugin-missing",
  "config/share-scope-undeclared",
  "config/shared-capability-disabled",
  "config/shared-externals-conflict",
  "config/tree-shaking-server-calc-injection",
  "doctor/partial-analysis",
  "federation/circular-remote-graph",
  "federation/external-runtime-provider-missing",
  "federation/ghost-shares",
  "federation/host-gaps",
  "federation/missing-provider",
  "federation/name-conflict",
  "federation/share-scope-mismatch",
  "federation/share-strategy-mismatch",
  "federation/version-conflict",
  "performance/asset-budget",
  "performance/version-first-startup",
  "performance/vite-bundle-all-css",
  "reliability/async-startup-library-promise",
  "reliability/external-runtime-provider-unverified",
  "reliability/shared-import-false",
  "reliability/snapshot-capability-disabled",
  "reliability/tree-shaking-server-calc-contract",
  "reliability/version-first-offline-remotes",
  "reliability/vite-fixed-parse-timeout",
  "runtime/error-correlated",
  "runtime/init-failed",
  "runtime/remote-load-failed",
  "runtime/remote-unknown",
  "runtime/shared-mismatch",
  "security/get-public-path-dynamic-code",
  "shared/candidate",
  "shared/deep-import-bypass",
  "shared/eager-without-singleton",
  "shared/singleton-mismatch",
  "shared/singleton-risk",
  "shared/unused",
  "shared/version-unsatisfied",
] as const;

const groupFor = (id: string): RuleMigrationGroup => {
  if (id === "config/shared-externals-conflict") return 0;
  if (id.startsWith("config/")) return 1;
  if (id.startsWith("artifact/")) return 2;
  if (id.startsWith("shared/") || id.startsWith("security/")) return 3;
  if (id.startsWith("federation/")) return 4;
  if (id.startsWith("runtime/")) return 5;
  return 6;
};

const pendingRequirement: EvidenceRequirement = { allOf: [] };
const pendingApplicability: RuleApplicability = {};

/** Machine-readable migration ledger. Legacy entries are intentionally not wired into runtime yet. */
export const ruleInventory: readonly RuleInventoryEntry[] = ids.map((id) => ({
  id,
  version: "1",
  owner: { name: "Module Federation Doctor maintainers" },
  remediation: {
    summary: "See the rule documentation for the current remediation guidance.",
    documentation: `/rules/${id}`,
  },
  prerequisites: pendingRequirement,
  applicability: pendingApplicability,
  confidenceCeiling: "unknown",
  defaultSeverity: "warning",
  group: groupFor(id),
  status: "legacy",
  migrationNote: "Pending evidence-aware migration; current v1 rule behavior remains unchanged.",
}));

export const ruleInventoryIds = ids;
