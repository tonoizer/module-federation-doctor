import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "../../src/rules.js";
import { ruleGuidance } from "../../src/rule-guidance.js";
import { capConfidence, stableEvaluationId, weakestConfidence } from "../../src/rule-contract.js";
import type { RuleEvaluationResult } from "../../src/rule-contract.js";
import { ruleInventory, ruleInventoryIds } from "../../src/rule-inventory.js";
import { runEvidenceAwareRules } from "../../src/rule-contract.js";
import type { EvidenceGraphV2 } from "../../src/evidence.js";
import { AnalysisBudgetTracker, resolveAnalysisBudgets } from "../../src/analysis-budgets.js";

describe("evidence-aware rule contract", () => {
  function graph(overrides: Partial<EvidenceGraphV2> = {}): EvidenceGraphV2 {
    return {
      protocol: {
        protocolVersion: 2,
        schemaVersion: 2,
        producer: { name: "test", version: "1" },
        source: { kind: "test", schemaVersion: "1" },
      },
      scope: { adapter: "vite", bundler: { name: "vite", version: "6" }, target: "web" },
      identity: { project: "shop", buildId: "build-1" },
      subjects: [{ id: "project:shop", kind: "project", name: "shop" }],
      assertions: [],
      edges: [],
      evaluations: [],
      ...overrides,
    };
  }

  const meta = {
    id: "test/rule",
    version: "1",
    owner: { name: "test" },
    remediation: { summary: "test", documentation: "/test" },
    prerequisites: { allOf: [{ predicate: "config.declared", subjectKind: "project" as const }] },
    applicability: { adapters: [{ name: "vite" }], bundlers: [{ name: "vite" }] },
    confidenceCeiling: "high" as const,
    defaultSeverity: "warning" as const,
  };

  it("runs one immutable evidence-aware evaluation with applicability before prerequisites", async () => {
    const input = graph({
      scope: { adapter: "webpack", bundler: { name: "webpack" }, target: "web" },
    });
    const result = await runEvidenceAwareRules({
      graph: input,
      rules: [{ meta, evaluate: () => ({ outcome: "fail", reason: "must not run" }) }],
    });
    expect(result.evaluations[0]).toMatchObject({
      outcome: "not-applicable",
      reasonCode: "not-applicable",
    });
    expect(result.execution).toHaveLength(0);
    expect(Object.isFrozen(result.evaluations)).toBe(false);
  });

  it("makes missing, partial, and weak prerequisites unknown", async () => {
    const rule = { meta, evaluate: () => ({ outcome: "pass" as const, reason: "ok" }) };
    const partial = {
      id: "assertion:partial",
      subject: "project:shop",
      predicate: "config.declared",
      value: true,
      layer: "declared" as const,
      scope: { adapter: "vite", bundler: { name: "vite" }, target: "web" as const },
      provenance: {
        collector: { name: "test", version: "1" },
        inputKind: "test",
        source: "test",
        sourceSchemaVersion: "1",
        parentEvidenceIds: [],
      },
      confidence: { level: "low" as const, reason: "weak" },
      completeness: { status: "partial" as const, reason: "clipped" },
    };
    const result = await runEvidenceAwareRules({
      graph: graph({ assertions: [partial] }),
      rules: [rule],
    });
    expect(result.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "prerequisite-incomplete",
    });
    expect(result.evaluations[0]?.confidence).toBe("low");
  });

  it("caps confidence, preserves stable IDs, and turns rule exceptions into engine errors", async () => {
    const assertion = {
      id: "assertion:exact",
      subject: "project:shop",
      predicate: "config.declared",
      value: true,
      layer: "declared" as const,
      scope: { adapter: "vite", bundler: { name: "vite" }, target: "web" as const },
      provenance: {
        collector: { name: "test", version: "1" },
        inputKind: "test",
        source: "test",
        sourceSchemaVersion: "1",
        parentEvidenceIds: [],
      },
      confidence: { level: "exact" as const, reason: "exact" },
      completeness: { status: "complete" as const, reason: "complete" },
    };
    const good = { meta, evaluate: () => ({ outcome: "pass" as const, reason: "ok" }) };
    const bad = {
      meta: { ...meta, id: "test/bad" },
      evaluate: () => {
        throw new Error("boom");
      },
    };
    const result = await runEvidenceAwareRules({
      graph: graph({ assertions: [assertion] }),
      rules: [good, bad],
    });
    expect(result.evaluations[0]).toMatchObject({
      outcome: "pass",
      confidence: "high",
      completeness: "complete",
    });
    expect(result.evaluations[0]?.id).toBe(
      stableEvaluationId({
        ruleId: "test/rule",
        ruleVersion: "1",
        subjectId: "project:shop",
        scope: { project: "shop", buildId: "build-1" },
      }),
    );
    expect(result.execution[0]).toMatchObject({ state: "engine-error", error: "boom" });
  });

  it("turns a normalization budget cutoff into deterministic unknown evaluations", async () => {
    const input = graph();
    const tracker = new AnalysisBudgetTracker(resolveAnalysisBudgets({ maxEvidenceNodes: 0 }));
    const result = await runEvidenceAwareRules({
      graph: input,
      rules: [{ meta, evaluate: () => ({ outcome: "fail", reason: "must not run" }) }],
      analysisBudget: tracker,
    });
    expect(result.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "prerequisite-incomplete",
      completeness: "partial",
      confidence: "unknown",
    });
    expect(result.analysis).toMatchObject({ status: "partial" });
  });

  it("redacts and orders overflow fallback metadata", async () => {
    const input = graph({
      scope: {
        adapter: "C:\\workspace\\secret",
        bundler: { name: "token=secret" },
        target: "web",
      } as never,
      subjects: [
        { id: "C:\\workspace\\alpha", kind: "project", name: "alpha" },
        { id: "token=beta", kind: "remote", name: "beta" },
      ],
    });
    const tracker = new AnalysisBudgetTracker(resolveAnalysisBudgets({ maxEvidenceNodes: 0 }));
    const result = await runEvidenceAwareRules({
      graph: input,
      rules: [{ meta, evaluate: () => ({ outcome: "fail", reason: "must not run" }) }],
      analysisBudget: tracker,
    });
    expect(result.evaluations).toHaveLength(2);
    expect(result.evaluations.every((item) => item.outcome === "unknown")).toBe(true);
    expect(result.evaluations.map((item) => item.subject)).toEqual([
      "budget-subject:1",
      "budget-subject:2",
    ]);
    expect(result.evaluations.map((item) => item.subject)).not.toContain("C:\\workspace\\alpha");
    expect(result.evaluations.map((item) => item.subject)).not.toContain("token=beta");
    expect(result.evaluations.every((item) => item.scope.adapter === "unknown")).toBe(true);
    expect(result.evaluations.every((item) => item.scope.bundler?.name === "unknown")).toBe(true);
  });

  it("turns the current and remaining rule evaluations unknown after wall-time expiry", async () => {
    let now = 0;
    const tracker = new AnalysisBudgetTracker(resolveAnalysisBudgets({ maxWallTimeMs: 5 }), {
      now: () => now,
      startedAt: 0,
    });
    const assertion = {
      id: "assertion:exact",
      subject: "project:shop",
      predicate: "config.declared",
      value: true,
      layer: "declared" as const,
      scope: { adapter: "vite", bundler: { name: "vite" }, target: "web" as const },
      provenance: {
        collector: { name: "test", version: "1" },
        inputKind: "test",
        source: "test",
        sourceSchemaVersion: "1",
        parentEvidenceIds: [],
      },
      confidence: { level: "exact" as const, reason: "exact" },
      completeness: { status: "complete" as const, reason: "complete" },
    };
    const rule = {
      meta,
      evaluate: () => {
        now = 10;
        return { outcome: "pass" as const, reason: "too late" };
      },
    };
    const result = await runEvidenceAwareRules({
      graph: graph({ assertions: [assertion] }),
      rules: [rule, { ...rule, meta: { ...meta, id: "test/rule-2" } }],
      analysisBudget: tracker,
    });
    expect(result.evaluations).toHaveLength(2);
    expect(result.evaluations.every((item) => item.outcome === "unknown")).toBe(true);
    expect(result.evaluations.every((item) => item.completeness === "partial")).toBe(true);
    expect(result.analysis).toMatchObject({ status: "partial" });
  });

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
      const requirements = (entry.prerequisites as { allOf: Array<{ predicate: string }> }).allOf;
      expect(requirements.length).toBeGreaterThanOrEqual(2);
      expect(requirements.map((requirement) => requirement.predicate)).toEqual(entry.evidenceReads);
      expect(requirements.every((requirement) => requirement.predicate.length > 0)).toBe(true);
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

  it("keeps declared reads aligned with the current built-in rule source", () => {
    const source = fs.readFileSync(new URL("../../src/rules.ts", import.meta.url), "utf8");
    const sourceFor = (id: string) => {
      const start = source.indexOf(`createRule("${id}"`);
      const end = source.indexOf('\n  createRule("', start + 1);
      return source.slice(start, end < 0 ? source.length : end);
    };
    const patterns: Record<string, string> = {
      moduleFederation: "mf(context)",
      "bundler.name": "context.facts.bundler.name",
      "bundler.mode": "context.facts.bundler.mode",
      "bundler.moduleFederationPluginCount": "context.facts.bundler.moduleFederationPluginCount",
      "bundler.outputPublicPathKind": "context.facts.bundler.outputPublicPathKind",
      "imports.sourceFiles": "context.facts.imports.sourceFiles",
      "imports.packages": "context.facts.imports.packages",
      "imports.dynamicPackages": "context.facts.imports.dynamicPackages",
      "imports.specifiers": "context.facts.imports.specifiers",
      "imports.unresolvedDynamic": "context.facts.imports.unresolvedDynamic",
      "imports.deepImports": "context.facts.imports.deepImports",
      "imports.deepImportFiles": "context.facts.imports.deepImportFiles",
      "dependencies.declared": "context.facts.dependencies.declared",
      "dependencies.installed": "context.facts.dependencies.installed",
      "artifacts.manifest": "context.facts.artifacts.manifest",
      "artifacts.emittedAssets": "context.facts.artifacts.emittedAssets",
      "artifacts.assetSizes": "context.facts.artifacts.assetSizes",
      capabilities: "context.facts.capabilities",
      "capabilities.manifest": "context.facts.capabilities.manifest",
      "capabilities.emittedAssets": "context.facts.capabilities.emittedAssets",
    };
    for (const entry of ruleInventory.filter(
      (item) =>
        item.id.startsWith("config/") ||
        item.id.startsWith("artifact/") ||
        item.id.startsWith("performance/") ||
        item.id.startsWith("reliability/") ||
        item.id.startsWith("security/") ||
        (item.id.startsWith("shared/") && item.id !== "shared/singleton-mismatch") ||
        item.id === "doctor/partial-analysis",
    )) {
      const body = sourceFor(entry.id);
      expect(body, entry.id).not.toBe("");
      for (const read of entry.evidenceReads) {
        if (read === "project.scope") continue;
        if (read === "moduleFederation" && body.includes("_context")) continue;
        expect(body, `${entry.id} must read ${read}`).toContain(patterns[read] ?? read);
      }
    }
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

  it("does not allow non-conclusive evidence on pass or fail", () => {
    const base = {
      id: "evaluation:2",
      rule: { id: "x", version: "1" },
      subject: "project:shop",
      confidence: "high" as const,
      evidenceIds: [],
      reasonCode: "rule-result" as const,
      reason: "conclusive",
    };
    // @ts-expect-error partial evidence cannot pass
    const partialPass: RuleEvaluationResult = { ...base, outcome: "pass", completeness: "partial" };
    // @ts-expect-error partial evidence cannot fail
    const partialFail: RuleEvaluationResult = { ...base, outcome: "fail", completeness: "partial" };
    // @ts-expect-error unknown completeness cannot pass
    const unknownPass: RuleEvaluationResult = { ...base, outcome: "pass", completeness: "unknown" };
    // @ts-expect-error unknown completeness cannot fail
    const unknownFail: RuleEvaluationResult = { ...base, outcome: "fail", completeness: "unknown" };
    // @ts-expect-error not-collected evidence cannot pass
    const notCollectedPass: RuleEvaluationResult = {
      ...base,
      outcome: "pass",
      completeness: "not-collected",
    };
    // @ts-expect-error not-collected evidence cannot fail
    const notCollectedFail: RuleEvaluationResult = {
      ...base,
      outcome: "fail",
      completeness: "not-collected",
    };
    // @ts-expect-error unknown confidence cannot pass
    const unknownConfidencePass: RuleEvaluationResult = {
      ...base,
      outcome: "pass",
      confidence: "unknown",
      completeness: "complete",
    };
    // @ts-expect-error unknown confidence cannot fail
    const unknownConfidenceFail: RuleEvaluationResult = {
      ...base,
      outcome: "fail",
      confidence: "unknown",
      completeness: "complete",
    };
    expect([
      partialPass,
      partialFail,
      unknownPass,
      unknownFail,
      notCollectedPass,
      notCollectedFail,
      unknownConfidencePass,
      unknownConfidenceFail,
    ]).toHaveLength(8);
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
