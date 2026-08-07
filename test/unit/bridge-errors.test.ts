import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../../src/engine.js";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, ModuleFederationConfigLike } from "../../src/types.js";

const roots: string[] = [];
const ERROR_RULES = [
  "bridge/router-shared-conflict",
  "bridge/react-version-entry-mismatch",
  "bridge/provider-shape-invalid",
  "bridge/ssr-server-entry-leak",
] as const;

async function fixture(packageJson: Record<string, unknown>, source: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-bridge-err-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(packageJson));
  await fs.writeFile(path.join(root, "src/index.tsx"), source);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function goodBridgeConfig(
  overrides: Partial<ModuleFederationConfigLike> = {},
): ModuleFederationConfigLike {
  return {
    name: "host",
    bridge: { enableBridgeRouter: true },
    runtimePlugins: ["@module-federation/bridge-react/plugin"],
    shared: {
      react: { singleton: true },
      "react-dom/": { singleton: true },
    },
    ...overrides,
  };
}

function bridgeFindings(findings: DoctorFinding[]) {
  return findings.filter((finding) => finding.ruleId.startsWith("bridge/"));
}

const quietExtras = {
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "doctor/partial-analysis": "off",
  "config/plugin-package-mismatch": "off",
  "bridge/react-version-entry-prefer": "off",
  "bridge/react-dom-prefix-missing": "off",
  "bridge/lazy-plugin-unregistered": "off",
  "bridge/router-implicit-enable": "off",
} as const;

describe("bridge error batch (#139)", () => {
  it("stays quiet on a good React Bridge host", async () => {
    const root = await fixture(
      {
        name: "bridge-host",
        dependencies: {
          react: "19.1.1",
          "react-dom": "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      [
        'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
        "export const Remote = createRemoteAppComponent({",
        "  loader: async () => ({ default: () => null }),",
        "  fallback: () => null,",
        "  loading: () => null,",
        "});",
        "",
      ].join("\n"),
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig(),
      rules: { ...quietExtras },
    });
    expect(bridgeFindings(result.report.findings).map((f) => f.ruleId)).toEqual([]);
  });

  it("errors when Bridge router shares React Router", async () => {
    const root = await fixture(
      {
        name: "bridge-router-conflict",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
          "react-router-dom": "6.0.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig({
        shared: {
          react: { singleton: true },
          "react-dom/": { singleton: true },
          "react-router-dom": { singleton: true },
        },
      }),
      rules: {
        ...quietExtras,
        "bridge/react-version-entry-mismatch": "off",
        "bridge/provider-shape-invalid": "off",
        "bridge/ssr-server-entry-leak": "off",
        "shared/singleton-risk": "off",
      },
    });
    expect(result.report.findings.map((f) => [f.ruleId, f.severity])).toContainEqual([
      "bridge/router-shared-conflict",
      "error",
    ]);
  });

  it("errors when Bridge entry major disagrees with React", async () => {
    const root = await fixture(
      {
        name: "bridge-mismatch",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v18";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig(),
      rules: {
        ...quietExtras,
        "bridge/router-shared-conflict": "off",
        "bridge/provider-shape-invalid": "off",
        "bridge/ssr-server-entry-leak": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).toContain(
      "bridge/react-version-entry-mismatch",
    );
  });

  it("errors on incomplete createRemoteAppComponent options", async () => {
    const root = await fixture(
      {
        name: "bridge-bad-provider",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      [
        'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
        "export const Remote = createRemoteAppComponent({});",
        "",
      ].join("\n"),
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig(),
      rules: {
        ...quietExtras,
        "bridge/router-shared-conflict": "off",
        "bridge/react-version-entry-mismatch": "off",
        "bridge/ssr-server-entry-leak": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).toContain("bridge/provider-shape-invalid");
  });

  it("errors when browser Bridge entry leaks into a node build", async () => {
    const root = await fixture(
      {
        name: "bridge-ssr-leak",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig({
        target: "node",
      }),
      rules: {
        ...quietExtras,
        "bridge/router-shared-conflict": "off",
        "bridge/react-version-entry-mismatch": "off",
        "bridge/provider-shape-invalid": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).toContain("bridge/ssr-server-entry-leak");
  });

  it("keeps positive Bridge findings from readable files when another source read fails", async () => {
    const root = await fixture(
      {
        name: "bridge-ssr-leak-with-read-failure",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const unreadable = path.join(root, "src/unreadable.tsx");
    await fs.writeFile(unreadable, "export const hidden = true;\n");
    const originalReadFile = fs.readFile;
    const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
      if (path.resolve(String(file)) === unreadable) throw new Error("fixture read failed");
      return originalReadFile(file, options);
    });
    try {
      const result = await analyze({
        root,
        bundler: "vite",
        mode: "ci",
        output: { formats: [] },
        moduleFederation: goodBridgeConfig({ target: "node" }),
        rules: {
          ...quietExtras,
          "bridge/router-shared-conflict": "off",
          "bridge/react-version-entry-mismatch": "off",
          "bridge/provider-shape-invalid": "off",
        },
      });
      expect(result.facts.imports.sourceReadFailures).toContain("src/unreadable.tsx");
      expect(result.report.findings.map((f) => f.ruleId)).toContain("bridge/ssr-server-entry-leak");
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("keeps readable Bridge fallback violations visible after a source read failure", async () => {
    const root = await fixture(
      {
        name: "bridge-fallback-with-read-failure",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      [
        'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
        "export const Remote = createRemoteAppComponent({ loader: async () => ({ default: () => null }) });",
        "",
      ].join("\n"),
    );
    const unreadable = path.join(root, "src/unreadable.tsx");
    await fs.writeFile(unreadable, "export const hidden = true;\n");
    const originalReadFile = fs.readFile;
    const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
      if (path.resolve(String(file)) === unreadable) throw new Error("fixture read failed");
      return originalReadFile(file, options);
    });
    try {
      const result = await analyze({
        root,
        bundler: "rspack",
        mode: "ci",
        output: { formats: [] },
        moduleFederation: goodBridgeConfig(),
        rules: {
          ...quietExtras,
          "bridge/router-shared-conflict": "off",
          "bridge/react-version-entry-mismatch": "off",
          "bridge/ssr-server-entry-leak": "off",
          "bridge/provider-shape-invalid": "off",
        },
      });
      expect(result.facts.imports.sourceReadFailures).toContain("src/unreadable.tsx");
      expect(result.report.findings.map((f) => f.ruleId)).toContain(
        "bridge/missing-fallback-loading",
      );
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("does not claim a Bridge helper is absent while source evidence is incomplete", async () => {
    const root = await fixture(
      {
        name: "bridge-manual-with-read-failure",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
          "@module-federation/runtime": "0.0.0",
        },
      },
      'import { loadRemote } from "@module-federation/runtime";\nloadRemote("shop/App");\n',
    );
    const unreadable = path.join(root, "src/unreadable.tsx");
    await fs.writeFile(unreadable, "export const hidden = true;\n");
    const originalReadFile = fs.readFile;
    const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
      if (path.resolve(String(file)) === unreadable) throw new Error("fixture read failed");
      return originalReadFile(file, options);
    });
    try {
      const result = await analyze({
        root,
        bundler: "rspack",
        mode: "ci",
        output: { formats: [] },
        moduleFederation: goodBridgeConfig({
          remotes: {
            shop: {
              name: "shop",
              entry: "https://example.test/mf-manifest.json",
              shareScope: "default",
            },
          },
        }),
        rules: {
          ...quietExtras,
          "bridge/router-shared-conflict": "off",
          "bridge/react-version-entry-mismatch": "off",
          "bridge/ssr-server-entry-leak": "off",
          "bridge/provider-shape-invalid": "off",
        },
      });
      expect(result.facts.imports.sourceReadFailures).toContain("src/unreadable.tsx");
      expect(result.report.findings.map((f) => f.ruleId)).not.toContain(
        "bridge/consumer-api-manual",
      );
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("stays quiet for node builds that import Bridge /server only", async () => {
    const root = await fixture(
      {
        name: "bridge-ssr-server",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
        },
      },
      'import "@module-federation/bridge-react/server";\n',
    );
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig({
        target: "node",
      }),
      rules: {
        ...quietExtras,
        "bridge/router-shared-conflict": "off",
        "bridge/react-version-entry-mismatch": "off",
        "bridge/provider-shape-invalid": "off",
        "shared/unused": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).not.toContain(
      "bridge/ssr-server-entry-leak",
    );
  });

  it("allows shared React Router when bridge.disableAlias is true", async () => {
    const root = await fixture(
      {
        name: "bridge-disable-alias",
        dependencies: {
          react: "19.1.1",
          "@module-federation/bridge-react": "0.2.0",
          "react-router-dom": "6.0.0",
        },
      },
      'import "@module-federation/bridge-react/v19";\n',
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: goodBridgeConfig({
        bridge: { enableBridgeRouter: true, disableAlias: true },
        shared: {
          react: { singleton: true },
          "react-dom/": { singleton: true },
          "react-router-dom": { singleton: true },
        },
      }),
      rules: {
        ...quietExtras,
        "bridge/react-version-entry-mismatch": "off",
        "bridge/provider-shape-invalid": "off",
        "bridge/ssr-server-entry-leak": "off",
        "shared/singleton-risk": "off",
        "shared/unused": "off",
      },
    });
    expect(result.report.findings.map((f) => f.ruleId)).not.toContain(
      "bridge/router-shared-conflict",
    );
  });

  it("produces zero bridge error findings on non-bridge apps", async () => {
    const root = await fixture(
      {
        name: "plain",
        dependencies: { react: "19.1.1", "@module-federation/vite": "2.8.0" },
      },
      'import "react";\n',
    );
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        shared: { react: { singleton: true } },
        target: "node",
      },
      rules: { ...quietExtras },
    });
    expect(
      bridgeFindings(result.report.findings).filter((f) =>
        (ERROR_RULES as readonly string[]).includes(f.ruleId),
      ),
    ).toEqual([]);
  });

  it("registers the four Bridge error rules", () => {
    const ids = builtInRules.map((rule) => rule.meta.id);
    for (const id of ERROR_RULES) expect(ids).toContain(id);
  });
});
