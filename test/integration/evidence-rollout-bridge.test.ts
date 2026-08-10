import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze, analyzeBuild, analyzeFederation } from "../../src/engine.js";
import {
  evidenceRuleScopeFor,
  runMigratedEvidenceRules,
  runMigratedRuntimeEvidenceRules,
} from "../../src/evidence-rule-bridge.js";
import {
  runMigratedFederationRules,
  migratedFederationEvidenceRuleIds,
  projectMigratedFederationFailures,
} from "../../src/evidence-federation-bridge.js";
import {
  EVIDENCE_LEGACY_ENV,
  RELEASE_GATES,
  createEvidenceRolloutController,
} from "../../src/evidence-rollout.js";
import { defineRule } from "../../src/rules.js";
import { compareV1Outputs } from "../../src/evidence-parity.js";
import { DEFAULT_ANALYSIS_BUDGETS } from "../../src/analysis-budgets.js";
import {
  describeFederationInstances,
  federationInstanceRefs,
} from "../../src/federation-instance.js";
import { normalizeModuleFederation } from "../../src/normalize.js";
import type {
  FederationInstanceFacts,
  ModuleFederationConfigLike,
  ProjectFacts,
} from "../../src/types.js";
import {
  MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS,
  MIGRATED_GROUP1_CONFIG_RULE_IDS,
  MIGRATED_GROUP2_RULE_IDS,
  MIGRATED_GROUP3_RULE_IDS,
  MIGRATED_GROUP4_RULE_IDS,
  MIGRATED_GROUP5_RULE_IDS,
  MIGRATED_GROUP6_RULE_IDS,
} from "../../src/rule-inventory.js";

const roots: string[] = [];
const greenGates = Object.fromEntries(RELEASE_GATES.map((gate) => [gate, true]));

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(
  name = "rollout-bridge",
  files: Record<string, string> = { "src/index.ts": "export default 1;\n" },
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-rollout-"));
  roots.push(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name, dependencies: { vite: "6.1.0" } }),
  );
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

function shadowRollout() {
  return createEvidenceRolloutController({ scopes: { rules: "shadow" } });
}

function compatRollout() {
  return shadowRollout().promoteToCompat("rules", greenGates);
}

function options(root: string, evidenceRollout: ReturnType<typeof shadowRollout>) {
  return {
    root,
    bundler: "vite" as const,
    mode: "ci" as const,
    moduleFederation: {},
    evidenceRollout,
    output: { formats: [] as never[] },
  };
}

function bridgeReportIds(report: { findings: Array<{ ruleId: string }> }) {
  return report.findings
    .filter((finding) => finding.ruleId.startsWith("bridge/"))
    .map((finding) => finding.ruleId);
}

const EXPECTED_GROUP2_RULE_IDS = [
  "config/duplicate-plugin-registration",
  "artifact/public-path-non-string-manifest",
  "config/external-runtime-conflict",
  "performance/asset-budget",
  "artifact/manifest-assets-disabled",
  "artifact/manifest-disabled",
  "artifact/dts-disabled",
  "artifact/manifest-invalid",
  "artifact/manifest-name-mismatch",
  "artifact/manifest-remote-entry-missing",
  "artifact/manifest-expose-assets-empty",
  "artifact/manifest-shared-version-mismatch",
  "artifact/types-metadata-missing",
  "artifact/remote-entry-missing",
  "artifact/expose-missing",
  "artifact/public-path-suspicious",
  "artifact/types-missing",
] as const;

const EXPECTED_GROUP3_RULE_IDS = [
  "security/get-public-path-dynamic-code",
  "shared/version-unsatisfied",
  "config/plugin-package-mismatch",
  "shared/singleton-risk",
  "shared/eager-without-singleton",
  "shared/unused",
  "shared/candidate",
  "shared/react-host-missing",
  "shared/deep-import-bypass",
  "shared/prefix-share-recommended",
] as const;

const EXPECTED_GROUP4_RULE_IDS = [
  "federation/name-conflict",
  "federation/version-conflict",
  "federation/share-scope-mismatch",
  "federation/share-strategy-mismatch",
  "federation/circular-remote-graph",
  "federation/missing-provider",
  "federation/host-gaps",
  "federation/ghost-shares",
  "shared/singleton-mismatch",
  "federation/external-runtime-provider-missing",
] as const;

const EXPECTED_GROUP5_RULE_IDS = [
  "runtime/remote-load-failed",
  "runtime/init-failed",
  "runtime/shared-mismatch",
  "runtime/remote-unknown",
  "runtime/error-correlated",
] as const;

const EXPECTED_GROUP6_RULE_IDS = [
  "reliability/snapshot-capability-disabled",
  "reliability/external-runtime-provider-unverified",
  "reliability/async-startup-library-promise",
  "performance/version-first-startup",
  "reliability/version-first-offline-remotes",
  "reliability/shared-import-false",
  "reliability/tree-shaking-server-calc-contract",
  "performance/vite-bundle-all-css",
  "reliability/vite-fixed-parse-timeout",
  "vite/remotes-prefer-module",
  "vite/var-filename-interop",
  "vite/host-init-inject-ssr",
  "vite/ssr-nitro-externals",
  "vite/manual-chunks-conflict",
  "vite/hashed-remote-filename",
  "vite/remote-hmr-dev",
  "vite/alias-share-bypass",
  "vite/server-origin",
  "config/transform-import-share-conflict",
  "doctor/partial-analysis",
] as const;

const migratedRuleCount =
  MIGRATED_GROUP1_CONFIG_RULE_IDS.length +
  MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS.length +
  EXPECTED_GROUP2_RULE_IDS.length +
  EXPECTED_GROUP3_RULE_IDS.length +
  EXPECTED_GROUP6_RULE_IDS.length;

const migratedRuleIds = new Set([
  ...MIGRATED_GROUP1_CONFIG_RULE_IDS,
  ...MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS,
  ...EXPECTED_GROUP2_RULE_IDS,
  ...EXPECTED_GROUP3_RULE_IDS,
  ...EXPECTED_GROUP6_RULE_IDS,
]);

function federationShadowRollout() {
  return createEvidenceRolloutController({ scopes: { "federation-workspace": "shadow" } });
}

function federationCompatRollout() {
  return federationShadowRollout().promoteToCompat("federation-workspace", greenGates);
}

function federationProjectFacts(
  name: string,
  shared: Record<string, Record<string, unknown>>,
  packages: string[],
  overrides: Partial<ProjectFacts> = {},
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
      shared: shared as unknown as NonNullable<ProjectFacts["moduleFederation"]>["shared"],
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
      sourceScope: "project" as const,
      sourceReadFailures: [],
    },
    artifacts: { emittedAssets: [] },
    ...overrides,
  };
}

function multiInstanceHostProject(
  name: string,
  configs: Array<{ config: ModuleFederationConfigLike; pluginName?: string }>,
): ProjectFacts {
  const descriptors = describeFederationInstances(
    configs.map((item) => ({
      config: item.config,
      pluginName: item.pluginName ?? "ModuleFederationPlugin",
    })),
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
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: [],
      },
      artifacts: { emittedAssets: [] },
    } satisfies FederationInstanceFacts;
  });
  return {
    schemaVersion: 1,
    project: { name, root: "." },
    bundler: {
      name: "vite",
      mode: "ci",
      federationInstances: federationInstanceRefs(descriptors),
    },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: instances[0]!.moduleFederation,
    federationInstances: instances,
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: { emittedAssets: [] },
  };
}

const CONFIDENCE_RANK: Record<string, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  exact: 4,
};

const quietRules = {
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "config/plugin-package-mismatch": "off",
  "config/runtime-plugin-missing": "off",
  "doctor/partial-analysis": "off",
  "reliability/version-first-offline-remotes": "off",
  "shared/candidate": "off",
  "shared/deep-import-bypass": "off",
  "shared/eager-without-singleton": "off",
  "shared/prefix-share-recommended": "off",
  "shared/react-host-missing": "off",
  "shared/singleton-risk": "off",
  "shared/unused": "off",
  "shared/version-unsatisfied": "off",
} as const;

describe("evidence-aware rule rollout bridge", () => {
  it("keeps legacy output byte-compatible in shadow and v2-compat modes", async () => {
    const root = await fixture();
    const legacy = await analyze(options(root, createEvidenceRolloutController()));
    const shadow = await analyze(options(root, shadowRollout()));
    const compat = await analyze(options(root, compatRollout()));

    expect(compareV1Outputs(legacy.report, shadow.report).equal).toBe(true);
    const parity = compareV1Outputs(legacy.report, compat.report);
    expect(parity.equal).toBe(true);
    expect(shadow.evidence).toMatchObject({ rollout: { scope: "rules", mode: "shadow" } });
    expect(shadow.evidence?.evaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: { id: "config/name-required", version: "1" },
          outcome: "fail",
        }),
      ]),
    );
    expect(shadow.evidence?.parity?.equal).toBe(true);
    expect(
      compat.report.findings.filter((finding) => finding.ruleId === "config/name-required"),
    ).toHaveLength(1);
  });

  it("routes every Group 1 core-config rule through the bridge with V1 parity", async () => {
    const root = await fixture("group1-config-rollout-bridge");
    const base = {
      root,
      bundler: "webpack" as const,
      mode: "ci" as const,
      moduleFederation: {
        name: "",
        filename: "../remoteEntry.txt",
        exposes: { bad: "./src/missing" },
        remotes: { app: "remote" },
        shared: { react: { singleton: true } },
        shareScope: ["default"],
        getPublicPath: "not a function",
        implementation: "mystery-runtime",
        remoteType: "script",
        library: { type: "module" },
        dts: { enabled: true, generateTypes: { outputDir: "types" } },
        runtimePlugins: ["./missing-plugin.ts"],
        experiments: { provideExternalRuntime: true },
      },
      output: { formats: [] as never[] },
    };
    const legacy = await analyzeBuild(base, [], { moduleFederationPluginCount: 0 });
    const compat = await analyzeBuild({ ...base, evidenceRollout: compatRollout() }, [], {
      moduleFederationPluginCount: 0,
    });
    const evaluatedIds = new Set(
      compat.evidence?.evaluations.map((evaluation) => evaluation.rule.id),
    );
    expect(evaluatedIds).toEqual(migratedRuleIds);
    expect(
      new Set(
        [...evaluatedIds].filter((id) => MIGRATED_GROUP1_CONFIG_RULE_IDS.includes(id as never)),
      ),
    ).toEqual(new Set(MIGRATED_GROUP1_CONFIG_RULE_IDS));
    const parity = compareV1Outputs(legacy.report, compat.report);
    expect(parity.equal).toBe(true);
  });

  it("routes the exact Group 2 migration tuple through the bridge", async () => {
    const root = await fixture("group2-migration-rollout-bridge");
    const compat = await analyze(options(root, compatRollout()));

    expect(MIGRATED_GROUP2_RULE_IDS).toEqual(EXPECTED_GROUP2_RULE_IDS);
    expect(new Set(compat.evidence?.evaluations.map((evaluation) => evaluation.rule.id))).toEqual(
      migratedRuleIds,
    );
    expect(compat.evidence?.evaluations).toHaveLength(migratedRuleCount);
  });

  it("routes the exact Group 3 migration tuple through the bridge", async () => {
    const root = await fixture("group3-migration-rollout-bridge");
    const compat = await analyze(options(root, compatRollout()));

    expect(MIGRATED_GROUP3_RULE_IDS).toEqual(EXPECTED_GROUP3_RULE_IDS);
    expect(new Set(compat.evidence?.evaluations.map((evaluation) => evaluation.rule.id))).toEqual(
      migratedRuleIds,
    );
    expect(compat.evidence?.evaluations).toHaveLength(migratedRuleCount);
  });

  it("routes the exact Group 4 federation tuple through the federation-workspace bridge", async () => {
    expect(MIGRATED_GROUP4_RULE_IDS).toEqual(EXPECTED_GROUP4_RULE_IDS);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-group4-rollout-"));
    roots.push(root);
    const host = federationProjectFacts("host", { react: { singleton: true } }, [
      "react",
      "lodash",
    ]);
    const remote = federationProjectFacts("remote", {}, ["react", "lodash"]);
    host.moduleFederation!.name = "shop";
    remote.moduleFederation!.name = "catalog";
    host.moduleFederation!.shareStrategy = "version-first";
    remote.moduleFederation!.shareStrategy = "loaded-first";
    const files = [path.join(root, "host.json"), path.join(root, "remote.json")];
    await fs.writeFile(files[0]!, JSON.stringify(host));
    await fs.writeFile(files[1]!, JSON.stringify(remote));
    const compat = await analyzeFederation(files, { evidenceRollout: federationCompatRollout() });
    const evaluatedRuleIds = new Set(
      compat.evidence?.evaluations.map((evaluation) => evaluation.rule.id),
    );
    const rulesRequiringRemoteSubjects = new Set(["federation/circular-remote-graph"]);
    for (const ruleId of EXPECTED_GROUP4_RULE_IDS) {
      if (rulesRequiringRemoteSubjects.has(ruleId)) continue;
      expect(evaluatedRuleIds.has(ruleId), `missing evaluation for ${ruleId}`).toBe(true);
    }
    expect(compat.evidence?.evaluations.length).toBeGreaterThanOrEqual(
      EXPECTED_GROUP4_RULE_IDS.length - rulesRequiringRemoteSubjects.size,
    );
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "federation/share-strategy-mismatch",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      compat.evidence?.evaluations.some(
        (evaluation) => evaluation.rule.id === "shared/singleton-mismatch",
      ),
    ).toBe(true);
    expect(compat.evidence).toMatchObject({
      rollout: { scope: "federation-workspace", mode: "v2-compat" },
    });
    const migrated = await runMigratedFederationRules(
      {
        projects: [host, remote],
        groupKey: "\0ungrouped",
        groupEvidenceIncomplete: false,
        alwaysShared: new Set(),
      },
      {},
    );
    expect(
      migrated.output.evaluations.some((evaluation) => {
        if (evaluation.rule.id !== "shared/singleton-mismatch") return false;
        const subject = migrated.graph.subjects.find((item) => item.id === evaluation.subject);
        return subject?.kind === "shared-package";
      }),
    ).toBe(true);
  });

  it("keeps shared-package topology rules unknown when a federation sibling has incomplete analysis", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-group4-incomplete-mf-sibling-"));
    roots.push(root);
    const host = federationProjectFacts("host", { react: { singleton: true } }, ["react"]);
    const incomplete = federationProjectFacts("incomplete", { react: { singleton: false } }, [
      "react",
    ]);
    incomplete.analysis = {
      status: "partial",
      limits: DEFAULT_ANALYSIS_BUDGETS,
      usage: {
        files: 0,
        sourceBytes: 0,
        artifacts: 0,
        evidenceNodes: 0,
        serializedBytes: 0,
      },
      exceeded: [{ kind: "files", limit: 1 }],
    };
    const files = [path.join(root, "host.json"), path.join(root, "incomplete.json")];
    await fs.writeFile(files[0]!, JSON.stringify(host));
    await fs.writeFile(files[1]!, JSON.stringify(incomplete));
    const migrated = await runMigratedFederationRules(
      {
        projects: [host, incomplete],
        groupKey: "\0ungrouped",
        groupEvidenceIncomplete: false,
        alwaysShared: new Set(),
      },
      {},
    );
    const sharedPackageGraphAssertions = migrated.graph.assertions.filter(
      (assertion) =>
        assertion.predicate === "federation.graph" &&
        migrated.graph.subjects.find((subject) => subject.id === assertion.subject)?.kind ===
          "shared-package",
    );
    expect(
      sharedPackageGraphAssertions.some(
        (assertion) => assertion.completeness.status !== "complete",
      ),
    ).toBe(true);
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "federation/version-conflict",
      ),
    ).toMatchObject({ outcome: "unknown" });
  });

  it("keeps federation workspace output byte-compatible in shadow mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-group4-shadow-rollout-"));
    roots.push(root);
    const host = federationProjectFacts("host", { react: { singleton: true } }, ["react"]);
    const remote = federationProjectFacts("remote", { react: { singleton: false } }, ["react"]);
    host.moduleFederation!.name = "shop";
    remote.moduleFederation!.name = "catalog";
    host.moduleFederation!.shareStrategy = "version-first";
    remote.moduleFederation!.shareStrategy = "loaded-first";
    const files = [path.join(root, "host.json"), path.join(root, "remote.json")];
    await fs.writeFile(files[0]!, JSON.stringify(host));
    await fs.writeFile(files[1]!, JSON.stringify(remote));
    const legacy = await analyzeFederation(files);
    const shadow = await analyzeFederation(files, { evidenceRollout: federationShadowRollout() });
    expect(compareV1Outputs(legacy.report, shadow.report).equal).toBe(true);
    expect(shadow.evidence?.parity?.equal).toBe(true);
    expect(
      shadow.evidence?.evaluations.some(
        (evaluation) => evaluation.rule.id === "federation/share-strategy-mismatch",
      ),
    ).toBe(true);
  });

  it("reports version-first remote-cycle failures on remote subjects with edge-scoped evaluations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-group4-circular-remote-"));
    roots.push(root);
    const first = federationProjectFacts("first", {}, []);
    const second = federationProjectFacts("second", {}, []);
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

    const legacy = await analyzeFederation(files);
    const shadow = await analyzeFederation(files, { evidenceRollout: federationShadowRollout() });
    expect(compareV1Outputs(legacy.report, shadow.report).equal).toBe(true);
    expect(shadow.evidence?.parity?.equal).toBe(true);

    const cycleFailEvals = shadow.evidence?.evaluations.filter(
      (evaluation) =>
        evaluation.rule.id === "federation/circular-remote-graph" && evaluation.outcome === "fail",
    );
    expect(cycleFailEvals).toHaveLength(2);
    const migrated = await runMigratedFederationRules(
      {
        projects: [first, second],
        groupKey: "\0ungrouped",
        groupEvidenceIncomplete: false,
        alwaysShared: new Set(),
      },
      {},
    );
    const migratedFailEvals = migrated.output.evaluations.filter(
      (evaluation) =>
        evaluation.rule.id === "federation/circular-remote-graph" && evaluation.outcome === "fail",
    );
    expect(migratedFailEvals).toHaveLength(2);
    for (const evaluation of migratedFailEvals) {
      expect(evaluation.scope.edgeId).toBeTruthy();
      const subject = migrated.graph.subjects.find((item) => item.id === evaluation.subject);
      expect(subject?.kind).toBe("remote");
    }
    for (const evaluation of cycleFailEvals ?? []) {
      expect(evaluation.scope.edgeId).toBeTruthy();
    }
    expect(
      legacy.report.findings.filter(
        (finding) => finding.ruleId === "federation/circular-remote-graph",
      ),
    ).toHaveLength(1);
    expect(
      projectMigratedFederationFailures(migrated.output.evaluations, {}, root).filter(
        (finding) => finding.ruleId === "federation/circular-remote-graph",
      ),
    ).toHaveLength(1);
  });

  it("matches circular-remote findings only to the federation instance in the cycle", async () => {
    const host = multiInstanceHostProject("host", [
      {
        config: {
          name: "app_a",
          filename: "clientEntry.js",
          exposes: {},
          remotes: {
            b: {
              name: "app_b",
              entry: "https://example.test/b/remoteEntry.js",
              shareScope: ["default"],
            },
          },
          shared: {},
          shareStrategy: "version-first",
        },
      },
      {
        config: {
          name: "app_a_ssr",
          filename: "ssrEntry.js",
          exposes: {},
          remotes: {
            b: {
              name: "app_b",
              entry: "https://example.test/b/remoteEntry.js",
              shareScope: ["default"],
            },
          },
          shared: {},
          shareStrategy: "loaded-first",
        },
      },
    ]);
    const second = federationProjectFacts("second", {}, []);
    second.moduleFederation!.name = "app_b";
    second.moduleFederation!.shareStrategy = "loaded-first";
    second.moduleFederation!.remotes = {
      a: { name: "app_a", entry: "https://example.test/a/remoteEntry.js", shareScope: ["default"] },
    };
    const cycleClientId = host.federationInstances![0]!.id;
    const ssrId = host.federationInstances![1]!.id;
    const migrated = await runMigratedFederationRules(
      {
        projects: [host, second],
        groupKey: "\0ungrouped",
        groupEvidenceIncomplete: false,
        alwaysShared: new Set(),
      },
      {},
    );
    const evaluationForInstance = (instanceId: string | undefined) => {
      const remoteSubject = migrated.graph.subjects.find(
        (subject) =>
          subject.kind === "remote" &&
          (subject.attributes?.federationInstanceId ?? undefined) === instanceId,
      );
      return migrated.output.evaluations.find(
        (evaluation) =>
          evaluation.rule.id === "federation/circular-remote-graph" &&
          evaluation.subject === remoteSubject?.id,
      );
    };
    expect(evaluationForInstance(cycleClientId)).toMatchObject({ outcome: "fail" });
    expect(evaluationForInstance(ssrId)).toMatchObject({ outcome: "pass" });
    const secondRemoteSubject = migrated.graph.subjects.find(
      (subject) => subject.kind === "remote" && subject.attributes?.fromProject === "second",
    );
    expect(
      migrated.output.evaluations.find(
        (evaluation) =>
          evaluation.rule.id === "federation/circular-remote-graph" &&
          evaluation.subject === secondRemoteSubject?.id,
      ),
    ).toMatchObject({ outcome: "fail" });
  });

  it("keeps absence-sensitive Group 4 rules unknown when one sibling has partial source evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-group4-partial-source-"));
    roots.push(root);
    const complete = federationProjectFacts("complete", {}, ["lodash"]);
    const partial = federationProjectFacts("partial", {}, ["lodash"], {
      imports: {
        sourceFiles: [],
        specifiers: ["lodash"],
        packages: ["lodash"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
        sourceScope: "partial" as const,
        sourceReadFailures: [],
      },
    });
    const files = [path.join(root, "complete.json"), path.join(root, "partial.json")];
    await fs.writeFile(files[0]!, JSON.stringify(complete));
    await fs.writeFile(files[1]!, JSON.stringify(partial));
    const legacy = await analyzeFederation(files);
    const compat = await analyzeFederation(files, { evidenceRollout: federationCompatRollout() });
    expect(
      legacy.report.findings.some((finding) => finding.ruleId === "federation/host-gaps"),
    ).toBe(false);
    expect(
      compat.report.findings.some((finding) => finding.ruleId === "federation/host-gaps"),
    ).toBe(false);
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "federation/host-gaps",
      ),
    ).toMatchObject({ outcome: "unknown" });
    const migrated = await runMigratedFederationRules(
      {
        projects: [complete, partial],
        groupKey: "\0ungrouped",
        groupEvidenceIncomplete: true,
        alwaysShared: new Set(),
      },
      { "federation/host-gaps": "warning" },
    );
    const sourceAssertions = migrated.graph.assertions.filter(
      (assertion) => assertion.predicate === "imports.sourceScan",
    );
    expect(sourceAssertions.some((assertion) => assertion.completeness.status === "partial")).toBe(
      true,
    );
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "federation/host-gaps",
      ),
    ).toMatchObject({ outcome: "unknown" });
    expect(migratedFederationEvidenceRuleIds.has("federation/host-gaps")).toBe(true);
  });

  it("projects ghost-shares and missing-provider failures in v2-compat with complete evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-group4-absence-complete-"));
    roots.push(root);
    const ghostHost = federationProjectFacts(
      "ghost-host",
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
    const ghostRemote = federationProjectFacts("ghost-remote", {}, []);
    const missingHost = federationProjectFacts("missing-host", {}, ["react"]);
    const missingRemote = federationProjectFacts(
      "missing-remote",
      {
        react: {
          package: "react",
          import: false,
          singleton: true,
          eager: false,
          shareScope: ["default"],
        },
      },
      ["react"],
    );
    const ghostFiles = [path.join(root, "ghost-host.json"), path.join(root, "ghost-remote.json")];
    const missingFiles = [
      path.join(root, "missing-host.json"),
      path.join(root, "missing-remote.json"),
    ];
    await fs.writeFile(ghostFiles[0]!, JSON.stringify(ghostHost));
    await fs.writeFile(ghostFiles[1]!, JSON.stringify(ghostRemote));
    await fs.writeFile(missingFiles[0]!, JSON.stringify(missingHost));
    await fs.writeFile(missingFiles[1]!, JSON.stringify(missingRemote));

    for (const [files, ruleId] of [
      [ghostFiles, "federation/ghost-shares"],
      [missingFiles, "federation/missing-provider"],
    ] as const) {
      const legacy = await analyzeFederation(files);
      const compat = await analyzeFederation(files, { evidenceRollout: federationCompatRollout() });
      expect(legacy.report.findings.some((finding) => finding.ruleId === ruleId)).toBe(true);
      expect(compat.report.findings.some((finding) => finding.ruleId === ruleId)).toBe(true);
      expect(
        compat.evidence?.evaluations.find((evaluation) => evaluation.rule.id === ruleId),
      ).toMatchObject({ outcome: "fail", completeness: "complete" });
    }
  });

  it("keeps absence-sensitive Group 4 rules unknown when workspace diagnostics mark evidence incomplete", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "mfdoctor-group4-diagnostics-incomplete-"),
    );
    roots.push(root);
    const host = federationProjectFacts(
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
    const remote = federationProjectFacts("remote", {}, []);
    const files = [path.join(root, "host.json"), path.join(root, "remote.json")];
    await fs.writeFile(files[0]!, JSON.stringify(host));
    await fs.writeFile(files[1]!, JSON.stringify(remote));
    const legacy = await analyzeFederation(files, {
      workspaceDiagnostics: [
        {
          kind: "invalid",
          files: [files[0]!],
          message: "Invalid project facts: host.json",
        },
      ],
    });
    const compat = await analyzeFederation(files, {
      evidenceRollout: federationCompatRollout(),
      workspaceDiagnostics: [
        {
          kind: "invalid",
          files: [files[0]!],
          message: "Invalid project facts: host.json",
        },
      ],
    });
    expect(
      legacy.report.findings.some((finding) => finding.ruleId === "federation/ghost-shares"),
    ).toBe(false);
    expect(
      compat.report.findings.some((finding) => finding.ruleId === "federation/ghost-shares"),
    ).toBe(false);
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "federation/ghost-shares",
      ),
    ).toMatchObject({ outcome: "unknown" });
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "federation/missing-provider",
      ),
    ).toMatchObject({ outcome: "unknown" });
  });

  it("keeps mixed federation and non-federation siblings in parity between legacy and v2-compat", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-group4-mixed-siblings-"));
    roots.push(root);
    const host = federationProjectFacts(
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
    const remote = federationProjectFacts("remote", {}, []);
    const library = federationProjectFacts("shared-lib", {}, []);
    delete library.moduleFederation;
    const files = [
      path.join(root, "host.json"),
      path.join(root, "remote.json"),
      path.join(root, "shared-lib.json"),
    ];
    await fs.writeFile(files[0]!, JSON.stringify(host));
    await fs.writeFile(files[1]!, JSON.stringify(remote));
    await fs.writeFile(files[2]!, JSON.stringify(library));
    const legacy = await analyzeFederation(files);
    const compat = await analyzeFederation(files, { evidenceRollout: federationCompatRollout() });
    expect(compareV1Outputs(legacy.report, compat.report).equal).toBe(true);
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "federation/ghost-shares",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
  });

  it("routes the exact Group 5 migration tuple only when runtime traces are attached", async () => {
    expect(MIGRATED_GROUP5_RULE_IDS).toEqual(EXPECTED_GROUP5_RULE_IDS);
    const root = await fixture("group5-migration-rollout-bridge");
    const baseline = await analyze(options(root, compatRollout()));
    expect(
      baseline.evidence?.evaluations.some((evaluation) =>
        MIGRATED_GROUP5_RULE_IDS.includes(evaluation.rule.id as never),
      ),
    ).toBe(false);

    const tracePath = path.resolve("fixtures/runtime-traces/remote-load-failed.json");
    const hostFacts = {
      schemaVersion: 1 as const,
      project: { name: "host", root },
      bundler: { name: "vite" as const, mode: "production" as const },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: true,
        stats: false,
        emittedAssets: true,
        installedVersions: true,
      },
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          checkout: {
            name: "checkout",
            entry: "https://cdn.example.com/checkout/mf-manifest.json",
            shareScope: "default",
          },
        },
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
        evidenceSources: ["source"] as const,
      },
      artifacts: {
        emittedAssets: [],
        manifest: {
          path: "mf-manifest.json",
          valid: true,
          id: "host",
          name: "host",
          exposes: [],
          shared: [],
        },
      },
    } satisfies ProjectFacts;
    const checkoutFacts = {
      ...hostFacts,
      project: { name: "checkout", root },
      moduleFederation: {
        name: "checkout",
        exposes: {},
        remotes: {},
        shared: {},
      },
      artifacts: { emittedAssets: [] },
    } satisfies ProjectFacts;
    const traces = await import("../../src/runtime-trace.js").then((module) =>
      module.loadRuntimeTraceFile(tracePath),
    );
    const run = await runMigratedRuntimeEvidenceRules(
      hostFacts,
      [hostFacts, checkoutFacts],
      traces,
      {
        "runtime/remote-load-failed": "error",
        "runtime/error-correlated": "error",
      },
    );
    expect(new Set(run.output.evaluations.map((evaluation) => evaluation.rule.id))).toEqual(
      new Set(EXPECTED_GROUP5_RULE_IDS),
    );
    expect(
      run.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "runtime/remote-load-failed",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    const projected = await import("../../src/evidence-rule-bridge.js").then((module) =>
      module.projectMigratedFailures(
        run.output.evaluations,
        hostFacts,
        {
          "runtime/remote-load-failed": "error",
          "runtime/error-correlated": "error",
        },
        root,
        run.graph.subjects,
      ),
    );
    expect(projected.some((finding) => finding.ruleId === "runtime/remote-load-failed")).toBe(true);
    expect(projected.every((finding) => finding.project !== "runtime")).toBe(true);
    expect(
      projected.find((finding) => finding.ruleId === "runtime/remote-load-failed")?.project,
    ).toBe("checkout");
  });

  it("keeps weak runtime attribution unknown in the evidence bridge", async () => {
    const root = await fixture("group5-weak-attribution-rollout-bridge");
    const hostFacts = {
      schemaVersion: 1 as const,
      project: { name: "host", root },
      bundler: { name: "vite" as const, mode: "production" as const },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: true,
        stats: false,
        emittedAssets: true,
        installedVersions: true,
      },
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          checkout: {
            name: "checkout",
            alias: "checkout",
            entry: "https://cdn.example/checkout.js",
            shareScope: "default",
          },
        },
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
        evidenceSources: ["source"] as const,
      },
      artifacts: { emittedAssets: [] },
    } satisfies ProjectFacts;
    const traces = await import("../../src/runtime-trace.js").then((module) =>
      module.parseRuntimeTraces({
        requestAlias: "checkout",
        summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
      }),
    );
    const run = await runMigratedRuntimeEvidenceRules(hostFacts, [hostFacts], traces, {
      "runtime/remote-load-failed": "error",
    });
    expect(run.graph.subjects.some((subject) => subject.kind === "runtime-instance")).toBe(true);
    expect(
      run.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "runtime/remote-load-failed",
      ),
    ).toMatchObject({ outcome: "unknown" });
    expect(
      run.graph.assertions.some(
        (assertion) =>
          assertion.predicate === "runtime.trace" &&
          assertion.layer === "runtime" &&
          assertion.confidence.level === "low",
      ),
    ).toBe(true);
  });

  it("routes the exact Group 6 migration tuple through the bridge", async () => {
    expect(MIGRATED_GROUP6_RULE_IDS).toEqual(EXPECTED_GROUP6_RULE_IDS);
    const root = await fixture("group6-migration-rollout-bridge");
    const compat = await analyze(options(root, compatRollout()));
    expect(new Set(compat.evidence?.evaluations.map((evaluation) => evaluation.rule.id))).toEqual(
      migratedRuleIds,
    );
    expect(compat.evidence?.evaluations).toHaveLength(migratedRuleCount);
  });

  it("keeps Group 6 legacy output byte-compatible in shadow and v2-compat modes", async () => {
    const root = await fixture("group6-parity-rollout-bridge");
    const analyzeOptions = {
      ...options(root, createEvidenceRolloutController()),
      moduleFederation: {
        name: "host",
        manifest: true,
        experiments: {
          asyncStartup: false,
          externalRuntime: true,
          provideExternalRuntime: false,
        },
        remotes: { shop: "shop@https://example.test/mf-manifest.json" },
        shared: { react: { singleton: true } },
      },
      rules: quietRules,
    };
    const legacy = await analyze(analyzeOptions);
    const shadow = await analyze({ ...analyzeOptions, evidenceRollout: shadowRollout() });
    const compat = await analyze({ ...analyzeOptions, evidenceRollout: compatRollout() });
    expect(compareV1Outputs(legacy.report, shadow.report).equal).toBe(true);
    expect(compareV1Outputs(legacy.report, compat.report).equal).toBe(true);
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "reliability/external-runtime-provider-unverified",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
  });

  it("ledgers Group 6 Vite plugin facts as unknown when absent", async () => {
    const root = await fixture("group6-vite-config-unknown-rollout-bridge");
    const result = await analyze(options(root, shadowRollout()));
    const migrated = await runMigratedEvidenceRules(result.facts, {});
    for (const id of [
      "vite/manual-chunks-conflict",
      "vite/alias-share-bypass",
      "vite/server-origin",
    ] as const) {
      expect(
        migrated.output.evaluations.find((evaluation) => evaluation.rule.id === id),
      ).toMatchObject({
        outcome: "unknown",
        reasonCode: "evidence-inconclusive",
      });
    }
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/transform-import-share-conflict",
      ),
    ).toMatchObject({
      outcome: "unknown",
      reasonCode: "evidence-inconclusive",
    });
  });

  it("evaluates SSR Vite rules from CLI facts without adapter builds", async () => {
    const root = await fixture("group6-ssr-cli-no-builds-rollout-bridge");
    const baseline = await analyze(options(root, shadowRollout()));
    const facts = structuredClone(baseline.facts);
    delete facts.builds;
    facts.moduleFederation = {
      name: "host",
      exposes: {},
      remotes: {
        catalog: {
          name: "catalog",
          entry: "https://example.test/mf-manifest.json",
          shareScope: "default",
        },
      },
      shared: {},
      vite: {
        bundleAllCSS: false,
        ignoreOrigin: false,
        ssrExternals: [],
        target: "node",
        hostInitInjectLocation: "html",
      },
    };
    const migrated = await runMigratedEvidenceRules(facts, {
      "vite/host-init-inject-ssr": "error",
      "vite/ssr-nitro-externals": "warning",
    });
    expect(facts.builds).toBeUndefined();
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/host-init-inject-ssr",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/host-init-inject-ssr",
      )?.reasonCode,
    ).not.toBe("prerequisite-missing");

    const nitroFacts = structuredClone(facts);
    nitroFacts.dependencies.declared.nitropack = "^2";
    nitroFacts.moduleFederation = {
      ...nitroFacts.moduleFederation!,
      shared: {
        react: { package: "react", singleton: true, eager: false, shareScope: ["default"] },
      },
      vite: {
        ...nitroFacts.moduleFederation!.vite!,
        ssrExternals: ["react"],
      },
    };
    const nitroRun = await runMigratedEvidenceRules(nitroFacts, {
      "vite/ssr-nitro-externals": "warning",
    });
    expect(
      nitroRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/ssr-nitro-externals",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      nitroRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/ssr-nitro-externals",
      )?.reasonCode,
    ).not.toBe("prerequisite-missing");
  });

  it("marks vite dialect rules not-applicable on non-Vite bundlers", async () => {
    const root = await fixture("group6-rspack-na-rollout-bridge");
    const result = await analyze({
      ...options(root, shadowRollout()),
      bundler: "rspack",
      moduleFederation: {
        name: "host",
        remotes: { shop: "shop@https://example.test/remoteEntry.js" },
        shared: { react: { singleton: true } },
      },
    });
    const migrated = await runMigratedEvidenceRules(result.facts, {});
    for (const id of [
      "vite/remotes-prefer-module",
      "vite/var-filename-interop",
      "performance/vite-bundle-all-css",
    ] as const) {
      expect(
        migrated.output.evaluations.find((evaluation) => evaluation.rule.id === id),
      ).toMatchObject({ outcome: "not-applicable", reasonCode: "not-applicable" });
    }
  });

  it("uses build effectiveMode only for vite/remote-hmr-dev", async () => {
    const root = await fixture("group6-build-mode-rollout-bridge");
    const facts = {
      schemaVersion: 1 as const,
      project: { name: "group6-build-mode-rollout-bridge", root },
      bundler: { name: "vite" as const, mode: "ci" as const },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
            shareScope: "default",
          },
        },
        shared: {},
        shareStrategy: "version-first" as const,
        vite: { bundleAllCSS: false, ignoreOrigin: false, ssrExternals: [], remoteHmr: false },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"] as const,
      },
      artifacts: { emittedAssets: [] },
    } satisfies ProjectFacts;
    const withoutBuild = await runMigratedEvidenceRules(facts, {
      "vite/remote-hmr-dev": "info",
      "config/remote-localhost-in-production": "warning",
    });
    expect(
      withoutBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/remote-hmr-dev",
      ),
    ).toMatchObject({ outcome: "pass" });
    expect(
      withoutBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/remote-localhost-in-production",
      ),
    ).toMatchObject({ outcome: "fail" });

    const build = {
      id: "vite-build-1",
      adapter: "vite" as const,
      bundler: "vite" as const,
      outputRoot: "dist",
      sourceHook: "writeBundle" as const,
      emittedAssets: [],
      effectiveMode: "development",
      artifacts: [],
      capabilities: {
        outputRoot: { state: "exact" as const, reason: "test" },
        emittedAssets: { state: "exact" as const, reason: "test" },
        artifacts: { state: "unavailable" as const, reason: "test" },
        effectiveMode: { state: "exact" as const, reason: "test" },
        target: { state: "exact" as const, reason: "test" },
      },
    };
    const withBuild = await runMigratedEvidenceRules(
      facts,
      {
        "vite/remote-hmr-dev": "info",
        "config/remote-localhost-in-production": "warning",
        "reliability/version-first-offline-remotes": ["warning", { localDemoOnly: true }],
      },
      undefined,
      build,
    );
    expect(
      withBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/remote-hmr-dev",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      withBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/remote-hmr-dev",
      )?.scope,
    ).toMatchObject({ buildMode: "development" });
    expect(
      withBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/remote-localhost-in-production",
      ),
    ).toMatchObject({ outcome: "fail" });
    expect(
      withBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "reliability/version-first-offline-remotes",
      ),
    ).toMatchObject({ outcome: "fail" });
  });

  it("keeps shadow and v2-compat parity for adapter builds with effectiveMode", async () => {
    const root = await fixture("group6-effective-mode-parity-rollout-bridge");
    const base = {
      root,
      bundler: "vite" as const,
      mode: "ci" as const,
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          shop: {
            name: "shop",
            entry: "shop@http://localhost:4174/remoteEntry.js",
            shareScope: "default",
          },
        },
        shared: {},
        shareStrategy: "version-first" as const,
        remoteHmr: false,
        vite: { bundleAllCSS: false, ignoreOrigin: false, ssrExternals: [] },
      },
      output: { formats: [] as never[] },
      rules: {
        ...quietRules,
        "artifact/manifest-disabled": "off" as const,
        "config/remote-manifest-recommended": "off" as const,
        "vite/remotes-prefer-module": "off" as const,
        "config/remote-localhost-in-production": "warning" as const,
        "reliability/version-first-offline-remotes": ["warning", { localDemoOnly: true }] as const,
        "vite/remote-hmr-dev": "info" as const,
      },
    };
    const buildOutputs = [
      {
        adapter: "vite" as const,
        bundler: "vite" as const,
        outputRoot: "dist",
        emittedAssets: [],
        effectiveMode: "development" as const,
        sourceHook: "writeBundle" as const,
      },
    ];
    const legacy = await analyzeBuild(base, [], undefined, buildOutputs);
    const shadow = await analyzeBuild(
      { ...base, evidenceRollout: shadowRollout() },
      [],
      undefined,
      buildOutputs,
    );
    const compat = await analyzeBuild(
      { ...base, evidenceRollout: compatRollout() },
      [],
      undefined,
      buildOutputs,
    );

    expect(compareV1Outputs(legacy.report, shadow.report).equal).toBe(true);
    expect(compareV1Outputs(legacy.report, compat.report).equal).toBe(true);
    expect(shadow.evidence?.parity?.equal).toBe(true);
    for (const ruleId of [
      "config/remote-localhost-in-production",
      "reliability/version-first-offline-remotes",
      "vite/remote-hmr-dev",
    ] as const) {
      expect(
        legacy.report.findings.some((finding) => finding.ruleId === ruleId),
        ruleId,
      ).toBe(true);
    }
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/remote-hmr-dev",
      ),
    ).toMatchObject({ outcome: "fail", scope: { buildMode: "development" } });
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/remote-localhost-in-production",
      ),
    ).toMatchObject({ outcome: "fail" });
  });

  it("keeps parity when multi-build projects skip remote-hmr effectiveMode shortcut", async () => {
    const root = await fixture("group6-multi-build-effective-mode-parity");
    const base = {
      root,
      bundler: "vite" as const,
      mode: "ci" as const,
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          shop: {
            name: "shop",
            entry: "shop@http://localhost:4174/remoteEntry.js",
            shareScope: "default",
          },
        },
        shared: {},
        shareStrategy: "version-first" as const,
        remoteHmr: false,
        vite: { bundleAllCSS: false, ignoreOrigin: false, ssrExternals: [] },
      },
      output: { formats: [] as never[] },
      rules: {
        ...quietRules,
        "artifact/manifest-disabled": "off" as const,
        "config/remote-manifest-recommended": "off" as const,
        "vite/remotes-prefer-module": "off" as const,
        "config/remote-localhost-in-production": "warning" as const,
        "reliability/version-first-offline-remotes": ["warning", { localDemoOnly: true }] as const,
        "vite/remote-hmr-dev": "info" as const,
      },
    };
    const buildOutputs = [
      {
        adapter: "vite" as const,
        bundler: "vite" as const,
        outputRoot: "dist/client",
        emittedAssets: [],
        effectiveMode: "development" as const,
        sourceHook: "writeBundle" as const,
      },
      {
        adapter: "vite" as const,
        bundler: "vite" as const,
        outputRoot: "dist/server",
        emittedAssets: [],
        effectiveMode: "production" as const,
        sourceHook: "writeBundle" as const,
      },
    ];
    const legacy = await analyzeBuild(base, [], undefined, buildOutputs);
    const shadow = await analyzeBuild(
      { ...base, evidenceRollout: shadowRollout() },
      [],
      undefined,
      buildOutputs,
    );
    const compat = await analyzeBuild(
      { ...base, evidenceRollout: compatRollout() },
      [],
      undefined,
      buildOutputs,
    );

    expect(compareV1Outputs(legacy.report, shadow.report).equal).toBe(true);
    expect(compareV1Outputs(legacy.report, compat.report).equal).toBe(true);
    expect(shadow.evidence?.parity?.equal).toBe(true);
    expect(legacy.report.findings.some((finding) => finding.ruleId === "vite/remote-hmr-dev")).toBe(
      false,
    );
    expect(
      compat.evidence?.evaluations.some(
        (evaluation) =>
          evaluation.rule.id === "vite/remote-hmr-dev" && evaluation.outcome === "fail",
      ),
    ).toBe(false);
  });

  it("projects doctor/partial-analysis while keeping per-rule unknowns separate", async () => {
    const root = await fixture("group6-partial-analysis-rollout-bridge");
    const result = await analyze({
      ...options(root, compatRollout()),
      rules: {
        ...quietRules,
        "doctor/partial-analysis": "warning",
        "vite/server-origin": "info",
      },
      moduleFederation: {
        name: "host",
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
            shareScope: "default",
          },
        },
        shared: {},
      },
    });
    expect(
      result.report.findings.some((finding) => finding.ruleId === "doctor/partial-analysis"),
    ).toBe(true);
    expect(
      result.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "doctor/partial-analysis",
      ),
    ).toMatchObject({ outcome: "fail", confidence: "unknown" });
    expect(
      result.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/server-origin",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "evidence-inconclusive" });
    expect(result.report.findings.some((finding) => finding.ruleId === "vite/server-origin")).toBe(
      false,
    );
  });

  it("keeps doctor/partial-analysis in CLI parity when moduleFederation is absent", async () => {
    const root = await fixture("group6-partial-analysis-cli-no-mf-rollout-bridge");
    const analyzeOptions = {
      root,
      bundler: "vite" as const,
      mode: "ci" as const,
      output: { formats: [] as never[] },
      rules: {
        ...quietRules,
        "doctor/partial-analysis": "warning" as const,
      },
    };
    const legacy = await analyze(analyzeOptions);
    const shadow = await analyze({ ...analyzeOptions, evidenceRollout: shadowRollout() });
    const compat = await analyze({ ...analyzeOptions, evidenceRollout: compatRollout() });

    expect(
      legacy.report.findings.some((finding) => finding.ruleId === "doctor/partial-analysis"),
    ).toBe(true);
    expect(compareV1Outputs(legacy.report, shadow.report).equal).toBe(true);
    expect(shadow.evidence?.parity?.equal).toBe(true);
    expect(
      compat.report.findings.some((finding) => finding.ruleId === "doctor/partial-analysis"),
    ).toBe(true);
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "doctor/partial-analysis",
      ),
    ).toMatchObject({ outcome: "fail", confidence: "unknown" });
    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "doctor/partial-analysis",
      )?.reasonCode,
    ).not.toBe("prerequisite-missing");
  });

  it("routes Group 3 heuristic rules through the bridge with V1 parity", async () => {
    const root = await fixture("group3-heuristics-rollout-bridge", {
      "src/index.ts": [
        'import { create } from "zustand";',
        'import debounce from "lodash/debounce";',
        'import React from "react";',
        'import "react-dom/client";',
        "void debounce;",
        "export const useStore = create(() => ({}));",
        "",
      ].join("\n"),
    });
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "group3-heuristics-rollout-bridge",
        dependencies: {
          zustand: "^5.0.0",
          lodash: "^4.17.0",
          react: "19.1.1",
          "react-dom": "19.1.1",
        },
      }),
    );
    const analyzeOptions = {
      root,
      bundler: "vite" as const,
      mode: "ci" as const,
      moduleFederation: {
        name: "host",
        getPublicPath: "function () { return '/cdn/'; }",
        remotes: { shop: "shop@https://example.test/mf-manifest.json" },
        shared: {
          zustand: { singleton: false },
          lodash: { singleton: false, eager: true },
          axios: { singleton: false },
          "react-dom": { singleton: true },
        },
      },
      output: { formats: [] as never[] },
      rules: {
        ...quietRules,
        "artifact/manifest-disabled": "off" as const,
        "config/get-public-path-unused": "off" as const,
        "vite/remotes-prefer-module": "off" as const,
        "config/plugin-package-mismatch": "warning" as const,
        "shared/candidate": "info" as const,
        "shared/singleton-risk": "warning" as const,
        "shared/eager-without-singleton": "warning" as const,
        "shared/unused": "warning" as const,
        "shared/version-unsatisfied": "error" as const,
        "shared/deep-import-bypass": "warning" as const,
        "shared/prefix-share-recommended": "info" as const,
        "security/get-public-path-dynamic-code": "warning" as const,
        "shared/react-host-missing": "warning" as const,
      },
    };
    const legacy = await analyze(analyzeOptions);
    const compat = await analyze({ ...analyzeOptions, evidenceRollout: compatRollout() });

    const parity = compareV1Outputs(legacy.report, compat.report);
    expect(parity.equal).toBe(true);

    const expectedOutcomes = {
      "security/get-public-path-dynamic-code": "fail",
      "config/plugin-package-mismatch": "fail",
      "shared/singleton-risk": "fail",
      "shared/eager-without-singleton": "fail",
      "shared/unused": "fail",
      "shared/candidate": "pass",
      "shared/react-host-missing": "fail",
      "shared/deep-import-bypass": "fail",
      "shared/prefix-share-recommended": "fail",
    } as const;
    for (const [id, outcome] of Object.entries(expectedOutcomes)) {
      const evaluation = compat.evidence?.evaluations.find((candidate) => candidate.rule.id === id);
      expect(evaluation, id).toMatchObject({ outcome, completeness: "complete" });
    }

    const versionFacts = structuredClone(compat.facts);
    versionFacts.dependencies.installed = {
      ...versionFacts.dependencies.installed,
      zustand: "5.0.0",
    };
    versionFacts.moduleFederation!.shared!.zustand!.requiredVersion = "^4.0.0";
    const versionRun = await runMigratedEvidenceRules(versionFacts, analyzeOptions.rules);
    expect(
      versionRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "shared/version-unsatisfied",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
  });

  it("keeps plugin-package-mismatch unknown on webpack without plugin registration evidence", async () => {
    const root = await fixture("group3-webpack-plugin-count-rollout-bridge");
    const baseline = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederation: { name: "host" },
      output: { formats: [] },
      rules: quietRules,
    });
    expect(baseline.facts.bundler.moduleFederationPluginCount).toBeUndefined();

    const missingCount = structuredClone(baseline.facts);
    delete missingCount.bundler.moduleFederationPluginCount;
    const migrated = await runMigratedEvidenceRules(missingCount, {
      "config/plugin-package-mismatch": "warning",
    });
    expect(
      migrated.graph.assertions.find(
        (assertion) => assertion.predicate === "project.bundler.moduleFederationPluginCount",
      ),
    ).toMatchObject({
      value: 0,
      completeness: { status: "not-collected" },
    });
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/plugin-package-mismatch",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "evidence-inconclusive" });

    const viteRoot = await fixture("group3-vite-plugin-package-rollout-bridge");
    const viteLegacy = await analyze(options(viteRoot, createEvidenceRolloutController()));
    const viteCompat = await analyze(options(viteRoot, compatRollout()));
    expect(compareV1Outputs(viteLegacy.report, viteCompat.report).equal).toBe(true);
    expect(
      viteCompat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/plugin-package-mismatch",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      viteCompat.report.findings.some(
        (finding) => finding.ruleId === "config/plugin-package-mismatch",
      ),
    ).toBe(true);
  });

  it("keeps duplicate-plugin unknown when registration evidence is absent for non-webpack bundlers", async () => {
    const root = await fixture("group3-vite-duplicate-plugin-rollout-bridge");
    const baseline = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      moduleFederation: { name: "host" },
      output: { formats: [] },
      rules: quietRules,
    });
    const facts = structuredClone(baseline.facts);
    delete facts.bundler.federationInstances;
    delete facts.bundler.moduleFederationPluginCount;
    const migrated = await runMigratedEvidenceRules(facts, {
      "config/duplicate-plugin-registration": "error",
      "config/plugin-package-mismatch": "warning",
    });
    expect(
      migrated.graph.assertions.find(
        (assertion) => assertion.predicate === "project.bundler.moduleFederationPluginCount",
      ),
    ).toBeUndefined();
    expect(
      migrated.graph.assertions.find(
        (assertion) => assertion.predicate === "project.bundler.federationInstances",
      ),
    ).toBeUndefined();
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/duplicate-plugin-registration",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "prerequisite-missing" });
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/plugin-package-mismatch",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });

    const rspackRoot = await fixture("group3-rspack-duplicate-plugin-rollout-bridge");
    const rspackBaseline = await analyze({
      root: rspackRoot,
      bundler: "rspack",
      mode: "ci",
      moduleFederation: { name: "host" },
      output: { formats: [] },
      rules: quietRules,
    });
    const rspackFacts = structuredClone(rspackBaseline.facts);
    delete rspackFacts.bundler.federationInstances;
    delete rspackFacts.bundler.moduleFederationPluginCount;
    const rspackMigrated = await runMigratedEvidenceRules(rspackFacts, {
      "config/duplicate-plugin-registration": "error",
      "config/plugin-package-mismatch": "warning",
    });
    expect(
      rspackMigrated.graph.assertions.find(
        (assertion) => assertion.predicate === "project.bundler.moduleFederationPluginCount",
      ),
    ).toBeUndefined();
    expect(
      rspackMigrated.graph.assertions.find(
        (assertion) => assertion.predicate === "project.bundler.federationInstances",
      ),
    ).toBeUndefined();
    expect(
      rspackMigrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/duplicate-plugin-registration",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "prerequisite-missing" });
    expect(
      rspackMigrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/plugin-package-mismatch",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
  });

  it("reports duplicate-plugin fail from federation instances when plugin count is absent for non-webpack bundlers", async () => {
    const duplicateConfig = { name: "host", filename: "remoteEntry.js" };
    const root = await fixture("group3-vite-duplicate-plugin-rollout-bridge");
    const baseline = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      moduleFederationInstances: [duplicateConfig, structuredClone(duplicateConfig)],
      output: { formats: [] },
      rules: quietRules,
    });
    expect(
      baseline.report.findings.some(
        (finding) => finding.ruleId === "config/duplicate-plugin-registration",
      ),
    ).toBe(true);

    const facts = structuredClone(baseline.facts);
    delete facts.bundler.moduleFederationPluginCount;
    expect(facts.bundler.federationInstances?.length).toBeGreaterThan(1);
    const migrated = await runMigratedEvidenceRules(facts, {
      "config/duplicate-plugin-registration": "error",
    });
    expect(
      migrated.graph.assertions.find(
        (assertion) => assertion.predicate === "project.bundler.moduleFederationPluginCount",
      ),
    ).toBeUndefined();
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/duplicate-plugin-registration",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });

    const rspackRoot = await fixture("group3-rspack-duplicate-plugin-rollout-bridge");
    const rspackBaseline = await analyze({
      root: rspackRoot,
      bundler: "rspack",
      mode: "ci",
      moduleFederationInstances: [duplicateConfig, structuredClone(duplicateConfig)],
      output: { formats: [] },
      rules: quietRules,
    });
    expect(
      rspackBaseline.report.findings.some(
        (finding) => finding.ruleId === "config/duplicate-plugin-registration",
      ),
    ).toBe(true);

    const rspackFacts = structuredClone(rspackBaseline.facts);
    delete rspackFacts.bundler.moduleFederationPluginCount;
    expect(rspackFacts.bundler.federationInstances?.length).toBeGreaterThan(1);
    const rspackMigrated = await runMigratedEvidenceRules(rspackFacts, {
      "config/duplicate-plugin-registration": "error",
    });
    expect(
      rspackMigrated.graph.assertions.find(
        (assertion) => assertion.predicate === "project.bundler.moduleFederationPluginCount",
      ),
    ).toBeUndefined();
    expect(
      rspackMigrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/duplicate-plugin-registration",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
  });

  it("ledgers shared/unused as unknown when unresolved dynamic evidence is inconclusive", async () => {
    const root = await fixture("group3-unresolved-unused-rollout-bridge");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.copyFile(
      path.resolve("fixtures/dynamic-imports/unresolved-load-share.ts"),
      path.join(root, "src/app.ts"),
    );
    const analyzeOptions = {
      root,
      bundler: "vite" as const,
      mode: "development" as const,
      output: { formats: [] as never[] },
      rules: {
        ...quietRules,
        "doctor/partial-analysis": "warning" as const,
        "shared/unused": "warning" as const,
      },
      moduleFederation: {
        name: "dyn_partial",
        shared: { lodash: { singleton: false } },
      },
    };
    const legacy = await analyze(analyzeOptions);
    const compat = await analyze({ ...analyzeOptions, evidenceRollout: compatRollout() });

    expect(legacy.report.findings.some((finding) => finding.ruleId === "shared/unused")).toBe(
      false,
    );
    expect(compat.report.findings.some((finding) => finding.ruleId === "shared/unused")).toBe(
      false,
    );
    expect(
      compat.evidence?.evaluations.find((item) => item.rule.id === "shared/unused"),
    ).toMatchObject({
      outcome: "unknown",
      reasonCode: "evidence-inconclusive",
    });
  });

  it("keeps absence-sensitive Group 3 shared rules unknown under partial source evidence", async () => {
    const root = await fixture("group3-partial-source", {
      "src/index.ts": "export const ok = true;\n",
      "src/unreadable.ts": "export const hidden = true;\n",
    });
    const unreadable = path.join(root, "src/unreadable.ts");
    const originalReadFile = fs.readFile;
    const readFileSpy = await import("vitest").then(({ vi }) =>
      vi.spyOn(fs, "readFile").mockImplementation(async (file, readOptions) => {
        if (path.resolve(String(file)) === unreadable) throw new Error("fixture read failed");
        return originalReadFile(file, readOptions);
      }),
    );
    try {
      const analyzeOptions = {
        root,
        bundler: "rspack" as const,
        mode: "ci" as const,
        moduleFederation: {
          name: "remote",
          shared: { lodash: { singleton: false } },
        },
        output: { formats: [] as never[] },
        rules: {
          ...quietRules,
          "shared/unused": "warning" as const,
        },
      };
      const legacy = await analyze(analyzeOptions);
      const compat = await analyze({ ...analyzeOptions, evidenceRollout: compatRollout() });

      expect(legacy.facts.imports.sourceReadFailures).toContain("src/unreadable.ts");
      expect(legacy.report.findings.some((finding) => finding.ruleId === "shared/unused")).toBe(
        false,
      );
      expect(compat.report.findings.some((finding) => finding.ruleId === "shared/unused")).toBe(
        false,
      );
      expect(
        compat.evidence?.evaluations.find((item) => item.rule.id === "shared/unused"),
      ).toMatchObject({ outcome: "unknown" });
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("caps Group 3 heuristic rule confidence at inventory ceilings", async () => {
    const root = await fixture("group3-confidence-rollout-bridge", {
      "src/index.ts": 'import "react-dom/client";\n',
    });
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "group3-confidence-rollout-bridge",
        dependencies: {
          vite: "6.1.0",
          react: "19.1.1",
          "react-dom": "19.1.1",
        },
      }),
    );
    const compat = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      moduleFederation: {
        name: "host",
        getPublicPath: "function () { return '/cdn/'; }",
        shared: {
          react: { singleton: true, requiredVersion: "^18" },
          "react-dom": { singleton: true },
        },
      },
      evidenceRollout: compatRollout(),
      output: { formats: [] },
      rules: {
        "doctor/partial-analysis": "off" as const,
        "config/name-required": "off" as const,
        "config/plugin-package-mismatch": "warning" as const,
        "security/get-public-path-dynamic-code": "warning" as const,
        "shared/version-unsatisfied": "error" as const,
        "shared/singleton-risk": "warning" as const,
        "shared/eager-without-singleton": "warning" as const,
        "shared/unused": "warning" as const,
        "shared/candidate": "info" as const,
        "shared/react-host-missing": "warning" as const,
        "shared/deep-import-bypass": "warning" as const,
        "shared/prefix-share-recommended": "info" as const,
      },
    });
    const ceilings: Record<string, string> = {
      "security/get-public-path-dynamic-code": "low",
      "shared/version-unsatisfied": "medium",
      "config/plugin-package-mismatch": "medium",
      "shared/singleton-risk": "low",
      "shared/eager-without-singleton": "low",
      "shared/unused": "low",
      "shared/candidate": "low",
      "shared/react-host-missing": "medium",
      "shared/deep-import-bypass": "low",
      "shared/prefix-share-recommended": "high",
    };
    for (const [id, ceiling] of Object.entries(ceilings)) {
      const evaluation = compat.evidence?.evaluations.find((item) => item.rule.id === id);
      expect(evaluation).toBeDefined();
      if (evaluation?.outcome === "unknown") continue;
      const rank = CONFIDENCE_RANK[evaluation!.confidence];
      const ceilingRank = CONFIDENCE_RANK[ceiling];
      expect(rank).toBeDefined();
      expect(ceilingRank).toBeDefined();
      expect(rank!).toBeLessThanOrEqual(ceilingRank!);
    }
  });

  it("routes every Group 1 bridge, SSR, and runtime-plugin rule through the bridge with V1 parity", async () => {
    const cases = [
      {
        name: "bridge-react-prefer",
        expectedIds: [
          "bridge/react-version-entry-prefer",
          "bridge/lazy-plugin-unregistered",
          "bridge/router-implicit-enable",
          "bridge/ssr-instanceid-hydration",
          "bridge/export-app-missing",
          "ssr/node-library-dts",
          "ssr/node-runtime-plugin-missing",
        ] as const,
        root: await fixture("bridge-react-prefer", {
          "src/index.tsx": 'import "@module-federation/bridge-react";\n',
        }),
        options: {
          bundler: "rspack" as const,
          mode: "ci" as const,
          target: "node" as const,
          moduleFederation: {
            name: "host",
            target: "node" as const,
            exposes: { "./Widget": "./src/index.tsx" },
            shared: {
              react: { singleton: true },
              "react-dom/": { singleton: true },
            },
          },
        },
        packageJson: {
          name: "bridge-react-prefer",
          dependencies: {
            react: "19.1.1",
            "react-dom": "19.1.1",
            "@module-federation/bridge-react": "0.2.0",
          },
        },
      },
      {
        name: "bridge-react-conflict",
        expectedIds: [
          "bridge/react-dom-prefix-missing",
          "bridge/react-version-entry-mismatch",
          "bridge/disable-alias-deprecated",
        ] as const,
        root: await fixture("bridge-react-conflict", {
          "src/index.tsx": 'import "@module-federation/bridge-react/v18";\n',
        }),
        options: {
          bundler: "rspack" as const,
          mode: "ci" as const,
          moduleFederation: {
            name: "host",
            bridge: { enableBridgeRouter: true, disableAlias: true },
            runtimePlugins: ["@module-federation/bridge-react/plugin"],
            shared: {
              react: { singleton: true },
              "react-router-dom": { singleton: true },
              "@tanstack/react-router": { singleton: true },
            },
          },
        },
        packageJson: {
          name: "bridge-react-conflict",
          dependencies: {
            react: "19.1.1",
            "react-dom": "19.1.1",
            "react-router-dom": "6.0.0",
            "@tanstack/react-router": "1.0.0",
            "@module-federation/bridge-react": "0.2.0",
          },
        },
      },
      {
        name: "bridge-react-provider",
        expectedIds: ["bridge/missing-fallback-loading"] as const,
        root: await fixture("bridge-react-provider", {
          "src/index.tsx": [
            'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
            "export const Remote = createRemoteAppComponent({",
            "  loader: async () => ({ default: () => null }),",
            "});",
            "",
          ].join("\n"),
        }),
        options: {
          bundler: "rspack" as const,
          mode: "ci" as const,
          moduleFederation: {
            name: "host",
            bridge: { enableBridgeRouter: true },
            runtimePlugins: ["@module-federation/bridge-react/plugin"],
            shared: {
              react: { singleton: true },
              "react-dom/": { singleton: true },
            },
          },
        },
        packageJson: {
          name: "bridge-react-provider",
          dependencies: {
            react: "19.1.1",
            "react-dom": "19.1.1",
            "@module-federation/bridge-react": "0.2.0",
          },
        },
      },
      {
        name: "bridge-react-manual",
        expectedIds: ["bridge/consumer-api-manual"] as const,
        root: await fixture("bridge-react-manual", {
          "src/index.tsx": [
            'import { loadRemote } from "@module-federation/runtime";',
            'loadRemote("shop/App");',
            "",
          ].join("\n"),
        }),
        options: {
          bundler: "rspack" as const,
          mode: "ci" as const,
          moduleFederation: {
            name: "host",
            bridge: { enableBridgeRouter: true },
            runtimePlugins: ["@module-federation/bridge-react/plugin"],
            remotes: {
              shop: {
                name: "shop",
                entry: "https://example.test/mf-manifest.json",
                shareScope: "default",
              },
            },
            shared: {
              react: { singleton: true },
              "react-dom/": { singleton: true },
            },
          },
        },
        packageJson: {
          name: "bridge-react-manual",
          dependencies: {
            react: "19.1.1",
            "react-dom": "19.1.1",
            "@module-federation/bridge-react": "0.2.0",
            "@module-federation/runtime": "0.0.0",
          },
        },
      },
      {
        name: "bridge-vue",
        expectedIds: [
          "bridge/vue-share-missing",
          "bridge/vue-ssr-fresh-context",
          "bridge/vue-server-entry",
          "bridge/vue-consumer-manual",
          "ssr/node-remote-manifest",
          "ssr/node-runtime-plugin-missing",
        ] as const,
        root: await fixture("bridge-vue", {
          "src/index.ts": [
            'import "@module-federation/bridge-vue3";',
            'import { loadRemote } from "@module-federation/runtime";',
            'loadRemote("shop/App");',
            "",
          ].join("\n"),
        }),
        options: {
          bundler: "rspack" as const,
          mode: "ci" as const,
          moduleFederation: {
            name: "host",
            target: "node" as const,
            remotes: {
              shop: {
                name: "shop",
                entry: "https://example.test/mf-manifest.json",
                shareScope: "default",
              },
            },
          },
        },
        packageJson: {
          name: "bridge-vue",
          dependencies: {
            vue: "3.5.0",
            "@module-federation/bridge-vue3": "0.2.0",
            "@module-federation/runtime": "0.0.0",
          },
        },
      },
      {
        name: "bridge-ssr",
        expectedIds: ["ssr/node-remote-manifest", "ssr/node-runtime-plugin-missing"] as const,
        root: await fixture("bridge-ssr"),
        options: {
          bundler: "rspack" as const,
          mode: "ci" as const,
          moduleFederation: {
            name: "host",
            target: "node" as const,
            remotes: {
              shop: {
                name: "shop",
                entry: "https://example.test/mf-manifest.json",
                shareScope: "default",
              },
            },
            library: { type: "module" },
            dts: { enabled: true },
          },
        },
        packageJson: {
          name: "bridge-ssr",
          dependencies: {},
        },
      },
      {
        name: "runtime-plugins",
        expectedIds: [
          "runtime-plugins/invalid-factory",
          "runtime-plugins/create-script-cors-parity",
          "runtime-plugins/create-script-without-link",
        ] as const,
        root: await fixture("runtime-plugins", {
          "src/bad-plugin.ts": "export default null;\n",
          "src/cors-plugin.ts": [
            "export default function plugin() {",
            "  return {",
            '    name: "cors",',
            "    createScript({ url }) {",
            '      const script = document.createElement("script");',
            '      script.crossOrigin = "anonymous";',
            "      script.src = url;",
            "      return script;",
            "    },",
            "  };",
            "}",
            "",
          ].join("\n"),
          "src/heuristic-plugin.ts": [
            "export default function plugin() {",
            "  return {",
            '    name: "heuristic",',
            "    createScript({ url }) {",
            '      const script = document.createElement("script");',
            "      script.src = url;",
            "      return script;",
            "    },",
            "  };",
            "}",
            "",
          ].join("\n"),
        }),
        options: {
          bundler: "vite" as const,
          mode: "ci" as const,
          moduleFederation: {
            name: "host",
            runtimePlugins: [
              "./src/bad-plugin.ts",
              "./src/cors-plugin.ts",
              "./src/heuristic-plugin.ts",
            ],
          },
        },
        packageJson: {
          name: "runtime-plugins",
          dependencies: { vite: "6.1.0" },
        },
      },
    ];

    for (const entry of cases) {
      await fs.writeFile(path.join(entry.root, "package.json"), JSON.stringify(entry.packageJson));
      const legacy = await analyze({
        root: entry.root,
        ...entry.options,
        output: { formats: [] as never[] },
        rules: quietRules,
      });
      const compat = await analyze({
        root: entry.root,
        ...entry.options,
        evidenceRollout: compatRollout(),
        output: { formats: [] as never[] },
        rules: quietRules,
      });
      const findingIds = new Set(compat.report.findings.map((finding) => finding.ruleId));
      expect(new Set(bridgeReportIds(compat.report))).toEqual(
        new Set(entry.expectedIds.filter((id) => id.startsWith("bridge/"))),
      );
      expect(findingIds).toEqual(new Set(entry.expectedIds));
      expect(compareV1Outputs(legacy.report, compat.report).equal).toBe(true);
      const evaluatedIds = new Set(
        compat.evidence?.evaluations.map((evaluation) => evaluation.rule.id),
      );
      for (const id of entry.expectedIds) expect(evaluatedIds.has(id)).toBe(true);
    }
  });

  it("keeps readable bridge violations under partial source evidence", async () => {
    const root = await fixture("bridge-partial-source", {
      "src/index.tsx": [
        'import "@module-federation/bridge-react";',
        'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
        "",
        "export const Remote = createRemoteAppComponent({",
        "  loader: async () => ({ default: () => null }),",
        "});",
        "",
      ].join("\n"),
      "src/unreadable.tsx": "export const hidden = true;\n",
    });
    const unreadable = path.join(root, "src/unreadable.tsx");
    const originalReadFile = fs.readFile;
    const readFileSpy = await import("vitest").then(({ vi }) =>
      vi.spyOn(fs, "readFile").mockImplementation(async (file, readOptions) => {
        if (path.resolve(String(file)) === unreadable) throw new Error("fixture read failed");
        return originalReadFile(file, readOptions);
      }),
    );
    try {
      const analyzeOptions = {
        root,
        bundler: "rspack" as const,
        mode: "ci" as const,
        moduleFederation: {
          name: "host",
          bridge: { enableBridgeRouter: true },
          runtimePlugins: ["@module-federation/bridge-react/plugin"],
          remotes: {
            shop: {
              name: "shop",
              entry: "https://example.test/mf-manifest.json",
              shareScope: "default",
            },
          },
          shared: {
            react: { singleton: true },
            "react-dom/": { singleton: true },
          },
        },
        output: { formats: [] as never[] },
        rules: quietRules,
      };
      const legacy = await analyze(analyzeOptions);
      const shadow = await analyze({ ...analyzeOptions, evidenceRollout: shadowRollout() });
      const compat = await analyze({ ...analyzeOptions, evidenceRollout: compatRollout() });

      expect(legacy.facts.imports.sourceReadFailures).toContain("src/unreadable.tsx");
      expect(compareV1Outputs(legacy.report, shadow.report).equal).toBe(true);
      expect(compareV1Outputs(legacy.report, compat.report).equal).toBe(true);
      expect(
        legacy.report.findings.some(
          (finding) => finding.ruleId === "bridge/missing-fallback-loading",
        ),
      ).toBe(true);
      expect(
        compat.report.findings.some(
          (finding) => finding.ruleId === "bridge/missing-fallback-loading",
        ),
      ).toBe(true);
      expect(
        compat.evidence?.evaluations.find(
          (item) => item.rule.id === "bridge/missing-fallback-loading",
        ),
      ).toMatchObject({ outcome: "fail" });
      expect(
        compat.evidence?.evaluations.find((item) => item.rule.id === "bridge/consumer-api-manual"),
      ).toMatchObject({ outcome: "unknown" });
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("keeps absence-sensitive config rules unknown under partial source evidence", async () => {
    const root = await fixture("config-partial-source", {
      "src/index.ts": "export const ok = true;\n",
      "src/unreadable.ts": "export const hidden = true;\n",
    });
    const unreadable = path.join(root, "src/unreadable.ts");
    const originalReadFile = fs.readFile;
    const readFileSpy = await import("vitest").then(({ vi }) =>
      vi.spyOn(fs, "readFile").mockImplementation(async (file, readOptions) => {
        if (path.resolve(String(file)) === unreadable) throw new Error("fixture read failed");
        return originalReadFile(file, readOptions);
      }),
    );
    try {
      const analyzeOptions = {
        root,
        bundler: "rspack" as const,
        mode: "ci" as const,
        moduleFederation: {
          name: "remote",
          exposes: { "./Missing": "./src/Missing" },
        },
        output: { formats: [] as never[] },
        rules: quietRules,
      };
      const legacy = await analyze(analyzeOptions);
      const compat = await analyze({ ...analyzeOptions, evidenceRollout: compatRollout() });

      expect(legacy.facts.imports.sourceReadFailures).toContain("src/unreadable.ts");
      expect(
        legacy.report.findings.some((finding) => finding.ruleId === "config/expose-path-missing"),
      ).toBe(false);
      expect(
        compat.report.findings.some((finding) => finding.ruleId === "config/expose-path-missing"),
      ).toBe(false);
      expect(
        compat.evidence?.evaluations.find((item) => item.rule.id === "config/expose-path-missing"),
      ).toMatchObject({ outcome: "unknown" });
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("keeps bridge SSR applicability deterministic for adapter and target scope", async () => {
    const root = await fixture("bridge-scope", {
      "src/index.tsx": 'import "@module-federation/bridge-react/v19";\n',
    });
    const run = () =>
      analyzeBuild(
        {
          root,
          bundler: "webpack",
          mode: "ci",
          moduleFederation: {
            name: "host",
            target: "node",
            shared: {
              react: { singleton: true },
              "react-dom/": { singleton: true },
            },
          },
          evidenceRollout: compatRollout(),
          output: { formats: [] },
        },
        ["dist/server/remoteEntry.js"],
        undefined,
        [
          {
            adapter: "webpack",
            bundler: "webpack",
            compilerName: "webpack",
            compilationName: "server",
            outputRoot: "dist/server",
            emittedAssets: ["remoteEntry.js"],
            effectiveMode: "production",
            targetKind: "node",
            sourceHook: "afterEmit",
          },
        ],
      );

    const first = await run();
    const second = await run();
    const firstEvaluation = first.evidence?.evaluations.find(
      (evaluation) => evaluation.rule.id === "bridge/ssr-server-entry-leak",
    );
    const secondEvaluation = second.evidence?.evaluations.find(
      (evaluation) => evaluation.rule.id === "bridge/ssr-server-entry-leak",
    );
    expect(firstEvaluation).toMatchObject({
      outcome: "fail",
      scope: { adapter: "webpack", target: "node", buildMode: "production" },
    });
    expect(firstEvaluation?.id).toBe(secondEvaluation?.id);
  });

  it("records disabled migrated rules in execution metadata without producing findings", async () => {
    const root = await fixture("disabled-rollout-bridge");
    const result = await analyze({
      ...options(root, compatRollout()),
      rules: { "config/name-required": "off" },
    });

    expect(result.evidence?.execution).toEqual([
      {
        state: "disabled",
        rule: { id: "config/name-required", version: "1" },
        reason: 'Rule is disabled by configuration (setting is "off").',
      },
    ]);
    expect(
      result.evidence?.evaluations.some(
        (evaluation) => evaluation.rule.id === "config/name-required",
      ),
    ).toBe(false);
    expect(
      result.report.findings.some((finding) => finding.ruleId === "config/name-required"),
    ).toBe(false);
  });

  it("keeps adapter and bundler versions distinct in the migrated rule scope", async () => {
    const root = await fixture("scoped-version-rollout-bridge");
    const result = await analyze(options(root, shadowRollout()));
    expect(result.facts.canonicalConfig).toBeDefined();
    result.facts.canonicalConfig!.contract.adapter.version = "2.4.0";
    result.facts.canonicalConfig!.contract.bundler.version = "5.99.0";

    expect(evidenceRuleScopeFor(result.facts)).toMatchObject({
      adapter: "vite",
      adapterVersion: "2.4.0",
      bundler: { name: "vite", version: "5.99.0" },
    });
    expect(evidenceRuleScopeFor(result.facts)).not.toHaveProperty("buildMode");
    const migrated = await runMigratedEvidenceRules(result.facts, {});
    expect(migrated.output.evaluations[0]?.scope).toMatchObject({
      adapter: "vite",
      adapterVersion: "2.4.0",
      bundler: { name: "vite", version: "5.99.0" },
    });
  });

  it("retains build and artifact scope for Group 2 artifact rules", async () => {
    const root = await fixture("group2-scope-rollout-bridge", {
      "src/index.ts": "export default 1;\n",
    });
    const result = await analyzeBuild(
      {
        root,
        bundler: "webpack",
        mode: "ci",
        moduleFederation: {
          name: "host",
          exposes: { "./Widget": "./src/index.ts" },
          remotes: { shop: "shop@https://example.test/mf-manifest.json" },
          shared: {
            react: { singleton: true },
          },
        },
        evidenceRollout: shadowRollout(),
        output: { formats: [] },
      },
      ["dist/client/remoteEntry.js"],
      undefined,
      [
        {
          adapter: "webpack",
          bundler: "webpack",
          compilerName: "webpack",
          compilationName: "client",
          outputRoot: "dist/client",
          emittedAssets: ["remoteEntry.js"],
          effectiveMode: "production",
          targetKind: "web",
          sourceHook: "afterEmit",
        },
      ],
    );
    const selectedBuild = result.facts.builds?.[0];
    expect(selectedBuild).toBeDefined();
    const run = await runMigratedEvidenceRules(result.facts, {}, undefined, selectedBuild);
    expect(run.graph.scope).toMatchObject({
      buildId: selectedBuild?.id,
      compilationId: selectedBuild?.compilationName,
      buildMode: "production",
      target: "web",
    });
    expect(
      run.graph.assertions.every((assertion) => assertion.scope.buildId === selectedBuild?.id),
    ).toBe(true);
    expect(run.graph.assertions.some((assertion) => assertion.predicate === "project.builds")).toBe(
      true,
    );
  });

  it("keeps missing and partial Group 2 artifact evidence unknown", async () => {
    const root = await fixture("group2-partial-artifact-rollout-bridge", {
      "src/index.ts": "export default 1;\n",
    });
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederation: {
        name: "host",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: { shop: "shop@https://example.test/mf-manifest.json" },
        shared: {
          react: { singleton: true },
        },
      },
      evidenceRollout: shadowRollout(),
      output: { formats: [] },
    });

    const partial = structuredClone(result.facts);
    partial.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      name: "host",
      remoteEntry: { name: "remoteEntry.js", path: "" },
      exposes: [],
      shared: [],
    };
    partial.capabilities.manifest = true;
    partial.artifacts.assetSizes = { "remoteEntry.js": 1_000_000 };
    partial.artifacts.emittedAssets = [];
    partial.capabilities.emittedAssets = false;
    const partialRun = await runMigratedEvidenceRules(partial, {});
    for (const id of [
      "artifact/manifest-remote-entry-missing",
      "artifact/remote-entry-missing",
      "artifact/types-missing",
      "performance/asset-budget",
    ]) {
      expect(
        partialRun.output.evaluations.find((evaluation) => evaluation.rule.id === id),
      ).toMatchObject({ outcome: "unknown" });
    }
    expect(
      partialRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "performance/asset-budget",
      ),
    ).toMatchObject({
      outcome: "unknown",
      reasonCode: "prerequisite-incomplete",
      completeness: "partial",
    });

    const missing = structuredClone(result.facts);
    delete missing.artifacts.manifest;
    missing.capabilities.manifest = false;
    const missingRun = await runMigratedEvidenceRules(missing, {});
    for (const id of ["artifact/expose-missing", "artifact/manifest-invalid"]) {
      expect(
        missingRun.output.evaluations.find((evaluation) => evaluation.rule.id === id),
      ).toMatchObject({ outcome: "unknown" });
    }
  });

  it("keeps an explicitly disabled manifest actionable without a manifest artifact", async () => {
    const root = await fixture("group2-explicit-manifest-disabled-rollout-bridge");
    const compat = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      moduleFederation: {
        name: "host",
        manifest: false,
        exposes: { "./Widget": "./src/index.ts" },
      },
      evidenceRollout: compatRollout(),
      output: { formats: [] },
      rules: quietRules,
    });

    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "artifact/manifest-disabled",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      compat.report.findings.filter((finding) => finding.ruleId === "artifact/manifest-disabled"),
    ).toHaveLength(1);

    const migrated = await runMigratedEvidenceRules(compat.facts, {});
    expect(
      migrated.graph.assertions.find(
        (assertion) => assertion.predicate === "artifacts.manifestExplicitlyDisabled",
      ),
    ).toMatchObject({ completeness: { status: "complete" } });
    expect(
      migrated.graph.assertions.find((assertion) => assertion.predicate === "artifacts.manifest"),
    ).toBeUndefined();
    expect(
      migrated.graph.assertions.find(
        (assertion) => assertion.predicate === "artifacts.manifestValidity",
      ),
    ).toBeUndefined();
    for (const id of [
      "artifact/expose-missing",
      "artifact/manifest-invalid",
      "artifact/manifest-name-mismatch",
      "artifact/manifest-remote-entry-missing",
      "artifact/manifest-expose-assets-empty",
      "artifact/manifest-shared-version-mismatch",
      "artifact/public-path-suspicious",
      "artifact/types-metadata-missing",
      "artifact/types-missing",
      "performance/asset-budget",
    ]) {
      expect(
        migrated.output.evaluations.find((evaluation) => evaluation.rule.id === id),
      ).toMatchObject({ outcome: "unknown" });
    }
  });

  it("keeps webpack explicit manifest: false conclusive only for manifest-disabled", async () => {
    const root = await fixture("group2-explicit-manifest-disabled-rollout-bridge");
    const compat = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederation: {
        name: "host",
        manifest: false,
        exposes: { "./Widget": "./src/index.ts" },
      },
      evidenceRollout: compatRollout(),
      output: { formats: [] },
      rules: quietRules,
    });

    expect(
      compat.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "artifact/manifest-disabled",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    const migrated = await runMigratedEvidenceRules(compat.facts, {});
    for (const id of ["artifact/expose-missing", "artifact/manifest-invalid"]) {
      expect(
        migrated.output.evaluations.find((evaluation) => evaluation.rule.id === id),
      ).toMatchObject({ outcome: "unknown" });
    }
  });

  it("keeps malformed manifest content unknown but preserves the invalid-manifest finding", async () => {
    const root = await fixture("group2-malformed-manifest-rollout-bridge");
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.copyFile(
      path.resolve("fixtures/manifests/malformed.json"),
      path.join(root, "dist/mf-manifest.json"),
    );
    const compat = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      evidenceRollout: compatRollout(),
      output: { formats: [] },
      rules: { "doctor/partial-analysis": "off" },
    });

    const migrated = await runMigratedEvidenceRules(compat.facts, {});
    const evaluation = migrated.output.evaluations.find(
      (item) => item.rule.id === "artifact/manifest-invalid",
    );
    expect(evaluation).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      compat.report.findings.some((finding) => finding.ruleId === "artifact/manifest-invalid"),
    ).toBe(true);
    const manifest = migrated.graph.assertions.find(
      (assertion) => assertion.predicate === "artifacts.manifest",
    );
    expect(manifest).toMatchObject({ completeness: { status: "unknown" } });
    expect(
      migrated.graph.assertions.find(
        (assertion) => assertion.predicate === "artifacts.manifestValidity",
      ),
    ).toMatchObject({ completeness: { status: "complete" }, value: { valid: false } });
  });

  it("keeps bundler field prerequisites independent from the aggregate", async () => {
    const root = await fixture("group2-bundler-fields-rollout-bridge");
    const baseline = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederation: {
        name: "host",
        manifest: true,
        exposes: { "./Widget": "./src/index.ts" },
      },
      output: { formats: [] },
    });
    const completeFacts = structuredClone(baseline.facts);
    completeFacts.bundler.moduleFederationPluginCount = 2;
    completeFacts.bundler.outputPublicPathKind = "non-string";
    const completeRun = await runMigratedEvidenceRules(completeFacts, {});
    expect(
      completeRun.graph.assertions.find(
        (assertion) => assertion.predicate === "project.bundler.moduleFederationPluginCount",
      ),
    ).toMatchObject({ value: 2, completeness: { status: "complete" } });
    expect(
      completeRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/duplicate-plugin-registration",
      ),
    ).toMatchObject({ outcome: "fail" });
    expect(
      completeRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "artifact/public-path-non-string-manifest",
      ),
    ).toMatchObject({ outcome: "fail" });

    const missingPluginCount = structuredClone(completeFacts);
    delete missingPluginCount.bundler.moduleFederationPluginCount;
    delete missingPluginCount.bundler.federationInstances;
    const missingCountRun = await runMigratedEvidenceRules(missingPluginCount, {});
    expect(
      missingCountRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/duplicate-plugin-registration",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "prerequisite-missing" });

    const missingPublicPath = structuredClone(completeFacts);
    delete missingPublicPath.bundler.outputPublicPathKind;
    const missingPublicPathRun = await runMigratedEvidenceRules(missingPublicPath, {});
    expect(
      missingPublicPathRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "artifact/public-path-non-string-manifest",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "prerequisite-missing" });
  });

  it("projects a complete Group 2 artifact failure through the V1 compatibility report", async () => {
    const root = await fixture("group2-complete-artifact-rollout-bridge");
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(root, "dist/mf-manifest.json"),
      JSON.stringify({
        id: "host",
        name: "host",
        metaData: { remoteEntry: { name: "missing.js", path: "" } },
        exposes: [],
        shared: [],
      }),
    );
    await fs.writeFile(path.join(root, "dist/other.js"), "export {};");

    const result = await analyzeBuild(
      {
        ...options(root, compatRollout()),
        bundler: "webpack",
        moduleFederation: {
          name: "host",
          exposes: { "./Widget": "./src/index.ts" },
        },
        rules: {
          ...quietRules,
          "artifact/manifest-remote-entry-missing": "error",
        },
      },
      ["dist/mf-manifest.json", "dist/other.js"],
      undefined,
      [
        {
          adapter: "webpack",
          bundler: "webpack",
          compilerName: "webpack",
          compilationName: "client",
          outputRoot: "dist",
          emittedAssets: ["mf-manifest.json", "other.js"],
          effectiveMode: "production",
          targetKind: "web",
          sourceHook: "afterEmit",
        },
      ],
    );

    expect(
      result.evidence?.evaluations.find(
        (evaluation) => evaluation.rule.id === "artifact/manifest-remote-entry-missing",
      ),
    ).toMatchObject({
      outcome: "fail",
      scope: { buildId: "webpack-build-1", compilationId: "client" },
      completeness: "complete",
    });
    expect(
      result.report.findings.filter(
        (finding) => finding.ruleId === "artifact/manifest-remote-entry-missing",
      ),
    ).toHaveLength(1);
  });

  it("evaluates the migrated rule through analyzeBuild with deterministic build scope", async () => {
    const root = await fixture("webpack-rollout-bridge");
    const run = () =>
      analyzeBuild(
        {
          ...options(root, compatRollout()),
          bundler: "webpack",
        },
        ["dist/remoteEntry.js"],
        undefined,
        [
          {
            adapter: "webpack",
            bundler: "webpack",
            compilerName: "webpack",
            compilationName: "client",
            hash: "abc123",
            outputRoot: "dist",
            emittedAssets: ["remoteEntry.js"],
            effectiveMode: "production",
            sourceHook: "afterEmit",
          },
        ],
      );

    const first = await run();
    const second = await run();
    const firstEvaluation = first.evidence?.evaluations.find(
      (evaluation) => evaluation.rule.id === "config/name-required",
    );
    const secondEvaluation = second.evidence?.evaluations.find(
      (evaluation) => evaluation.rule.id === "config/name-required",
    );
    expect(firstEvaluation).toMatchObject({
      outcome: "fail",
      scope: {
        adapter: "webpack",
        buildMode: "production",
        buildId: "webpack-build-1",
        compilationId: "client",
      },
    });
    expect(firstEvaluation?.id).toBe(secondEvaluation?.id);
    expect(
      first.report.findings.filter((finding) => finding.ruleId === "config/name-required"),
    ).toHaveLength(1);
  });

  it("evaluates every build in isolated scopes while deduping the V1 finding", async () => {
    const root = await fixture("multi-build-rollout-bridge");
    const result = await analyzeBuild(
      {
        ...options(root, compatRollout()),
        bundler: "webpack",
      },
      ["dist/client/remoteEntry.js", "dist/server/remoteEntry.js"],
      undefined,
      [
        {
          adapter: "webpack",
          bundler: "webpack",
          compilerName: "webpack",
          compilationName: "client",
          outputRoot: "dist/client",
          emittedAssets: ["remoteEntry.js"],
          effectiveMode: "production",
          targetKind: "web",
          sourceHook: "afterEmit",
        },
        {
          adapter: "webpack",
          bundler: "webpack",
          compilerName: "webpack",
          compilationName: "server",
          outputRoot: "dist/server",
          emittedAssets: ["remoteEntry.js"],
          effectiveMode: "development",
          targetKind: "node",
          sourceHook: "afterEmit",
        },
      ],
    );

    const evaluations = result.evidence?.evaluations.filter(
      (evaluation) => evaluation.rule.id === "config/name-required",
    );
    expect(evaluations).toHaveLength(2);
    expect(new Set(evaluations?.map((evaluation) => evaluation.id)).size).toBe(2);
    expect(evaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: expect.objectContaining({
            buildId: "webpack-build-1",
            compilationId: "client",
            buildMode: "production",
            target: "web",
          }),
        }),
        expect.objectContaining({
          scope: expect.objectContaining({
            buildId: "webpack-build-2",
            compilationId: "server",
            buildMode: "development",
            target: "node",
          }),
        }),
      ]),
    );
    expect(
      result.report.findings.filter((finding) => finding.ruleId === "config/name-required"),
    ).toHaveLength(1);

    const [clientBuild, serverBuild] = result.facts.builds ?? [];
    expect(clientBuild).toBeDefined();
    expect(serverBuild).toBeDefined();
    const clientGraph = await runMigratedEvidenceRules(result.facts, {}, undefined, clientBuild);
    const selectedBuilds = clientGraph.graph.assertions.find(
      (assertion) => assertion.predicate === "project.builds",
    )?.value;
    expect(selectedBuilds).toEqual([expect.objectContaining({ id: clientBuild?.id })]);
    expect(JSON.stringify(selectedBuilds)).not.toContain(serverBuild?.id);
    expect(clientGraph.graph.identity.buildId).toBe(clientBuild?.id);
    expect(
      clientGraph.graph.assertions.every(
        (assertion) => assertion.scope.buildId === clientBuild?.id,
      ),
    ).toBe(true);
  });

  it("does not leak unrelated federation instances into a selected build graph", async () => {
    const root = await fixture("build-instance-scope-rollout-bridge");
    const moduleFederationInstances = [
      {
        name: "checkout",
        filename: "checkoutEntry.js",
        exposes: { "./Widget": "./src/checkout.ts" },
      },
      {
        name: "catalog",
        filename: "catalogEntry.js",
        exposes: { "./Widget": "./src/catalog.ts" },
      },
    ];
    const baseline = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederationInstances,
      output: { formats: [] },
    });
    const instances = baseline.facts.federationInstances ?? [];
    expect(instances).toHaveLength(2);
    const selectedId = instances[0]!.id;
    const otherId = instances[1]!.id;
    const result = await analyzeBuild(
      {
        root,
        bundler: "webpack",
        mode: "ci",
        moduleFederationInstances,
        evidenceRollout: shadowRollout(),
        output: { formats: [] },
      },
      ["dist/checkoutEntry.js"],
      undefined,
      [
        {
          adapter: "webpack",
          bundler: "webpack",
          outputRoot: "dist",
          emittedAssets: ["checkoutEntry.js"],
          federationInstanceIds: [selectedId],
          sourceHook: "afterEmit",
        },
      ],
    );
    const selectedBuild = result.facts.builds?.[0];
    expect(selectedBuild).toBeDefined();
    const run = await runMigratedEvidenceRules(result.facts, {}, undefined, selectedBuild);
    const instancesValue = run.graph.assertions.find(
      (assertion) => assertion.predicate === "project.federationInstances",
    )?.value;
    expect(instancesValue).toEqual([expect.objectContaining({ id: selectedId })]);
    expect(JSON.stringify(instancesValue)).not.toContain(otherId);
    expect(
      run.graph.assertions.every((assertion) => assertion.scope.buildId === selectedBuild?.id),
    ).toBe(true);
  });

  it("keeps the runner ledger on the graph and carries unknown metadata", async () => {
    const root = await fixture("ledger-rollout-bridge");
    const result = await analyze(options(root, shadowRollout()));
    const incomplete = structuredClone(result.facts);
    delete incomplete.moduleFederation;
    delete incomplete.canonicalConfig;
    const migrated = await runMigratedEvidenceRules(incomplete, {});

    expect(migrated.graph.evaluations).toHaveLength(migratedRuleCount);
    expect(
      migrated.graph.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/name-required",
      ),
    ).toMatchObject({
      outcome: "unknown",
      reasonCode: "prerequisite-missing",
      confidence: "unknown",
      missingRequirements: expect.any(Array),
    });
  });

  it("keeps unknown evidence and custom V1 rules out of the migrated projection", async () => {
    const root = await fixture("custom-rollout-bridge");
    const custom = defineRule({
      meta: {
        id: "team/custom",
        defaultSeverity: "warning",
        supportedBundlers: ["vite"],
        documentation: "/rules/team/custom",
      },
      check(context) {
        context.report({ message: "custom finding", evidence: { source: "v1" } });
      },
    });
    const base = options(root, compatRollout());
    const { moduleFederation: _moduleFederation, ...withoutModuleFederation } = base;
    const result = await analyze({ ...withoutModuleFederation, extends: [custom] });

    expect(result.evidence?.evaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: { id: "config/name-required", version: "1" },
          outcome: "unknown",
        }),
      ]),
    );
    expect(
      result.report.findings.some((finding) => finding.ruleId === "config/name-required"),
    ).toBe(false);
    expect(result.report.findings.some((finding) => finding.ruleId === "team/custom")).toBe(true);
  });

  it("narrows per-instance evidence graphs to the selected federation instance", async () => {
    const root = await fixture("multi-instance-rollout-bridge");
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      moduleFederationInstances: [
        {
          name: "checkout",
          filename: "checkoutEntry.js",
          exposes: { "./Widget": "./src/checkout.ts" },
        },
        {
          name: "catalog",
          filename: "catalogEntry.js",
          exposes: { "./Widget": "./src/catalog.ts" },
        },
      ],
      evidenceRollout: shadowRollout(),
      output: { formats: [] },
    });
    const instances = result.facts.federationInstances ?? [];
    expect(instances).toHaveLength(2);

    const runs = await Promise.all(
      instances.map((instance) =>
        runMigratedEvidenceRules(
          {
            ...result.facts,
            federationInstanceId: instance.id,
            moduleFederation: instance.moduleFederation,
            capabilities: instance.capabilities,
            imports: instance.imports,
            artifacts: instance.artifacts,
          },
          {},
        ),
      ),
    );
    for (const [index, run] of runs.entries()) {
      const selected = instances[index]!;
      const other = instances[index === 0 ? 1 : 0]!;
      const federationInstances = run.graph.assertions.find(
        (assertion) => assertion.predicate === "project.federationInstances",
      )?.value;
      expect(federationInstances).toEqual([
        expect.objectContaining({
          id: selected.id,
          moduleFederation: expect.objectContaining({ name: selected.moduleFederation.name }),
        }),
      ]);
      expect(JSON.stringify(federationInstances)).not.toContain(other.moduleFederation.name);
      expect(JSON.stringify(federationInstances)).not.toContain("canonicalConfig");
      expect(run.graph.identity.federationInstanceId).toBe(selected.id);
      expect(
        run.graph.assertions.every(
          (assertion) => assertion.scope.federationInstanceId === selected.id,
        ),
      ).toBe(true);
    }
  });

  it("keeps legacy findings when the migrated graph hits its evidence budget", async () => {
    const root = await fixture("bridge-budget-rollout-bridge");
    const result = await analyze({
      ...options(root, compatRollout()),
      analysisBudgets: { maxEvidenceNodes: 0 },
    });

    expect(
      result.report.findings.filter((finding) => finding.ruleId === "config/name-required"),
    ).toHaveLength(1);
    expect(result.exitCode).toBe(1);
    expect(result.evidence?.execution).toHaveLength(migratedRuleCount);
    expect(result.evidence?.execution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "engine-error",
          rule: { id: "config/name-required", version: "1" },
        }),
      ]),
    );
  });

  it("honors MFDOCTOR_EVIDENCE_LEGACY as an emergency rollback", async () => {
    const root = await fixture("rollback-rollout-bridge");
    const compat = compatRollout();
    const previous = process.env[EVIDENCE_LEGACY_ENV];
    process.env[EVIDENCE_LEGACY_ENV] = "1";
    try {
      const result = await analyze(options(root, compat));
      expect(result.evidence).toMatchObject({ rollout: { scope: "rules", mode: "legacy" } });
      expect(result.evidence?.evaluations).toHaveLength(0);
      expect(
        result.report.findings.filter((finding) => finding.ruleId === "config/name-required"),
      ).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env[EVIDENCE_LEGACY_ENV];
      else process.env[EVIDENCE_LEGACY_ENV] = previous;
    }
  });
});
