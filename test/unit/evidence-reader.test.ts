import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import projectFixture from "../../examples/evidence/v1-project.json";
import reportFixture from "../../examples/evidence/v1-report.json";
import { EvidenceIntegrityError } from "../../src/evidence.js";
import {
  AnalysisBudgetTracker,
  measureEvidenceUsage,
  resolveAnalysisBudgets,
} from "../../src/analysis-budgets.js";
import { EvidenceBudgetExceededError } from "../../src/evidence-budget.js";
import {
  EvidenceReaderError,
  migrateDoctorReport,
  migrateProjectFacts,
  projectFactsFromEvidence,
  readEvidenceFile,
  readEvidenceDocument,
  reportFromEvaluations,
} from "../../src/evidence-reader.js";
import { compareV1Outputs } from "../../src/evidence-parity.js";

describe("public evidence reader", () => {
  it("migrates a v1 project without mutation and records omitted completeness", () => {
    const input = structuredClone(projectFixture);
    const before = structuredClone(input);
    const result = readEvidenceDocument(input, { fileLabel: "project.json" });
    expect(result.kind).toBe("project-facts");
    expect(result.graph.assertions.some((item) => item.predicate === "project.dependencies")).toBe(
      true,
    );
    expect(
      result.graph.assertions.find((item) => item.predicate === "project.completeness")
        ?.completeness,
    ).toMatchObject({ status: "partial", missing: ["moduleFederation"] });
    expect(input).toEqual(before);
    expect(migrateProjectFacts(input as never)).toEqual(result.graph);
  });

  it("migrates a v1 report finding into an evaluation and evidence", () => {
    const result = readEvidenceDocument(reportFixture, { fileLabel: "report.json" });
    expect(result.kind).toBe("doctor-report");
    expect(result.graph.evaluations).toHaveLength(1);
    expect(result.graph.evaluations[0]?.outcome).toBe("fail");
    expect(
      result.graph.assertions.find((item) => item.predicate === "doctor.finding")?.value,
    ).toMatchObject({
      ruleId: "shared/version-conflict",
    });
    expect(
      result.graph.assertions.find((item) => item.predicate === "doctor.capabilities")?.value,
    ).toEqual(reportFixture.capabilities);
    expect(
      result.graph.assertions.find((item) => item.predicate === "doctor.summary")?.value,
    ).toEqual(reportFixture.summary);
    expect(migrateDoctorReport(reportFixture as never)).toEqual(result.graph);
  });

  it("projects migrated v1 documents back to the legacy products", () => {
    const projectGraph = migrateProjectFacts(projectFixture as never);
    const reportGraph = migrateDoctorReport(reportFixture as never);
    const projectedProject = projectFactsFromEvidence(projectGraph);
    const projectedReport = reportFromEvaluations(reportGraph);

    expect(compareV1Outputs(projectFixture, projectedProject).equal).toBe(true);
    expect(compareV1Outputs(reportFixture, projectedReport).equal).toBe(true);
  });

  it("fails an opted-in projection atomically at the evidence boundary", () => {
    const graph = migrateProjectFacts(projectFixture as never);
    const tracker = new AnalysisBudgetTracker(resolveAnalysisBudgets({ maxEvidenceNodes: 0 }));
    expect(() => projectFactsFromEvidence(graph, { analysisBudget: tracker })).toThrow(
      EvidenceBudgetExceededError,
    );
    expect(tracker.report()).toMatchObject({
      status: "partial",
      usage: { evidenceNodes: 0, serializedBytes: 0 },
    });
  });

  it("preserves optional builds and runtime plugin contracts through v1 projection", () => {
    const input = structuredClone(projectFixture) as Record<string, unknown>;
    input.builds = [
      {
        id: "build-1",
        adapter: "vite",
        bundler: "vite",
        emittedAssets: [],
        artifacts: [],
        capabilities: {
          outputRoot: { state: "not-applicable", reason: "test" },
          emittedAssets: { state: "exact", reason: "test" },
          artifacts: { state: "exact", reason: "test" },
          effectiveMode: { state: "exact", reason: "test" },
          target: { state: "exact", reason: "test" },
        },
        sourceHook: "test",
      },
    ];
    input.runtimePluginContracts = [{ plugin: "test", kind: "cors-parity" }];
    const graph = migrateProjectFacts(input as never);
    expect(projectFactsFromEvidence(graph)).toMatchObject({
      builds: input.builds,
      runtimePluginContracts: input.runtimePluginContracts,
    });
  });

  it("accepts large schema-valid v1 values during migration", () => {
    const input = structuredClone(projectFixture) as Record<string, any>;
    input.project.root = `/workspace/${"x".repeat(1_100_000)}`;
    const graph = migrateProjectFacts(input as never);
    expect(projectFactsFromEvidence(graph).project.root).toBe("[PATH]");
  });

  it("rejects cyclic graphs with an integrity error while calculating legacy limits", () => {
    const graph = migrateProjectFacts(projectFixture as never);
    const cyclic = {} as Record<string, any>;
    cyclic.self = cyclic;
    graph.assertions.find((item) => item.predicate === "project.imports")!.value = cyclic;

    expect(() => projectFactsFromEvidence(graph)).toThrow(EvidenceIntegrityError);
    expect(() => projectFactsFromEvidence(graph)).toThrow("Evidence value contains a cycle.");
  });

  it("accepts large schema-valid v1 reports during migration", () => {
    const findings = Array.from({ length: 1_200 }, (_, index) => ({
      ...reportFixture.findings[0],
      fingerprint: `finding-${index}`,
      evidence: { detail: "x".repeat(1_000) },
    }));
    const input = { ...reportFixture, findings };
    const graph = migrateDoctorReport(input as never);
    expect(reportFromEvaluations(graph).findings).toHaveLength(findings.length);
  });

  it("does not invent a legacy report finding from a v2-only evaluation", () => {
    const graph = readEvidenceDocument(reportFixture).graph;
    graph.evaluations[0]!.evidenceIds = [];
    expect(() => reportFromEvaluations(graph)).toThrow(/has no v1 doctor\.finding assertion/);
  });

  it("reads, normalizes, and repeats v2 deterministically", () => {
    const graph = readEvidenceDocument({
      protocol: {
        protocolVersion: 2,
        schemaVersion: 2,
        producer: { name: "test", version: "1" },
        source: { kind: "fixture", schemaVersion: "2" },
      },
      scope: { adapter: "vite", bundler: { name: "vite" }, target: "web" },
      identity: { project: "host", sessionId: "volatile" },
      subjects: [{ id: "subject:host", kind: "project", name: "host" }],
      assertions: [],
      edges: [],
      evaluations: [],
    });
    expect(graph.graph.identity.sessionId).toBe("[REDACTED]");
    expect(readEvidenceDocument(graph.graph).graph).toEqual(graph.graph);
  });

  it("reports evidence budget usage without changing the normalized graph", () => {
    const input = {
      protocol: {
        protocolVersion: 2,
        schemaVersion: 2,
        producer: { name: "test", version: "1" },
        source: { kind: "fixture", schemaVersion: "2" },
      },
      scope: { adapter: "vite", bundler: { name: "vite" }, target: "web" },
      identity: { project: "budget", sessionId: "secret-session" },
      subjects: [{ id: "subject:budget", kind: "project", name: "budget" }],
      assertions: [],
      edges: [],
      evaluations: [],
    } as const;
    const measurement = measureEvidenceUsage(input);
    const tracker = new AnalysisBudgetTracker(
      resolveAnalysisBudgets({
        maxEvidenceNodes: measurement.evidenceNodes,
        maxSerializedBytes: measurement.serializedBytes,
      }),
    );
    const result = readEvidenceDocument(input, { analysisBudget: tracker });
    expect(result.analysis).toMatchObject({ status: "complete", usage: measurement });
    expect(result.graph.identity.sessionId).toBe("[REDACTED]");
  });

  it("rejects an oversized evidence document with a typed budget report", () => {
    const input = {
      protocol: {
        protocolVersion: 2,
        schemaVersion: 2,
        producer: { name: "test", version: "1" },
        source: { kind: "fixture", schemaVersion: "2" },
      },
      scope: { adapter: "vite", bundler: { name: "vite" }, target: "web" },
      identity: { project: "budget" },
      subjects: [{ id: "subject:budget", kind: "project", name: "budget" }],
      assertions: [],
      edges: [],
      evaluations: [],
    };
    const measurement = measureEvidenceUsage(input);
    const tracker = new AnalysisBudgetTracker(
      resolveAnalysisBudgets({ maxEvidenceNodes: measurement.evidenceNodes - 1 }),
    );
    expect(() => readEvidenceDocument(input, { analysisBudget: tracker })).toThrow(
      EvidenceReaderError,
    );
    expect(() => readEvidenceDocument(input, { analysisBudget: tracker })).toThrowError(
      expect.objectContaining({ failureCode: "budget-exceeded", report: expect.any(Object) }),
    );
    expect(tracker.report()).toMatchObject({
      status: "partial",
      usage: { evidenceNodes: 0, serializedBytes: 0 },
      exceeded: [{ kind: "evidenceNodes" }],
    });
  });

  it.each([
    ["schema-invalid", { schemaVersion: 1, project: {} }, "/"],
    ["wrong-document-kind", { schemaVersion: 1, nope: true }, "/"],
    ["unsupported-version", { schemaVersion: 3, project: {} }, "/schemaVersion"],
  ])("reports %s with typed file and pointer details", (code, input, path) => {
    expect(() => readEvidenceDocument(input, { fileLabel: "input.json" })).toThrow(
      EvidenceReaderError,
    );
    try {
      readEvidenceDocument(input, { fileLabel: "input.json" });
    } catch (error) {
      expect(error).toMatchObject({ fileLabel: "input.json", failureCode: code, pointer: path });
    }
  });

  it("rejects non-JSON values with a file label and pointer", () => {
    expect(() =>
      readEvidenceDocument({ schemaVersion: 1, project: Number.NaN }, { fileLabel: "bad.json" }),
    ).toThrowError(
      expect.objectContaining({
        failureCode: "malformed-json",
        fileLabel: "bad.json",
        pointer: "/project",
      }),
    );
    expect(() => readEvidenceDocument({ schemaVersion: 1, project: new Date() })).toThrowError(
      expect.objectContaining({ failureCode: "malformed-json", pointer: "/project" }),
    );
    expect(() => readEvidenceDocument({ schemaVersion: 1, project: new Map() })).toThrowError(
      expect.objectContaining({ failureCode: "malformed-json", pointer: "/project" }),
    );
    expect(() => readEvidenceDocument({ schemaVersion: 1, project: 1n })).toThrowError(
      expect.objectContaining({ failureCode: "malformed-json", pointer: "/project" }),
    );
  });

  it("keeps document context when a v1 value is not JSON-safe", () => {
    expect(() => readEvidenceDocument({ schemaVersion: 1, project: new Date() })).toThrowError(
      expect.objectContaining({
        detectedDocumentKind: "project-facts",
        sourceVersion: 1,
        failureCode: "malformed-json",
        pointer: "/project",
      }),
    );
  });

  it.each([
    ["slash", "a/b", "a~1b"],
    ["tilde", "a~b", "a~0b"],
  ])("escapes %s keys in malformed JSON pointers", (_name, key, escapedKey) => {
    expect(() =>
      readEvidenceDocument({
        schemaVersion: 1,
        capabilities: reportFixture.capabilities,
        summary: reportFixture.summary,
        findings: [
          {
            ...reportFixture.findings[0],
            evidence: { [key]: new Date() },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        detectedDocumentKind: "doctor-report",
        sourceVersion: 1,
        failureCode: "malformed-json",
        pointer: `/findings/0/evidence/${escapedKey}`,
      }),
    );
  });

  it("maps false capabilities to non-collected completeness", () => {
    const result = readEvidenceDocument(projectFixture);
    expect(
      result.graph.assertions.find((item) => item.predicate === "project.artifacts")?.completeness,
    ).toMatchObject({ status: "partial" });
    expect(
      result.graph.assertions.find((item) => item.predicate === "project.imports")?.completeness,
    ).toMatchObject({ status: "complete" });
  });

  it("keeps project.imports complete while marking sourceScan unknown on read failures", () => {
    const input = structuredClone(projectFixture) as typeof projectFixture & {
      imports: { sourceReadFailures?: string[] };
    };
    input.imports.sourceReadFailures = ["src/unreadable.ts"];
    const result = readEvidenceDocument(input);
    expect(
      result.graph.assertions.find((item) => item.predicate === "project.imports")?.completeness,
    ).toMatchObject({ status: "complete" });
    expect(
      result.graph.assertions.find((item) => item.predicate === "imports.sourceScan")?.completeness,
    ).toMatchObject({ status: "unknown" });
  });

  it("preserves an empty report and makes boundary values schema-valid", () => {
    const empty = readEvidenceDocument({
      schemaVersion: 1,
      capabilities: reportFixture.capabilities,
      summary: { projects: 0, info: 0, warnings: 0, errors: 0 },
      findings: [],
    });
    expect(empty.graph.assertions.map((item) => item.predicate)).toEqual(
      expect.arrayContaining(["doctor.capabilities", "doctor.summary"]),
    );

    const result = readEvidenceDocument({
      schemaVersion: 1,
      capabilities: {
        config: false,
        sourceImports: false,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: false,
      },
      summary: { projects: 0, info: 0, warnings: 0, errors: 0 },
      findings: [
        {
          schemaVersion: 1,
          ruleId: "rule",
          severity: "info",
          message: "",
          project: "",
          evidence: {},
          fingerprint: "same",
        },
      ],
    });
    expect(result.graph.subjects.every((subject) => subject.name.length > 0)).toBe(true);
    expect(result.graph.evaluations[0]?.reason.length).toBeGreaterThan(0);
    expect(result.graph.assertions.some((item) => item.predicate === "doctor.summary")).toBe(true);
  });

  it("gives duplicate findings deterministic unique IDs", () => {
    const input = {
      ...reportFixture,
      findings: [reportFixture.findings[0], reportFixture.findings[0]],
    };
    const first = migrateDoctorReport(input as never);
    const second = migrateDoctorReport(input as never);
    expect(new Set(first.assertions.map((item) => item.id)).size).toBe(first.assertions.length);
    expect(new Set(first.evaluations.map((item) => item.id)).size).toBe(first.evaluations.length);
    expect(first).toEqual(second);
  });

  it("keeps distinct same-key findings unique and stable when reordered", () => {
    const findings = [
      { ...reportFixture.findings[0], message: "first", evidence: { detail: "a" } },
      { ...reportFixture.findings[0], message: "second", evidence: { detail: "b" } },
    ];
    const first = migrateDoctorReport({ ...reportFixture, findings } as never);
    const second = migrateDoctorReport({
      ...reportFixture,
      findings: [findings[1]!, findings[0]!],
    } as never);

    expect(new Set(first.evaluations.map((item) => item.id)).size).toBe(2);
    expect(second).toEqual(first);
  });

  it("uses canonical finding data to order findings with volatile differences", () => {
    const findings = [
      { ...reportFixture.findings[0], evidence: { timestamp: "2026-01-02T00:00:00Z" } },
      { ...reportFixture.findings[0], evidence: { timestamp: "2026-01-01T00:00:00Z" } },
    ];
    const first = migrateDoctorReport({ ...reportFixture, findings } as never);
    const second = migrateDoctorReport({
      ...reportFixture,
      findings: [findings[1]!, findings[0]!],
    } as never);

    expect(second).toEqual(first);
  });

  it("keeps report metadata and v2 IDs stable when findings are reordered", () => {
    const findings = [
      { ...reportFixture.findings[0], project: "zeta", fingerprint: "z" },
      { ...reportFixture.findings[0], project: "alpha", fingerprint: "a" },
    ];
    const first = migrateDoctorReport({ ...reportFixture, findings } as never);
    const second = migrateDoctorReport({
      ...reportFixture,
      findings: [findings[1]!, findings[0]!],
    } as never);

    expect(second).toEqual(first);
    expect(first.assertions.find((item) => item.predicate === "doctor.capabilities")?.subject).toBe(
      first.subjects.slice().sort((left, right) => left.id.localeCompare(right.id))[0]?.id,
    );
  });

  it.each([
    ["/protocol/schemaVersion", { protocolVersion: 2, schemaVersion: 3 }],
    ["/protocol/protocolVersion", { protocolVersion: 3, schemaVersion: 2 }],
  ])("reports future v2 versions at %s", (path, protocol) => {
    expect(() =>
      readEvidenceDocument({ protocol, subjects: [], assertions: [], edges: [], evaluations: [] }),
    ).toThrowError(expect.objectContaining({ failureCode: "unsupported-version", pointer: path }));
  });

  it("rejects Observability runtime reports instead of treating summary as a doctor report", () => {
    expect(() =>
      readEvidenceDocument({
        traceId: "mf-obs",
        hostName: "host",
        summary: { outcome: "runtime-loaded", phases: { loadRemote: { status: "success" } } },
        events: [],
      }),
    ).toThrowError(
      expect.objectContaining({
        failureCode: "wrong-document-kind",
        message: expect.stringMatching(/parseRuntimeTraces|loadRuntimeTraceFile/),
      }),
    );
  });

  it("keeps file loading on the evidence reader seam", async () => {
    const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "mfdoctor-evidence-reader-"));
    const file = nodePath.join(root, "project.json");
    await fs.writeFile(file, JSON.stringify(projectFixture));
    try {
      const result = await readEvidenceFile(file);
      expect(result.kind).toBe("project-facts");
      await fs.writeFile(file, "{");
      await expect(readEvidenceFile(file)).rejects.toMatchObject({
        name: "EvidenceReaderError",
        failureCode: "malformed-json",
        pointer: "/",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reserves file bytes separately from parsed evidence nodes", async () => {
    const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "mfdoctor-evidence-budget-"));
    const file = nodePath.join(root, "project.json");
    const serialized = JSON.stringify(projectFixture);
    await fs.writeFile(file, serialized);
    try {
      const measurement = measureEvidenceUsage(projectFixture);
      const tracker = new AnalysisBudgetTracker(
        resolveAnalysisBudgets({
          maxEvidenceNodes: measurement.evidenceNodes,
          maxSerializedBytes: Buffer.byteLength(serialized),
        }),
      );
      const result = await readEvidenceFile(file, { analysisBudget: tracker });
      expect(result.analysis).toMatchObject({
        status: "complete",
        usage: {
          evidenceNodes: measurement.evidenceNodes,
          serializedBytes: Buffer.byteLength(serialized),
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
