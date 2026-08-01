import { describe, expect, it } from "vitest";
import { builtInRules } from "../../src/rules.js";
import {
  hasNodeRuntimePlugin,
  isBrowserOnlyManifestRemoteEntry,
  isSsrNodeEnvApplicable,
  nodeLibraryDtsProblems,
} from "../../src/ssr-detect.js";
import type { BuildRecord, DoctorFinding, ProjectFacts } from "../../src/types.js";

function presentCapability(
  reason = "test",
): BuildRecord["capabilities"][keyof BuildRecord["capabilities"]] {
  return { state: "exact", reason };
}

function buildRecord(
  id: string,
  targetKind: BuildRecord["targetKind"],
  target?: string,
): BuildRecord {
  return {
    id,
    adapter: "rspack",
    bundler: "rspack",
    emittedAssets: [],
    artifacts: [],
    ...(target ? { target } : {}),
    ...(targetKind ? { targetKind } : {}),
    capabilities: {
      outputRoot: presentCapability(),
      emittedAssets: presentCapability(),
      artifacts: presentCapability(),
      effectiveMode: presentCapability(),
      target: presentCapability(),
    },
    sourceHook: "test",
  };
}

function baseFacts(): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: "ssr-fixture", root: "." },
    bundler: { name: "rspack", mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: {
      name: "ssr_host",
      exposes: {},
      remotes: {},
      shared: {},
      experiments: {
        asyncStartup: false,
        externalRuntime: false,
        provideExternalRuntime: false,
        target: "node",
      },
    },
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: ["source"],
    },
    artifacts: { emittedAssets: [] },
  };
}

async function run(id: string, facts: ProjectFacts, options: Record<string, unknown> = {}) {
  const findings: Array<
    Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
  > = [];
  const selected = builtInRules.find((item) => item.meta.id === id)!;
  await selected.check({ facts, options, report: (finding) => findings.push(finding) });
  return findings;
}

describe("ssr dual-env rules (#122)", () => {
  it("detects browser-only mf-manifest entries and accepts /ssr/ paths", () => {
    expect(isBrowserOnlyManifestRemoteEntry("http://x/mf-manifest.json")).toBe(true);
    expect(isBrowserOnlyManifestRemoteEntry("http://x/ssr/mf-manifest.json")).toBe(false);
    expect(isBrowserOnlyManifestRemoteEntry("http://x/remoteEntry.js")).toBe(false);
  });

  it("is silent on browser-only targets", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.experiments!.target = "web";
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/mf-manifest.json", shareScope: "default" },
    };
    expect(isSsrNodeEnvApplicable(facts)).toBe(false);
    expect(await run("ssr/node-remote-manifest", facts)).toHaveLength(0);
    expect(await run("ssr/node-runtime-plugin-missing", facts)).toHaveLength(0);
    expect(await run("ssr/node-library-dts", facts)).toHaveLength(0);
  });

  it("fires node-remote-manifest on browser manifests under node target", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/mf-manifest.json", shareScope: "default" },
    };
    expect(await run("ssr/node-remote-manifest", facts)).not.toHaveLength(0);
  });

  it("stays quiet when remotes already use /ssr/mf-manifest.json", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/ssr/mf-manifest.json", shareScope: "default" },
    };
    expect(await run("ssr/node-remote-manifest", facts)).toHaveLength(0);
  });

  it("fires when node runtimePlugin is missing and quiets when present", async () => {
    const facts = baseFacts();
    expect(hasNodeRuntimePlugin(facts.moduleFederation!.runtimePlugins)).toBe(false);
    expect(await run("ssr/node-runtime-plugin-missing", facts)).not.toHaveLength(0);
    facts.moduleFederation!.runtimePlugins = ["@module-federation/node/runtimePlugin"];
    expect(await run("ssr/node-runtime-plugin-missing", facts)).toHaveLength(0);
  });

  it("warns on non-commonjs library + enabled dts for node producers", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.exposes = { "./Widget": "src/Widget.tsx" };
    facts.moduleFederation!.library = { type: "var" };
    facts.moduleFederation!.dts = { enabled: true, options: {} };
    expect(nodeLibraryDtsProblems(facts.moduleFederation).length).toBeGreaterThan(0);
    expect(await run("ssr/node-library-dts", facts)).not.toHaveLength(0);
  });

  it("quiets node-library-dts for hosts without exposes", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.library = { type: "var" };
    expect(await run("ssr/node-library-dts", facts)).toHaveLength(0);
  });

  it("honors ssrMode browser-only override", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/mf-manifest.json", shareScope: "default" },
    };
    expect(await run("ssr/node-remote-manifest", facts, { ssrMode: "browser-only" })).toHaveLength(
      0,
    );
  });

  it("applies dual-env mixed builds only when ssrMode forces dual", async () => {
    const facts = baseFacts();
    delete facts.moduleFederation!.experiments!.target;
    facts.builds = [buildRecord("web", "web"), buildRecord("ssr", "ssr")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/mf-manifest.json", shareScope: "default" },
    };
    expect(isSsrNodeEnvApplicable(facts)).toBe(false);
    expect(await run("ssr/node-remote-manifest", facts)).toHaveLength(0);
    expect(isSsrNodeEnvApplicable(facts, "dual")).toBe(true);
    expect(await run("ssr/node-remote-manifest", facts, { ssrMode: "dual" })).not.toHaveLength(0);
  });

  it("applies when vite.target is node even with mixed build records", async () => {
    const facts = baseFacts();
    delete facts.moduleFederation!.experiments!.target;
    facts.moduleFederation!.vite = {
      bundleAllCSS: false,
      ignoreOrigin: false,
      ssrExternals: [],
      target: "node",
    };
    facts.builds = [buildRecord("web", "web"), buildRecord("ssr", "ssr")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/mf-manifest.json", shareScope: "default" },
    };
    expect(isSsrNodeEnvApplicable(facts)).toBe(true);
    expect(await run("ssr/node-remote-manifest", facts)).not.toHaveLength(0);
  });
});
