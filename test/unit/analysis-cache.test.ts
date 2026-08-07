import { describe, expect, it } from "vitest";
import baseline from "../../benchmarks/analysis-cost-baseline.json";
import { AnalysisContentCache, analysisCacheKey, contentDigest } from "../../src/analysis-cache.js";

describe("analysis content cache", () => {
  it("defines all six budget dimensions for every benchmark fixture", () => {
    const keys = [
      "maxFiles",
      "maxSourceBytes",
      "maxArtifacts",
      "maxEvidenceNodes",
      "maxSerializedBytes",
      "maxWallTimeMs",
    ] as const;
    for (const fixture of Object.values(baseline.fixtures)) {
      for (const key of keys) expect(fixture[key]).toEqual(expect.any(Number));
    }
  });

  it("bounds workspace facts with serialized bytes instead of source bytes", () => {
    for (const fixture of Object.values(baseline.workspaces)) {
      expect(fixture).not.toHaveProperty("maxSourceBytes");
      for (const key of ["maxFiles", "maxSerializedBytes", "maxWallTimeMs", "maxRssBytes"])
        expect(fixture[key as keyof typeof fixture]).toEqual(expect.any(Number));
    }
  });

  it("keys parsed input by kind, path, content, and identity", () => {
    const digest = contentDigest("source");
    expect(analysisCacheKey("source", "src/a.ts", digest, "vite-a")).not.toBe(
      analysisCacheKey("source", "src/a.ts", digest, "vite-b"),
    );
    expect(analysisCacheKey("source", "src/a.ts", digest, "vite-a")).not.toBe(
      analysisCacheKey("artifact", "src/a.ts", digest, "vite-a"),
    );
  });

  it("is bounded LRU and reports hits/misses without mutating v1 facts", () => {
    const cache = new AnalysisContentCache({ maxEntries: 1, maxBytes: 4 });
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.set("first", { parsed: true }, 4)).toBe(true);
    expect(cache.get("first")).toEqual({ parsed: true });
    expect(cache.set("second", { parsed: true }, 4)).toBe(true);
    expect(cache.get("first")).toBeUndefined();
    expect(cache.stats).toMatchObject({ hits: 1, misses: 2, entries: 1, bytes: 4 });
  });

  it("isolates cached parsed values and rejects unsafe values", () => {
    const cache = new AnalysisContentCache();
    expect(cache.set("artifact", { nested: { valid: true } }, 1)).toBe(true);

    const hit = cache.get<{ nested: { valid: boolean } }>("artifact")!;
    hit.nested.valid = false;
    expect(cache.get("artifact")).toEqual({ nested: { valid: true } });

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(cache.set("cycle", cycle, 1)).toBe(false);
    expect(cache.set("function", { value: () => true }, 1)).toBe(false);
  });
});
