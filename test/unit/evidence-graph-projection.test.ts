import { describe, expect, it } from "vitest";
import type { EvidenceGraphV2 } from "../../src/evidence.js";
import {
  completeEvidenceRun,
  disabledRuleExecution,
  graphScopeFor,
  projectConclusiveFailures,
  ruleOptionsFromSettings,
  severityFor,
  toEvidenceFinding,
  type ProjectableEvidenceRule,
} from "../../src/evidence-graph-projection.js";
import type { RuleFailResult } from "../../src/rule-contract.js";
import { fingerprint } from "../../src/utils.js";

const rule = (id = "test/rule", fix?: string): ProjectableEvidenceRule => ({
  meta: {
    id,
    version: "1",
    owner: { name: "test" },
    remediation: {
      summary: "fix it",
      documentation: "https://example.test/doc",
      ...(fix ? { fix } : {}),
    },
    prerequisites: { predicate: "project.scope" },
    applicability: {},
    confidenceCeiling: "high",
    defaultSeverity: "warning",
  },
});

const fail = (overrides: Partial<RuleFailResult> = {}): RuleFailResult => ({
  id: "evaluation:1",
  rule: { id: "test/rule", version: "1" },
  subject: "project:shop",
  outcome: "fail",
  reasonCode: "rule-result",
  reason: "failed",
  confidence: "high",
  completeness: "complete",
  evidenceIds: [],
  scope: { bundler: { name: "vite" }, target: "web" },
  ...overrides,
});

const emptyGraph = (): EvidenceGraphV2 => ({
  protocol: {
    protocolVersion: 2,
    schemaVersion: 2,
    producer: { name: "test", version: "1" },
    source: { kind: "fixture", schemaVersion: "1" },
  },
  scope: { adapter: "vite", bundler: { name: "vite", version: "7" }, target: "web" },
  identity: { project: "shop" },
  subjects: [{ id: "project:shop", kind: "project", name: "shop" }],
  assertions: [
    {
      id: "assertion:1",
      subject: "project:shop",
      predicate: "project.scope",
      value: true,
      layer: "declared",
      scope: { adapter: "vite", bundler: { name: "vite", version: "7" }, target: "web" },
      provenance: {
        collector: { name: "test", version: "1" },
        inputKind: "fixture",
        source: "fixture",
        sourceSchemaVersion: "1",
      },
      confidence: { level: "exact", reason: "fixture" },
      completeness: { status: "complete", reason: "fixture" },
    },
  ],
  edges: [],
  evaluations: [],
});

describe("shared evidence projection helpers", () => {
  it("copies finding payloads into the evidence-rule shape", () => {
    expect(
      toEvidenceFinding({
        message: "broken",
        evidence: { pkg: "react" },
        suggestion: "share it",
        location: { path: "src/a.ts", line: 2 },
        detailsSchema: "shared.unused.v1",
        details: { unused: ["react"] },
      }),
    ).toEqual({
      message: "broken",
      evidence: { pkg: "react" },
      suggestion: "share it",
      location: { path: "src/a.ts", line: 2 },
      detailsSchema: "shared.unused.v1",
      details: { unused: ["react"] },
    });
  });

  it("merges per-rule options from settings without copying unrelated rules", () => {
    const hmr = rule("vite/remote-hmr-dev");
    const other = rule("shared/unused");
    const options = ruleOptionsFromSettings(
      [hmr, other],
      { "vite/remote-hmr-dev": ["warning", { extra: true }] },
      (item, base) =>
        item.meta.id === "vite/remote-hmr-dev" ? { ...base, unscopedProjectBuildCount: 2 } : base,
    );
    expect(options["vite/remote-hmr-dev"]).toEqual({ extra: true, unscopedProjectBuildCount: 2 });
    expect(options["shared/unused"]).toEqual({});
  });

  it("projects conclusive failures with stable fingerprints that ignore details", () => {
    const stub = rule("test/rule", "share react");
    const projected = projectConclusiveFailures({
      evaluations: [
        fail({
          findings: [
            toEvidenceFinding({
              message: "/tmp/app/src/a.ts is unused",
              evidence: { pkg: "react" },
              suggestion: "share react",
              detailsSchema: "shared.unused.v1",
              details: { unused: ["react"] },
            }),
          ],
        }),
      ],
      rules: new Map([["test/rule", stub]]),
      settings: {},
      root: "/tmp/app",
      projectFor: () => "shop",
    });
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      schemaVersion: 1,
      ruleId: "test/rule",
      severity: "warning",
      project: "shop",
      message: "./src/a.ts is unused",
      suggestion: "share react",
      documentation: "https://example.test/doc",
      detailsSchema: "shared.unused.v1",
      details: { unused: ["react"] },
    });
    expect(projected[0]!.fingerprint).toBe(
      fingerprint({ ruleId: "test/rule", project: "shop", evidence: { pkg: "react" } }),
    );
  });

  it("dedupes federation-style fingerprints after stripping project from evidence", () => {
    const stub = rule("federation/name-conflict");
    const finding = toEvidenceFinding({
      message: "duplicate",
      evidence: { project: "host", name: "app" },
    });
    const projected = projectConclusiveFailures({
      evaluations: [
        fail({ rule: { id: "federation/name-conflict", version: "1" }, findings: [finding] }),
        fail({
          id: "evaluation:2",
          rule: { id: "federation/name-conflict", version: "1" },
          findings: [finding],
        }),
      ],
      rules: new Map([["federation/name-conflict", stub]]),
      settings: {},
      root: ".",
      uniqueFingerprints: true,
      projectFor: (_evaluation, item) =>
        typeof item.evidence.project === "string" ? item.evidence.project : "federation",
      evidenceFor: (_evaluation, item) => {
        const { project: _project, ...evidence } = item.evidence;
        return evidence;
      },
    });
    expect(projected).toHaveLength(1);
    expect(projected[0]!.project).toBe("host");
    expect(projected[0]!.evidence).toEqual({ name: "app" });
    expect(projected[0]!.fingerprint).toBe(
      fingerprint({
        ruleId: "federation/name-conflict",
        project: "host",
        evidence: { name: "app" },
      }),
    );
  });

  it("skips disabled rules and unknown rule ids", () => {
    const stub = rule();
    expect(
      projectConclusiveFailures({
        evaluations: [fail()],
        rules: new Map([["test/rule", stub]]),
        settings: { "test/rule": "off" },
        root: ".",
        projectFor: () => "shop",
      }),
    ).toEqual([]);
    expect(
      projectConclusiveFailures({
        evaluations: [fail({ rule: { id: "missing/rule", version: "1" } })],
        rules: new Map([["test/rule", stub]]),
        settings: {},
        root: ".",
        projectFor: () => "shop",
      }),
    ).toEqual([]);
  });

  it("sorts attached evaluations and prepends disabled execution", () => {
    const graph = emptyGraph();
    const disabled = disabledRuleExecution([rule("off/rule")], { "off/rule": "off" });
    const completed = completeEvidenceRun(
      graph,
      {
        evaluations: [fail({ id: "evaluation:b" }), fail({ id: "evaluation:a" })],
        execution: [
          { state: "engine-error", rule: { id: "x", version: "1" }, reason: "boom", error: "e" },
        ],
      },
      graph.scope,
      disabled,
    );
    expect(completed.graph.evaluations.map((item) => item.id)).toEqual([
      "evaluation:a",
      "evaluation:b",
    ]);
    expect(completed.output.execution.map((item) => item.state)).toEqual([
      "disabled",
      "engine-error",
    ]);
  });

  it("keeps graphScopeFor target fallback and severity overrides", () => {
    expect(
      graphScopeFor(
        { adapter: "vite", bundler: { name: "vite" }, target: "web" },
        { target: "not-a-target", bundler: { name: "rspack" } },
      ),
    ).toMatchObject({ target: "web", bundler: { name: "rspack" } });
    expect(severityFor("off", "error")).toBeUndefined();
    expect(severityFor(["info", {}], "error")).toBe("info");
    expect(severityFor(undefined, "warning")).toBe("warning");
  });
});
