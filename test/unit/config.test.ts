import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, resolveOptions } from "../../src/config.js";

describe("resolveOptions", () => {
  it("uses safe development defaults", () => {
    vi.stubEnv("CI", "");
    const root = path.resolve("fixture");
    expect(resolveOptions({ root })).toMatchObject({
      mode: "development",
      failOn: "never",
      include: DEFAULT_INCLUDE,
      exclude: DEFAULT_EXCLUDE,
      output: {
        directory: path.join(root, ".mf/doctor"),
        formats: ["terminal", "json"],
      },
    });
    vi.unstubAllEnvs();
  });

  it("uses strict CI defaults", () => {
    vi.stubEnv("CI", "true");
    expect(resolveOptions({ root: "fixture" })).toMatchObject({
      mode: "ci",
      failOn: "error",
      output: { formats: ["terminal", "json", "sarif"] },
    });
    vi.unstubAllEnvs();
  });
});
