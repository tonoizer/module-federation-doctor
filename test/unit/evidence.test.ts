import { describe, expect, it } from "vitest";
import {
  assertEvidenceGraphIntegrity,
  normalizeEvidenceGraph,
  redactEvidenceValue,
  stableEvidenceId,
  EvidenceIntegrityError,
  EvidenceResourceError,
  type EvidenceGraphV2,
} from "../../src/evidence.js";

const assertion = (id: string, parentEvidenceIds: string[] = []) => ({
  id,
  subject: "project:shop",
  predicate: "version",
  value: { values: ["declared", "artifact"] },
  layer: "declared" as const,
  scope: { adapter: "vite", bundler: { name: "vite", version: "7" }, target: "web" as const },
  provenance: {
    collector: { name: "test", version: "1" },
    inputKind: "fixture",
    source: "fixture.json",
    sourceSchemaVersion: "1",
    parentEvidenceIds,
  },
  confidence: { level: "exact" as const, reason: "fixture" },
  completeness: {
    status: "partial" as const,
    missing: ["z-last", "a-first"],
    reason: "fixture",
  },
});

const graph = (reverse = false): EvidenceGraphV2 => {
  const subjects = [
    { id: "project:shop", kind: "project" as const, name: "shop" },
    { id: "remote:cart", kind: "remote" as const, name: "cart" },
  ];
  const assertions = [assertion("assertion:cart", ["project:shop"]), assertion("assertion:shop")];
  const evaluations = [
    {
      id: "evaluation:version",
      rule: { id: "shared/version-conflict", version: "1" },
      subject: "project:shop",
      outcome: "unknown" as const,
      evidenceIds: ["assertion:shop", "assertion:cart"],
      reason: "fixture",
      completeness: {
        status: "unknown" as const,
        missing: ["z-last", "a-first"],
        reason: "fixture",
      },
    },
  ];
  return {
    protocol: {
      protocolVersion: 2,
      schemaVersion: 2,
      producer: { name: "test", version: "1" },
      source: { kind: "fixture", schemaVersion: "1" },
    },
    scope: { adapter: "vite", bundler: { name: "vite", version: "7" }, target: "web" },
    identity: { project: "shop", sessionId: "session-1" },
    subjects: reverse
      ? subjects.slice().sort((left, right) => right.id.localeCompare(left.id))
      : subjects,
    assertions: reverse
      ? assertions.slice().sort((left, right) => right.id.localeCompare(left.id))
      : assertions,
    edges: [
      { id: "edge:derived", kind: "derived-from", from: "assertion:cart", to: "project:shop" },
    ],
    evaluations,
  };
};

describe("evidence protocol helpers", () => {
  it("sanitizes secret keys and values without corrupting URLs or paths", () => {
    const redacted = redactEvidenceValue({
      credential: "do-not-save",
      "private-key": "-----BEGIN PRIVATE KEY-----",
      nested: { authorization: "Bearer abc", safe: "keep" },
      url: "https://user:pass@example.com/a?token=abc&ok=1",
      windows: "C:\\Users\\alice\\project\\file.ts",
      unc: "\\\\server\\share\\secret.txt",
      posix: "/srv/project/file.ts",
      posixOther: "/etc/project/file.ts",
    });
    expect(redacted).toMatchObject({
      "[REDACTED_KEY]": ["[REDACTED]", "[REDACTED]"],
      nested: { "[REDACTED_KEY]": "[REDACTED]", safe: "keep" },
      windows: "[PATH]",
      unc: "[PATH]",
      posix: "[PATH]",
      posixOther: "[PATH]",
    });
    expect(typeof (redacted as { url: string }).url).toBe("string");
    expect((redacted as { url: string }).url).toMatch(/^https:\/\//);
    expect((redacted as { url: string }).url).not.toContain("user");
    expect((redacted as { url: string }).url).not.toContain("pass");
    expect((redacted as { url: string }).url).not.toContain("token=abc");
  });

  it("sorts every set-like collection and is input-order independent", () => {
    const first = normalizeEvidenceGraph(graph());
    const second = normalizeEvidenceGraph(graph(true));
    expect(second).toEqual(first);
    expect(first.assertions[0]?.provenance.parentEvidenceIds).toEqual(["project:shop"]);
    expect(first.assertions[0]?.completeness.missing).toEqual(["a-first", "z-last"]);
    expect(first.evaluations[0]?.evidenceIds).toEqual(["assertion:cart", "assertion:shop"]);
  });

  it("rejects duplicate and dangling graph references", () => {
    const duplicate = graph();
    duplicate.edges.push({
      id: "project:shop",
      kind: "identity",
      from: "project:shop",
      to: "remote:cart",
    });
    expect(() => assertEvidenceGraphIntegrity(duplicate)).toThrow(EvidenceIntegrityError);

    const dangling = graph();
    dangling.evaluations[0]!.evidenceIds = ["assertion:missing"];
    expect(() => assertEvidenceGraphIntegrity(dangling)).toThrow(/missing assertion/);
  });

  it("rejects non-finite numbers and distinguishes JSON values", () => {
    expect(() => stableEvidenceId("value", Number.NaN)).toThrow(EvidenceResourceError);
    expect(() => stableEvidenceId("value", Number.POSITIVE_INFINITY)).toThrow(
      EvidenceResourceError,
    );
    expect(stableEvidenceId("value", null)).not.toBe(stableEvidenceId("value", "null"));
  });

  it("bounds deep and oversized values before traversal or hashing", () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < 100; index += 1) deep = { next: deep };
    expect(() => stableEvidenceId("deep", deep as never, { maxDepth: 8 })).toThrow(/maxDepth/);
    expect(() => stableEvidenceId("large", "x".repeat(100), { maxBytes: 32 })).toThrow(/maxBytes/);
  });

  it("gives equivalent object keys the same stable ID", () => {
    expect(stableEvidenceId("assertion", { b: 2, a: 1 })).toBe(
      stableEvidenceId("assertion", { a: 1, b: 2 }),
    );
  });

  it("excludes documented volatile fields from stable IDs", () => {
    expect(stableEvidenceId("value", { value: "same", timestamp: 1, sessionId: "one" })).toBe(
      stableEvidenceId("value", { value: "same", timestamp: 2, sessionId: "two" }),
    );
  });
});
