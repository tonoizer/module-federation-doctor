import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { collectProjectFacts } from "../../src/collect.js";
import { analyze } from "../../src/engine.js";
import { resolveOptions } from "../../src/config.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";
import { builtInRules } from "../../src/rules.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const dynamicFixtures = path.join(fixtures, "dynamic-imports");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function projectWith(
  files: Record<string, string>,
  options: {
    moduleFederation?: Record<string, unknown>;
    runtimeTrace?: string;
    include?: string[];
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-dynamic-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"dynamic-fixture"}');
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }
  const facts = await collectProjectFacts(
    resolveOptions({
      root,
      bundler: "vite",
      mode: "development",
      include: options.include ?? ["src/**/*.{ts,tsx,js,jsx}"],
      moduleFederation: {
        name: "dynamic_fixture",
        ...options.moduleFederation,
      },
      ...(options.runtimeTrace ? { runtimeTrace: options.runtimeTrace } : {}),
    }),
  );
  return { root, facts };
}

describe("dynamic-import completeness", () => {
  it("resolves dynamic import() of a shared package", async () => {
    const source = await fs.readFile(
      path.join(dynamicFixtures, "dynamic-import-package.ts"),
      "utf8",
    );
    const { facts } = await projectWith(
      { "src/app.ts": source },
      { moduleFederation: { shared: ["lodash"] } },
    );
    expect(facts.imports.packages).toContain("lodash");
    expect(facts.imports.dynamicPackages).toContain("lodash");
    expect(facts.imports.evidenceSources).toContain("source");
  });

  it("resolves dynamic import() of a local module path", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "dynamic-import-local.ts"), "utf8");
    const { facts } = await projectWith({
      "src/app.ts": source,
      "src/Widget.ts": "export {}\n",
    });
    expect(facts.imports.specifiers).toContain("./Widget");
    expect(facts.imports.packages).not.toContain("Widget");
  });

  it("classifies import('remote/expose') as a remote, not a package", async () => {
    const source = await fs.readFile(
      path.join(dynamicFixtures, "dynamic-import-remote.ts"),
      "utf8",
    );
    const { facts } = await projectWith(
      { "src/app.ts": source },
      {
        moduleFederation: {
          remotes: { shop: "shop@https://cdn.example.com/shop/mf-manifest.json" },
        },
      },
    );
    expect(facts.imports.remotes).toContain("shop");
    expect(facts.imports.packages).not.toContain("shop");
    expect(facts.imports.specifiers).toContain("shop/Card");
  });

  it("resolves loadRemote string literals", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "load-remote.ts"), "utf8");
    const { facts } = await projectWith(
      { "src/app.ts": source },
      {
        moduleFederation: {
          remotes: { shop: "shop@https://cdn.example.com/shop/mf-manifest.json" },
        },
      },
    );
    expect(facts.imports.remotes).toContain("shop");
    expect(facts.imports.specifiers).toContain("shop/Card");
  });

  it("resolves loadShare string literals for shared usage", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "load-share.ts"), "utf8");
    const { facts } = await projectWith(
      { "src/app.ts": source },
      { moduleFederation: { shared: { react: { singleton: true } } } },
    );
    expect(facts.imports.packages).toContain("react");
    expect(facts.imports.dynamicPackages).toContain("react");
  });

  it("resolves registerRemotes name literals as remotes", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "register-remotes.ts"), "utf8");
    const { facts } = await projectWith({ "src/app.ts": source });
    expect(facts.imports.remotes).toContain("checkout");
    expect(facts.imports.packages).not.toContain("checkout");
  });

  it("records unresolved import(expr) and prefers partial-analysis", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "unresolved-import.ts"), "utf8");
    const { root } = await projectWith(
      { "src/app.ts": source },
      { moduleFederation: { shared: { lodash: { singleton: false } } } },
    );
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      rules: {
        "config/plugin-package-mismatch": "off",
        "shared/singleton-risk": "off",
      },
      moduleFederation: {
        name: "dynamic_fixture",
        shared: { lodash: { singleton: false } },
      },
    });
    expect(
      result.facts.imports.unresolvedDynamic.some(
        (item) => item.api === "import" && item.file === "src/app.ts",
      ),
    ).toBe(true);
    expect(result.report.findings.some((item) => item.ruleId === "doctor/partial-analysis")).toBe(
      true,
    );
    expect(result.report.findings.some((item) => item.ruleId === "shared/unused")).toBe(false);
  });

  it("merges opt-in runtime trace shared packages without requiring source imports", async () => {
    const trace = path.join(fixtures, "runtime-traces/healthy.json");
    const { facts } = await projectWith(
      { "src/app.ts": "export {}\n" },
      {
        runtimeTrace: trace,
        moduleFederation: { shared: { react: { singleton: true } } },
      },
    );
    expect(facts.imports.packages).toContain("react");
    expect(facts.imports.dynamicPackages).toContain("react");
    expect(facts.imports.evidenceSources).toContain("runtime-trace");
    expect(facts.imports.remotes).toContain("checkout");
  });

  it("does not load runtime traces unless runtimeTrace is set", async () => {
    const { facts } = await projectWith(
      { "src/app.ts": "export {}\n" },
      { moduleFederation: { shared: { react: { singleton: true } } } },
    );
    expect(facts.imports.packages).not.toContain("react");
    expect(facts.imports.evidenceSources).not.toContain("runtime-trace");
  });

  it("uses manifest remotes as import hints", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-manifest-remote-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"manifest-remote"}');
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/app.ts"), "export {}\n");
    await fs.writeFile(
      path.join(root, "dist/mf-manifest.json"),
      JSON.stringify({
        id: "host",
        name: "host",
        metaData: {
          remoteEntry: { name: "remoteEntry.js", path: "", type: "module" },
        },
        exposes: [],
        shared: [],
        remotes: [{ name: "checkout", alias: "checkout", entry: "https://cdn.example.com/c.json" }],
      }),
    );
    const facts = await collectProjectFacts(
      resolveOptions({
        root,
        bundler: "vite",
        mode: "development",
        moduleFederation: { name: "host" },
      }),
    );
    expect(facts.imports.remotes).toContain("checkout");
    expect(facts.imports.evidenceSources).toContain("manifest");
  });
});

describe("shared/unused with dynamic evidence", () => {
  async function runUnused(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "shared/unused")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("treats dynamicPackages as usage", async () => {
    const findings = await runUnused({
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
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
        name: "fixture",
        exposes: {},
        remotes: {},
        shared: {
          lodash: { package: "lodash", singleton: false, eager: false, shareScope: "default" },
        },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: ["src/app.ts"],
        specifiers: ["lodash"],
        packages: ["lodash"],
        dynamicPackages: ["lodash"],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    });
    expect(findings).toHaveLength(0);
  });

  it("skips unused when unresolved loadShare may hide usage", async () => {
    const findings = await runUnused({
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
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
        name: "fixture",
        exposes: {},
        remotes: {},
        shared: {
          lodash: { package: "lodash", singleton: false, eager: false, shareScope: "default" },
        },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: ["src/app.ts"],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [{ api: "loadShare", file: "src/app.ts" }],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    });
    expect(findings).toHaveLength(0);
  });
});
