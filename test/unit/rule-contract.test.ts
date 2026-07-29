import { describe, expect, it } from "vitest";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "../../src/rules.js";
import { ruleGuidance } from "../../src/rule-guidance.js";
import { capConfidence, stableEvaluationId, weakestConfidence } from "../../src/rule-contract.js";
import type { RuleEvaluationResult } from "../../src/rule-contract.js";
import { ruleInventory, ruleInventoryIds } from "../../src/rule-inventory.js";

describe("evidence-aware rule contract", () => {
  it("keeps the inventory in sync with every current built-in rule", () => {
    const runtimeIds = [
      ...builtInRules.map((rule) => rule.meta.id),
      ...federationRuleMeta.map((rule) => rule.id),
      ...runtimeRuleMeta.map((rule) => rule.id),
    ].sort();
    const currentSeverities = new Map([
      ...builtInRules.map((rule) => [rule.meta.id, rule.meta.defaultSeverity] as const),
      ...federationRuleMeta.map((rule) => [rule.id, rule.severity] as const),
      ...runtimeRuleMeta.map((rule) => [rule.id, rule.severity] as const),
    ]);
    expect([...ruleInventoryIds].sort()).toEqual(runtimeIds);
    expect(new Set(ruleInventoryIds).size).toBe(ruleInventoryIds.length);
    expect(ruleInventory.every((entry) => entry.status === "legacy")).toBe(true);
    for (const entry of ruleInventory) {
      expect(entry.version).not.toBe("");
      expect(entry.owner.name).not.toBe("");
      expect(entry.prerequisites).toMatchObject({
        predicate: expect.any(String),
        layer: expect.any(String),
        subjectKind: expect.any(String),
        minimumConfidence: expect.any(String),
        minimumCompleteness: "complete",
      });
      expect(entry.applicability.adapters?.length).toBeGreaterThan(0);
      expect(entry.applicability.bundlers?.length).toBeGreaterThan(0);
      expect(entry.remediation.summary).toBe(ruleGuidance[entry.id]?.impact);
      expect(entry.remediation.fix).toBe(ruleGuidance[entry.id]?.fix);
      expect(entry.migrationNote).toContain(`Planned group ${entry.group}`);
      expect(entry.defaultSeverity).toBe(currentSeverities.get(entry.id));
    }
    expect(
      ruleInventory.find((entry) => entry.id === "config/plugin-package-mismatch")?.group,
    ).toBe(3);
    expect(ruleInventory.find((entry) => entry.id === "performance/asset-budget")?.group).toBe(2);
    expect(ruleInventory.find((entry) => entry.id === "shared/singleton-mismatch")?.group).toBe(4);
    expect(
      ruleInventory.find((entry) => entry.id === "performance/asset-budget")?.defaultSeverity,
    ).toBe("warning");
  });

  it("does not allow invalid outcome and reason combinations", () => {
    const base = {
      id: "evaluation:1",
      rule: { id: "x", version: "1" },
      subject: "project:shop",
      confidence: "high" as const,
      evidenceIds: [],
      completeness: "complete" as const,
    };
    const pass: RuleEvaluationResult = {
      ...base,
      outcome: "pass",
      reasonCode: "rule-result",
      reason: "healthy",
    };
    expect(pass.outcome).toBe("pass");

    // @ts-expect-error unknown must explain which requirements are missing
    const missingDetails: RuleEvaluationResult = {
      ...base,
      outcome: "unknown",
      reasonCode: "prerequisite-missing",
      reason: "not enough evidence",
    };
    // @ts-expect-error unknown cannot use the pass/fail reason code
    const invalidReason: RuleEvaluationResult = {
      ...base,
      outcome: "unknown",
      reasonCode: "rule-result",
      reason: "not enough evidence",
      missingRequirements: [],
    };
    // @ts-expect-error disabled is an execution state, not an evaluation outcome
    const disabled: RuleEvaluationResult = { ...base, outcome: "disabled" };
    expect([missingDetails, invalidReason, disabled]).toHaveLength(3);
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
    expect(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "2",
        subjectId: "project:shop",
        scope: { project: "shop", buildId: "build-1" },
      }),
    ).not.toBe(left);
    expect(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "1",
        subjectId: "project:cart",
        scope: { project: "shop", buildId: "build-1" },
      }),
    ).not.toBe(left);
    expect(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "1",
        subjectId: "project:shop",
        scope: {},
      }),
    ).not.toBe(left);
    expect(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "1",
        subjectId: "project:shop",
        scope: { project: "shop", buildId: "build-1", artifactDigest: "digest-2" },
      }),
    ).not.toBe(left);
    expect(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "1",
        subjectId: "project:shop",
        scope: { project: "shop", buildId: "/Users/alice/project/build-1" },
      }),
    ).toBe(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "1",
        subjectId: "project:shop",
        scope: { project: "shop", buildId: "/Users/bob/project/build-1" },
      }),
    );
  });
});
