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

  it("normalizes the current upstream report without confusing runtimeVersion with source contract", async () => {
    const [trace] = await loadRuntimeTraceFile(path.join(fixtureRoot, "current-2.5.3.json"));
    expect(trace).toBeDefined();
    expect(trace!).toMatchObject({
      sourceContract: "upstream-observability-2.5.3",
      runtimeVersion: "2.5.0",
      requestId: "remote/Button",
      hostName: "host",
      outcome: "runtime-loaded",
      diagnosis: {
        title: "Remote loaded successfully",
        ownerHint: "remote",
        completedPhases: ["loadRemote"],
      },
    });
    expect(trace!.runtimeVersion).not.toBe(trace!.sourceContract);
  });

  it("accepts all supported report envelopes and keeps partial reports partial", async () => {
    const [direct] = parseRuntimeTraces({ traceId: "direct", status: "pending" });
    expect(direct).toBeDefined();
    expect(direct!.sourceContract).toBe("partial");
    expect(parseRuntimeTraces([direct]).length).toBe(1);
    expect(parseRuntimeTraces({ report: direct }).length).toBe(1);
    expect(parseRuntimeTraces({ reports: [direct] }).length).toBe(1);
    expect(() => parseRuntimeTraces({ projects: 1, findings: [] })).toThrow(/document kind/);
  });

  it("fails closed for malformed, mixed, future, and JSONL-like documents", () => {
    expect(() => parseRuntimeTraces([{ traceId: "ok" }, null])).toThrow(RuntimeTraceError);
    expect(() => parseRuntimeTraces({ reports: [{ traceId: "ok" }, { nope: true }] })).toThrow(
      /shape/,
    );
    expect(() => parseRuntimeTraces({ summary: { outcome: "future-outcome" } })).toThrow(/outcome/);
    expect(() => parseRuntimeTraces({ reports: "events.jsonl" })).toThrow(/reports/);
  });

  it("preserves bounded current error evidence while removing stacks and secrets", () => {
    const [trace] = parseRuntimeTraces({
      traceId: "current-error",
      hostName: "host",
      runtimeVersion: "2.5.0",
      errorStack: "/private/user/project/index.ts:1",
      errorContext: {
        url: "https://user:pass@example.test/a?token=secret",
        authorization: "Bearer secret",
        requestId: "remote/Button",
      },
      summary: {
        outcome: "failed",
        loadedBefore: true,
        phases: { moduleFactory: { status: "error" }, preload: { status: "pending" } },
        error: {
          errorCode: "RUNTIME-007",
          errorName: "Error",
          errorMessage: "factory failed",
          failedPhase: "moduleFactory",
          context: { requestId: "remote/Button" },
        },
      },
      diagnosis: {
        title: "Factory failed",
        ownerHint: "remote",
        facts: {
          safe: "kept",
          stack: "/Users/alice/private/app/index.ts:2",
          trace: "at load (/Users/alice/private/app/index.ts:2)",
          locator: {
            filePath: "/home/alice/app/src/file.ts",
            url: "https://u:p@example.test/a?token=x",
          },
        },
        actions: [{ id: "retry", title: "Retry", errorStack: "/private/app/index.ts:3" }],
      },
    });
    expect(trace).toMatchObject({
      errorCode: "RUNTIME-007",
      errorName: "Error",
      errorMessage: "factory failed",
      failedPhase: "moduleFactory",
      loadedBefore: true,
      diagnosis: { ownerHint: "remote", title: "Factory failed", facts: { safe: "kept" } },
    });
    expect(JSON.stringify(trace)).not.toMatch(
      /errorStack|private\/user|Users\/alice|home\/alice|Bearer|secret/,
    );
  });

  it("keeps phase-specific factory and preload failures", () => {
    const trace = parseRuntimeTraces({
      traceId: "phase-specific",
      remote: { name: "checkout" },
      summary: {
        outcome: "failed",
        phases: {
          moduleFactory: { status: "error" },
          preload: { status: "error" },
        },
      },
    });
    const findings = correlateRuntime(trace, [baseProject({ name: "checkout" })]);
    expect(
      findings.find(
        (item) =>
          item.ruleId === "runtime/remote-load-failed" &&
          item.evidence.phaseKind === "moduleFactory",
      )?.message,
    ).toMatch(/module factory/);
    expect(
      findings.find(
        (item) =>
          item.ruleId === "runtime/remote-load-failed" &&
          item.evidence.phaseKind === "moduleFactory",
      )?.evidence,
    ).toMatchObject({
      phaseKind: "moduleFactory",
    });
  });

  it("migrates legacy init and factory phases without generic-only correlation", () => {
    const [trace] = parseRuntimeTraces({
      remote: { name: "checkout" },
      summary: { outcome: "failed", phases: { factory: { status: "error" } } },
      diagnosis: { owner: "remote" },
    });
    expect(trace!.phases).toEqual({ moduleFactory: { status: "error" } });
    expect(
      correlateRuntime([trace!], [baseProject({ name: "checkout" })]).some(
        (item) => item.ruleId === "runtime/remote-load-failed",
      ),
    ).toBe(true);
  });

  it("uses final recovered outcome over earlier failed phases", () => {
    const trace = parseRuntimeTraces({
      traceId: "recovered-shared",
      hostName: "host",
      remote: { name: "checkout" },
      shared: { package: "react", reason: "custom-share-info-unmatched" },
      summary: {
        outcome: "recovered",
        recovered: true,
        phases: { shared: { status: "error" }, preload: { status: "success" } },
        error: { errorCode: "RUNTIME-007" },
      },
    });
    const findings = correlateRuntime(trace, [
      baseProject({ name: "host" }),
      baseProject({ name: "checkout" }),
    ]);
    expect(findings.some((finding) => finding.ruleId === "runtime/shared-mismatch")).toBe(false);
    expect(findings.every((finding) => finding.severity !== "error")).toBe(true);
  });

  it("keeps network/shared/unknown ownership neutral and order independent", () => {
    const trace = parseRuntimeTraces({
      traceId: "ambiguous",
      hostName: "host",
      remote: { name: "remote" },
      ownerHint: "network",
      summary: { outcome: "failed", phases: { remoteEntryInit: { status: "error" } } },
    });
    const projects = [baseProject({ name: "remote" }), baseProject({ name: "host" })];
    const findings = correlateRuntime(trace, projects);
    expect(findings.find((item) => item.ruleId === "runtime/init-failed")?.project).toBe("runtime");
  });

  it("keeps conflicting owner hints neutral and preserves the conflict", () => {
    const [trace] = parseRuntimeTraces({
      hostName: "host",
      remote: { name: "checkout" },
      ownerHint: "host",
      diagnosis: { ownerHint: "remote" },
      summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
    });
    expect(trace).toMatchObject({ ownerHintConflict: true, ownerHints: ["host", "remote"] });
    const finding = correlateRuntime(
      [trace!],
      [baseProject({ name: "host" }), baseProject({ name: "checkout" })],
    ).find((item) => item.ruleId === "runtime/remote-load-failed");
    expect(finding?.project).toBe("runtime");
    expect(finding?.evidence).toMatchObject({
      identity: { ownerHints: ["host", "remote"] },
    });
  });

  it("does not blame a host from alias-only configuration evidence", () => {
    const host = baseProject({
      name: "host",
      moduleFederation: {
        name: "host",
        exposes: {},
        shared: {},
        remotes: {
          checkout: {
            name: "checkout",
            entry: "https://cdn.example/checkout.js",
            shareScope: "default",
          },
        },
      },
    });
    const [trace] = parseRuntimeTraces({
      remote: { alias: "checkout" },
      summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
    });
    expect(
      correlateRuntime([trace!], [host]).find(
        (item) => item.ruleId === "runtime/remote-load-failed",
      )?.project,
    ).toBe("runtime");
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
    expect(() => parseRuntimeTraces({ kind: "build-report", projects: [] })).toThrow(
      /Wrong.*build-report/,
    );
    expect(() => parseRuntimeTraces({ report: { findings: [] } })).toThrow(/Wrong.*build-report/);
    expect(() => parseRuntimeTraces({ schemaVersion: 2, traceId: "future" })).toThrow(/future/);
    expect(() => parseRuntimeTraces({ reports: [{ schemaVersion: 2, summary: {} }] })).toThrow(
      /future/,
    );
    expect(
      parseRuntimeTraces({
        summary: {},
        events: [{ phase: "remoteEntry", status: "success" }],
      })[0]!,
    ).toMatchObject({ sourceContract: "partial" });
  });
});
