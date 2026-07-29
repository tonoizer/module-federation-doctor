import { describe, expect, it } from "vitest";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "../../src/rules.js";
import { capConfidence, stableEvaluationId, weakestConfidence } from "../../src/rule-contract.js";
import { ruleInventory, ruleInventoryIds } from "../../src/rule-inventory.js";

describe("evidence-aware rule contract", () => {
  it("keeps the inventory in sync with every current built-in rule", () => {
    const runtimeIds = [
      ...builtInRules.map((rule) => rule.meta.id),
      ...federationRuleMeta.map((rule) => rule.id),
      ...runtimeRuleMeta.map((rule) => rule.id),
    ].sort();
    expect([...ruleInventoryIds].sort()).toEqual(runtimeIds);
    expect(new Set(ruleInventoryIds).size).toBe(ruleInventoryIds.length);
    expect(ruleInventory.every((entry) => entry.status === "legacy")).toBe(true);
  });

  it("calculates weakest evidence confidence and applies the rule ceiling", () => {
    expect(weakestConfidence("exact", "medium")).toBe("medium");
    expect(weakestConfidence("unknown", "exact")).toBe("unknown");
    expect(capConfidence("exact", "high")).toBe("high");
  });

  it("keeps evaluation identity independent from messages and ordering", () => {
    const left = stableEvaluationId({
      ruleId: "config/name-required",
      ruleVersion: "1",
      subjectId: "project:shop",
      scope: { project: "shop", buildId: "build-1" },
    });
    const right = stableEvaluationId({
      ruleId: "config/name-required",
      ruleVersion: "1",
      subjectId: "project:shop",
      scope: { buildId: "build-1", project: "shop" },
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^evaluation:[0-9a-f]{16}$/);
  });
});
