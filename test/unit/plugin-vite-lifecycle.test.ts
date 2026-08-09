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
  config?:
    | ((config: unknown, env?: unknown) => void | Promise<void>)
    | {
        order?: "pre" | "post" | null;
        handler: (config: unknown, env?: unknown) => void | Promise<void>;
      };
  configResolved?: (config: unknown) => void;
  buildStart?: () => void | Promise<void>;
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
      "vite/host-init-inject-ssr": "off",
      "vite/manual-chunks-conflict": "off",
      "vite/server-origin": "off",
      "vite/alias-share-bypass": "off",
      "vite/remote-hmr-dev": "off",
    } satisfies Record<string, RuleSetting>,
  };
}

async function runViteConfigHook(plugin: VitePluginHooks, config: unknown): Promise<void> {
  const hook = plugin.config;
  if (!hook) return;
  if (typeof hook === "function") {
    await hook(config);
    return;
  }
  await hook.handler(config);
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
  it("does not report federation-owned manualChunks as user configuration", async () => {
    const root = await makeRoot({ vite: "8.1.5" });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist/remoteEntry.js"), "export {};\n");

    const raw = viteDoctor.raw(
      {
        ...doctorOptions(root),
        output: { formats: ["json"] },
        rules: {
          ...doctorOptions(root).rules,
          "doctor/partial-analysis": "off",
          "vite/manual-chunks-conflict": "info",
        },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;

    await runViteConfigHook(plugin, {
      root,
      build: { outDir: "dist", rollupOptions: { output: {} } },
    });
    plugin.configResolved?.({
      root,
      mode: "production",
      build: {
        outDir: "dist",
        write: true,
        rollupOptions: { output: { manualChunks: () => "mf-bootstrap" } },
      },
    });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "remoteEntry.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { viteConfig?: { manualChunks?: boolean } } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.bundler.viteConfig?.manualChunks).toBeUndefined();
    expect(
      report.findings.some((finding) => finding.ruleId === "vite/manual-chunks-conflict"),
    ).toBe(false);
  });

  it("keeps an explicitly configured manualChunks advisory", async () => {
    const root = await makeRoot({ vite: "8.1.5" });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist/remoteEntry.js"), "export {};\n");
    const userManualChunks = () => "user-chunk";

    const raw = viteDoctor.raw(
      {
        ...doctorOptions(root),
        output: { formats: ["json"] },
        rules: {
          ...doctorOptions(root).rules,
          "doctor/partial-analysis": "off",
          "vite/manual-chunks-conflict": "info",
        },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;

    await runViteConfigHook(plugin, {
      root,
      build: { outDir: "dist", rolldownOptions: { output: { manualChunks: userManualChunks } } },
    });
    plugin.configResolved?.({
      root,
      mode: "production",
      build: {
        outDir: "dist",
        write: true,
        rollupOptions: { output: { manualChunks: () => "mf-bootstrap" } },
      },
    });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "remoteEntry.js": {} });
    await plugin.closeBundle!.call({});

    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };
    expect(
      report.findings.some((finding) => finding.ruleId === "vite/manual-chunks-conflict"),
    ).toBe(true);
  });

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
    await plugin.closeBundle!.call({});

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
    await plugin.closeBundle!.call({ meta: { rolldownVersion: "1.0.2" } });

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
      postEmitHook: "closeBundle",
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
      builds: Array<{
        emittedAssets: string[];
        capabilities: { emittedAssets: { state: string; source?: string } };
      }>;
    };
    expect(project.bundler.lifecycle?.engine).toBe("rolldown");
    expect(project.bundler.lifecycle?.postEmitHook).toBe("closeBundle");
    // Bounded recovery is partial, never exact compiler evidence.
    expect(project.capabilities.emittedAssets).toBe(false);
    expect(project.builds[0]?.emittedAssets).toEqual(["dist/remoteEntry.js"]);
    expect(project.builds[0]?.capabilities.emittedAssets).toMatchObject({
      state: "partial",
      source: "closeBundle",
    });
  });

  it("records absolute outDir as a safe project-relative output root", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    const absoluteOut = path.join(root, "artifacts", "abs");
    await fs.mkdir(absoluteOut, { recursive: true });
    await fs.writeFile(path.join(absoluteOut, "remoteEntry.js"), "export {};\n");

    const raw = viteDoctor.raw(doctorOptions(root), {
      framework: "vite",
      versions: { unplugin: "3.3.0" },
    } as never);
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: absoluteOut, write: true },
    });
    await plugin.writeBundle!.call(
      {},
      { dir: absoluteOut },
      { "remoteEntry.js": { type: "chunk" } },
    );
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{ outputRoot?: string; emittedAssets: string[] }>;
    };
    expect(project.builds[0]?.outputRoot).toBe("artifacts/abs");
    expect(project.builds[0]?.emittedAssets).toEqual(["artifacts/abs/remoteEntry.js"]);
  });

  it("collects every output before failing policy at closeBundle", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    await fs.mkdir(path.join(root, "dist/web"), { recursive: true });
    await fs.mkdir(path.join(root, "dist/node"), { recursive: true });
    await fs.writeFile(path.join(root, "dist/web/mf-manifest.json"), "bad json");
    await fs.writeFile(
      path.join(root, "dist/node/mf-manifest.json"),
      JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    );
    const raw = viteDoctor.raw(
      {
        ...doctorOptions(root),
        artifactNames: { manifest: ["mf-manifest.json"], stats: [] },
        rules: { ...doctorOptions(root).rules, "artifact/manifest-invalid": "error" },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "dist/web", write: true },
    });
    await plugin.writeBundle!.call(
      {},
      { dir: path.join(root, "dist/web") },
      { "mf-manifest.json": {} },
    );
    await plugin.writeBundle!.call(
      {},
      { dir: path.join(root, "dist/node") },
      { "mf-manifest.json": {} },
    );

    await expect(plugin.closeBundle!.call({})).rejects.toThrow(/policy failed/);
    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { builds: Array<{ outputRoot?: string }> };
    expect(project.builds.map((build) => build.outputRoot)).toEqual(["dist/node", "dist/web"]);
  });

  it("resets output evidence between build cycles", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    await fs.mkdir(path.join(root, "dist/first"), { recursive: true });
    await fs.mkdir(path.join(root, "dist/second"), { recursive: true });
    const raw = viteDoctor.raw(doctorOptions(root), {
      framework: "vite",
      versions: { unplugin: "3.3.0" },
    } as never);
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({ root, mode: "production", build: { outDir: "dist", write: true } });

    const buildStart = plugin.buildStart as (() => void | Promise<void>) | undefined;
    await buildStart?.();
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist/first") }, { "first.js": {} });
    // A new public cycle can start before the previous close hook is observed.
    await buildStart?.();
    await plugin.writeBundle!.call(
      {},
      { dir: path.join(root, "dist/second") },
      { "second.js": {} },
    );
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { builds: Array<{ emittedAssets: string[] }> };
    expect(project.builds).toHaveLength(1);
    expect(project.builds[0]?.emittedAssets).toEqual(["dist/second/second.js"]);
  });

  it("does not claim stale disk evidence when Vite writing is disabled", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(root, "dist/mf-manifest.json"),
      JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    );
    const raw = viteDoctor.raw(doctorOptions(root), {
      framework: "vite",
      versions: { unplugin: "3.3.0" },
    } as never);
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({ root, mode: "production", build: { outDir: "dist", write: false } });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "remoteEntry.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{
        emittedAssets: string[];
        artifacts: unknown[];
        capabilities: { emittedAssets: { state: string }; artifacts: { state: string } };
      }>;
      artifacts: { emittedAssets: string[]; records?: unknown[] };
    };
    expect(project.builds[0]).toMatchObject({
      emittedAssets: [],
      artifacts: [],
      capabilities: {
        emittedAssets: { state: "not-applicable" },
        artifacts: { state: "not-applicable" },
      },
    });
    expect(project.artifacts.emittedAssets).toEqual([]);
    expect(project.artifacts.records ?? []).toEqual([]);
  });

  it("rejects an output root symlink that escapes the project", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-vite-outside-"));
    roots.push(outside);
    await fs.symlink(outside, path.join(root, "escaped"), "dir");
    const raw = viteDoctor.raw(doctorOptions(root), {
      framework: "vite",
      versions: { unplugin: "3.3.0" },
    } as never);
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "escaped", write: true },
    });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "escaped") }, { "remote.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{ outputRoot?: string }>;
      artifacts: { emittedAssets: string[]; records?: unknown[] };
      capabilities: { emittedAssets: boolean };
    };
    expect(project.builds[0]?.outputRoot).toBeUndefined();
    expect(project.artifacts.emittedAssets).toEqual([]);
    expect(project.artifacts.records ?? []).toEqual([]);
    expect(project.capabilities.emittedAssets).toBe(false);
  });

  it("rejects a missing output child below an escaping symlink ancestor", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-vite-outside-"));
    roots.push(outside);
    await fs.symlink(outside, path.join(root, "escaped"), "dir");
    const raw = viteDoctor.raw(doctorOptions(root), {
      framework: "vite",
      versions: { unplugin: "3.3.0" },
    } as never);
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "escaped/missing", write: true },
    });
    await plugin.writeBundle!.call(
      {},
      { dir: path.join(root, "escaped/missing") },
      { "remote.js": {} },
    );
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{ outputRoot?: string }>;
      artifacts: { emittedAssets: string[]; records?: unknown[] };
      capabilities: { emittedAssets: boolean };
    };
    expect(project.builds[0]?.outputRoot).toBeUndefined();
    expect(project.artifacts.emittedAssets).toEqual([]);
    expect(project.artifacts.records ?? []).toEqual([]);
    expect(project.capabilities.emittedAssets).toBe(false);
  });

  it("preserves the public SSR target alongside its target kind", async () => {
    const root = await makeRoot({ vite: "5.4.0" });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    const raw = viteDoctor.raw(doctorOptions(root), {
      framework: "vite",
      versions: { unplugin: "3.3.0" },
    } as never);
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "dist", write: true, ssr: true },
      ssr: { target: "node22" },
    });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "server.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { builds: Array<{ target?: string; targetKind?: string }> };
    expect(project.builds[0]).toMatchObject({ target: "node22", targetKind: "node" });
  });

  it("joins Nuxt's root-relative client output to the SSR close cycle", async () => {
    const root = await makeRoot({ vite: "8.1.5", nuxt: "4.0.0" });
    const clientRoot = path.join(root, ".nuxt/dist/client");
    const serverRoot = path.join(root, ".nuxt/dist/server");
    await fs.mkdir(clientRoot, { recursive: true });
    await fs.mkdir(serverRoot, { recursive: true });
    await fs.writeFile(path.join(clientRoot, "remoteEntry.js"), "export {};\n");
    await fs.writeFile(path.join(serverRoot, "remoteEntry.ssr.js"), "export {};\n");

    const raw = viteDoctor.raw(
      {
        ...doctorOptions(root),
        output: { formats: ["json"] },
        rules: {
          ...doctorOptions(root).rules,
          "artifact/remote-entry-missing": "error",
        },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: ".nuxt/dist/server", write: true, ssr: true },
      ssr: { target: "node" },
    });
    await plugin.writeBundle!.call({}, { dir: serverRoot }, { "remoteEntry.ssr.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { builds: Array<{ outputRoot?: string; targetKind?: string }> };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.builds.map((build) => build.outputRoot)).toEqual([
      ".nuxt/dist/client",
      ".nuxt/dist/server",
    ]);
    expect(project.builds.map((build) => build.targetKind)).toEqual(["web", "node"]);
    expect(
      report.findings.some((finding) => finding.ruleId === "artifact/remote-entry-missing"),
    ).toBe(false);
  });

  it("joins Nitro's public client output to the server close cycle", async () => {
    const root = await makeRoot({ vite: "8.1.5", nitro: "3.0.0" });
    await fs.mkdir(path.join(root, ".output/public/assets"), { recursive: true });
    await fs.mkdir(path.join(root, ".output/server"), { recursive: true });
    await fs.writeFile(path.join(root, ".output/public/remoteEntry.js"), "export {};");
    await fs.writeFile(path.join(root, ".output/public/@mf-types.d.ts"), "export {};");
    await fs.writeFile(path.join(root, ".output/public/mf-stats.json"), "{}");
    await fs.writeFile(
      path.join(root, ".output/public/mf-manifest.json"),
      JSON.stringify({
        id: "vite_lifecycle_nitro",
        name: "vite_lifecycle",
        metaData: {
          name: "vite_lifecycle",
          remoteEntry: { name: "remoteEntry.js", path: "", type: "module" },
          ssrRemoteEntry: { name: "remoteEntry.ssr.js", path: "", type: "module" },
          types: { path: "", name: "" },
        },
        shared: [],
        remotes: [],
        exposes: [
          {
            id: "vite_lifecycle:Widget",
            name: "Widget",
            path: "./Widget",
            assets: { js: { async: [], sync: ["assets/Widget.js"] }, css: { async: [], sync: [] } },
          },
        ],
      }),
    );
    await fs.writeFile(path.join(root, ".output/public/assets/Widget.js"), "export {};");
    await fs.writeFile(path.join(root, ".output/server/remoteEntry.ssr.js"), "export {};");
    await fs.writeFile(path.join(root, ".output/server/index.mjs"), "export {};");

    const raw = viteDoctor.raw(
      {
        ...doctorOptions(root),
        output: { formats: ["json"] },
        rules: {
          ...doctorOptions(root).rules,
          "artifact/remote-entry-missing": "error",
        },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: ".output/server", write: true, ssr: true },
      ssr: { target: "node" },
    });
    await plugin.writeBundle!.call(
      {},
      { dir: path.join(root, ".output/server") },
      { "remoteEntry.ssr.js": {}, "index.mjs": {} },
    );
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{
        outputRoot?: string;
        targetKind?: string;
        artifacts: Array<{ path: string }>;
      }>;
      artifacts: { emittedAssets: string[] };
    };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.builds.map((build) => build.outputRoot)).toEqual([
      ".output/public",
      ".output/server",
    ]);
    expect(project.builds.map((build) => build.targetKind)).toEqual(["web", "node"]);
    expect(project.artifacts.emittedAssets).toEqual(
      expect.arrayContaining([
        ".output/public/mf-manifest.json",
        ".output/public/remoteEntry.js",
        ".output/server/remoteEntry.ssr.js",
      ]),
    );
    expect(project.builds.flatMap((build) => build.artifacts.map((record) => record.path))).toEqual(
      expect.arrayContaining([".output/public/mf-manifest.json", ".output/public/mf-stats.json"]),
    );
    expect(
      report.findings.some((finding) => finding.ruleId === "artifact/remote-entry-missing"),
    ).toBe(false);
    expect(report.findings.some((finding) => finding.ruleId === "doctor/partial-analysis")).toBe(
      false,
    );
  });

  it("joins Nitro's transient SSR environment to the public client output", async () => {
    const root = await makeRoot({ vite: "8.1.5", nitro: "3.0.0" });
    const publicRoot = path.join(root, ".output/public");
    const transientSsrRoot = path.join(root, "node_modules/.nitro/vite/services/ssr");
    await fs.mkdir(publicRoot, { recursive: true });
    await fs.mkdir(transientSsrRoot, { recursive: true });
    await fs.writeFile(path.join(publicRoot, "remoteEntry.js"), "export {};");
    await fs.writeFile(path.join(transientSsrRoot, "remoteEntry.ssr.js"), "export {};");

    const raw = viteDoctor.raw(
      {
        ...doctorOptions(root),
        output: { formats: ["json"] },
        rules: {
          ...doctorOptions(root).rules,
          "artifact/remote-entry-missing": "error",
          "doctor/partial-analysis": "off",
        },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = (Array.isArray(raw) ? raw[0]! : raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "node_modules/.nitro/vite/services/ssr", write: true, ssr: true },
      ssr: { target: "node" },
    });
    await plugin.writeBundle!.call({}, { dir: transientSsrRoot }, { "remoteEntry.ssr.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { builds: Array<{ outputRoot?: string; emittedAssets: string[] }> };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.builds.map((build) => build.outputRoot)).toEqual([
      ".output/public",
      "node_modules/.nitro/vite/services/ssr",
    ]);
    expect(project.builds[0]?.emittedAssets).toContain(".output/public/remoteEntry.js");
    expect(
      report.findings.some((finding) => finding.ruleId === "artifact/remote-entry-missing"),
    ).toBe(false);
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
