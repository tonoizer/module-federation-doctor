import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  isCiEnvironment,
  resolveOptions,
} from "../../src/config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCiEnvironment", () => {
  it("treats common truthy CI values as CI", () => {
    for (const value of ["true", "TRUE", "1", "yes"]) {
      expect(isCiEnvironment({ CI: value })).toBe(true);
    }
  });

  it("ignores falsey CI values", () => {
    for (const value of ["", "0", "false", "FALSE", "no", "off", "  false  "]) {
      expect(isCiEnvironment({ CI: value })).toBe(false);
    }
  });

  it("detects provider-specific signals without CI", () => {
    expect(isCiEnvironment({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(isCiEnvironment({ GITLAB_CI: "true" })).toBe(true);
    expect(isCiEnvironment({ CIRCLECI: "true" })).toBe(true);
    expect(isCiEnvironment({ TF_BUILD: "True" })).toBe(true);
    expect(isCiEnvironment({ JENKINS_URL: "https://ci.example/jenkins" })).toBe(true);
    expect(isCiEnvironment({})).toBe(false);
  });
});

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
  });

  it("auto-infers CI defaults from CI=true without mode", () => {
    vi.stubEnv("CI", "true");
    expect(resolveOptions({ root: "fixture" })).toMatchObject({
      mode: "ci",
      failOn: "error",
      output: { formats: ["terminal", "json", "sarif"] },
    });
  });

  it("auto-infers CI defaults from CI=1 and GitHub Actions", () => {
    vi.stubEnv("CI", "1");
    expect(resolveOptions({ root: "fixture" }).mode).toBe("ci");
    vi.stubEnv("CI", "");
    vi.stubEnv("GITHUB_ACTIONS", "true");
    expect(resolveOptions({ root: "fixture" })).toMatchObject({
      mode: "ci",
      failOn: "error",
    });
  });

  it("lets explicit mode override environment detection", () => {
    vi.stubEnv("CI", "true");
    expect(resolveOptions({ root: "fixture", mode: "development" })).toMatchObject({
      mode: "development",
      failOn: "never",
    });
    vi.stubEnv("CI", "");
    expect(resolveOptions({ root: "fixture", mode: "ci" })).toMatchObject({
      mode: "ci",
      failOn: "error",
    });
  });
});
