import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze, analyzeBuild } from "../../src/engine.js";
import { evidenceRuleScopeFor, runMigratedEvidenceRules } from "../../src/evidence-rule-bridge.js";
import {
  EVIDENCE_LEGACY_ENV,
  RELEASE_GATES,
  createEvidenceRolloutController,
} from "../../src/evidence-rollout.js";
import { defineRule } from "../../src/rules.js";
import { compareV1Outputs } from "../../src/evidence-parity.js";
import { MIGRATED_GROUP1_CONFIG_RULE_IDS } from "../../src/rule-inventory.js";

const roots: string[] = [];
const greenGates = Object.fromEntries(RELEASE_GATES.map((gate) => [gate, true]));

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(name = "rollout-bridge") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-rollout-"));
  roots.push(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name, dependencies: { vite: "6.1.0" } }),
  );
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/index.ts"), "export default 1;\n");
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
    const legacy = await analyze(base);
    const compat = await analyze({ ...base, evidenceRollout: compatRollout() });
    const evaluatedIds = new Set(
      compat.evidence?.evaluations.map((evaluation) => evaluation.rule.id),
    );
    expect(evaluatedIds).toEqual(new Set(MIGRATED_GROUP1_CONFIG_RULE_IDS));
    const parity = compareV1Outputs(legacy.report, compat.report);
    expect(parity.equal).toBe(true);
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

    expect(migrated.graph.evaluations).toHaveLength(MIGRATED_GROUP1_CONFIG_RULE_IDS.length);
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
    expect(result.evidence?.execution).toHaveLength(MIGRATED_GROUP1_CONFIG_RULE_IDS.length);
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
