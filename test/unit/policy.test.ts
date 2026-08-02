import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveOptions } from "../../src/config.js";
import {
  definePolicyPack,
  demoPreset,
  presets,
  productionPreset,
  recommendedPreset,
  resolvePolicy,
  strictPreset,
} from "../../src/policy.js";
import { defineRule } from "../../src/rules.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const acmePackPath = path.join(repoRoot, "fixtures/policy-packs/acme-mfdoctor-policy/index.js");

describe("built-in presets", () => {
  it("exposes built-in presets and recommendation overlays", () => {
    expect(Object.keys(presets).sort()).toEqual(["demo", "production", "recommended", "strict"]);
    expect(recommendedPreset.name).toBe("recommended");
    expect(strictPreset.name).toBe("strict");
    expect(demoPreset.name).toBe("demo");
    expect(productionPreset.name).toBe("production");
  });

  it("recommended mirrors catalog defaults for built-in sample rules", () => {
    expect(recommendedPreset.rules?.["config/name-required"]).toBe("error");
    expect(recommendedPreset.rules?.["config/remote-http-insecure"]).toBe("warning");
    expect(recommendedPreset.rules?.["config/remote-manifest-recommended"]).toBe("info");
    expect(recommendedPreset.rules?.["shared/singleton-mismatch"]).toBe("warning");
  });

  it("strict elevates info/warning while keeping advisory tooling signals", () => {
    expect(strictPreset.rules?.["config/remote-http-insecure"]).toBe("error");
    expect(strictPreset.rules?.["config/remote-manifest-recommended"]).toBe("warning");
    expect(strictPreset.rules?.["config/name-required"]).toBe("error");
    expect(strictPreset.rules?.["doctor/partial-analysis"]).toBe("warning");
    expect(strictPreset.rules?.["shared/candidate"]).toBe("warning");
    expect(strictPreset.rules?.["config/implementation-suspicious"]).toBe("warning");
    expect(strictPreset.rules?.["federation/ghost-shares"]).toBe("warning");
  });

  it("keeps soft heuristics at info/warning in recommended (not error)", () => {
    expect(recommendedPreset.rules?.["shared/candidate"]).toBe("info");
    expect(recommendedPreset.rules?.["config/implementation-suspicious"]).toBe("info");
    expect(recommendedPreset.rules?.["federation/ghost-shares"]).toBe("info");
    expect(recommendedPreset.rules?.["shared/singleton-risk"]).toBe("warning");
    expect(recommendedPreset.rules?.["shared/unused"]).toBe("warning");
  });

  it("keeps demo recommendations quiet without hiding correctness rules", () => {
    expect(demoPreset.rules).toEqual({
      "config/remote-manifest-recommended": ["info", { localDemoOnly: true }],
      "reliability/version-first-offline-remotes": ["warning", { localDemoOnly: true }],
      "artifact/manifest-disabled": ["info", { localDemoOnly: true }],
      "artifact/dts-disabled": "info",
      "bridge/router-implicit-enable": ["info", { localDemoOnly: true }],
    });
    expect(demoPreset.rules?.["config/remote-http-insecure"]).toBeUndefined();
  });

  it("elevates selected recommendations in the production overlay", () => {
    expect(productionPreset.rules).toEqual({
      "config/remote-manifest-recommended": "warning",
      "reliability/version-first-offline-remotes": "warning",
      "artifact/manifest-disabled": "warning",
      "artifact/dts-disabled": "warning",
      "bridge/router-implicit-enable": "warning",
    });
  });
});

describe("resolvePolicy / resolveOptions precedence", () => {
  it("resolves preset names left to right", async () => {
    const policy = await resolvePolicy(["recommended", "strict"], repoRoot);
    expect(policy.applied).toEqual(["recommended", "strict"]);
    expect(policy.rules["config/remote-http-insecure"]).toBe("error");
    expect(policy.rules["doctor/partial-analysis"]).toBe("warning");
  });

  it("composes recommendation profiles with recommended and local overrides", async () => {
    const demo = await resolvePolicy(["recommended", "demo"], repoRoot);
    expect(demo.applied).toEqual(["recommended", "demo"]);
    expect(demo.rules["config/remote-manifest-recommended"]).toEqual([
      "info",
      { localDemoOnly: true },
    ]);
    expect(demo.rules["config/remote-http-insecure"]).toBe("warning");

    const production = await resolveOptions({
      root: repoRoot,
      mode: "development",
      extends: ["recommended", "production"],
      rules: { "config/remote-manifest-recommended": "off" },
    });
    expect(production.appliedPolicies).toEqual(["recommended", "production"]);
    expect(production.rules["artifact/manifest-disabled"]).toBe("warning");
    expect(production.rules["config/remote-manifest-recommended"]).toBe("off");
    expect(production.rules["config/remote-http-insecure"]).toBe("warning");
  });

  it("lets later packs override earlier preset maps", async () => {
    const pack = definePolicyPack({
      name: "team",
      rules: {
        "config/remote-http-insecure": "off",
        "shared/unused": "error",
      },
    });
    const policy = await resolvePolicy(["recommended", pack], repoRoot);
    expect(policy.rules["config/remote-http-insecure"]).toBe("off");
    expect(policy.rules["shared/unused"]).toBe("error");
    expect(policy.rules["config/name-required"]).toBe("error");
  });

  it("loads a shareable pack from a config path and registers plugins", async () => {
    const policy = await resolvePolicy(["recommended", acmePackPath], repoRoot);
    expect(policy.applied).toEqual(["recommended", "@acme/mfdoctor-policy"]);
    expect(policy.rules["config/remote-http-insecure"]).toBe("error");
    expect(policy.rules["shared/candidate"]).toBe("off");
    expect(policy.plugins.map((rule) => rule.meta.id)).toEqual(["acme/require-manifest"]);
  });

  it("applies override precedence: CLI/flags > local rules > pack > preset", async () => {
    const pack = definePolicyPack({
      name: "org",
      rules: {
        "config/remote-http-insecure": "error",
        "shared/unused": "warning",
        "artifact/types-missing": "error",
      },
    });

    // Config file layer: extends + local rules (local wins over pack/preset).
    const fromConfig = await resolveOptions({
      root: repoRoot,
      mode: "development",
      extends: ["recommended", pack],
      rules: {
        "shared/unused": "off",
        "config/remote-http-insecure": "warning",
      },
    });
    expect(fromConfig.appliedPolicies).toEqual(["recommended", "org"]);
    expect(fromConfig.rules["artifact/types-missing"]).toBe("error"); // pack over preset
    expect(fromConfig.rules["shared/unused"]).toBe("off"); // local over pack
    expect(fromConfig.rules["config/remote-http-insecure"]).toBe("warning"); // local over pack
    expect(fromConfig.rules["config/name-required"]).toBe("error"); // preset default

    // CLI/flags merge onto DoctorOptions before resolve (same pattern as cli.ts).
    const configLayer = {
      root: repoRoot,
      mode: "development" as const,
      extends: ["recommended" as const, pack],
      rules: {
        "shared/unused": "off" as const,
        "config/remote-http-insecure": "warning" as const,
      },
    };
    const fromCli = await resolveOptions({
      ...configLayer,
      rules: {
        "shared/unused": "off",
        "config/remote-http-insecure": "off",
      },
    });
    expect(fromCli.rules["config/remote-http-insecure"]).toBe("off");
    expect(fromCli.rules["artifact/types-missing"]).toBe("error");
  });

  it("keeps defineRule entries in extends alongside packs", async () => {
    const custom = defineRule({
      meta: {
        id: "team/custom",
        defaultSeverity: "error",
        supportedBundlers: ["vite", "rspack", "rsbuild", "webpack", "unknown"],
        documentation: "/rules/team/custom",
      },
      check() {},
    });
    const resolved = await resolveOptions({
      root: repoRoot,
      mode: "development",
      extends: ["recommended", custom],
    });
    expect(resolved.extends.map((rule) => rule.meta.id)).toEqual(["team/custom"]);
  });

  it("rejects remote HTTP(S) policy pack URLs", async () => {
    await expect(resolvePolicy(["https://example.com/policy.js"], repoRoot)).rejects.toThrow(
      /no remote HTTP download/i,
    );
    await expect(resolvePolicy(["http://example.com/policy.js"], repoRoot)).rejects.toThrow(
      /no remote HTTP download/i,
    );
  });
});
