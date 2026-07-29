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
import { validatePayload } from "../helpers/schema-contract.js";

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
      samples: [
        "api_key=abc123",
        "passwd=abc123",
        "authorization=Basic dXNlcjpwYXNz",
        "cookie=session=abc123",
        "file:///var/lib/app.js",
        "Error at /Users/alice/app/index.js:12:3, next",
        "at f (/Users/alice/private.ts:1)",
      ],
    });
    expect(redacted).toMatchObject({
      "[REDACTED_KEY]": ["[REDACTED]", "[REDACTED]"],
      nested: { "[REDACTED_KEY]": "[REDACTED]", safe: "keep" },
      windows: "[PATH]",
      unc: "[PATH]",
      posix: "[PATH]",
      posixOther: "[PATH]",
      samples: [
        "api_key=[REDACTED]",
        "passwd=[REDACTED]",
        "authorization=[REDACTED] [REDACTED]",
        "cookie=[REDACTED]",
        "[PATH]",
        "Error at [PATH], next",
        "at f ([PATH])",
      ],
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
    expect(first.identity).toHaveProperty("sessionId", "[REDACTED]");
  });

  it("schema-validates the normalized graph and preserves fixed keys", async () => {
    const normalized = normalizeEvidenceGraph(graph());
    await validatePayload(
      "evidence.schema.json",
      JSON.parse(JSON.stringify(normalized)),
      "normalized evidence graph",
    );
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

    const secretId = graph();
    secretId.subjects[0]!.id = "token=a";
    expect(() => normalizeEvidenceGraph(secretId)).toThrow(/secret or path/);
  });

  it("keeps hostile object keys inert and JSON-compatible", async () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
    ) as never;
    const redacted = redactEvidenceValue(hostile);
    expect(Object.getPrototypeOf(redacted)).toBeNull();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(JSON.parse(JSON.stringify(redacted))).toEqual(hostile);
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
    expect(() => stableEvidenceId("escaped", "\\".repeat(600_000))).toThrow(/maxBytes/);
    expect(() => stableEvidenceId("expanded", "basic x,".repeat(120_000))).toThrow(/maxBytes/);
    expect(() =>
      stableEvidenceId(
        "wide",
        Array.from({ length: 1_001 }, () => "x"),
      ),
    ).toThrow(/maxWidth/);
    expect(() => stableEvidenceId("raised", { next: "x" }, { maxDepth: 129 })).toThrow(/maxDepth/);
    expect(() => stableEvidenceId("raised", "x", { maxBytes: 8 * 1_048_576 + 1 })).toThrow(
      /maxBytes/,
    );
    expect(() => stableEvidenceId("raised", "x", { maxNodes: 50_001 })).toThrow(/maxNodes/);
    expect(() => stableEvidenceId("raised", "x", { maxWidth: 10_001 })).toThrow(/maxWidth/);
  });

  it("stops proxy object enumeration at the width ceiling", () => {
    const describedKeys = new Set<PropertyKey>();
    const target = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`key${index}`, "x"]),
    );
    const value = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        describedKeys.add(key);
        return Object.getOwnPropertyDescriptor(object, key);
      },
    });

    expect(() => stableEvidenceId("proxy", value as never)).toThrow(/maxWidth/);
    expect(describedKeys.size).toBeLessThanOrEqual(1_001);
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
