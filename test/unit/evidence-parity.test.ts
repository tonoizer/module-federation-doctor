import { describe, expect, it } from "vitest";
import {
  assertDriftLedgerEntry,
  compareV1Outputs,
  ParityResourceError,
} from "../../src/evidence-parity.js";

describe("v1 parity comparator", () => {
  it("ignores object key order but preserves array order", () => {
    expect(compareV1Outputs({ b: 2, a: 1 }, { a: 1, b: 2 }).equal).toBe(true);
    expect(compareV1Outputs({ items: ["a", "b"] }, { items: ["b", "a"] }).diffs[0]).toMatchObject({
      path: "/items/0",
      kind: "changed",
    });
  });

  it("redacts secrets and paths before diff and digest", () => {
    const first = compareV1Outputs(
      {
        token: "one",
        path: "/private/one/report.json",
        url: "https://u:p@example.test/x?token=one",
      },
      {
        token: "two",
        path: "/private/two/report.json",
        url: "https://u:p@example.test/x?token=two",
      },
    );
    expect(first.equal).toBe(true);
    expect(first.legacyDigest).toBe(first.projectedDigest);
  });

  it("bounds diff output", () => {
    const result = compareV1Outputs({ a: 1, b: 1, c: 1 }, { a: 2, b: 2, c: 2 }, { maxDiffs: 2 });
    expect(result.diffs).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.equal).toBe(false);
  });

  it("rejects oversized values instead of producing unbounded artifacts", () => {
    expect(() => compareV1Outputs({ value: "x".repeat(100) }, {}, { maxBytes: 10 })).toThrow(
      ParityResourceError,
    );
  });

  it("validates drift ledger metadata", () => {
    expect(() => assertDriftLedgerEntry({ id: "missing" })).toThrow(/missing required metadata/);
    expect(() =>
      assertDriftLedgerEntry({
        id: "invalid-class",
        class: "guess",
        owner: "tonoizer",
        linkedIssue: "#87",
        fixture: "invalid-class",
        summary: "This must not be accepted.",
        affectedContracts: ["v1 report"],
        releaseNoteStatus: "not-required",
      }),
    ).toThrow(/invalid class/);
    expect(() =>
      assertDriftLedgerEntry({
        id: "approved-addition",
        class: "v2-only-addition",
        owner: "tonoizer",
        linkedIssue: "#87",
        fixture: "approved-addition",
        summary: "Additive evidence is outside the v1 surface.",
        affectedContracts: ["v1 report"],
        releaseNoteStatus: "not-required",
      }),
    ).not.toThrow();
  });
});
