import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";
import { defineRule } from "../../src/rules.js";
import type { ProjectFacts } from "../../src/types.js";
import { countPathReads } from "../helpers/fs-io.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(source: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-hotpath-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "hotpath",
      dependencies: {
        react: "19.1.1",
        "@module-federation/bridge-react": "0.2.0",
      },
    }),
  );
  await fs.writeFile(path.join(root, "src/index.tsx"), source);
  return root;
}

const quiet = {
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "doctor/partial-analysis": "off",
  "config/plugin-package-mismatch": "off",
  "bridge/react-version-entry-prefer": "off",
  "bridge/react-dom-prefix-missing": "off",
  "bridge/lazy-plugin-unregistered": "off",
  "bridge/router-implicit-enable": "off",
} as const;

const moduleFederation = {
  name: "host",
  bridge: { enableBridgeRouter: true },
  runtimePlugins: ["@module-federation/bridge-react/plugin"],
  shared: {
    react: { singleton: true },
    "react-dom/": { singleton: true },
  },
};

const incompleteProvider = [
  'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
  "export const Remote = createRemoteAppComponent({});",
  "",
].join("\n");

describe("analysis hot path", () => {
  it("reuses collected source texts instead of re-reading them in rules", async () => {
    const root = await fixture(incompleteProvider);
    const sourceFile = path.join(root, "src/index.tsx");
    const spy = countPathReads(sourceFile);
    try {
      const result = await analyze({
        root,
        bundler: "rspack",
        mode: "ci",
        output: { formats: [], write: false },
        moduleFederation,
        rules: {
          ...quiet,
          "bridge/router-shared-conflict": "off",
          "bridge/react-version-entry-mismatch": "off",
          "bridge/ssr-server-entry-leak": "off",
        },
      });
      expect(result.report.findings.map((finding) => finding.ruleId)).toContain(
        "bridge/provider-shape-invalid",
      );
      expect(spy.reads()).toBe(1);
    } finally {
      spy.restore();
    }
  });

  it("shares one frozen facts object across rules and exposes collected source texts", async () => {
    const seen: ProjectFacts[] = [];
    const probe = (id: string) =>
      defineRule({
        meta: {
          id,
          defaultSeverity: "info",
          supportedBundlers: ["unknown", "vite", "rspack", "rsbuild", "webpack", "modern"],
          documentation: `/rules/${id}`,
        },
        check(context) {
          seen.push(context.facts);
          expect(() => {
            (context.facts as { project: { name: string } }).project.name = "mutated";
          }).toThrow();
          expect(context.sourceTexts?.["src/index.tsx"]).toContain("createRemoteAppComponent");
        },
      });
    const root = await fixture(incompleteProvider);
    await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      failOn: "never",
      output: { formats: [], write: false },
      moduleFederation,
      extends: [probe("test/facts-a"), probe("test/facts-b")],
      rules: {
        ...quiet,
        "bridge/router-shared-conflict": "off",
        "bridge/react-version-entry-mismatch": "off",
        "bridge/ssr-server-entry-leak": "off",
        "bridge/provider-shape-invalid": "off",
      },
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("does not persist collected source texts on project.json", async () => {
    const root = await fixture(
      [
        'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
        "export const Remote = createRemoteAppComponent({ uniqueHotpathMarker: true });",
        "",
      ].join("\n"),
    );
    const output = path.join(root, ".mf/doctor");
    await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      failOn: "never",
      output: { directory: output, formats: ["json"], write: true },
      moduleFederation,
      rules: {
        ...quiet,
        "bridge/router-shared-conflict": "off",
        "bridge/react-version-entry-mismatch": "off",
        "bridge/ssr-server-entry-leak": "off",
        "bridge/provider-shape-invalid": "off",
      },
    });
    const project = JSON.parse(await fs.readFile(path.join(output, "project.json"), "utf8")) as {
      sourceTexts?: unknown;
    };
    expect(project.sourceTexts).toBeUndefined();
    expect(JSON.stringify(project)).not.toContain("uniqueHotpathMarker");
  });

  it("does not re-read a scanned runtime plugin during contract collection", async () => {
    const root = await fixture("export {};\n");
    const pluginSource = `export default function plugin() {
  return { name: "hotpath-plugin" };
}
`;
    const pluginFile = path.join(root, "src/runtime-plugin.ts");
    await fs.writeFile(pluginFile, pluginSource);
    const spy = countPathReads(pluginFile);
    try {
      const result = await analyze({
        root,
        bundler: "rspack",
        mode: "ci",
        failOn: "never",
        output: { formats: [], write: false },
        moduleFederation: {
          ...moduleFederation,
          runtimePlugins: ["./src/runtime-plugin.ts"],
        },
        rules: quiet,
      });
      expect(result.facts.runtimePluginContracts ?? []).toEqual([]);
      expect(spy.reads()).toBe(1);
    } finally {
      spy.restore();
    }
  });
});
