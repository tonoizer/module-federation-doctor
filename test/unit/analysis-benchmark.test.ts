import { describe, expect, it } from "vitest";
import baseline from "../../benchmarks/analysis-cost-baseline.json";
import {
  assertBenchmarkScaleConfig,
  REQUIRED_BENCHMARK_SCALES,
} from "../../scripts/analysis-benchmark-guards.mjs";

describe("analysis benchmark scales", () => {
  it("keeps the source and workspace workloads at their required sizes", () => {
    assertBenchmarkScaleConfig(baseline.scales);
    expect(Object.keys(baseline.scales)).toEqual(["sources-1k", "sources-10k", "workspace-many"]);
    expect(REQUIRED_BENCHMARK_SCALES).toMatchObject([
      { name: "sources-1k", sourceCount: 1_000 },
      { name: "sources-10k", sourceCount: 10_000 },
      { name: "workspace-many", projectCount: 64, instancesPerProject: 8 },
    ]);
    expect(Object.hasOwn(baseline.scales["workspace-many"], "maxSourceBytes")).toBe(false);
  });

  it("rejects a benchmark contract that silently shrinks a workload", () => {
    const shrunk = structuredClone(baseline.scales);
    shrunk["sources-10k"].sourceCount = 1_000;
    expect(() => assertBenchmarkScaleConfig(shrunk)).toThrow(
      "scales.sources-10k.sourceCount must be 10000",
    );
  });
});
