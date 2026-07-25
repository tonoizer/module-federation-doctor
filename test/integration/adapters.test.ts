import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { analyze, analyzeFederation } from "../../src/engine.js";
import type { BundlerName, DoctorOptions, ProjectFacts } from "../../src/types.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function project(bundler: BundlerName, kind: "clean" | "warning" | "error") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-${bundler}-${kind}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/Widget.ts"), 'import "@scope/pkg/deep";\nexport {};\n');
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: `${bundler}-${kind}`,
      dependencies: {
        [`@module-federation/${bundler === "rspack" ? "enhanced" : bundler === "rsbuild" ? "rsbuild-plugin" : "vite"}`]:
          "1.0.0",
        "@scope/pkg": "1.0.0",
      },
    }),
  );
  const base: DoctorOptions = {
    root,
    bundler,
    mode: "ci",
    output: { formats: [] },
    moduleFederation: {
      name: `${bundler}_${kind}`,
      manifest: true,
      exposes: { "./Widget": "./src/Widget.ts" },
      shared: {},
    },
    rules: {
      "artifact/remote-entry-missing": "off",
      "artifact/types-missing": "off",
      "doctor/partial-analysis": "off",
    },
  };
  if (kind === "warning")
    base.moduleFederation = {
      ...base.moduleFederation,
      shared: { "@scope/pkg": { eager: true, singleton: false } },
    };
  if (kind === "error")
    base.moduleFederation = {
      ...base.moduleFederation,
      exposes: { Widget: "./src/missing.ts" },
    };
  return analyze(base);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("adapter cases", () => {
  for (const bundler of ["vite", "rspack", "rsbuild"] as const) {
    it(`${bundler}: clean, warning, and error policy`, async () => {
      const clean = await project(bundler, "clean");
      const warning = await project(bundler, "warning");
      const error = await project(bundler, "error");
      expect(clean.report.findings).toEqual([]);
      expect(warning.exitCode).toBe(0);
      expect(warning.report.findings.some((item) => item.severity === "warning")).toBe(true);
      expect(error.exitCode).toBe(1);
      expect(error.report.findings.some((item) => item.severity === "error")).toBe(true);
    });
  }

  it("builds the clean mixed-federation example through real bundler hooks", async () => {
    const repository = path.resolve(import.meta.dirname, "../..");
    const packages = [
      "@mfdoctor-example/host-vite",
      "@mfdoctor-example/remote-rspack",
      "@mfdoctor-example/remote-rsbuild",
    ];
    const baseEnvironment: NodeJS.ProcessEnv = { ...process.env, CI: "", NODE_ENV: "production" };
    delete baseEnvironment.VITEST;
    delete baseEnvironment.VITEST_WORKER_ID;

    for (const packageName of packages) {
      const { stdout, stderr } = await execFileAsync("pnpm", ["--filter", packageName, "build"], {
        cwd: repository,
        env: baseEnvironment,
      });
      expect(stderr).not.toContain("Doctor could not complete");
      expect(stdout).toContain("Module Federation Doctor: no findings.");
    }
  }, 120_000);

  it("demos intentional showcase findings through the CLI", async () => {
    const repository = path.resolve(import.meta.dirname, "../..");
    await execFileAsync("pnpm", ["build"], { cwd: repository });
    const { stdout } = await execFileAsync("node", ["scripts/demo-showcase.mjs"], {
      cwd: repository,
    });
    expect(stdout).toContain("ok examples/showcase/name-required");
    expect(stdout).toContain("ok examples/showcase/expose-key-invalid");
    expect(stdout).toContain("ok examples/showcase/eager-without-singleton");
  }, 60_000);
});

describe("cross-project analysis", () => {
  it("finds version, scope, singleton, and provider conflicts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-federation-"));
    roots.push(root);
    const make = (
      name: string,
      version: string,
      requiredVersion: string,
      singleton: boolean,
      shareScope: string,
    ): ProjectFacts => ({
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
        shared: {
          react: {
            package: "react",
            singleton,
            eager: false,
            requiredVersion,
            shareScope,
            import: false,
          },
        },
      },
      dependencies: { declared: { react: requiredVersion }, installed: { react: version } },
      imports: { sourceFiles: [], specifiers: [], packages: [] },
      artifacts: { emittedAssets: [] },
    });
    const files = [path.join(root, "a.json"), path.join(root, "b.json"), path.join(root, "c.json")];
    await fs.writeFile(files[0]!, JSON.stringify(make("a", "18.3.0", "^18", true, "default")));
    await fs.writeFile(files[1]!, JSON.stringify(make("b", "19.1.1", "^19", false, "other")));
    const missing = make("c", "19.1.1", "^19", true, "default");
    missing.moduleFederation!.shared = {};
    missing.moduleFederation!.name = "a";
    enableExternalRuntime(missing);
    await fs.writeFile(files[2]!, JSON.stringify(missing));
    const ids = (await analyzeFederation(files)).map((item) => item.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "federation/version-conflict",
        "federation/share-scope-mismatch",
        "federation/missing-provider",
        "shared/singleton-mismatch",
        "federation/name-conflict",
        "federation/external-runtime-provider-missing",
      ]),
    );
  });
});

function enableExternalRuntime(facts: ProjectFacts) {
  facts.moduleFederation!.experiments = {
    asyncStartup: false,
    externalRuntime: true,
    provideExternalRuntime: false,
  };
}
