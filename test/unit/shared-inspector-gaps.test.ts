import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOptions } from "../../src/config.js";
import { analyze, analyzeFederation } from "../../src/engine.js";
import { definePolicyPack } from "../../src/policy.js";
import { builtInRules } from "../../src/rules.js";
import { DEFAULT_DEEP_IMPORT_ALLOWLIST } from "../../src/shared-policy.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-shared-gaps-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"shared-gaps"}');
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return root;
}

function projectFacts(
  name: string,
  shared: NonNullable<ProjectFacts["moduleFederation"]>["shared"],
  packages: string[],
): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name, root: "." },
    bundler: { name: "vite", mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: {
      name,
      exposes: {},
      remotes: {},
      shared,
    },
    dependencies: {
      declared: Object.fromEntries(packages.map((pkg) => [pkg, "*"])),
      installed: {},
    },
    imports: {
      sourceFiles: [],
      specifiers: packages,
      packages,
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: ["source"],
    },
    artifacts: { emittedAssets: [] },
  };
}

describe("shared/deep-import-bypass", () => {
  it("records deepImports and flags shared root + subpath bypass", async () => {
    const root = await tempProject({
      "src/Widget.ts": `import cloneDeep from "lodash/cloneDeep";\nexport const x = cloneDeep({});\n`,
    });
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      moduleFederation: {
        name: "app",
        shared: { lodash: { singleton: false } },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "shared/unused": "off",
      },
    });
    expect(result.facts.imports.depth).toBe("local-graph");
    expect(result.facts.imports.deepImports).toContain("lodash/cloneDeep");
    expect(result.report.findings.some((item) => item.ruleId === "shared/deep-import-bypass")).toBe(
      true,
    );
  });

  it("routes React deep imports to prefix-share and still flags lodash bypass", async () => {
    const root = await tempProject({
      "src/Widget.ts": `
        import { jsx } from "react/jsx-runtime";
        import cloneDeep from "lodash/cloneDeep";
        export const x = jsx("div", null);
        export const y = cloneDeep({});
      `,
    });
    const quiet = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      moduleFederation: {
        name: "app",
        shared: {
          react: { singleton: true },
          lodash: { singleton: false },
        },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "shared/unused": "off",
        "shared/deep-import-bypass": "off",
      },
    });
    expect(quiet.report.findings.some((item) => item.ruleId === "shared/deep-import-bypass")).toBe(
      false,
    );

    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "shared/deep-import-bypass")!;
    await rule.check({
      facts: {
        ...quiet.facts,
        moduleFederation: {
          name: "app",
          exposes: {},
          remotes: {},
          shared: {
            react: { package: "react", singleton: true, eager: false, shareScope: "default" },
            lodash: { package: "lodash", singleton: false, eager: false, shareScope: "default" },
          },
        },
        imports: {
          ...quiet.facts.imports,
          deepImports: ["react/jsx-runtime", "lodash/cloneDeep"],
          deepImportFiles: {
            react: ["src/Widget.ts"],
            lodash: ["src/Widget.ts"],
          },
        },
      },
      options: {},
      report: (finding) => findings.push(finding),
    });
    // Prefix-share owns React/React DOM gaps; jsx-runtime is not allowlisted.
    expect(DEFAULT_DEEP_IMPORT_ALLOWLIST).not.toContain("react/jsx-runtime");
    expect(DEFAULT_DEEP_IMPORT_ALLOWLIST).not.toContain("react-dom/client");
    expect(findings.some((item) => String(item.evidence.package) === "react")).toBe(false);
    expect(findings.some((item) => String(item.evidence.package) === "lodash")).toBe(true);
  });
});

describe("local-graph vs direct import depth", () => {
  it("direct depth ignores export-from package re-exports", async () => {
    const root = await tempProject({
      "src/barrel.ts": `export { cloneDeep } from "lodash";\n`,
      "src/Widget.ts": `export {};\n`,
    });
    const direct = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      importDepth: "direct",
      moduleFederation: {
        name: "app",
        shared: { lodash: { singleton: false } },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(direct.facts.imports.depth).toBe("direct");
    expect(direct.facts.imports.packages).not.toContain("lodash");
    expect(direct.report.findings.some((item) => item.ruleId === "shared/unused")).toBe(true);

    const graph = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      importDepth: "local-graph",
      moduleFederation: {
        name: "app",
        shared: { lodash: { singleton: false } },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(graph.facts.imports.packages).toContain("lodash");
    expect(graph.report.findings.some((item) => item.ruleId === "shared/unused")).toBe(false);
  });
});

describe("expanded singleton/candidate policy lists", () => {
  it("flags zustand candidate and singleton-risk from built-in lists", async () => {
    const root = await tempProject({
      "src/Widget.ts": `import { create } from "zustand";\nexport const useStore = create(() => ({}));\n`,
    });
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "shared-gaps", dependencies: { zustand: "^5.0.0" } }),
    );
    const candidate = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      moduleFederation: { name: "app", shared: {} },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(candidate.report.findings.some((item) => item.ruleId === "shared/candidate")).toBe(true);

    const singleton = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      moduleFederation: {
        name: "app",
        shared: { zustand: { singleton: false } },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "shared/unused": "off",
      },
    });
    expect(singleton.report.findings.some((item) => item.ruleId === "shared/singleton-risk")).toBe(
      true,
    );
  });

  it("extends candidate list via policy pack sharedPolicy", async () => {
    const root = await tempProject({
      "src/Widget.ts": `import "@acme/ui";\n`,
    });
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "shared-gaps", dependencies: { "@acme/ui": "1.0.0" } }),
    );
    const pack = definePolicyPack({
      name: "acme",
      sharedPolicy: { additionalCandidates: ["@acme/ui"] },
    });
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      extends: [pack],
      moduleFederation: { name: "app", shared: {} },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(
      result.report.findings.some(
        (item) => item.ruleId === "shared/candidate" && item.evidence.package === "@acme/ui",
      ),
    ).toBe(true);
  });
});

describe("federation host-gaps and ghost-shares", () => {
  it("detects host gaps and allows rules off suppression", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-fed-gaps-"));
    roots.push(root);
    const host = projectFacts("host", {}, ["zustand"]);
    const remote = projectFacts("remote", {}, ["zustand"]);
    const hostFile = path.join(root, "host.json");
    const remoteFile = path.join(root, "remote.json");
    await fs.writeFile(hostFile, JSON.stringify(host));
    await fs.writeFile(remoteFile, JSON.stringify(remote));

    const result = await analyzeFederation([hostFile, remoteFile]);
    expect(result.findings.some((item) => item.ruleId === "federation/host-gaps")).toBe(true);

    const suppressed = await analyzeFederation([hostFile, remoteFile], {
      rules: { "federation/host-gaps": "off" },
    });
    expect(suppressed.findings.some((item) => item.ruleId === "federation/host-gaps")).toBe(false);
  });

  it("detects ghost shares as info", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-fed-ghost-"));
    roots.push(root);
    const host = projectFacts(
      "host",
      {
        lodash: {
          package: "lodash",
          singleton: false,
          eager: false,
          shareScope: ["default"],
        },
      },
      [],
    );
    const remote = projectFacts("remote", {}, []);
    const hostFile = path.join(root, "host.json");
    const remoteFile = path.join(root, "remote.json");
    await fs.writeFile(hostFile, JSON.stringify(host));
    await fs.writeFile(remoteFile, JSON.stringify(remote));

    const result = await analyzeFederation([hostFile, remoteFile]);
    const ghost = result.findings.find((item) => item.ruleId === "federation/ghost-shares");
    expect(ghost?.severity).toBe("info");
    expect(ghost?.evidence.package).toBe("lodash");
  });

  it("honors off and severity overrides for federation strategy mismatch", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-fed-strategy-"));
    roots.push(root);
    const first = projectFacts("first", {}, []);
    const second = projectFacts("second", {}, []);
    first.moduleFederation!.shareStrategy = "version-first";
    second.moduleFederation!.shareStrategy = "loaded-first";
    const files = [path.join(root, "first.json"), path.join(root, "second.json")];
    await fs.writeFile(files[0]!, JSON.stringify(first));
    await fs.writeFile(files[1]!, JSON.stringify(second));

    const finding = (await analyzeFederation(files)).findings.find(
      (item) => item.ruleId === "federation/share-strategy-mismatch",
    );
    expect(finding?.severity).toBe("warning");
    expect(finding?.documentation).toBe("/rules/federation/share-strategy-mismatch");
    expect(finding?.fingerprint).toBeTruthy();

    const quiet = await analyzeFederation(files, {
      rules: { "federation/share-strategy-mismatch": "off" },
    });
    expect(
      quiet.findings.some((item) => item.ruleId === "federation/share-strategy-mismatch"),
    ).toBe(false);

    const retargeted = await analyzeFederation(files, {
      rules: { "federation/share-strategy-mismatch": "info" },
    });
    expect(
      retargeted.findings.find((item) => item.ruleId === "federation/share-strategy-mismatch")
        ?.severity,
    ).toBe("info");
  });

  it("allows a healthy loaded-first async bi-directional federation cycle", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-fed-cycle-"));
    roots.push(root);
    const first = projectFacts("first", {}, []);
    const second = projectFacts("second", {}, []);
    first.moduleFederation!.name = "app_a";
    first.moduleFederation!.shareStrategy = "loaded-first";
    first.moduleFederation!.exposes = { "./A": "src/A.ts" };
    first.moduleFederation!.remotes = {
      b: { name: "app_b", entry: "https://example.test/b/remoteEntry.js", shareScope: ["default"] },
    };
    first.moduleFederation!.experiments = {
      asyncStartup: true,
      externalRuntime: false,
      provideExternalRuntime: false,
    };
    second.moduleFederation!.name = "app_b";
    second.moduleFederation!.shareStrategy = "loaded-first";
    second.moduleFederation!.exposes = { "./B": "src/B.ts" };
    second.moduleFederation!.remotes = {
      a: { name: "app_a", entry: "https://example.test/a/remoteEntry.js", shareScope: ["default"] },
    };
    second.moduleFederation!.experiments = {
      asyncStartup: true,
      externalRuntime: false,
      provideExternalRuntime: false,
    };
    const files = [path.join(root, "first.json"), path.join(root, "second.json")];
    await fs.writeFile(files[0]!, JSON.stringify(first));
    await fs.writeFile(files[1]!, JSON.stringify(second));

    const result = await analyzeFederation(files);
    expect(result.findings.some((item) => item.ruleId === "federation/circular-remote-graph")).toBe(
      false,
    );
    expect(result.exitCode).toBe(0);
  });

  it("warns only when a cycle has version-first eager startup evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-fed-risk-"));
    roots.push(root);
    const first = projectFacts("first", {}, []);
    const second = projectFacts("second", {}, []);
    first.moduleFederation!.name = "app_a";
    first.moduleFederation!.shareStrategy = "version-first";
    first.moduleFederation!.remotes = {
      b: { name: "app_b", entry: "https://example.test/b/remoteEntry.js", shareScope: ["default"] },
    };
    second.moduleFederation!.name = "app_b";
    second.moduleFederation!.shareStrategy = "loaded-first";
    second.moduleFederation!.remotes = {
      a: { name: "app_a", entry: "https://example.test/a/remoteEntry.js", shareScope: ["default"] },
    };
    const files = [path.join(root, "first.json"), path.join(root, "second.json")];
    await fs.writeFile(files[0]!, JSON.stringify(first));
    await fs.writeFile(files[1]!, JSON.stringify(second));

    const finding = (await analyzeFederation(files)).findings.find(
      (item) => item.ruleId === "federation/circular-remote-graph",
    );
    expect(finding?.severity).toBe("warning");
    expect(finding?.evidence.riskMembers).toEqual([
      expect.objectContaining({ project: "first", shareStrategy: "version-first" }),
    ]);
    expect(finding?.evidence.edges).toHaveLength(2);

    const quiet = await analyzeFederation(files, {
      rules: { "federation/circular-remote-graph": "off" },
    });
    expect(quiet.findings.some((item) => item.ruleId === "federation/circular-remote-graph")).toBe(
      false,
    );
    const retargeted = await analyzeFederation(files, {
      rules: { "federation/circular-remote-graph": "error" },
    });
    expect(
      retargeted.findings.find((item) => item.ruleId === "federation/circular-remote-graph")
        ?.severity,
    ).toBe("error");
  });
});

describe("shared policy resolveOptions", () => {
  it("merges pack and local sharedPolicy knobs", async () => {
    const resolved = await resolveOptions({
      extends: [
        definePolicyPack({
          name: "pack",
          sharedPolicy: {
            additionalCandidates: ["zustand"],
            importDepth: "direct",
          },
        }),
      ],
      additionalCandidates: ["jotai"],
      importDepth: "local-graph",
    });
    expect(resolved.sharedPolicy.importDepth).toBe("local-graph");
    expect(resolved.sharedPolicy.shareCandidates).toEqual(
      expect.arrayContaining(["zustand", "jotai", "react"]),
    );
  });
});
