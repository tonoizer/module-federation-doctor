import { describe, expect, it } from "vitest";
import {
  normalizeEvidenceGraph,
  redactEvidenceValue,
  stableEvidenceId,
  type EvidenceGraphV2,
} from "../../src/evidence.js";

const graph = (reverse = false): EvidenceGraphV2 => {
  const subjects = [
    { id: "project:shop", kind: "project" as const, name: "shop" },
    { id: "remote:cart", kind: "remote" as const, name: "cart" },
  ];
  return {
    protocol: {
      protocolVersion: 2,
      schemaVersion: 2,
      producer: { name: "test", version: "1" },
      source: { kind: "fixture", schemaVersion: "1" },
    },
    scope: { adapter: "vite", bundler: { name: "vite", version: "7" }, target: "web" },
    identity: { project: "shop", sessionId: "secret-session" },
    subjects: reverse
      ? subjects.slice().sort((left, right) => right.id.localeCompare(left.id))
      : subjects,
    assertions: [],
    edges: [],
    evaluations: [],
  };
};

describe("evidence protocol helpers", () => {
  it("sorts graph collections and redacts identity values", () => {
    const normalized = normalizeEvidenceGraph(graph(true));
    expect(normalized.subjects.map((subject) => subject.id)).toEqual([
      "project:shop",
      "remote:cart",
    ]);
    expect(normalized.identity.sessionId).toBe("secret-session");
  });

  it("gives equivalent normalized input the same ID", () => {
    expect(stableEvidenceId("assertion", { b: 2, a: 1 })).toBe(
      stableEvidenceId("assertion", { a: 1, b: 2 }),
    );
  });

  it("redacts secrets and machine paths recursively", () => {
    expect(redactEvidenceValue({ token: "abc", file: "/Users/alice/project/src/main.ts" })).toEqual(
      { token: "[REDACTED]", file: "[PATH]" },
    );
  });
});
