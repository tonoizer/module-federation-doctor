import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UnpluginContextMeta, UnpluginOptions } from "unplugin";
import { rsbuildDoctor, viteDoctor } from "../../src/plugin.js";
import type { ModuleFederationConfigLike, RuleSetting } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

type VitePluginHooks = UnpluginOptions & {
  configResolved?: (config: unknown) => void;
  writeBundle?: (
    this: unknown,
    outputOptions?: { dir?: string; file?: string },
    bundle?: Record<string, unknown>,
  ) => Promise<void>;
  closeBundle?: (this: unknown) => Promise<void>;
};

function asSinglePlugin(value: UnpluginOptions | UnpluginOptions[]): UnpluginOptions {
  expect(Array.isArray(value)).toBe(false);
  return value as UnpluginOptions;
}

async function makeRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-${name}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "dist/remoteEntry.js"), "export {};\n");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name,
      dependencies: {
        "@module-federation/vite": "1.0.0",
        "@module-federation/rsbuild-plugin": "1.0.0",
      },
    }),
  );
  return root;
}

const quietRules = {
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "artifact/dts-disabled": "off",
  "artifact/expose-missing": "off",
  "config/plugin-package-mismatch": "off",
  "config/name-required": "off",
  "doctor/partial-analysis": "off",
  "vite/host-init-inject-ssr": "off",
  "vite/manual-chunks-conflict": "off",
  "vite/server-origin": "off",
  "vite/alias-share-bypass": "off",
  "vite/remote-hmr-dev": "off",
} satisfies Record<string, RuleSetting>;

function instanceConfig(name: string, filename: string): ModuleFederationConfigLike {
  return {
    name,
    filename,
    dts: false,
    manifest: false,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  };
}

async function readDoctorOutput(root: string): Promise<{
  project: { bundler: { moduleFederationPluginCount?: number } };
  report: { findings: Array<{ ruleId: string }> };
}> {
  return {
    project: JSON.parse(await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8")) as {
      bundler: { moduleFederationPluginCount?: number };
    },
    report: JSON.parse(await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8")) as {
      findings: Array<{ ruleId: string }>;
    },
  };
}

function duplicateFindings(report: { findings: Array<{ ruleId: string }> }): unknown[] {
  return report.findings.filter((finding) => finding.ruleId === "config/duplicate-plugin-registration");
}

async function runVitePlugins(
  root: string,
  plugins: unknown[],
  options: Record<string, unknown> = {},
): Promise<void> {
  const raw = viteDoctor.raw(
    {
      root,
      bundler: "vite",
      mode: "ci",
      failOn: "never",
      output: { formats: ["json"] },
      rules: quietRules,
      ...options,
    },
    { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
  );
  const plugin = asSinglePlugin(raw) as VitePluginHooks;
  plugin.configResolved?.({
    root,
    mode: "production",
    build: { outDir: "dist", write: true },
    plugins,
  });
  await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "remoteEntry.js": {} });
  await plugin.closeBundle!.call({});
}

async function runRsbuildPlugins(
  root: string,
  plugins: unknown[],
  options: Record<string, unknown> = {},
  via: "getPlugins" | "getRsbuildConfig" = "getRsbuildConfig",
): Promise<void> {
  const plugin = asSinglePlugin(
    rsbuildDoctor.raw(
      {
        root,
        bundler: "rsbuild",
        mode: "ci",
        failOn: "never",
        output: { formats: ["json"] },
        rules: quietRules,
        ...options,
      },
      { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
    ),
  );
  let afterBuild:
    | ((args: { stats: { toJson: (options: { assets: boolean }) => unknown } }) => Promise<void>)
    | undefined;
  plugin.rsbuild?.setup?.({
    context: { rootPath: root },
    ...(via === "getPlugins"
      ? { getPlugins: () => plugins }
      : { getRsbuildConfig: () => ({ plugins }) }),
    onAfterBuild(fn: typeof afterBuild) {
      afterBuild = fn;
    },
  } as never);

  await afterBuild!({
    stats: {
      toJson: () => ({
        name: "web",
        outputPath: path.join(root, "dist"),
        mode: "production",
        assets: [{ name: "remoteEntry.js" }],
      }),
    },
  });
}

describe("Vite/Rsbuild duplicate plugin registration", () => {
  it("reports two identical unnamed Vite federation registrations", async () => {
    const root = await makeRoot("vite-duplicate-unnamed");
    const config = instanceConfig("checkout", "checkout.js");
    await runVitePlugins(root, [
      { name: "module-federation-vite", _options: config },
      { name: "vite:module-federation-config" },
      { name: "module-federation-vite", _options: structuredClone(config) },
    ]);
    const { project, report } = await readDoctorOutput(root);
    expect(project.bundler.moduleFederationPluginCount).toBe(2);
    expect(duplicateFindings(report)).toHaveLength(1);
  });

  it("does not report distinct Vite federation configs (multi-instance)", async () => {
    const root = await makeRoot("vite-multi-instance-plugins");
    await runVitePlugins(root, [
      { name: "module-federation-vite", _options: instanceConfig("checkout", "checkout.js") },
      { name: "module-federation-vite", _options: instanceConfig("catalog", "catalog.js") },
    ]);
    const { project, report } = await readDoctorOutput(root);
    expect(project.bundler.moduleFederationPluginCount).toBe(2);
    expect(duplicateFindings(report)).toHaveLength(0);
  });

  it("keeps explicit distinct moduleFederationInstances ahead of unnamed Vite plugins", async () => {
    const root = await makeRoot("vite-explicit-instances");
    await runVitePlugins(
      root,
      [
        { name: "module-federation-vite" },
        { name: "module-federation-vite" },
      ],
      {
        moduleFederationInstances: [
          instanceConfig("checkout", "checkout.js"),
          instanceConfig("catalog", "catalog.js"),
        ],
      },
    );
    const { project, report } = await readDoctorOutput(root);
    expect(project.bundler.moduleFederationPluginCount).toBe(2);
    expect(duplicateFindings(report)).toHaveLength(0);
  });

  it("reports two unnamed Rsbuild federation registrations from the public plugin list", async () => {
    const root = await makeRoot("rsbuild-duplicate-unnamed");
    await runRsbuildPlugins(root, [
      { name: "rsbuild:module-federation-enhanced" },
      [{ name: "rsbuild:module-federation-enhanced" }],
    ]);
    const { project, report } = await readDoctorOutput(root);
    expect(project.bundler.moduleFederationPluginCount).toBe(2);
    expect(duplicateFindings(report)).toHaveLength(1);
  });

  it("keeps explicit distinct moduleFederationInstances ahead of unnamed Rsbuild plugins", async () => {
    const root = await makeRoot("rsbuild-explicit-instances");
    await runRsbuildPlugins(
      root,
      [
        { name: "rsbuild:module-federation-enhanced" },
        { name: "rsbuild:module-federation-enhanced" },
      ],
      {
        moduleFederationInstances: [
          instanceConfig("checkout", "checkout.js"),
          instanceConfig("catalog", "catalog.js"),
        ],
      },
      "getPlugins",
    );
    const { project, report } = await readDoctorOutput(root);
    expect(project.bundler.moduleFederationPluginCount).toBe(2);
    expect(duplicateFindings(report)).toHaveLength(0);
  });
});
