import { describe, expect, it } from "vitest";
import * as lineage from "../../src/finding-lineage.js";
import * as waivers from "../../src/governance-waivers.js";
import * as root from "../../src/index.js";

const lineageRootNames = [
  "FINDING_LINEAGE_SCHEMA_VERSION",
  "FindingLineageValidationError",
  "assertFindingLineageRecord",
  "createFindingHistorySnapshot",
  "createFindingLineage",
  "diffFindingHistory",
  "diffFindingHistorySeries",
] as const;

const waiverRootNames = [
  "GOVERNANCE_WAIVER_SCHEMA_VERSION",
  "defineGovernanceWaiver",
  "evaluateGovernanceWaiver",
  "resolveGovernanceWaivers",
] as const;

describe("lineage and waiver root exports", () => {
  it("keeps finding-lineage helpers on src/finding-lineage.ts only", () => {
    for (const name of lineageRootNames) {
      expect(root, name).not.toHaveProperty(name);
    }
    expect(lineage.FINDING_LINEAGE_SCHEMA_VERSION).toBe(1);
    expect(typeof lineage.createFindingLineage).toBe("function");
    expect(typeof lineage.createFindingHistorySnapshot).toBe("function");
    expect(typeof lineage.diffFindingHistory).toBe("function");
    expect(typeof lineage.diffFindingHistorySeries).toBe("function");
    expect(typeof lineage.assertFindingLineageRecord).toBe("function");
    expect(lineage.FindingLineageValidationError).toBeTypeOf("function");
  });

  it("keeps governance-waiver helpers on src/governance-waivers.ts only", () => {
    for (const name of waiverRootNames) {
      expect(root, name).not.toHaveProperty(name);
    }
    expect(waivers.GOVERNANCE_WAIVER_SCHEMA_VERSION).toBe(1);
    expect(typeof waivers.defineGovernanceWaiver).toBe("function");
    expect(typeof waivers.evaluateGovernanceWaiver).toBe("function");
    expect(typeof waivers.resolveGovernanceWaivers).toBe("function");
  });
});
