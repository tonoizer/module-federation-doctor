import { describe, expect, it } from "vitest";
import { builtInRules } from "../../src/rules.js";
import {
  consumerRemoteTargetKind,
  hasNodeRuntimePlugin,
  isBrowserOnlyManifestRemoteEntry,
  isSsrAwareRemoteEntry,
  isSsrNodeEnvApplicable,
  nodeLibraryDtsProblems,
  remoteEntryImpliedTarget,
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

  it("ignores Vite build-target noise without explicit MF node target", async () => {
    const facts = baseFacts();
    delete facts.moduleFederation!.experiments!.target;
    facts.builds = [buildRecord("vite-build-1", "node", "node")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/mf-manifest.json", shareScope: "default" },
    };
    expect(isSsrNodeEnvApplicable(facts)).toBe(false);
    expect(await run("ssr/node-remote-manifest", facts)).toHaveLength(0);
    expect(await run("ssr/node-runtime-plugin-missing", facts)).toHaveLength(0);
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

describe("ssr/remote-entry-target-mismatch (BL-32)", () => {
  it("classifies remoteEntry.ssr.js and /ssr/ paths as SSR, remoteEntry.js as web", () => {
    expect(isSsrAwareRemoteEntry("http://x/remoteEntry.ssr.js")).toBe(true);
    expect(remoteEntryImpliedTarget("http://x/remoteEntry.ssr.js")).toBe("ssr");
    expect(remoteEntryImpliedTarget("http://x/ssr/mf-manifest.json")).toBe("ssr");
    expect(remoteEntryImpliedTarget("http://x/remoteEntry.js")).toBe("web");
    expect(remoteEntryImpliedTarget("http://x/mf-manifest.json")).toBeUndefined();
    expect(remoteEntryImpliedTarget("shop")).toBeUndefined();
  });

  it("flags a browser host whose remotes point at remoteEntry.ssr.js", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.experiments!.target = "web";
    facts.builds = [buildRecord("web", "web")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/remoteEntry.ssr.js", shareScope: "default" },
    };
    expect(consumerRemoteTargetKind(facts)).toBe("web");
    const findings = await run("ssr/remote-entry-target-mismatch", facts);
    expect(findings).not.toHaveLength(0);
    expect(findings[0]?.message).toMatch(/Browser remotes point at an SSR remoteEntry/);
  });

  it("flags a browser host whose remotes point at /ssr/ paths", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.experiments!.target = "web";
    facts.builds = [buildRecord("web", "web")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/ssr/mf-manifest.json", shareScope: "default" },
    };
    expect(await run("ssr/remote-entry-target-mismatch", facts)).not.toHaveLength(0);
  });

  it("flags the reverse: SSR host remotes pointing at browser remoteEntry.js", async () => {
    const facts = baseFacts();
    facts.builds = [buildRecord("ssr", "ssr")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/remoteEntry.js", shareScope: "default" },
    };
    expect(consumerRemoteTargetKind(facts)).toBe("ssr");
    const findings = await run("ssr/remote-entry-target-mismatch", facts);
    expect(findings).not.toHaveLength(0);
    expect(findings[0]?.message).toMatch(/Node\/SSR remotes point at a browser remoteEntry/);
  });

  it("stays quiet when browser remotes match the client container", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.experiments!.target = "web";
    facts.builds = [buildRecord("web", "web")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/remoteEntry.js", shareScope: "default" },
    };
    expect(await run("ssr/remote-entry-target-mismatch", facts)).toHaveLength(0);
  });

  it("stays quiet when SSR remotes already use remoteEntry.ssr.js", async () => {
    const facts = baseFacts();
    facts.builds = [buildRecord("ssr", "ssr")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/remoteEntry.ssr.js", shareScope: "default" },
    };
    expect(await run("ssr/remote-entry-target-mismatch", facts)).toHaveLength(0);
  });

  it("skips when consumer targetKind facts are missing", async () => {
    const facts = baseFacts();
    delete facts.moduleFederation!.experiments!.target;
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/remoteEntry.ssr.js", shareScope: "default" },
    };
    expect(consumerRemoteTargetKind(facts)).toBeUndefined();
    expect(await run("ssr/remote-entry-target-mismatch", facts)).toHaveLength(0);
  });

  it("skips mixed dual-env web+ssr builds (Nitro pairing is not this contract)", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.experiments!.target = "web";
    facts.builds = [buildRecord("web", "web"), buildRecord("ssr", "ssr")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/remoteEntry.ssr.js", shareScope: "default" },
    };
    expect(consumerRemoteTargetKind(facts)).toBeUndefined();
    expect(await run("ssr/remote-entry-target-mismatch", facts)).toHaveLength(0);
  });

  it("does not treat bare builds.targetKind=node as a browser or SSR consumer", async () => {
    const facts = baseFacts();
    delete facts.moduleFederation!.experiments!.target;
    facts.builds = [buildRecord("vite-build-1", "node", "node")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/remoteEntry.ssr.js", shareScope: "default" },
    };
    expect(consumerRemoteTargetKind(facts)).toBeUndefined();
    expect(await run("ssr/remote-entry-target-mismatch", facts)).toHaveLength(0);
  });

  it("does not flag the SvelteKit SSR remoteEntry.ssr.js false-positive guard fixture", async () => {
    const facts = baseFacts();
    facts.bundler.name = "vite";
    delete facts.moduleFederation!.experiments!.target;
    facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
    facts.capabilities.emittedAssets = true;
    facts.artifacts.emittedAssets = [".svelte-kit/output/server/remoteEntry.ssr.js"];
    facts.builds = [buildRecord("sveltekit-ssr", "node")];
    expect(await run("ssr/remote-entry-target-mismatch", facts)).toHaveLength(0);
    expect(await run("artifact/remote-entry-missing", facts)).toHaveLength(0);
  });

  it("leaves browser mf-manifest.json on node hosts to ssr/node-remote-manifest", async () => {
    const facts = baseFacts();
    facts.builds = [buildRecord("ssr", "ssr")];
    facts.moduleFederation!.remotes = {
      shop: { name: "shop", entry: "http://x/mf-manifest.json", shareScope: "default" },
    };
    expect(await run("ssr/remote-entry-target-mismatch", facts)).toHaveLength(0);
    expect(await run("ssr/node-remote-manifest", facts)).not.toHaveLength(0);
  });
});
