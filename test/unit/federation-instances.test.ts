import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addBuildFacts } from "../../src/collect.js";
import { analyze, analyzeBuild } from "../../src/engine.js";
import {
  describeFederationInstances,
  federationInstanceRefs,
} from "../../src/federation-instance.js";
import { buildFederationModel } from "../../src/federation-model.js";
import { normalizeModuleFederation } from "../../src/normalize.js";
import {
  collectModuleFederationPluginInstances,
  collectViteModuleFederationPluginInstances,
  resolveViteFederationInstances,
} from "../../src/plugin.js";
import { writeReports } from "../../src/reporters.js";
import { buildUiPayload, reportFromFindings } from "../../src/ui-graph.js";
import { migrateProjectFacts, projectFactsFromEvidence } from "../../src/evidence-reader.js";
import { validatePayload } from "../helpers/schema-contract.js";
import type {
  ArtifactFacts,
  DoctorFinding,
  FederationInstanceFacts,
  ImportFacts,
  ModuleFederationConfigLike,
  ProjectFacts,
} from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function instanceConfig(name: string, filename: string): ModuleFederationConfigLike {
  return {
    name,
    filename,
    exposes: { "./Widget": `./src/${name}.ts` },
    remotes: {},
    shared: { react: { singleton: true, requiredVersion: "^18" } },
  };
}

async function projectRoot(name = "multi-instance") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-multi-instance-"));
  roots.push(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name, dependencies: { react: "18.3.1", vite: "6.0.0" } }),
  );
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src/checkout.ts"),
    'import "checkout-only";\nexport default 1;\n',
  );
  await fs.writeFile(
    path.join(root, "src/catalog.ts"),
    'import "catalog-only";\nexport default 2;\n',
  );
  return root;
}

function imports(packages: string[] = []): ImportFacts {
  return {
    sourceFiles: [],
    specifiers: [],
    packages,
    dynamicPackages: [],
    remotes: [],
    unresolvedDynamic: [],
    evidenceSources: [],
  };
}

function artifacts(): ArtifactFacts {
  return { emittedAssets: [] };
}

function scopedProject(name: string, configs: ModuleFederationConfigLike[]): ProjectFacts {
  const descriptors = describeFederationInstances(
    configs.map((config) => ({ config, pluginName: "ModuleFederationPlugin" })),
  );
  const instances = descriptors.map((descriptor) => {
    const moduleFederation = normalizeModuleFederation(descriptor.config, { bundler: "vite" })!;
    return {
      id: descriptor.id,
      pluginName: descriptor.pluginName,
      configDigest: descriptor.configDigest,
      registrationGroup: descriptor.registrationGroup,
      moduleFederation,
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      imports: imports(),
      artifacts: artifacts(),
    } satisfies FederationInstanceFacts;
  });
  return {
    schemaVersion: 1,
    project: { name, root: ".", federationGroup: "checkout" },
    bundler: {
      name: "vite",
      mode: "production",
      federationInstances: federationInstanceRefs(descriptors),
    },
    capabilities: {
      config: true,
      sourceImports: false,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: instances[0]!.moduleFederation,
    federationInstances: instances,
    dependencies: { declared: {}, installed: { react: "18.3.1" } },
    imports: imports(),
    artifacts: artifacts(),
  };
}

describe("multiple Module Federation instances", () => {
  it("derives stable identities and keeps intentional registrations separate", () => {
    const first = instanceConfig("checkout", "checkoutEntry.js");
    const second = instanceConfig("catalog", "catalogEntry.js");
    const forward = describeFederationInstances([
      { config: first, pluginName: "ModuleFederationPlugin" },
      { config: second, pluginName: "ModuleFederationPlugin" },
    ]);
    const reverse = describeFederationInstances([
      {
        config: { ...second, exposes: { ...second.exposes } },
        pluginName: "ModuleFederationPlugin",
      },
      { config: { ...first, exposes: { ...first.exposes } }, pluginName: "ModuleFederationPlugin" },
    ]);

    expect(new Set(forward.map((item) => item.id)).size).toBe(2);
    expect(new Set(forward.map((item) => item.registrationGroup)).size).toBe(2);
    expect(new Set(forward.map((item) => item.id))).toEqual(
      new Set(reverse.map((item) => item.id)),
    );
  });

  it("reports an actionable finding only for an identical duplicate registration", async () => {
    const root = await projectRoot("duplicate-instance");
    const config = instanceConfig("checkout", "checkoutEntry.js");
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederationInstances: [config, structuredClone(config)],
      output: { formats: [] },
    });
    const findings = result.report.findings.filter(
      (finding) => finding.ruleId === "config/duplicate-plugin-registration",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      federationInstanceId: expect.stringMatching(/^mfid:v1:federation-instance:/),
      evidence: {
        moduleFederationPluginCount: 2,
        federationInstanceIds: expect.arrayContaining([
          expect.stringMatching(/^mfid:v1:federation-instance:/),
        ]),
      },
    });
    expect((findings[0]!.evidence.federationInstanceIds as string[]).length).toBe(2);
  });

  it("does not report a duplicate for two distinct instances", async () => {
    const root = await projectRoot();
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederationInstances: [
        instanceConfig("checkout", "checkoutEntry.js"),
        instanceConfig("catalog", "catalogEntry.js"),
      ],
      output: { formats: [] },
    });
    expect(
      result.report.findings.some(
        (finding) => finding.ruleId === "config/duplicate-plugin-registration",
      ),
    ).toBe(false);
    expect(result.facts.federationInstances).toHaveLength(2);
    const checkout = result.facts.federationInstances![0]!;
    const catalog = result.facts.federationInstances![1]!;
    expect(checkout.imports).toMatchObject({
      sourceFiles: ["src/checkout.ts"],
      packages: ["checkout-only"],
      sourceScope: "instance",
    });
    expect(catalog.imports).toMatchObject({
      sourceFiles: ["src/catalog.ts"],
      packages: ["catalog-only"],
      sourceScope: "instance",
    });
  });

  it("partitions emitted manifests, entries, and build evidence by instance", async () => {
    const root = await projectRoot();
    const firstManifest = {
      id: "checkout",
      name: "checkout",
      metaData: { remoteEntry: { name: "checkoutEntry.js", path: "" } },
      exposes: [],
      shared: [],
    };
    const secondManifest = {
      id: "catalog",
      name: "catalog",
      metaData: { remoteEntry: { name: "catalogEntry.js", path: "" } },
      exposes: [],
      shared: [],
    };
    await fs.mkdir(path.join(root, "dist/checkout"), { recursive: true });
    await fs.mkdir(path.join(root, "dist/catalog"), { recursive: true });
    await fs.writeFile(
      path.join(root, "dist/checkout/checkout-manifest.json"),
      JSON.stringify(firstManifest),
    );
    await fs.writeFile(
      path.join(root, "dist/catalog/catalog-manifest.json"),
      JSON.stringify(secondManifest),
    );
    await fs.writeFile(
      path.join(root, "dist/checkout/checkout-stats.json"),
      JSON.stringify({ instance: "checkout", assets: ["checkoutEntry.js"] }),
    );
    await fs.writeFile(
      path.join(root, "dist/catalog/catalog-stats.json"),
      JSON.stringify({ instance: "catalog", assets: ["catalogEntry.js"] }),
    );
    await fs.writeFile(path.join(root, "dist/checkout/checkoutEntry.js"), "checkout");
    await fs.writeFile(path.join(root, "dist/catalog/catalogEntry.js"), "catalog");

    const result = await analyzeBuild(
      {
        root,
        bundler: "webpack",
        mode: "ci",
        moduleFederationInstances: [
          instanceConfig("checkout", "checkoutEntry.js"),
          instanceConfig("catalog", "catalogEntry.js"),
        ],
        artifactNames: {
          manifest: ["checkout-manifest.json", "catalog-manifest.json"],
          stats: ["checkout-stats.json", "catalog-stats.json"],
        },
        output: { formats: [] },
      },
      [
        "dist/checkout/checkout-manifest.json",
        "dist/checkout/checkout-stats.json",
        "dist/checkout/checkoutEntry.js",
        "dist/catalog/catalog-manifest.json",
        "dist/catalog/catalog-stats.json",
        "dist/catalog/catalogEntry.js",
      ],
      undefined,
      [
        {
          adapter: "webpack",
          bundler: "webpack",
          outputRoot: "dist/checkout",
          emittedAssets: ["checkout-manifest.json", "checkout-stats.json", "checkoutEntry.js"],
          sourceHook: "afterEmit",
        },
        {
          adapter: "webpack",
          bundler: "webpack",
          outputRoot: "dist/catalog",
          emittedAssets: ["catalog-manifest.json", "catalog-stats.json", "catalogEntry.js"],
          sourceHook: "afterEmit",
        },
      ],
    );

    const instances = result.facts.federationInstances!;
    expect(instances).toHaveLength(2);
    const checkout = instances.find((item) => item.moduleFederation.name === "checkout")!;
    const catalog = instances.find((item) => item.moduleFederation.name === "catalog")!;
    expect(checkout.artifacts.manifest?.name).toBe("checkout");
    expect(catalog.artifacts.manifest?.name).toBe("catalog");
    expect(checkout.artifacts.stats?.data).toMatchObject({ instance: "checkout" });
    expect(catalog.artifacts.stats?.data).toMatchObject({ instance: "catalog" });
    expect(checkout.artifacts.emittedAssets).toEqual([
      "dist/checkout/checkout-manifest.json",
      "dist/checkout/checkout-stats.json",
      "dist/checkout/checkoutEntry.js",
    ]);
    expect(catalog.artifacts.emittedAssets).toEqual([
      "dist/catalog/catalog-manifest.json",
      "dist/catalog/catalog-stats.json",
      "dist/catalog/catalogEntry.js",
    ]);
    expect(
      checkout.builds
        ?.flatMap((build) => build.artifacts)
        .every((record) => record.federationInstanceId === checkout.id),
    ).toBe(true);
    expect(
      catalog.builds
        ?.flatMap((build) => build.artifacts)
        .every((record) => record.federationInstanceId === catalog.id),
    ).toBe(true);
  });

  it("keeps same-directory stats and same-name or hashed entries scoped", async () => {
    const root = await projectRoot("same-directory-instances");
    const checkoutManifest = {
      id: "checkout",
      name: "checkout",
      metaData: { remoteEntry: { name: "checkout.abc123.js", path: "" } },
      exposes: [],
      shared: [],
    };
    const catalogManifest = {
      id: "catalog",
      name: "catalog",
      metaData: { remoteEntry: { name: "catalog.def456.js", path: "" } },
      exposes: [],
      shared: [],
    };
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(root, "dist/checkout-manifest.json"),
      JSON.stringify(checkoutManifest),
    );
    await fs.writeFile(
      path.join(root, "dist/catalog-manifest.json"),
      JSON.stringify(catalogManifest),
    );
    await fs.writeFile(
      path.join(root, "dist/checkout-stats.json"),
      JSON.stringify({ instance: "checkout" }),
    );
    await fs.writeFile(
      path.join(root, "dist/catalog-stats.json"),
      JSON.stringify({ instance: "catalog" }),
    );
    await fs.writeFile(path.join(root, "dist/checkout.abc123.js"), "checkout");
    await fs.writeFile(path.join(root, "dist/catalog.def456.js"), "catalog");

    const result = await analyzeBuild(
      {
        root,
        bundler: "webpack",
        mode: "ci",
        moduleFederationInstances: [
          instanceConfig("checkout", "remoteEntry.js"),
          instanceConfig("catalog", "remoteEntry.js"),
        ],
        artifactNames: {
          manifest: ["checkout-manifest.json", "catalog-manifest.json"],
          stats: ["checkout-stats.json", "catalog-stats.json"],
        },
        output: { formats: [] },
      },
      [
        "dist/checkout-manifest.json",
        "dist/catalog-manifest.json",
        "dist/checkout-stats.json",
        "dist/catalog-stats.json",
        "dist/checkout.abc123.js",
        "dist/catalog.def456.js",
      ],
      undefined,
      [
        {
          adapter: "webpack",
          bundler: "webpack",
          outputRoot: "dist",
          emittedAssets: [
            "checkout-manifest.json",
            "catalog-manifest.json",
            "checkout-stats.json",
            "catalog-stats.json",
            "checkout.abc123.js",
            "catalog.def456.js",
          ],
          federationInstanceIds: [],
          sourceHook: "afterEmit",
        },
      ],
    );

    const instances = result.facts.federationInstances!;
    const checkout = instances.find((item) => item.moduleFederation.name === "checkout")!;
    const catalog = instances.find((item) => item.moduleFederation.name === "catalog")!;
    expect(checkout.artifacts.stats?.data).toMatchObject({ instance: "checkout" });
    expect(catalog.artifacts.stats?.data).toMatchObject({ instance: "catalog" });
    expect(checkout.artifacts.emittedAssets).toEqual([
      "dist/checkout-manifest.json",
      "dist/checkout-stats.json",
      "dist/checkout.abc123.js",
    ]);
    expect(catalog.artifacts.emittedAssets).toEqual([
      "dist/catalog-manifest.json",
      "dist/catalog-stats.json",
      "dist/catalog.def456.js",
    ]);
    expect(checkout.builds).toEqual([]);
    expect(catalog.builds).toEqual([]);
  });

  it("honors adapter-provided build instance scopes", async () => {
    const root = await projectRoot("scoped-builds");
    const facts = await (async () => {
      const { resolveOptions } = await import("../../src/config.js");
      const { collectProjectFacts } = await import("../../src/collect.js");
      return collectProjectFacts(
        await resolveOptions({
          root,
          bundler: "vite",
          moduleFederationInstances: [
            instanceConfig("checkout", "checkout.js"),
            instanceConfig("catalog", "catalog.js"),
          ],
        }),
      );
    })();
    await addBuildFacts(facts, ["dist/checkout.js"], root, undefined, [
      {
        adapter: "vite",
        bundler: "vite",
        outputRoot: "dist",
        emittedAssets: ["checkout.js"],
        federationInstanceIds: [facts.federationInstances![0]!.id],
        sourceHook: "closeBundle",
      },
    ]);
    const checkout = facts.federationInstances![0]!;
    const catalog = facts.federationInstances![1]!;
    expect(checkout.builds).toHaveLength(1);
    expect(catalog.builds).toEqual([]);
    expect(catalog.capabilities.emittedAssets).toBe(false);
  });

  it("persists instance scopes without leaking canonical or in-memory records", async () => {
    const root = await projectRoot("persisted-instances");
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederationInstances: [
        instanceConfig("checkout", "checkoutEntry.js"),
        instanceConfig("catalog", "catalogEntry.js"),
      ],
      output: { formats: [] },
    });
    const output = path.join(root, "persisted");
    await writeReports(result.facts, result.report, output, []);
    const written = JSON.parse(await fs.readFile(path.join(output, "project.json"), "utf8")) as {
      canonicalConfig?: unknown;
      federationInstances?: Array<{
        canonicalConfig?: unknown;
        artifacts: { records?: unknown };
      }>;
      artifacts: { records?: unknown };
    };
    expect(written.canonicalConfig).toBeUndefined();
    expect(written.artifacts.records).toBeUndefined();
    expect(written.federationInstances?.every((item) => item.canonicalConfig === undefined)).toBe(
      true,
    );
    expect(written.federationInstances?.every((item) => item.artifacts.records === undefined)).toBe(
      true,
    );
    await validatePayload("project.schema.json", written, "multi-instance project output");
    const imported = projectFactsFromEvidence(migrateProjectFacts(written as ProjectFacts));
    expect(imported.federationInstances).toHaveLength(2);
  });

  it("keeps cross-app remote edges and UI graph nodes scoped to instances", () => {
    const host = scopedProject("host", [
      {
        ...instanceConfig("host-client", "clientEntry.js"),
        remotes: { checkout: { name: "checkout", entry: "http://checkout/remote.js" } },
      },
      {
        ...instanceConfig("host-ssr", "ssrEntry.js"),
        remotes: { catalog: { name: "catalog", entry: "http://catalog/remote.js" } },
      },
    ]);
    const checkout = scopedProject("checkout-app", [
      {
        ...instanceConfig("checkout", "checkoutEntry.js"),
        exposes: { "./Button": "./src/checkout.ts" },
      },
    ]);
    checkout.project.federationGroup = "checkout";
    const catalog = scopedProject("catalog-app", [
      {
        ...instanceConfig("catalog", "catalogEntry.js"),
        exposes: { "./Card": "./src/catalog.ts" },
      },
    ]);
    catalog.project.federationGroup = "checkout";

    const model = buildFederationModel([host, checkout, catalog]);
    expect(model.projects).toHaveLength(4);
    expect(model.remoteEdges.filter((edge) => edge.fromProject === "host")).toHaveLength(2);
    expect(model.remoteEdges.filter((edge) => edge.matched)).toHaveLength(2);
    expect(new Set(model.remoteEdges.map((edge) => edge.fromInstanceId)).size).toBe(2);

    const report = reportFromFindings([host, checkout, catalog], []);
    const ui = buildUiPayload([host, checkout, catalog], report);
    const hostProjects = ui.graphs.remotes.nodes.filter((node) => node.project === "host");
    expect(hostProjects).toHaveLength(2);
    expect(new Set(hostProjects.map((node) => node.id)).size).toBe(2);
    const hostProjectIds = new Set(hostProjects.map((node) => node.id));
    expect(ui.graphs.remotes.edges.filter((edge) => hostProjectIds.has(edge.source))).toHaveLength(
      2,
    );

    const scopedFinding: DoctorFinding = {
      schemaVersion: 1,
      ruleId: "shared/unused",
      severity: "error",
      project: "host",
      federationInstanceId: host.federationInstances![0]!.id,
      message: "Only one host instance is unhealthy.",
      evidence: { package: "react" },
      fingerprint: "scoped-host-finding",
    };
    const scopedUi = buildUiPayload(
      [host, checkout, catalog],
      reportFromFindings([host, checkout, catalog], [scopedFinding]),
    );
    const scopedHostNodes = scopedUi.graphs.remotes.nodes.filter((node) => node.project === "host");
    expect(scopedHostNodes.find((node) => node.meta?.federationInstanceId)?.severity).toBe("error");
    expect(
      scopedHostNodes.find((node) => !node.meta?.federationInstanceId)?.severity,
    ).toBeUndefined();
  });

  it("extracts public configs from webpack and Vite federation plugins", () => {
    const webpack = collectModuleFederationPluginInstances([
      { name: "ModuleFederationPlugin", options: instanceConfig("one", "one.js") },
      { name: "ModuleFederationPlugin", options: instanceConfig("two", "two.js") },
    ]);
    const vite = collectViteModuleFederationPluginInstances([
      { name: "module-federation", options: instanceConfig("vite", "vite.js") },
      { name: "module-federation-doctor", options: instanceConfig("ignored", "ignored.js") },
    ]);
    expect(webpack.map((item) => item.config.name)).toEqual(["one", "two"]);
    expect(vite.map((item) => item.config.name)).toEqual(["vite"]);
    expect(
      collectModuleFederationPluginInstances([
        { name: "ModuleFederationPlugin", _options: instanceConfig("enhanced", "enhanced.js") },
      ]),
    ).toMatchObject([{ config: { name: "enhanced" } }]);
  });

  it("keeps explicit Vite Doctor config ahead of resolved plugin defaults", () => {
    const explicit = instanceConfig("vite", "remoteEntry.js");
    const detected = [
      {
        config: { ...explicit, filename: "remoteEntry-[hash]" },
        pluginName: "module-federation",
      },
    ];
    expect(resolveViteFederationInstances(detected, explicit)).toEqual([
      { config: explicit, pluginName: "module-federation" },
    ]);
  });

  it("keeps throwing plugin accessors from breaking instance detection", () => {
    const opaque = Object.defineProperty({}, "name", {
      get() {
        throw new Error("plugin is not initialized");
      },
    });
    expect(collectModuleFederationPluginInstances([opaque])).toEqual([]);
    expect(collectViteModuleFederationPluginInstances([opaque])).toEqual([]);
  });

  it("preserves deterministic build ordering for Nuxt-style client and SSR outputs", async () => {
    const root = await projectRoot("nuxt-multi-instance");
    const facts = await (async () => {
      const { resolveOptions } = await import("../../src/config.js");
      const { collectProjectFacts } = await import("../../src/collect.js");
      return collectProjectFacts(
        await resolveOptions({
          root,
          bundler: "vite",
          moduleFederationInstances: [
            instanceConfig("client", "client.js"),
            instanceConfig("ssr", "ssr.js"),
          ],
        }),
      );
    })();
    await addBuildFacts(
      facts,
      [".nuxt/dist/client/client.js", ".nuxt/dist/server/ssr.js"],
      root,
      undefined,
      [
        {
          adapter: "vite",
          bundler: "vite",
          outputRoot: ".nuxt/dist/server",
          emittedAssets: ["ssr.js"],
          targetKind: "ssr",
          sourceHook: "closeBundle",
        },
        {
          adapter: "vite",
          bundler: "vite",
          outputRoot: ".nuxt/dist/client",
          emittedAssets: ["client.js"],
          targetKind: "web",
          sourceHook: "closeBundle",
        },
      ],
    );
    expect(facts.builds?.map((build) => build.outputRoot)).toEqual([
      ".nuxt/dist/client",
      ".nuxt/dist/server",
    ]);
    const [client, ssr] = facts.federationInstances!;
    expect(facts.builds?.map((build) => build.federationInstanceIds)).toEqual([
      [client!.id],
      [ssr!.id],
    ]);
    expect(client!.builds?.map((build) => build.outputRoot)).toEqual([".nuxt/dist/client"]);
    expect(ssr!.builds?.map((build) => build.outputRoot)).toEqual([".nuxt/dist/server"]);
  });
});
