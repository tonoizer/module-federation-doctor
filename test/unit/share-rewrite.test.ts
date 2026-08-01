import { describe, expect, it } from "vitest";
import { findShareRewriteOverlaps, rewriteOverlapsShareKey } from "../../src/share-rewrite.js";

describe("share-rewrite helper", () => {
  it("matches exact and trailing-slash prefix shares", () => {
    expect(rewriteOverlapsShareKey("react", "react")).toBe(true);
    expect(rewriteOverlapsShareKey("react/jsx-runtime", "react/")).toBe(true);
    expect(rewriteOverlapsShareKey("react", "react/")).toBe(true);
    expect(rewriteOverlapsShareKey("lodash", "react")).toBe(false);
  });

  it("returns overlapping rewrite targets and honors allowlists", () => {
    expect(findShareRewriteOverlaps(["react", "lodash"], ["react", "vue"], ["react"])).toEqual([]);
    expect(findShareRewriteOverlaps(["lodash"], ["lodash", "react/"])).toEqual(["lodash"]);
    expect(findShareRewriteOverlaps(["react/jsx-runtime"], ["react/"])).toEqual([
      "react/jsx-runtime",
    ]);
  });
});
