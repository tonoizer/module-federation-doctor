import { describe, expect, it } from "vitest";
import projectFixture from "../../examples/evidence/v1-project.json";
import reportFixture from "../../examples/evidence/v1-report.json";
import {
  EvidenceReaderError,
  migrateDoctorReport,
  migrateProjectFacts,
  readEvidenceDocument,
} from "../../src/evidence-reader.js";

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

  it("maps false capabilities to non-collected completeness", () => {
    const result = readEvidenceDocument(projectFixture);
    expect(
      result.graph.assertions.find((item) => item.predicate === "project.artifacts")?.completeness,
    ).toMatchObject({ status: "partial" });
    expect(
      result.graph.assertions.find((item) => item.predicate === "project.imports")?.completeness,
    ).toMatchObject({ status: "complete" });
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
});
