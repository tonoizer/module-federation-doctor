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
    await resolveOptions({
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
  it("ignores comments, strings, and templates while preserving real imports", async () => {
    const source = await fs.readFile(
      path.join(dynamicFixtures, "adversarial-comments-strings.ts"),
      "utf8",
    );
    const { facts } = await projectWith({ "src/app.ts": source });
    expect(facts.imports.packages).toEqual(["react", "react-dom"]);
    expect(facts.imports.specifiers).toEqual(["react", "react-dom"]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("parses TSX syntax and records non-literal runtime calls as unresolved", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "syntax-aware.tsx"), "utf8");
    const { facts } = await projectWith(
      { "src/app.tsx": source },
      { moduleFederation: { remotes: { shop: "shop@https://cdn.example.com/shop.js" } } },
    );
    expect(facts.imports.packages).toContain("react");
    expect(facts.imports.dynamicPackages).toContain("lodash");
    expect(facts.imports.remotes).toContain("shop");
    expect(facts.imports.unresolvedDynamic).toEqual([{ api: "loadShare", file: "src/app.tsx" }]);
  });

  it("turns malformed source into partial evidence", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "malformed.txt"), "utf8");
    const { facts } = await projectWith(
      { "src/bad.txt": source },
      { include: ["src/**/*.{ts,tsx,js,jsx,txt}"] },
    );
    expect(facts.imports.packages).toEqual([]);
    expect(facts.imports.unresolvedDynamic).toEqual([{ api: "import", file: "src/bad.txt" }]);
  });

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

  it("resolves explicitly imported, aliased, and namespace MF APIs in JavaScript", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "runtime-api-bindings.js"), "utf8");
    const { facts } = await projectWith({ "src/app.js": source });

    expect(facts.imports.packages).toEqual([
      "@module-federation/runtime",
      "react",
      "react-dom",
      "router",
      "state",
    ]);
    expect(facts.imports.dynamicPackages).toEqual(["react", "react-dom", "router", "state"]);
    expect(facts.imports.remotes).toEqual(["catalog", "checkout", "shop"]);
    expect(facts.imports.specifiers).toEqual([
      "@module-federation/runtime",
      "catalog/Widget",
      "checkout",
      "react",
      "react-dom",
      "router",
      "shop/Card",
      "state",
    ]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("does not count type-only imports, exports, or TS import types as runtime usage", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "type-only-bindings.ts"), "utf8");
    const { facts } = await projectWith({ "src/types.ts": source });

    expect(facts.imports.specifiers).toEqual([]);
    expect(facts.imports.packages).toEqual([]);
    expect(facts.imports.dynamicPackages).toEqual([]);
    expect(facts.imports.remotes).toEqual([]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("does not attribute same-name local bindings or nested shadowing to imported MF APIs", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "shadowed-api.ts"), "utf8");
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.remotes).toEqual(["shop"]);
    expect(facts.imports.packages).toEqual(["@module-federation/runtime", "react"]);
    expect(facts.imports.specifiers).toEqual(["@module-federation/runtime", "react", "shop/App"]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("respects parameter, var, and block shadowing of imported bindings", async () => {
    const source = `
      import { loadRemote as remote, loadShare as share } from "@module-federation/runtime";
      import * as mf from "@module-federation/runtime";

      export function shadowedByParameters(
        remote: (id: string) => unknown,
        mf: { loadRemote: (id: string) => unknown },
      ) {
        remote("local/parameter");
        mf.loadRemote("local/namespace");
      }

      export function shadowedByVar() {
        remote("local/var");
        var remote = (id: string) => id;
      }

      export function shadowedByBlock() {
        {
          const share = (id: string) => id;
          share("local/block");
        }
      }

      remote("shop/App");
      share("react");
      mf.loadShare("react-dom");
    `;
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.remotes).toEqual(["shop"]);
    expect(facts.imports.packages).toEqual(["@module-federation/runtime", "react", "react-dom"]);
    expect(facts.imports.specifiers).toEqual([
      "@module-federation/runtime",
      "react",
      "react-dom",
      "shop/App",
    ]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("keeps ambient MF API declarations unresolved", async () => {
    const source = `
      declare function loadRemote(id: string): Promise<unknown>;
      declare function loadShare(id: string): Promise<unknown>;

      export async function loadFederated(id: string) {
        await loadRemote("shop/App");
        await loadShare(id);
      }
    `;
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.specifiers).toEqual([]);
    expect(facts.imports.packages).toEqual([]);
    expect(facts.imports.remotes).toEqual([]);
    expect(facts.imports.unresolvedDynamic).toEqual([
      { api: "loadRemote", file: "src/app.ts" },
      { api: "loadShare", file: "src/app.ts" },
    ]);
  });

  it("keeps ambient MF API variable declarations unresolved", async () => {
    const source = `
      declare const loadRemote: (id: string) => Promise<unknown>;
      declare let loadShare: (id: string) => Promise<unknown>;
      declare var loadShareSync: (id: string) => Promise<unknown>;

      export async function loadFederated(id: string) {
        await loadRemote("shop/App");
        await loadShare(id);
        await loadShareSync("react");
      }
    `;
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.specifiers).toEqual([]);
    expect(facts.imports.packages).toEqual([]);
    expect(facts.imports.remotes).toEqual([]);
    expect(facts.imports.unresolvedDynamic).toEqual([
      { api: "loadRemote", file: "src/app.ts" },
      { api: "loadShare", file: "src/app.ts" },
      { api: "loadShareSync", file: "src/app.ts" },
    ]);
  });

  it("resolves literal CommonJS runtime bindings with lexical shadowing", async () => {
    const source = `
      const { loadRemote, loadShare: share, loadShareSync: syncShare } =
        require("@module-federation/runtime");
      const mf = require("@module-federation/runtime");

      function shadowedByParameter(mf) {
        mf.loadRemote("local/namespace");
      }

      function shadowedByBlock() {
        {
          const share = (id) => id;
          share("local/share");
        }
      }

      loadRemote("shop/App");
      share("react");
      syncShare("react-dom");
      mf.loadRemote("catalog/Widget");
    `;
    const { facts } = await projectWith({ "src/app.js": source });

    expect(facts.imports.packages).toEqual(["@module-federation/runtime", "react", "react-dom"]);
    expect(facts.imports.dynamicPackages).toEqual(["react", "react-dom"]);
    expect(facts.imports.remotes).toEqual(["catalog", "shop"]);
    expect(facts.imports.specifiers).toEqual([
      "@module-federation/runtime",
      "catalog/Widget",
      "react",
      "react-dom",
      "shop/App",
    ]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("does not resolve CommonJS runtime bindings when require is shadowed later in scope", async () => {
    const source = `
      const { loadRemote: validRemote } = require("@module-federation/runtime");
      const validRuntime = require("@module-federation/runtime");

      validRemote("shop/App");
      validRuntime.loadShare("react");

      function shadowedByFunction() {
        const { loadRemote } = require("@module-federation/runtime");
        function require() {}
        loadRemote("local/function");
      }

      function shadowedByVar() {
        const { loadShare: share } = require("@module-federation/runtime");
        var require;
        share("local/var");
      }

      function shadowedByLexical() {
        const runtime = require("@module-federation/runtime");
        const require = () => ({ loadRemote() {} });
        runtime.loadRemote("local/lexical");
      }
    `;
    const { facts } = await projectWith({ "src/app.js": source });

    expect(facts.imports.packages).toEqual(["@module-federation/runtime", "react"]);
    expect(facts.imports.dynamicPackages).toEqual(["react"]);
    expect(facts.imports.remotes).toEqual(["shop"]);
    expect(facts.imports.specifiers).toEqual(["@module-federation/runtime", "react", "shop/App"]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("resolves runtime-tools public re-export entry points", async () => {
    const source = `
      import { loadRemote as remote } from "@module-federation/runtime-tools";
      import * as runtime from "@module-federation/runtime-tools/runtime";

      remote("shop/App");
      runtime.loadShare("react");
    `;
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.packages).toEqual(["@module-federation/runtime-tools", "react"]);
    expect(facts.imports.dynamicPackages).toEqual(["react"]);
    expect(facts.imports.remotes).toEqual(["shop"]);
    expect(facts.imports.specifiers).toEqual([
      "@module-federation/runtime-tools",
      "@module-federation/runtime-tools/runtime",
      "react",
      "shop/App",
    ]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("does not let function-body vars shadow parameter initializers", async () => {
    const source = `
      import { loadShare } from "@module-federation/runtime";

      export function ensureShared(value = loadShare("react")) {
        var loadShare;
        return value;
      }
    `;
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.packages).toEqual(["@module-federation/runtime", "react"]);
    expect(facts.imports.dynamicPackages).toEqual(["react"]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("keeps static-block and TS-module vars scoped to their blocks", async () => {
    const source = `
      import { loadRemote } from "@module-federation/runtime";

      class Local {
        static {
          var loadRemote;
          loadRemote("local/static-block");
        }
      }

      declare module "virtual-module" {
        var loadRemote: unknown;
      }

      loadRemote("shop/App");
    `;
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.packages).toEqual(["@module-federation/runtime"]);
    expect(facts.imports.remotes).toEqual(["shop"]);
    expect(facts.imports.specifiers).toEqual(["@module-federation/runtime", "shop/App"]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("does not treat unimported local functions with MF API names as federation APIs", async () => {
    const source = await fs.readFile(path.join(dynamicFixtures, "local-api-names.ts"), "utf8");
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.specifiers).toEqual([]);
    expect(facts.imports.packages).toEqual([]);
    expect(facts.imports.remotes).toEqual([]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
  });

  it("keeps non-literal calls through imported and namespace APIs unresolved", async () => {
    const source = await fs.readFile(
      path.join(dynamicFixtures, "unresolved-api-bindings.ts"),
      "utf8",
    );
    const { facts } = await projectWith({ "src/app.ts": source });

    expect(facts.imports.specifiers).toEqual(["@module-federation/runtime"]);
    expect(facts.imports.packages).toEqual(["@module-federation/runtime"]);
    expect(facts.imports.remotes).toEqual([]);
    expect(facts.imports.unresolvedDynamic).toEqual([
      { api: "loadRemote", file: "src/app.ts" },
      { api: "loadShare", file: "src/app.ts" },
      { api: "loadShareSync", file: "src/app.ts" },
    ]);
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

  it("does not fail offline check when opt-in runtimeTrace is invalid", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-bad-runtime-"));
    roots.push(root);
    const badTrace = path.join(root, "bad-trace.json");
    await fs.writeFile(badTrace, '{"findings":[],"projects":1}');
    const { facts } = await projectWith(
      { "src/app.ts": "export {}\n" },
      {
        runtimeTrace: badTrace,
        moduleFederation: { shared: { react: { singleton: true } } },
      },
    );
    expect(facts.imports.evidenceSources).not.toContain("runtime-trace");
    expect(facts.imports.packages).not.toContain("react");
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
      await resolveOptions({
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

  it("treats trailing-slash prefix shares as used when root or subpath is imported", async () => {
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
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
          "react/": { package: "react/", singleton: false, eager: false, shareScope: "default" },
        },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: ["src/app.ts"],
        specifiers: ["react", "react/jsx-runtime"],
        packages: ["react"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
        deepImports: ["react/jsx-runtime"],
      },
      artifacts: { emittedAssets: [] },
    });
    expect(findings).toHaveLength(0);
  });

  it("treats exact subpath share keys as used via deepImports", async () => {
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
          "preact/hooks": {
            package: "preact/hooks",
            singleton: false,
            eager: false,
            shareScope: "default",
          },
        },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: ["src/app.ts"],
        specifiers: ["preact/hooks"],
        packages: ["preact"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
        deepImports: ["preact/hooks"],
      },
      artifacts: { emittedAssets: [] },
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags truly unused non-prefix share keys", async () => {
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
        specifiers: ["react"],
        packages: ["react"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    });
    expect(findings.some((item) => item.message.includes('"lodash"'))).toBe(true);
  });

  it("still flags unused trailing-slash keys with no matching imports", async () => {
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
          "vue/": { package: "vue/", singleton: false, eager: false, shareScope: "default" },
        },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: ["src/app.ts"],
        specifiers: ["react"],
        packages: ["react"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    });
    expect(findings.some((item) => item.message.includes('"vue/"'))).toBe(true);
  });
});
