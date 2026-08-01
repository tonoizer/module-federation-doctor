import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UnpluginOptions } from "unplugin";
import { analyze } from "../../src/engine.js";
import { viteDoctor } from "../../src/plugin.js";
import type { DoctorOptions, OutputFormat, RuleSetting } from "../../src/types.js";
import { detectViteLifecycle } from "../../src/vite-lifecycle.js";

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

async function makeRoot(deps: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-vite-lifecycle-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "vite-lifecycle",
      dependencies: {
        "@module-federation/vite": "1.0.0",
        ...deps,
      },
    }),
  );
  return root;
}

function doctorOptions(root: string): DoctorOptions {
  return {
    root,
    bundler: "vite",
    mode: "ci",
    output: { formats: [] as OutputFormat[] },
    moduleFederation: {
      name: "vite_lifecycle",
      filename: "remoteEntry.js",
      exposes: { "./Widget": "./src/Widget.ts" },
      shared: {},
    },
    rules: {
      "artifact/remote-entry-missing": "off",
      "artifact/types-missing": "off",
      "config/plugin-package-mismatch": "off",
    } satisfies Record<string, RuleSetting>,
  };
}

describe("detectViteLifecycle", () => {
  it("detects classic Vite as rollup engine", async () => {
    const root = await makeRoot({ vite: "5.0.0" });
    const lifecycle = await detectViteLifecycle(root);
    expect(lifecycle).toEqual({
      flavor: "vite",
      engine: "rollup",
      evidence: [],
    });
  });

  it("detects rolldown-vite flavor from declared packages", async () => {
    const root = await makeRoot({ "rolldown-vite": "7.0.0", rolldown: "1.0.0" });
    const lifecycle = await detectViteLifecycle(root);
    expect(lifecycle.flavor).toBe("rolldown-vite");
    expect(lifecycle.engine).toBe("rolldown");
    expect(lifecycle.evidence).toEqual(expect.arrayContaining(["rolldown", "rolldown-vite"]));
  });

  it("detects vite-plus flavor from declared packages", async () => {
    const root = await makeRoot({
      "vite-plus": "0.2.0",
      "@voidzero-dev/vite-plus-core": "0.2.0",
    });
    const lifecycle = await detectViteLifecycle(root);
    expect(lifecycle.flavor).toBe("vite-plus");
    expect(lifecycle.engine).toBe("rolldown");
    expect(lifecycle.evidence).toEqual(
      expect.arrayContaining(["vite-plus", "@voidzero-dev/vite-plus-core"]),
    );
  });

  it("prefers public rolldownVersion hook meta for engine", async () => {
    const root = await makeRoot({ vite: "8.0.0" });
    const lifecycle = await detectViteLifecycle(root, { rolldownVersion: "1.0.2" });
    expect(lifecycle.engine).toBe("rolldown");
    expect(lifecycle.flavor).toBe("rolldown-vite");
    expect(lifecycle.evidence).toContain("meta.rolldownVersion");
  });

  it("treats bare rolldown as weak evidence without reclassifying classic Vite", async () => {
    const root = await makeRoot({ vite: "5.4.0", rolldown: "1.0.0" });
    const lifecycle = await detectViteLifecycle(root);
    expect(lifecycle.flavor).toBe("vite");
    expect(lifecycle.engine).toBe("rollup");
    expect(lifecycle.evidence).toEqual(["rolldown"]);
  });
});

describe("vite adapter Rolldown / Vite Plus lifecycle", () => {
  it("keeps resolved multi-output evidence exact and bounded", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    await fs.mkdir(path.join(root, "artifacts/web"), { recursive: true });
    await fs.mkdir(path.join(root, "artifacts/node"), { recursive: true });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    const manifest = JSON.stringify({ name: "vite_lifecycle", exposes: [], shared: [] });
    await fs.writeFile(path.join(root, "artifacts/web/custom-manifest.json"), manifest);
    await fs.writeFile(path.join(root, "artifacts/node/custom-manifest.json"), "bad json");
    await fs.writeFile(path.join(root, "dist/custom-manifest.json"), manifest);

    const raw = viteDoctor.raw(
      {
        ...doctorOptions(root),
        artifactNames: { manifest: ["custom-manifest.json"], stats: ["custom-stats.json"] },
        rules: {
          ...doctorOptions(root).rules,
          "artifact/manifest-invalid": "off",
          "artifact/manifest-name-mismatch": "off",
          "artifact/manifest-disabled": "off",
          "doctor/partial-analysis": "off",
        },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "artifacts/web", write: true },
    });
    await plugin.writeBundle!.call(
      {},
      { dir: path.join(root, "artifacts/web") },
      { "remoteEntry.js": {}, "custom-manifest.json": {} },
    );
    await plugin.writeBundle!.call(
      {},
      { dir: path.join(root, "artifacts/node") },
      { "server.js": {}, "custom-manifest.json": {} },
    );

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{
        outputRoot?: string;
        emittedAssets: string[];
        artifacts: Array<{ path: string }>;
      }>;
    };
    expect(project.builds).toHaveLength(2);
    expect(project.builds.map((build) => build.outputRoot)).toEqual([
      "artifacts/node",
      "artifacts/web",
    ]);
    expect(project.builds[0]?.emittedAssets).toEqual([
      "artifacts/node/custom-manifest.json",
      "artifacts/node/server.js",
    ]);
    expect(project.builds[0]?.artifacts.map((record) => record.path)).toEqual([
      "artifacts/node/custom-manifest.json",
    ]);
    expect(project.builds[1]?.artifacts.map((record) => record.path)).toEqual([
      "artifacts/web/custom-manifest.json",
    ]);
    expect(JSON.stringify(project)).not.toContain(root);
  });

  it("writeBundle records rolldown lifecycle and emit capabilities when assets exist", async () => {
    const root = await makeRoot({ "rolldown-vite": "7.0.0", rolldown: "1.0.0" });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist/remoteEntry.js"), "export {};\n");

    const raw = viteDoctor.raw(doctorOptions(root), {
      framework: "vite",
      versions: { unplugin: "3.3.0" },
    } as never);
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    expect(typeof plugin.writeBundle).toBe("function");
    expect(typeof plugin.closeBundle).toBe("function");

    plugin.configResolved?.({ root, mode: "production", build: { outDir: "dist", write: true } });
    await plugin.writeBundle!.call(
      {
        meta: { rolldownVersion: "1.0.2" },
      },
      { dir: path.join(root, "dist") },
      { "remoteEntry.js": { type: "asset" } },
    );

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      bundler: {
        name: string;
        lifecycle?: {
          flavor: string;
          engine: string;
          postEmitHook?: string;
          evidence: string[];
        };
      };
      capabilities: { emittedAssets: boolean };
      artifacts: { emittedAssets: string[] };
    };

    expect(project.bundler.name).toBe("vite");
    expect(project.bundler.lifecycle).toMatchObject({
      flavor: "rolldown-vite",
      engine: "rolldown",
      postEmitHook: "writeBundle",
    });
    expect(project.capabilities.emittedAssets).toBe(true);
    expect(project.artifacts.emittedAssets).toEqual(
      expect.arrayContaining(["dist/remoteEntry.js"]),
    );
  });

  it("defers empty Rolldown writeBundle to closeBundle", async () => {
    const root = await makeRoot({ "rolldown-vite": "7.0.0" });
    const raw = viteDoctor.raw(doctorOptions(root), {
      framework: "vite",
      versions: { unplugin: "3.3.0" },
    } as never);
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;

    plugin.configResolved?.({ root, mode: "production", build: { outDir: "dist", write: true } });
    await plugin.writeBundle!.call(
      { meta: { rolldownVersion: "1.0.2" } },
      { dir: path.join(root, "dist") },
      {},
    );
    await expect(fs.access(path.join(root, ".mf/doctor/project.json"))).rejects.toThrow();

    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist/remoteEntry.js"), "export {};\n");
    await plugin.closeBundle!.call({
      meta: { rolldownVersion: "1.0.2" },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      bundler: { lifecycle?: { postEmitHook?: string; engine: string } };
      capabilities: { emittedAssets: boolean };
    };
    expect(project.bundler.lifecycle?.engine).toBe("rolldown");
    expect(project.bundler.lifecycle?.postEmitHook).toBe("closeBundle");
    expect(project.capabilities.emittedAssets).toBe(false);
  });

  it("emits doctor/partial-analysis when Rolldown emit facts stay missing", async () => {
    const root = await makeRoot({ "vite-plus": "0.2.0" });
    const raw = viteDoctor.raw(
      {
        ...doctorOptions(root),
        output: { formats: ["json"] },
        rules: {
          "artifact/remote-entry-missing": "off",
          "artifact/types-missing": "off",
          "config/plugin-package-mismatch": "off",
          "doctor/partial-analysis": "warning",
        },
      },
      {
        framework: "vite",
        versions: { unplugin: "3.3.0" },
      } as never,
    );
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;

    await plugin.writeBundle!.call({
      meta: { rolldownVersion: "1.0.0" },
    });
    await plugin.closeBundle!.call({
      meta: { rolldownVersion: "1.0.0" },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      bundler: { lifecycle?: { flavor: string; engine: string } };
      capabilities: { emittedAssets: boolean };
    };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string; evidence?: { missing?: string[] } }> };

    expect(project.bundler.lifecycle).toMatchObject({
      flavor: "vite-plus",
      engine: "rolldown",
    });
    expect(project.capabilities.emittedAssets).toBe(false);
    expect(report.findings.some((item) => item.ruleId === "doctor/partial-analysis")).toBe(true);
    expect(
      report.findings.find((item) => item.ruleId === "doctor/partial-analysis")?.evidence?.missing,
    ).toEqual(expect.arrayContaining(["emittedAssets"]));
  });

  it("records classic Vite lifecycle without requiring closeBundle", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist/remoteEntry.js"), "export {};\n");

    const result = await analyze(doctorOptions(root));
    expect(result.facts.bundler.lifecycle).toMatchObject({
      flavor: "vite",
      engine: "rollup",
    });
  });
});
