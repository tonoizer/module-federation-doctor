import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeRuntime,
  correlateRuntime,
  loadRuntimeTraceFile,
  parseRuntimeTraces,
  RuntimeTraceError,
} from "../../src/runtime-trace.js";
import type { ProjectFacts } from "../../src/types.js";

const roots: string[] = [];
const fixtureRoot = path.resolve("fixtures/runtime-traces");

async function writeProject(facts: ProjectFacts): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-runtime-"));
  roots.push(root);
  const file = path.join(root, "project.json");
  await fs.writeFile(file, JSON.stringify(facts));
  return file;
}

function baseProject(overrides: Partial<ProjectFacts> & { name: string }): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: overrides.name, root: "." },
    bundler: { name: "vite", mode: "production" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: true,
      stats: false,
      emittedAssets: true,
      installedVersions: true,
    },
    moduleFederation: {
      name: overrides.name,
      exposes: {},
      remotes: {},
      shared: {},
      ...overrides.moduleFederation,
    },
    dependencies: {
      declared: { react: "^19.0.0" },
      installed: { react: "19.1.1" },
      ...overrides.dependencies,
    },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: ["react"],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: ["source"],
    },
    artifacts: {
      emittedAssets: ["remoteEntry.js"],
      ...overrides.artifacts,
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("runtime trace import", () => {
  it("redacts secrets and collapses private URLs while parsing", async () => {
    const traces = await loadRuntimeTraceFile(path.join(fixtureRoot, "remote-load-failed.json"));
    const trace = traces[0]!;
    expect(trace.remote?.entry).toBe("https://cdn.internal.example/.../mf-manifest.json");
    expect(trace.moduleInfo?.publicPath).toBe("https://cdn.internal.example/.../build");
    expect(JSON.stringify(trace)).not.toMatch(/secret-token|Bearer|session=/);
  });

  it("correlates remote load failures with project remotes", async () => {
    const host = baseProject({
      name: "host",
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
      artifacts: {
        emittedAssets: [],
        manifest: {
          path: "mf-manifest.json",
          valid: true,
          id: "host",
          name: "host",
          publicPath: "https://cdn.example.com/host/",
          exposes: [],
          shared: [],
        },
      },
    });
    const remote = baseProject({ name: "checkout" });
    const traces = await loadRuntimeTraceFile(path.join(fixtureRoot, "remote-load-failed.json"));
    const findings = correlateRuntime(traces, [host, remote]);
    expect(findings.map((item) => item.ruleId).sort()).toEqual([
      "runtime/error-correlated",
      "runtime/remote-load-failed",
    ]);
    expect(findings.find((item) => item.ruleId === "runtime/remote-load-failed")?.project).toBe(
      "checkout",
    );
  });

  it("correlates init failures and shared mismatches", async () => {
    const host = baseProject({
      name: "host",
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
        shared: {
          react: {
            package: "react",
            singleton: true,
            eager: false,
            requiredVersion: "^19.0.0",
            shareScope: "default",
          },
        },
        experiments: { asyncStartup: true, externalRuntime: true, provideExternalRuntime: false },
      },
    });
    const init = await loadRuntimeTraceFile(path.join(fixtureRoot, "init-failed.json"));
    const shared = await loadRuntimeTraceFile(path.join(fixtureRoot, "shared-mismatch.json"));
    const initFindings = correlateRuntime(init, [host]);
    const sharedFindings = correlateRuntime(shared, [host]);
    expect(initFindings.some((item) => item.ruleId === "runtime/init-failed")).toBe(true);
    expect(
      initFindings.find((item) => item.ruleId === "runtime/init-failed")?.evidence,
    ).toMatchObject({
      asyncStartup: true,
      externalRuntime: true,
    });
    expect(sharedFindings.some((item) => item.ruleId === "runtime/shared-mismatch")).toBe(true);
  });

  it("warns when the traced remote is absent from project facts", () => {
    const findings = correlateRuntime(
      parseRuntimeTraces({
        traceId: "mf-unknown",
        remote: { name: "missing-remote" },
        events: [],
      }),
      [baseProject({ name: "host" })],
    );
    expect(findings.map((item) => item.ruleId)).toContain("runtime/remote-unknown");
  });

  it("analyzes fixture traces against project.json files", async () => {
    const hostFile = await writeProject(
      baseProject({
        name: "host",
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
          shared: {
            react: {
              package: "react",
              singleton: true,
              eager: false,
              requiredVersion: "^19.0.0",
              shareScope: "default",
            },
          },
        },
      }),
    );
    const result = await analyzeRuntime({
      tracePath: path.join(fixtureRoot, "shared-mismatch.json"),
      projectFiles: [hostFile],
      formats: [],
    });
    expect(result.exitCode).toBe(1);
    expect(result.summary.traces).toBe(1);
    expect(result.findings.some((item) => item.ruleId === "runtime/shared-mismatch")).toBe(true);
  });

  it("accepts a healthy runtime trace with no findings", async () => {
    const hostFile = await writeProject(
      baseProject({
        name: "host",
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
          shared: {
            react: {
              package: "react",
              singleton: true,
              eager: false,
              requiredVersion: "^19.0.0",
              shareScope: "default",
            },
          },
        },
      }),
    );
    const result = await analyzeRuntime({
      tracePath: path.join(fixtureRoot, "healthy.json"),
      projectFiles: [hostFile],
      formats: ["terminal"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("rejects empty or invalid traces", () => {
    expect(() => parseRuntimeTraces({})).toThrow(RuntimeTraceError);
    expect(() => parseRuntimeTraces([])).toThrow(RuntimeTraceError);
  });
});
