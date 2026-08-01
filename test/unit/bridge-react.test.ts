import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, ModuleFederationConfigLike, ProjectFacts } from "../../src/types.js";

const roots: string[] = [];
const BRIDGE_RULES = [
  "bridge/react-version-entry-prefer",
  "bridge/react-dom-prefix-missing",
  "bridge/lazy-plugin-unregistered",
  "bridge/router-implicit-enable",
] as const;

async function fixture(packageJson: Record<string, unknown>, source = 'import "react";\n') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-bridge-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(packageJson));
  await fs.writeFile(path.join(root, "src/index.ts"), source);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function goodBridgeConfig(): ModuleFederationConfigLike {
  return {
    name: "host",
    bridge: { enableBridgeRouter: true },
    runtimePlugins: ["@module-federation/bridge-react/plugin"],
    shared: {
      react: { singleton: true },
      "react-dom/": { singleton: true },
    },
  };
}

function bridgeFindings(findings: DoctorFinding[]) {
  return findings.filter((finding) => finding.ruleId.startsWith("bridge/"));
}

describe("bridge React rules (#121)", () => {
  it("stays quiet on a good React Bridge shape", async () => {
    const root = await fixture(
      {
        name: "bridge-host",
        dependencies: {
          react: "19.1.1",
          "react-dom": "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
          "@module-federation/enhanced": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\nimport "react-dom/client";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig(),
      rules: {
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(bridgeFindings(result.report.findings).map((f) => f.ruleId)).toEqual([]);
  });

  it("prefers versioned Bridge entry when React major is known", async () => {
    const root = await fixture(
      {
        name: "bridge-bare",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        ...goodBridgeConfig(),
      },
      rules: {
        "bridge/react-dom-prefix-missing": "off",
        "bridge/lazy-plugin-unregistered": "off",
        "bridge/router-implicit-enable": "off",
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).toContain(
      "bridge/react-version-entry-prefer",
    );
  });

  it("errors when Bridge v19 lacks react-dom/ shared prefix", async () => {
    const root = await fixture(
      {
        name: "bridge-no-dom",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        bridge: { enableBridgeRouter: true },
        runtimePlugins: ["@module-federation/bridge-react/plugin"],
        shared: { react: { singleton: true } },
      },
      rules: {
        "bridge/react-version-entry-prefer": "off",
        "bridge/lazy-plugin-unregistered": "off",
        "bridge/router-implicit-enable": "off",
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(result.report.findings.map((f) => [f.ruleId, f.severity])).toContainEqual([
      "bridge/react-dom-prefix-missing",
      "error",
    ]);
  });

  it("errors when Bridge React plugin is missing from runtimePlugins", async () => {
    const root = await fixture(
      {
        name: "bridge-no-plugin",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        bridge: { enableBridgeRouter: true },
        shared: {
          react: { singleton: true },
          "react-dom/": { singleton: true },
        },
      },
      rules: {
        "bridge/react-version-entry-prefer": "off",
        "bridge/react-dom-prefix-missing": "off",
        "bridge/router-implicit-enable": "off",
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).toContain(
      "bridge/lazy-plugin-unregistered",
    );
  });

  it("reports implicit enableBridgeRouter as info", async () => {
    const root = await fixture(
      {
        name: "bridge-implicit",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        runtimePlugins: ["@module-federation/bridge-react/plugin"],
        shared: {
          react: { singleton: true },
          "react-dom/": { singleton: true },
        },
      },
      rules: {
        "bridge/react-version-entry-prefer": "off",
        "bridge/react-dom-prefix-missing": "off",
        "bridge/lazy-plugin-unregistered": "off",
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(result.report.findings.map((f) => [f.ruleId, f.severity])).toContainEqual([
      "bridge/router-implicit-enable",
      "info",
    ]);
  });

  it("honors allowImplicitBridgeRouter and off overrides", async () => {
    const root = await fixture(
      {
        name: "bridge-opts",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        runtimePlugins: ["@module-federation/bridge-react/plugin"],
        shared: {
          react: { singleton: true },
          "react-dom/": { singleton: true },
        },
      },
      rules: {
        "bridge/router-implicit-enable": ["info", { allowImplicitBridgeRouter: true }],
        "bridge/react-dom-prefix-missing": "off",
        "bridge/lazy-plugin-unregistered": "off",
        "bridge/react-version-entry-prefer": "off",
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(bridgeFindings(result.report.findings)).toEqual([]);
  });

  it("produces zero bridge findings on non-bridge apps", async () => {
    const root = await fixture({
      name: "plain",
      dependencies: { react: "19.1.1", "@module-federation/vite": "2.8.0" },
    });
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        shared: { react: { singleton: true } },
      },
      rules: {
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(bridgeFindings(result.report.findings)).toEqual([]);
  });

  it("keeps React Bridge rules silent on Vue-only Bridge projects", async () => {
    const root = await fixture(
      {
        name: "vue-bridge",
        dependencies: {
          vue: "3.5.0",
          "@module-federation/bridge-vue3": "0.2.0",
        },
      },
      'import "@module-federation/bridge-vue3";\nimport "vue";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "vue-host",
        bridge: { enableBridgeRouter: true },
        shared: { vue: { singleton: true } },
      },
      rules: {
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "shared/singleton-risk": "off",
      },
    });
    expect(bridgeFindings(result.report.findings)).toEqual([]);
  });

  it("does not flag shared/unused for Bridge react-dom/ when react-dom is imported", async () => {
    const root = await fixture(
      {
        name: "bridge-dom-share",
        dependencies: {
          react: "19.1.1",
          "react-dom": "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
          "@module-federation/enhanced": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\nimport "react-dom/client";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig(),
      rules: {
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        ...Object.fromEntries(BRIDGE_RULES.map((id) => [id, "off"])),
      },
    });
    expect(result.report.findings.some((f) => f.ruleId === "shared/unused")).toBe(false);
  });

  it("registers the four Bridge React rules", () => {
    const ids = builtInRules.map((rule) => rule.meta.id);
    for (const id of BRIDGE_RULES) expect(ids).toContain(id);
  });

  it("does not prefer versioned entry for plugin-only hosts without bare Bridge imports", async () => {
    const root = await fixture(
      {
        name: "bridge-plugin-only",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "react";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig(),
      rules: {
        "bridge/react-dom-prefix-missing": "off",
        "bridge/lazy-plugin-unregistered": "off",
        "bridge/router-implicit-enable": "off",
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).not.toContain(
      "bridge/react-version-entry-prefer",
    );
  });

  it("still errors when only react-dom/server is shared", async () => {
    const root = await fixture(
      {
        name: "bridge-dom-server",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        bridge: { enableBridgeRouter: true },
        runtimePlugins: ["@module-federation/bridge-react/plugin"],
        shared: {
          react: { singleton: true },
          "react-dom/server": { singleton: true },
        },
      },
      rules: {
        "bridge/react-version-entry-prefer": "off",
        "bridge/lazy-plugin-unregistered": "off",
        "bridge/router-implicit-enable": "off",
        "artifact/remote-entry-missing": "off",
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).toContain(
      "bridge/react-dom-prefix-missing",
    );
  });
});

describe("bridge-detect helpers via rule silence", () => {
  it("runs individual Bridge rules against ProjectFacts without React Bridge", async () => {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const facts: ProjectFacts = {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
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
        name: "fixture",
        exposes: {},
        remotes: {},
        shared: {},
      },
      dependencies: { declared: { vue: "3.5.0" }, installed: { vue: "3.5.0" } },
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: ["vue"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: [],
      },
      artifacts: { emittedAssets: [] },
    };
    for (const id of BRIDGE_RULES) {
      const rule = builtInRules.find((item) => item.meta.id === id)!;
      await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    }
    expect(findings).toEqual([]);
  });
});
