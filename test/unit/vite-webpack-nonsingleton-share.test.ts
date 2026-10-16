import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeFederation } from "../../src/engine.js";
import type { BundlerName, NormalizedShared, ProjectFacts } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const RULE_ID = "federation/vite-webpack-nonsingleton-share";

function sharedEntry(
  name: string,
  singleton: boolean,
): NonNullable<ProjectFacts["moduleFederation"]>["shared"][string] {
  return {
    package: name,
    singleton,
    eager: false,
    shareScope: ["default"],
  } satisfies NormalizedShared;
}

function projectFacts(input: {
  name: string;
  bundler: BundlerName;
  shared: Record<string, { singleton: boolean }>;
  pluginVersion?: string;
  pluginVersionSource?: "manifest" | "stats";
}): ProjectFacts {
  const shared = Object.fromEntries(
    Object.entries(input.shared).map(([pkg, value]) => [pkg, sharedEntry(pkg, value.singleton)]),
  );
  const artifacts: ProjectFacts["artifacts"] = { emittedAssets: [] };
  if (input.pluginVersion && input.pluginVersionSource !== "stats") {
    const manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      pluginVersion: input.pluginVersion,
      exposes: [],
      shared: Object.keys(shared).map((name) => {
        const singleton = shared[name]?.singleton;
        return singleton === undefined ? { name, assets: [] } : { name, assets: [], singleton };
      }),
    };
    artifacts.manifest = manifest;
    artifacts.records = [
      {
        kind: "manifest",
        path: "dist/mf-manifest.json",
        source: "discovered",
        state: "valid",
        valid: true,
        manifest,
      },
    ];
  }
  if (input.pluginVersion && input.pluginVersionSource === "stats") {
    const stats = {
      path: "dist/mf-stats.json",
      valid: true,
      data: { metaData: { pluginVersion: input.pluginVersion } },
    };
    artifacts.stats = stats;
    artifacts.records = [
      {
        kind: "stats",
        path: "dist/mf-stats.json",
        source: "discovered",
        state: "valid",
        valid: true,
        stats,
      },
    ];
  }
  return {
    schemaVersion: 1,
    project: { name: input.name, root: "." },
    bundler: { name: input.bundler, mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: Boolean(artifacts.manifest),
      stats: Boolean(artifacts.stats),
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: {
      name: input.name,
      exposes: {},
      remotes: {},
      shared,
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
    artifacts,
  };
}

async function federationFindings(projects: ProjectFacts[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-vite-nonsingleton-"));
  roots.push(root);
  const files: string[] = [];
  for (const project of projects) {
    const file = path.join(root, `${project.project.name}.json`);
    await fs.writeFile(file, JSON.stringify(project));
    files.push(file);
  }
  return (await analyzeFederation(files)).findings.map((finding) => ({
    ruleId: finding.ruleId,
    project: finding.project,
    message: finding.message,
    suggestion: finding.suggestion,
    evidence: finding.evidence,
  }));
}

function viteRemote(options: {
  pluginVersion?: string;
  pluginVersionSource?: "manifest" | "stats";
  singleton?: boolean;
}): ProjectFacts {
  return projectFacts({
    name: "vite-remote",
    bundler: "vite",
    shared: { "vue-types": { singleton: options.singleton ?? true } },
    ...(options.pluginVersion ? { pluginVersion: options.pluginVersion } : {}),
    ...(options.pluginVersionSource ? { pluginVersionSource: options.pluginVersionSource } : {}),
  });
}

function webpackPeer(options: { singleton?: boolean; bundler?: BundlerName } = {}): ProjectFacts {
  return projectFacts({
    name: "webpack-host",
    bundler: options.bundler ?? "webpack",
    shared: { "vue-types": { singleton: options.singleton ?? false } },
  });
}

describe("federation/vite-webpack-nonsingleton-share", () => {
  it("fires for a Vite emit in [1.22.0, 1.23.4) federated with a webpack non-singleton share", async () => {
    const findings = await federationFindings([
      viteRemote({ pluginVersion: "1.22.0" }),
      webpackPeer(),
    ]);
    const hit = findings.find((item) => item.ruleId === RULE_ID);
    expect(hit).toMatchObject({
      ruleId: RULE_ID,
      project: "vite-remote",
      evidence: {
        package: "vue-types",
        pluginVersion: "1.22.0",
        viteInstance: "vite-remote",
        webpackPeers: ["webpack-host"],
      },
    });
    expect(hit?.message).toContain("RUNTIME-015");
    expect(hit?.message).toContain("1.23.4");
    expect(hit?.suggestion).toContain("Upgrade `@module-federation/vite` to >=1.23.4");
    expect(hit?.suggestion).toContain("https://github.com/module-federation/vite/issues/1429");
  });

  it("reads pluginVersion from collected mf-stats metaData when the manifest omits it", async () => {
    const findings = await federationFindings([
      viteRemote({ pluginVersion: "1.22.1", pluginVersionSource: "stats" }),
      webpackPeer({ bundler: "rspack" }),
    ]);
    expect(findings.find((item) => item.ruleId === RULE_ID)?.evidence.pluginVersion).toBe("1.22.1");
  });

  it("stays quiet when the Vite plugin is >= 1.23.4", async () => {
    const findings = await federationFindings([
      viteRemote({ pluginVersion: "1.23.4" }),
      webpackPeer(),
    ]);
    expect(findings.some((item) => item.ruleId === RULE_ID)).toBe(false);
  });

  it("stays quiet when the Vite plugin is below 1.22.0", async () => {
    const findings = await federationFindings([
      viteRemote({ pluginVersion: "1.21.6" }),
      webpackPeer(),
    ]);
    expect(findings.some((item) => item.ruleId === RULE_ID)).toBe(false);
  });

  it("stays quiet when the webpack-family peer shares the package as a singleton", async () => {
    const findings = await federationFindings([
      viteRemote({ pluginVersion: "1.23.3" }),
      webpackPeer({ singleton: true }),
    ]);
    expect(findings.some((item) => item.ruleId === RULE_ID)).toBe(false);
  });

  it("stays quiet when there is no webpack-family peer", async () => {
    const findings = await federationFindings([
      viteRemote({ pluginVersion: "1.22.0" }),
      projectFacts({
        name: "other-vite",
        bundler: "vite",
        shared: { "vue-types": { singleton: false } },
      }),
    ]);
    expect(findings.some((item) => item.ruleId === RULE_ID)).toBe(false);
  });

  it("stays quiet when the Vite emit does not report a plugin version", async () => {
    const findings = await federationFindings([viteRemote({}), webpackPeer()]);
    expect(findings.some((item) => item.ruleId === RULE_ID)).toBe(false);
  });
});
