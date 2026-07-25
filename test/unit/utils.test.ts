import { describe, expect, it } from "vitest";
import { fingerprint, normalizePath, redact, stableStringify } from "../../src/utils.js";

describe("deterministic privacy helpers", () => {
  it("normalizes Windows paths", () => {
    expect(normalizePath(".\\src\\index.ts")).toBe("src/index.ts");
  });

  it("redacts credentials, sensitive values, and roots", () => {
    expect(
      redact(
        {
          authorization: "Bearer secret",
          url: "https://user:pass@example.test/x?token=top-secret&safe=yes",
          path: "/Users/me/project/src/a.ts",
        },
        "/Users/me/project",
      ),
    ).toEqual({
      authorization: "[REDACTED]",
      url: "https://[REDACTED]@example.test/x?token=[REDACTED]&safe=yes",
      path: "./src/a.ts",
    });
  });

  it("sorts evidence before hashing", () => {
    const left = fingerprint({ ruleId: "x", project: "p", evidence: { b: 2, a: 1 } });
    const right = fingerprint({ ruleId: "x", project: "p", evidence: { a: 1, b: 2 } });
    expect(left).toBe(right);
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
