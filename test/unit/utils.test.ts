import { describe, expect, it } from "vitest";
import {
  fingerprint,
  normalizePath,
  redact,
  redactRuntimeUrl,
  relativePath,
  stableStringify,
} from "../../src/utils.js";

describe("deterministic privacy helpers", () => {
  it("normalizes Windows paths", () => {
    expect(normalizePath(".\\src\\index.ts")).toBe("src/index.ts");
  });

  it("rewrites out-of-project absolutes as [external]/basename", () => {
    expect(relativePath("/Users/me/project", "/opt/mf/bundler.js")).toBe("[external]/bundler.js");
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

  it("collapses private runtime URLs to origin and basename", () => {
    expect(
      redactRuntimeUrl(
        "https://user:pass@cdn.internal.example/apps/checkout/v1/mf-manifest.json?token=secret",
      ),
    ).toBe("https://cdn.internal.example/.../mf-manifest.json");
  });

  it("sorts evidence before hashing", () => {
    const left = fingerprint({ ruleId: "x", project: "p", evidence: { b: 2, a: 1 } });
    const right = fingerprint({ ruleId: "x", project: "p", evidence: { a: 1, b: 2 } });
    expect(left).toBe(right);
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
