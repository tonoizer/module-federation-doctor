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
    expect(result.graph.assertions[0]?.value).toMatchObject({ ruleId: "shared/version-conflict" });
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
  });
});
