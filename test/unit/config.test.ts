import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CI_PROVIDER_ENV_KEYS,
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  isCiEnvironment,
  resolveOptions,
} from "../../src/config.js";

/**
 * Stub a local (non-CI) environment.
 * Clearing only `CI` is insufficient on GitHub Actions / other runners where
 * provider vars remain set and still trip `isCiEnvironment`.
 */
function stubLocalEnv(): void {
  vi.stubEnv("CI", "");
  for (const key of CI_PROVIDER_ENV_KEYS) {
    vi.stubEnv(key, "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCiEnvironment", () => {
  it("treats common truthy CI values as CI", () => {
    for (const value of ["true", "TRUE", "1", "yes"]) {
      expect(isCiEnvironment({ CI: value })).toBe(true);
    }
  });

  it("ignores falsey CI values when no provider signal is present", () => {
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

  it("still detects providers when CI is explicitly falsey", () => {
    // Product behavior: empty/false CI does not opt out of provider detection.
    expect(isCiEnvironment({ CI: "", GITHUB_ACTIONS: "true" })).toBe(true);
    expect(isCiEnvironment({ CI: "false", GITLAB_CI: "true" })).toBe(true);
  });
});

describe("resolveOptions", () => {
  it("uses safe development defaults", async () => {
    stubLocalEnv();
    const root = path.resolve("fixture");
    expect(await resolveOptions({ root })).toMatchObject({
      mode: "development",
      failOn: "never",
      quiet: true,
      printLog: { success: false },
      include: DEFAULT_INCLUDE,
      exclude: DEFAULT_EXCLUDE,
      output: {
        directory: path.join(root, ".mf/doctor"),
        formats: ["terminal", "json"],
      },
    });
    expect((await resolveOptions({ root })).baseline).toBeUndefined();
  });

  it("resolves quiet / printLog / MFDOCTOR_QUIET knobs", async () => {
    stubLocalEnv();
    const root = path.resolve("fixture");
    expect((await resolveOptions({ root, printLog: { success: true } })).quiet).toBe(false);
    expect((await resolveOptions({ root, quiet: false })).printLog.success).toBe(true);
    vi.stubEnv("MFDOCTOR_QUIET", "1");
    expect((await resolveOptions({ root, quiet: false })).quiet).toBe(true);
    vi.stubEnv("MFDOCTOR_QUIET", "0");
    expect((await resolveOptions({ root })).quiet).toBe(false);
  });

  it("resolves recognizeMfToolkit when set", async () => {
    stubLocalEnv();
    const root = path.resolve("fixture");
    expect((await resolveOptions({ root })).recognizeMfToolkit).toBeUndefined();
    expect((await resolveOptions({ root, recognizeMfToolkit: false })).recognizeMfToolkit).toBe(
      false,
    );
    expect((await resolveOptions({ root, recognizeMfToolkit: true })).recognizeMfToolkit).toBe(
      true,
    );
  });

  it("resolves baseline path options", async () => {
    stubLocalEnv();
    const root = path.resolve("fixture");
    expect((await resolveOptions({ root, baseline: "./mfdoctor.baseline.json" })).baseline).toEqual(
      {
        path: path.resolve(root, "./mfdoctor.baseline.json"),
        failOnSuppressed: false,
        reportStale: true,
      },
    );
  });

  it("auto-infers CI defaults from CI=true without mode", async () => {
    stubLocalEnv();
    vi.stubEnv("CI", "true");
    expect(await resolveOptions({ root: "fixture" })).toMatchObject({
      mode: "ci",
      failOn: "error",
      output: { formats: ["terminal", "json", "sarif"] },
    });
  });

  it("auto-infers CI defaults from CI=1 and GitHub Actions", async () => {
    stubLocalEnv();
    vi.stubEnv("CI", "1");
    expect((await resolveOptions({ root: "fixture" })).mode).toBe("ci");
    stubLocalEnv();
    vi.stubEnv("GITHUB_ACTIONS", "true");
    expect(await resolveOptions({ root: "fixture" })).toMatchObject({
      mode: "ci",
      failOn: "error",
    });
  });

  it("lets explicit mode override environment detection", async () => {
    stubLocalEnv();
    vi.stubEnv("CI", "true");
    expect(await resolveOptions({ root: "fixture", mode: "development" })).toMatchObject({
      mode: "development",
      failOn: "never",
    });
    stubLocalEnv();
    expect(await resolveOptions({ root: "fixture", mode: "ci" })).toMatchObject({
      mode: "ci",
      failOn: "error",
    });
  });

  it("resolves top-level profiles after extends and before local rules", async () => {
    stubLocalEnv();
    const resolved = await resolveOptions({
      root: "fixture",
      mode: "development",
      extends: ["demo"],
      profile: "production",
      rules: { "shared/prefix-share-recommended": "off" },
    });

    expect(resolved.appliedPolicies).toEqual(["demo", "production"]);
    expect(resolved.rules["config/remote-manifest-recommended"]).toBe("warning");
    expect(resolved.rules["config/observability-plugin-recommended"]).toEqual([
      "warning",
      { recommendWithoutPackage: true },
    ]);
    expect(resolved.rules["shared/prefix-share-recommended"]).toBe("off");
  });

  it("maps a demo profile to production in CI and keeps the CI gate", async () => {
    stubLocalEnv();
    const resolved = await resolveOptions({ root: "fixture", mode: "ci", profile: "demo" });

    expect(resolved.appliedPolicies).toEqual(["production"]);
    expect(resolved.mode).toBe("ci");
    expect(resolved.failOn).toBe("error");
    expect(resolved.rules["shared/prefix-share-recommended"]).toBe("warning");
  });
});
