import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "../../src/rules.js";
import { ruleGuidance } from "../../src/rule-guidance.js";
import { capConfidence, stableEvaluationId, weakestConfidence } from "../../src/rule-contract.js";
import type { RuleEvaluationResult } from "../../src/rule-contract.js";
import {
  MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS,
  MIGRATED_GROUP1_CONFIG_RULE_IDS,
  MIGRATED_GROUP2_RULE_IDS,
  MIGRATED_GROUP3_RULE_IDS,
  ruleInventory,
  ruleInventoryIds,
} from "../../src/rule-inventory.js";
import { runEvidenceAwareRules } from "../../src/rule-contract.js";
import type { EvidenceGraphV2 } from "../../src/evidence.js";
import { AnalysisBudgetTracker, resolveAnalysisBudgets } from "../../src/analysis-budgets.js";

describe("evidence-aware rule contract", () => {
  const makeAssertion = (predicate: string, id: string) => ({
    id,
    subject: "project:shop",
    predicate,
    value: true,
    layer:
      predicate === "project.moduleFederation" || predicate === "project.scope"
        ? ("declared" as const)
        : ("effective" as const),
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
  });

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

  it("applies semver ranges to scoped bundler applicability", async () => {
    const rule = {
      meta: {
        ...meta,
        applicability: {
          adapters: [{ name: "vite" }],
          bundlers: [{ name: "vite", version: ">=6.0.0" }],
        },
      },
      evaluate: () => ({ outcome: "pass" as const, reason: "supported" }),
    };
    const assertion = {
      id: "assertion:exact",
      subject: "project:shop",
      predicate: "config.declared",
      value: true,
      layer: "declared" as const,
      scope: {
        adapter: "vite",
        bundler: { name: "vite", version: "6.1.0" },
        target: "web" as const,
      },
      provenance: {
        collector: { name: "test", version: "1" },
        inputKind: "test",
        source: "test",
        sourceSchemaVersion: "1",
      },
      confidence: { level: "exact" as const, reason: "exact" },
      completeness: { status: "complete" as const, reason: "complete" },
    };
    const result = await runEvidenceAwareRules({
      graph: graph({
        scope: { adapter: "vite", bundler: { name: "vite", version: "6.1.0" }, target: "web" },
        assertions: [assertion],
      }),
      rules: [rule],
    });
    expect(result.evaluations[0]).toMatchObject({ outcome: "pass" });

    const unsupported = await runEvidenceAwareRules({
      graph: graph({
        scope: { adapter: "vite", bundler: { name: "vite", version: "5.9.0" }, target: "web" },
        assertions: [assertion],
      }),
      rules: [rule],
    });
    expect(unsupported.evaluations[0]).toMatchObject({
      outcome: "not-applicable",
      reasonCode: "not-applicable",
    });
  });

  it("applies semver ranges to adapter versions with honest unknown handling", async () => {
    const rule = {
      meta: {
        ...meta,
        applicability: {
          adapters: [{ name: "vite", version: ">=6.0.0" }],
          bundlers: [{ name: "vite" }],
        },
      },
      evaluate: () => ({ outcome: "pass" as const, reason: "supported" }),
    };
    const assertion = {
      id: "assertion:adapter-version",
      subject: "project:shop",
      predicate: "config.declared",
      value: true,
      layer: "declared" as const,
      scope: {
        adapter: "vite",
        bundler: { name: "vite", version: "6.1.0" },
        target: "web" as const,
      },
      provenance: {
        collector: { name: "test", version: "1" },
        inputKind: "test",
        source: "test",
        sourceSchemaVersion: "1",
      },
      confidence: { level: "exact" as const, reason: "exact" },
      completeness: { status: "complete" as const, reason: "complete" },
    };
    const run = (adapterVersion: string | undefined, candidateRule = rule) =>
      runEvidenceAwareRules({
        graph: graph({ assertions: [assertion] }),
        rules: [candidateRule],
        scope: {
          adapter: "vite",
          ...(adapterVersion !== undefined ? { adapterVersion } : {}),
        },
      });

    const satisfies = await run("6.1.0");
    expect(satisfies.evaluations[0]).toMatchObject({
      outcome: "pass",
      scope: { adapter: "vite", adapterVersion: "6.1.0" },
    });

    const rejects = await run("5.9.0");
    expect(rejects.evaluations[0]).toMatchObject({
      outcome: "not-applicable",
      reasonCode: "not-applicable",
    });

    const unknown = await run(undefined);
    expect(unknown.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "applicability-unknown",
    });

    const invalidActual = await run("not-a-version");
    expect(invalidActual.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "applicability-unknown",
    });

    const invalidConstraint = await run("6.1.0", {
      ...rule,
      meta: {
        ...rule.meta,
        applicability: {
          adapters: [{ name: "vite", version: "not-a-range" }],
          bundlers: [{ name: "vite" }],
        },
      },
    });
    expect(invalidConstraint.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "applicability-unknown",
    });
  });

  it("uses some semantics across multiple versioned entries with the same name", async () => {
    const rule = {
      meta: {
        ...meta,
        applicability: {
          adapters: [
            { name: "vite", version: ">=7.0.0" },
            { name: "vite", version: "6.x" },
          ],
          bundlers: [
            { name: "vite", version: ">=7.0.0" },
            { name: "vite", version: "6.x" },
          ],
        },
        prerequisites: { allOf: [] },
      },
      evaluate: () => ({ outcome: "pass" as const, reason: "supported" }),
    };
    const run = (adapterVersion: string, bundlerVersion: string) =>
      runEvidenceAwareRules({
        graph: graph({
          scope: {
            adapter: "vite",
            bundler: { name: "vite", version: bundlerVersion },
            target: "web",
          },
        }),
        rules: [rule],
        scope: {
          adapter: "vite",
          adapterVersion,
          bundler: { name: "vite", version: bundlerVersion },
        },
      });

    expect((await run("6.5.0", "6.5.0")).evaluations[0]).toMatchObject({
      outcome: "pass",
    });
    expect((await run("7.1.0", "7.1.0")).evaluations[0]).toMatchObject({
      outcome: "pass",
    });
    expect((await run("5.9.0", "5.9.0")).evaluations[0]).toMatchObject({
      outcome: "not-applicable",
      reasonCode: "not-applicable",
    });
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

  it("accepts inconclusive rule decisions as unknown evaluations", async () => {
    const rule = {
      meta,
      evaluate: () => ({
        outcome: "unknown" as const,
        reason: "Heuristic evidence cannot establish certainty.",
        reasonCode: "evidence-inconclusive" as const,
      }),
    };
    const result = await runEvidenceAwareRules({
      graph: graph({
        assertions: [makeAssertion("config.declared", "assertion:config")],
      }),
      rules: [rule],
    });
    expect(result.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "evidence-inconclusive",
      completeness: "complete",
    });
  });

  it("maps migrated config.declared and source.scan prereqs to emitted graph predicates only", async () => {
    const configRule = ruleInventory.find((entry) => entry.id === "config/expose-key-invalid");
    const sourceRule = ruleInventory.find((entry) => entry.id === "config/runtime-plugin-missing");
    expect(configRule).toBeDefined();
    expect(sourceRule).toBeDefined();
    const configMeta = {
      ...meta,
      id: configRule!.id,
      prerequisites: configRule!.prerequisites,
    };
    const sourceMeta = {
      ...meta,
      id: sourceRule!.id,
      prerequisites: sourceRule!.prerequisites,
    };

    const passed = await runEvidenceAwareRules({
      graph: graph({
        assertions: [
          makeAssertion("project.scope", "assertion:scope"),
          makeAssertion("project.moduleFederation", "assertion:config"),
          makeAssertion("project.imports", "assertion:imports"),
          makeAssertion("imports.sourceScan", "assertion:source-scan"),
        ],
      }),
      rules: [
        { meta: configMeta, evaluate: () => ({ outcome: "pass" as const, reason: "ok" }) },
        { meta: sourceMeta, evaluate: () => ({ outcome: "pass" as const, reason: "ok" }) },
      ],
    });
    expect(passed.evaluations.map((item) => item.outcome)).toEqual(["pass", "pass"]);

    const incompleteSourceScan = await runEvidenceAwareRules({
      graph: graph({
        assertions: [
          makeAssertion("project.scope", "assertion:scope"),
          makeAssertion("project.moduleFederation", "assertion:config"),
          makeAssertion("project.imports", "assertion:imports"),
          {
            ...makeAssertion("imports.sourceScan", "assertion:source-scan"),
            completeness: { status: "unknown" as const, reason: "read failures" },
          },
        ],
      }),
      rules: [{ meta: sourceMeta, evaluate: () => ({ outcome: "pass" as const, reason: "ok" }) }],
    });
    expect(incompleteSourceScan.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "prerequisite-missing",
    });

    const unrelatedConfig = await runEvidenceAwareRules({
      graph: graph({
        assertions: [makeAssertion("project.config", "assertion:wrong")],
      }),
      rules: [{ meta: configMeta, evaluate: () => ({ outcome: "pass" as const, reason: "ok" }) }],
    });
    expect(unrelatedConfig.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "prerequisite-missing",
    });

    const unrelatedSource = await runEvidenceAwareRules({
      graph: graph({
        assertions: [makeAssertion("project.source", "assertion:wrong-source")],
      }),
      rules: [{ meta: sourceMeta, evaluate: () => ({ outcome: "pass" as const, reason: "ok" }) }],
    });
    expect(unrelatedSource.evaluations[0]).toMatchObject({
      outcome: "unknown",
      reasonCode: "prerequisite-missing",
    });
  });

  it("does not narrow subjects for anyOf requirements with an unconstrained branch", async () => {
    const assertionFor = (subject: string, predicate: string) => ({
      id: `${predicate}:${subject}`,
      subject,
      predicate,
      value: true,
      layer: "effective" as const,
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
    });
    const rule = {
      meta: {
        ...meta,
        id: "test/any-of-subject-scope",
        prerequisites: {
          anyOf: [
            { predicate: "typed", subjectKind: "artifact" as const },
            { predicate: "unconstrained" },
          ],
        },
      },
      evaluate: () => ({ outcome: "pass" as const, reason: "evidence is available" }),
    };
    const result = await runEvidenceAwareRules({
      graph: graph({
        subjects: [
          { id: "project:shop", kind: "project", name: "shop" },
          { id: "artifact:manifest", kind: "artifact", name: "manifest" },
        ],
        assertions: [
          assertionFor("project:shop", "unconstrained"),
          assertionFor("artifact:manifest", "typed"),
        ],
      }),
      rules: [rule],
    });

    expect(result.evaluations.map((evaluation) => evaluation.subject).sort()).toEqual([
      "artifact:manifest",
      "project:shop",
    ]);
    expect(result.evaluations.every((evaluation) => evaluation.outcome === "pass")).toBe(true);
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
        scope: {
          project: "shop",
          buildId: "build-1",
          adapter: "vite",
          bundler: { name: "vite", version: "6" },
          target: "web",
        },
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
    expect(ruleInventoryIds).not.toContain("config/nested-producer-dts-extract");
    expect(ruleInventoryIds).not.toContain("config/remote-type-urls-missing");
    expect(runtimeIds).not.toContain("config/nested-producer-dts-extract");
    expect(runtimeIds).not.toContain("config/remote-type-urls-missing");
    expect(ruleInventory.find((entry) => entry.id === "config/name-required")?.status).toBe(
      "migrated",
    );
    const migratedIds: ReadonlySet<string> = new Set([
      ...MIGRATED_GROUP1_CONFIG_RULE_IDS,
      ...MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS,
      ...MIGRATED_GROUP2_RULE_IDS,
      ...MIGRATED_GROUP3_RULE_IDS,
    ]);
    expect(
      ruleInventory.every((entry) =>
        migratedIds.has(entry.id) ? entry.status === "migrated" : entry.status === "legacy",
      ),
    ).toBe(true);
    expect(
      ruleInventory
        .filter((entry) => entry.status === "migrated")
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([...migratedIds].sort());
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
    expect(ruleInventory.find((entry) => entry.id === "shared/unused")?.status).toBe("migrated");
    expect(
      ruleInventory.find((entry) => entry.id === "config/plugin-package-mismatch")?.evidenceReads,
    ).toContain("bundler.moduleFederationPluginCount");
    expect(ruleInventory.find((entry) => entry.id === "shared/unused")?.evidenceReads).toContain(
      "imports.sourceScan",
    );
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
      "imports.sourceScan": "sourceEvidenceIncomplete(context.facts)",
      "dependencies.declared": "context.facts.dependencies.declared",
      "dependencies.installed": "context.facts.dependencies.installed",
      "artifacts.manifest": "context.facts.artifacts.manifest",
      "artifacts.manifestExplicitlyDisabled": "manifestExplicitlyDisabled(context)",
      "artifacts.manifestValidity": "context.facts.artifacts.manifest",
      "artifacts.emittedAssets": "context.facts.artifacts.emittedAssets",
      "artifacts.assetSizes": "context.facts.artifacts.assetSizes",
      capabilities: "context.facts.capabilities",
      "capabilities.manifest": "context.facts.capabilities.manifest",
      "capabilities.emittedAssets": "context.facts.capabilities.emittedAssets",
      "project.moduleFederation": "mf(context)",
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
      scope: {},
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
        subjectId: "project:shop",
        scope: { project: "shop", adapter: "vite", bundler: { name: "vite" } },
      }),
    ).not.toBe(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "1",
        subjectId: "project:shop",
        scope: { project: "shop", adapter: "webpack", bundler: { name: "webpack" } },
      }),
    );
    expect(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "1",
        subjectId: "project:shop",
        scope: {
          project: "shop",
          adapter: "vite",
          adapterVersion: "6.1.0",
          bundler: { name: "webpack", version: "5.99.0" },
        },
      }),
    ).not.toBe(
      stableEvaluationId({
        ruleId: "config/name-required",
        ruleVersion: "1",
        subjectId: "project:shop",
        scope: {
          project: "shop",
          adapter: "vite",
          adapterVersion: "6.2.0",
          bundler: { name: "webpack", version: "5.99.0" },
        },
      }),
    );
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
