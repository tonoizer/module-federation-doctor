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
import {
  DEFAULT_RUNTIME_CAPTURE_LIMITS,
  HARD_RUNTIME_CAPTURE_LIMITS,
  runtimeCaptureContentDigest,
  runtimeCaptureRecordId,
  type RuntimeCaptureEnvelope,
  type RuntimeCaptureIdentity,
} from "../../src/capture.js";
import type { FederationInstanceFacts, ProjectFacts } from "../../src/types.js";
import { normalizeModuleFederation } from "../../src/normalize.js";

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

function captureEnvelope(
  value: Record<string, unknown> = {
    traceId: "capture-trace",
    hostName: "host",
    outcome: "runtime-loaded",
  },
  identityOverrides: Partial<RuntimeCaptureIdentity> = {},
): RuntimeCaptureEnvelope {
  const identity: RuntimeCaptureIdentity = {
    captureId: "capture-test",
    navigationId: "navigation-1",
    realmId: "realm-top",
    sequence: 0,
    ...identityOverrides,
  };
  const report = {
    id: runtimeCaptureRecordId("observability", identity, value as never),
    identity,
    source: "observability" as const,
    capturedAt: 1,
    contentDigest: runtimeCaptureContentDigest(value as never),
    provenance: {
      collector: { name: "test-capture", version: "1" },
      inputKind: "observability-report",
      source: "official-observability",
      sourceSchemaVersion: "2.5",
    },
    completeness: { status: "complete" as const, reason: "test fixture" },
    value: value as never,
  };
  return {
    schemaVersion: 1,
    contractVersion: 1,
    collector: { name: "test-capture", version: "1" },
    transport: "file",
    captureId: identity.captureId,
    capabilities: {
      observations: [
        {
          capabilityKind: "reports",
          state: "exact",
          reason: "test fixture",
          source: "observability",
          scope: "top-page",
          priority: 1,
          sourceSchemaVersion: "2.5",
        },
      ],
    },
    limits: DEFAULT_RUNTIME_CAPTURE_LIMITS,
    truncation: [],
    reports: [report],
    events: [],
    devtools: [],
    snapshots: [],
    instances: [],
    network: [],
    errors: [],
    relations: [],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("runtime trace import", () => {
  it("imports a bounded runtime capture through the existing runtime parser", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-capture-"));
    roots.push(root);
    const file = path.join(root, "capture.json");
    await fs.writeFile(file, JSON.stringify(captureEnvelope()));

    const [trace] = await loadRuntimeTraceFile(file);

    expect(trace).toMatchObject({
      sourceContract: "upstream-observability-2.5.3",
      traceId: "capture-trace",
      hostName: "host",
      outcome: "runtime-loaded",
    });
    expect(Object.getOwnPropertyDescriptor(trace, "capture")?.value).toMatchObject({
      captureId: "capture-test",
      navigationId: "navigation-1",
      realmId: "realm-top",
      sequence: 0,
      provenance: { source: "official-observability" },
    });
    expect(JSON.stringify(trace)).not.toContain("capture-test");
  });

  it("validates imported project facts through the evidence reader", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-project-import-errors-"));
    roots.push(root);
    const tracePath = path.join(root, "trace.json");
    await fs.writeFile(tracePath, JSON.stringify({ traceId: "runtime", outcome: "pending" }));

    const projectPath = path.join(root, "project.json");
    const expectedProject = baseProject({ name: "host" });
    await fs.writeFile(projectPath, JSON.stringify(expectedProject));
    const imported = await analyzeRuntime({ tracePath, projectFiles: [projectPath] });
    expect(imported.projects).toEqual([expectedProject]);

    await fs.writeFile(projectPath, "{");
    await expect(analyzeRuntime({ tracePath, projectFiles: [projectPath] })).rejects.toMatchObject({
      name: "EvidenceReaderError",
      fileLabel: projectPath,
      failureCode: "malformed-json",
      pointer: "/",
    });

    await fs.writeFile(projectPath, JSON.stringify({ schemaVersion: 3, project: {} }));
    await expect(analyzeRuntime({ tracePath, projectFiles: [projectPath] })).rejects.toMatchObject({
      name: "EvidenceReaderError",
      fileLabel: projectPath,
      failureCode: "unsupported-version",
      pointer: "/schemaVersion",
    });

    await fs.writeFile(
      projectPath,
      JSON.stringify({ ...baseProject({ name: "host" }), project: { name: 42, root: "." } }),
    );
    await expect(analyzeRuntime({ tracePath, projectFiles: [projectPath] })).rejects.toMatchObject({
      name: "EvidenceReaderError",
      fileLabel: projectPath,
      failureCode: "schema-invalid",
      pointer: "/project/name",
    });

    await expect(
      analyzeRuntime({ tracePath, projectFiles: [path.join(root, "missing-project.json")] }),
    ).rejects.toMatchObject({ failureCode: "not-found" });
  });

  it("rejects malformed, future, oversized, and unredacted capture files before analysis", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-capture-errors-"));
    roots.push(root);
    const malformed = path.join(root, "malformed.json");
    await fs.writeFile(malformed, "{");
    await expect(loadRuntimeTraceFile(malformed)).rejects.toMatchObject({
      failureCode: "malformed-json",
    });

    const future = path.join(root, "future.json");
    await fs.writeFile(future, JSON.stringify({ ...captureEnvelope(), contractVersion: 2 }));
    await expect(loadRuntimeTraceFile(future)).rejects.toThrow(
      /unsupported capture contract version/,
    );

    const oversized = path.join(root, "oversized.json");
    await fs.writeFile(oversized, "{}");
    await fs.truncate(oversized, HARD_RUNTIME_CAPTURE_LIMITS.maxBytes + 1);
    await expect(loadRuntimeTraceFile(oversized)).rejects.toMatchObject({
      failureCode: "oversized-input",
    });

    const privateValue = { ...captureEnvelope({ diagnosisTitle: "Bearer secret" }) };
    const privateFile = path.join(root, "private.json");
    await fs.writeFile(privateFile, JSON.stringify(privateValue));
    await expect(loadRuntimeTraceFile(privateFile)).rejects.toThrow(/canonically redacted/);
  });

  it("keeps capture identity and ambiguity safe for runtime correlation", () => {
    const envelope = captureEnvelope(
      {
        traceId: "ambiguous",
        outcome: "failed",
        errorCode: "RUNTIME-001",
        phase: "remoteEntryInit",
      },
      { hostName: "host", remoteName: "remote", navigationId: "nav-2", realmId: "frame-1" },
    );
    const [trace] = parseRuntimeTraces(envelope);
    const findings = correlateRuntime(
      [trace!],
      [baseProject({ name: "host" }), baseProject({ name: "remote" })],
    );

    expect(trace).toMatchObject({ traceId: "ambiguous", hostName: "host" });
    expect(findings.some((finding) => finding.project === "runtime")).toBe(true);
  });

  it("correlates runtime failures against the affected nested federation instance", () => {
    const clientId = "mfid:v1:federation-instance:111111111111111111111111";
    const ssrId = "mfid:v1:federation-instance:222222222222222222222222";
    const host = baseProject({
      name: "host",
      moduleFederation: normalizeModuleFederation(
        { name: "host-client", exposes: {}, remotes: {}, shared: {} },
        { bundler: "vite" },
      )!,
    });
    const instance = (id: string, name: string): FederationInstanceFacts => ({
      id,
      pluginName: "ModuleFederationPlugin",
      configDigest: `sha256:${"a".repeat(64)}`,
      registrationGroup: `sha256:${"b".repeat(64)}`,
      moduleFederation: normalizeModuleFederation(
        { name, exposes: {}, remotes: {}, shared: {} },
        { bundler: "vite" },
      )!,
      capabilities: host.capabilities,
      imports: host.imports,
      artifacts: host.artifacts,
    });
    const scopedHost: ProjectFacts = {
      ...host,
      bundler: {
        ...host.bundler,
        federationInstances: [
          {
            id: clientId,
            pluginName: "ModuleFederationPlugin",
            configDigest: `sha256:${"a".repeat(64)}`,
            registrationGroup: `sha256:${"b".repeat(64)}`,
          },
          {
            id: ssrId,
            pluginName: "ModuleFederationPlugin",
            configDigest: `sha256:${"c".repeat(64)}`,
            registrationGroup: `sha256:${"d".repeat(64)}`,
          },
        ],
      },
      federationInstances: [instance(clientId, "host-client"), instance(ssrId, "host-ssr")],
    };
    const [trace] = parseRuntimeTraces({
      hostName: "host-ssr",
      remote: { name: "checkout" },
      ownerHint: "host",
      summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
    });

    const finding = correlateRuntime([trace!], [scopedHost]).find(
      (item) => item.ruleId === "runtime/remote-load-failed",
    );
    expect(finding).toMatchObject({ project: "host", federationInstanceId: ssrId });
  });

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

  it("rejects non-string phase and event statuses with typed validation errors", () => {
    expect(() =>
      parseRuntimeTraces({ summary: { phases: { remoteEntry: { status: 42 } } } }),
    ).toThrow(RuntimeTraceError);
    expect(() => parseRuntimeTraces({ events: [{ phase: "remoteEntry", status: 42 }] })).toThrow(
      /status.*string/,
    );
  });

  it("rejects wrong top-level and nested field types instead of dropping them", () => {
    for (const report of [
      { summary: "failed" },
      { summary: { outcome: 1 } },
      { remote: "checkout" },
      { summary: { phases: "failed" } },
      { diagnosis: { warnings: "warning" } },
    ]) {
      expect(() => parseRuntimeTraces(report)).toThrow(RuntimeTraceError);
    }
  });

  it("clips imported events and evidence arrays deterministically", () => {
    const items = Array.from({ length: 100_000 }, (_, index) => ({
      phase: "loadRemote",
      status: "success",
      errorCode: `RUNTIME-${index}`,
    }));
    const names = Array.from({ length: 100_000 }, (_, index) => `remote-${index}`);
    const [trace] = parseRuntimeTraces({
      remote: { name: "checkout" },
      events: items,
      shared: { package: "react", availableVersions: names },
      moduleInfo: { availableNames: names, entries: names.map((name) => ({ name })) },
      diagnosis: {
        warnings: names,
        completedPhases: names,
        pendingPhases: names,
        actions: names.map((title) => ({ title })),
      },
    });
    expect(trace?.events).toHaveLength(24);
    expect(trace?.shared?.availableVersions).toHaveLength(24);
    expect(trace?.moduleInfo?.availableNames).toHaveLength(24);
    expect(trace?.moduleInfo?.entries).toHaveLength(24);
    expect(trace?.diagnosis?.warnings).toHaveLength(24);
    expect(trace?.diagnosis?.completedPhases).toHaveLength(24);
    expect(trace?.diagnosis?.pendingPhases).toHaveLength(24);
    expect(trace?.diagnosis?.actions).toHaveLength(24);
    expect(trace?.evidenceClipped).toBe(true);
  });

  it("marks legacy success without completion evidence as partial", () => {
    const [trace] = parseRuntimeTraces({
      traceId: "legacy-incomplete",
      summary: { outcome: "success" },
      diagnosis: { owner: "remote", summary: "Load started" },
    });
    expect(trace).toMatchObject({
      sourceContract: "legacy-doctor-v1",
      outcome: "partial",
    });
  });

  it("keeps legacy success with completion evidence as runtime-loaded", () => {
    const [trace] = parseRuntimeTraces({
      summary: {
        outcome: "success",
        phases: { remoteEntry: { status: "complete" } },
      },
    });
    expect(trace?.outcome).toBe("runtime-loaded");
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

  it("normalizes structured loadedBefore and retryable evidence with bounds", () => {
    const consumers = Array.from({ length: 100 }, (_, index) => ({
      name: `consumer-${index}`,
      remoteEntryExports: true,
      containerInitialized: false,
      exposes: [`./Expose-${index}`],
    }));
    const [trace] = parseRuntimeTraces({
      loadedBefore: { producer: true, expose: false, consumers },
      retryable: true,
      events: [{ phase: "remoteEntry", status: "error", retryable: true }],
    });
    expect(trace?.loadedBefore).toMatchObject({ producer: true, expose: false });
    expect(typeof trace?.loadedBefore === "object" && trace.loadedBefore?.consumers).toHaveLength(
      24,
    );
    expect(trace?.retryable).toBe(true);
    expect(trace?.events[0]?.retryable).toBe(true);
    expect(trace?.evidenceClipped).toBe(true);
    expect(() => parseRuntimeTraces({ loadedBefore: { producer: "yes" } })).toThrow(
      /loadedBefore\/producer.*boolean/,
    );
  });

  it("preserves requiredVersion false and rejects other wrong types", () => {
    const [trace] = parseRuntimeTraces({ shared: { package: "react", requiredVersion: false } });
    expect(trace?.shared?.requiredVersion).toBe(false);
    expect(() => parseRuntimeTraces({ shared: { package: "react", requiredVersion: 19 } })).toThrow(
      /requiredVersion.*string/,
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

  it("keeps legacy init and factory phase names while correlating them", () => {
    const [trace] = parseRuntimeTraces({
      remote: { name: "checkout" },
      summary: { outcome: "failed", phases: { factory: { status: "error" } } },
      diagnosis: { owner: "remote" },
    });
    expect(trace!.phases).toEqual({ factory: { status: "error" } });
    expect(trace!.sourceContract).toBe("legacy-doctor-v1");
    const finding = correlateRuntime([trace!], [baseProject({ name: "checkout" })]).find(
      (item) => item.ruleId === "runtime/remote-load-failed",
    );
    expect(finding?.evidence).toMatchObject({
      phases: ["factory"],
      phaseKind: "moduleFactory",
    });
  });

  it("detects current contract even when a legacy-looking moduleInfo name is present", () => {
    const [trace] = parseRuntimeTraces({
      hostName: "host",
      runtimeVersion: "2.5.0",
      summary: {
        outcome: "runtime-loaded",
        runtimeLoaded: true,
        phases: { loadRemote: { status: "success" } },
      },
      diagnosis: { ownerHint: "remote", title: "Remote loaded successfully" },
      moduleInfo: { name: "host", reason: "clipped", clipped: true, entries: [{ name: "host" }] },
    });
    expect(trace?.sourceContract).toBe("upstream-observability-2.5.3");
  });

  it("marks missing shared evidence on partial/old runtimes as unknown, not healthy or failed", async () => {
    const [partial] = await loadRuntimeTraceFile(path.join(fixtureRoot, "partial-devtools.json"));
    expect(partial?.sharedCompleteness).toBe("unknown");
    expect(partial?.sourceContract).toBe("partial");
    expect(
      correlateRuntime([partial!], [baseProject({ name: "host" })]).some(
        (item) => item.ruleId === "runtime/shared-mismatch",
      ),
    ).toBe(false);

    const [oldRuntime] = parseRuntimeTraces({
      traceId: "old-chrome",
      runtimeVersion: "2.4.9",
      status: "pending",
      events: [],
    });
    expect(oldRuntime?.sharedCompleteness).toBe("unknown");
  });

  it("keeps requestAlias as weak evidence and never sole ownership", () => {
    const host = baseProject({
      name: "host",
      moduleFederation: {
        name: "host",
        exposes: {},
        shared: {},
        remotes: {
          checkout: {
            name: "checkout",
            alias: "checkout",
            entry: "https://cdn.example/checkout.js",
            shareScope: "default",
          },
        },
      },
    });
    const [trace] = parseRuntimeTraces({
      requestAlias: "checkout",
      summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
    });
    const finding = correlateRuntime([trace!], [host]).find(
      (item) => item.ruleId === "runtime/remote-load-failed",
    );
    expect(finding?.project).toBe("runtime");
    expect(finding?.evidence).toMatchObject({
      identity: {
        requestAlias: "checkout",
        matchReason: "alias-only or requestAlias evidence is weak; neutral runtime attribution",
      },
    });
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

  it("does not infer a shared mismatch from an unrelated failed remote load", () => {
    const host = baseProject({
      name: "host",
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {},
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
    });
    const findings = correlateRuntime(
      parseRuntimeTraces({
        remote: { name: "checkout" },
        summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
        shared: { package: "react" },
      }),
      [host],
    );
    expect(findings.some((finding) => finding.ruleId === "runtime/shared-mismatch")).toBe(false);
  });

  it("does not infer a shared mismatch from import false without runtime shared proof", () => {
    const host = baseProject({
      name: "host",
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {},
        shared: {
          react: {
            package: "react",
            singleton: true,
            eager: false,
            requiredVersion: false,
            import: false,
            shareScope: "default",
          },
        },
      },
    });
    const findings = correlateRuntime(
      parseRuntimeTraces({
        shared: { package: "react" },
        summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
      }),
      [host],
    );
    expect(findings.some((finding) => finding.ruleId === "runtime/shared-mismatch")).toBe(false);
  });

  it("requires shared evidence for shared mismatch and keeps ambiguous attribution neutral", () => {
    const projects = [
      baseProject({ name: "host" }),
      baseProject({ name: "provider-a" }),
      baseProject({ name: "provider-b" }),
    ];
    const traces = [
      parseRuntimeTraces({
        shared: { package: "react" },
        summary: { outcome: "failed", phases: { shared: { status: "error" } } },
      }),
      parseRuntimeTraces({
        shared: { package: "react", reason: "version-mismatch" },
        summary: { outcome: "failed" },
      }),
      parseRuntimeTraces({
        shared: { package: "react", selectedVersion: "18.0.0", requiredVersion: "^19.0.0" },
        summary: { outcome: "failed" },
      }),
      parseRuntimeTraces({
        hostName: "host",
        ownerHint: "host",
        diagnosis: { ownerHint: "remote" },
        shared: { package: "react", provider: "provider-a" },
        summary: { outcome: "failed", phases: { shared: { status: "error" } } },
      }),
    ];
    const findings = traces.flatMap((trace) => correlateRuntime(trace, projects));
    const sharedFindings = findings.filter(
      (finding) => finding.ruleId === "runtime/shared-mismatch",
    );
    expect(sharedFindings).toHaveLength(4);
    expect(sharedFindings[0]?.evidence).toMatchObject({
      identity: { matchReason: "shared phase failed" },
    });
    expect(sharedFindings[3]?.project).toBe("runtime");
    expect(sharedFindings[3]?.evidence).toMatchObject({
      identity: { ownerHints: ["host", "remote"], candidates: expect.any(Array) },
    });
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

  it("keeps an unresolved host owner hint neutral even when the producer is exact", () => {
    const [trace] = parseRuntimeTraces({
      hostName: "missing-host",
      remote: { name: "checkout" },
      ownerHint: "host",
      summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
    });
    const finding = correlateRuntime([trace!], [baseProject({ name: "checkout" })]).find(
      (item) => item.ruleId === "runtime/remote-load-failed",
    );
    expect(finding?.project).toBe("runtime");
    expect(finding?.evidence).toMatchObject({
      identity: {
        ownerHint: "host",
        matchReason: "owner hint did not match an exact candidate; neutral runtime attribution",
        candidates: ["checkout"],
      },
    });
  });

  it("keeps duplicate exact producer identities neutral and order independent", () => {
    const [trace] = parseRuntimeTraces({
      hostName: "host",
      remote: { name: "checkout" },
      summary: { outcome: "failed", phases: { remoteEntry: { status: "error" } } },
    });
    const host = baseProject({ name: "host" });
    const checkoutA = baseProject({
      name: "checkout",
      project: { name: "checkout", root: "/workspace/a" },
    });
    const checkoutB = baseProject({
      name: "checkout",
      project: { name: "checkout", root: "/workspace/b" },
    });

    const forward = correlateRuntime([trace!], [host, checkoutA, checkoutB]);
    const reverse = correlateRuntime([trace!], [host, checkoutB, checkoutA]);
    const forwardFinding = forward.find((item) => item.ruleId === "runtime/remote-load-failed");
    const reverseFinding = reverse.find((item) => item.ruleId === "runtime/remote-load-failed");

    expect(forwardFinding?.project).toBe("runtime");
    expect(reverseFinding?.project).toBe("runtime");
    expect(forwardFinding?.fingerprint).toBe(reverseFinding?.fingerprint);
    expect(forwardFinding?.evidence).toMatchObject({
      identity: { matchReason: "multiple exact candidates; neutral runtime attribution" },
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
    for (const schemaVersion of ["2", 0, -1]) {
      expect(() => parseRuntimeTraces({ schemaVersion, traceId: "invalid-version" })).toThrow(
        /schema version/,
      );
    }
    expect(() => parseRuntimeTraces({ schemaVersion: 2, traceId: "future" })).toThrow(
      /schema version/,
    );
    expect(() => parseRuntimeTraces({ reports: [{ schemaVersion: 2, summary: {} }] })).toThrow(
      /schema version/,
    );
    expect(
      parseRuntimeTraces({
        summary: {},
        events: [{ phase: "remoteEntry", status: "success" }],
      })[0]!,
    ).toMatchObject({ sourceContract: "partial" });
  });

  it("clips report envelopes before normalizing every report", () => {
    const reports = Array.from({ length: 100_000 }, (_, index) => ({
      traceId: `trace-${index}`,
      summary: { outcome: "pending" },
    }));
    const parsed = parseRuntimeTraces({ reports });
    expect(parsed).toHaveLength(24);
    expect(parsed[0]?.evidenceClipped).toBe(true);
  });

  it("keeps parser errors typed and labeled when reading a file", async () => {
    const file = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-runtime-error-")),
      "bad.json",
    );
    roots.push(path.dirname(file));
    await fs.writeFile(file, JSON.stringify({ shared: { requiredVersion: 42 } }));
    await expect(loadRuntimeTraceFile(file)).rejects.toMatchObject({
      fileLabel: file,
      failureCode: "invalid-field",
      pointer: "/shared/requiredVersion",
    });
  });
});
