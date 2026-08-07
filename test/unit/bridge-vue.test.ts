import { describe, expect, it } from "vitest";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";

function baseFacts(): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: "vue-bridge-fixture", root: "." },
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
      name: "vue_host",
      exposes: {},
      remotes: {},
      shared: {},
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

describe("vue bridge rules (#135)", () => {
  it("stays silent on React Bridge hosts", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
    facts.dependencies.declared.react = "19.0.0";
    facts.imports.packages = ["@module-federation/bridge-react", "react"];
    facts.moduleFederation!.shared = {};
    expect(await run("bridge/vue-share-missing", facts)).toHaveLength(0);
    expect(await run("bridge/vue-server-entry", facts)).toHaveLength(0);
    expect(await run("bridge/vue-consumer-manual", facts)).toHaveLength(0);
  });

  it("errors when Vue Bridge omits vue from shared", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
    facts.imports.packages = ["@module-federation/bridge-vue3", "vue"];
    expect(await run("bridge/vue-share-missing", facts)).not.toHaveLength(0);
    facts.moduleFederation!.shared = {
      vue: { package: "vue", singleton: true, eager: false, shareScope: "default" },
    };
    expect(await run("bridge/vue-share-missing", facts)).toHaveLength(0);
  });

  it("also requires vue-router share when vue-router is used", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
    facts.dependencies.declared["vue-router"] = "4.0.0";
    facts.imports.packages = ["@module-federation/bridge-vue3", "vue", "vue-router"];
    facts.moduleFederation!.shared = {
      vue: { package: "vue", singleton: true, eager: false, shareScope: "default" },
    };
    const findings = await run("bridge/vue-share-missing", facts);
    expect(findings).not.toHaveLength(0);
    expect(JSON.stringify(findings[0]?.evidence)).toContain("vue-router");
  });

  it("warns on SSR without Vue Bridge server entry and quiets with /server", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
    facts.imports.packages = ["@module-federation/bridge-vue3"];
    facts.imports.specifiers = ["@module-federation/bridge-vue3"];
    facts.moduleFederation!.experiments = {
      asyncStartup: false,
      externalRuntime: false,
      provideExternalRuntime: false,
      target: "node",
    };
    expect(await run("bridge/vue-server-entry", facts)).not.toHaveLength(0);
    facts.imports.specifiers = ["@module-federation/bridge-vue3/server"];
    expect(await run("bridge/vue-server-entry", facts)).toHaveLength(0);
  });

  it("does not infer a missing Vue server entry from incomplete source evidence", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
    facts.imports.packages = ["@module-federation/bridge-vue3"];
    facts.imports.specifiers = ["@module-federation/bridge-vue3"];
    facts.imports.sourceReadFailures = ["src/server.ts"];
    facts.moduleFederation!.experiments = {
      asyncStartup: false,
      externalRuntime: false,
      provideExternalRuntime: false,
      target: "node",
    };
    facts.moduleFederation!.shared = {
      vue: { package: "vue", singleton: true, eager: false, shareScope: "default" },
    };

    expect(await run("bridge/vue-server-entry", facts)).toHaveLength(0);
  });

  it("does not infer a missing Vue SSR fresh context from unreadable source evidence", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
    facts.imports.sourceFiles = ["src/App.ts"];
    facts.imports.packages = ["@module-federation/bridge-vue3"];
    facts.imports.sourceReadFailures = ["src/App.ts"];
    facts.moduleFederation!.experiments = {
      asyncStartup: false,
      externalRuntime: false,
      provideExternalRuntime: false,
      target: "node",
    };
    facts.moduleFederation!.shared = {
      vue: { package: "vue", singleton: true, eager: false, shareScope: "default" },
    };

    expect(await run("bridge/vue-ssr-fresh-context", facts)).toHaveLength(0);
  });

  it("does not infer manual Vue remote consumption from unreadable source evidence", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
    facts.imports.sourceFiles = ["src/App.ts"];
    facts.imports.packages = ["@module-federation/bridge-vue3", "@module-federation/runtime"];
    facts.imports.remotes = ["shop"];
    facts.imports.sourceReadFailures = ["src/App.ts"];
    facts.moduleFederation!.shared = {
      vue: { package: "vue", singleton: true, eager: false, shareScope: "default" },
    };
    facts.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "https://example.test/mf-manifest.json",
        shareScope: "default",
      },
    };

    expect(await run("bridge/vue-consumer-manual", facts)).toHaveLength(0);
  });
});
