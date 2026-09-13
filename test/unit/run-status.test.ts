import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_BUDGETS } from "../../src/analysis-budgets.js";
import {
  computeRunStatus,
  emptyRunStatus,
  hasRequiredEvidence,
  INCOMPLETE_REASON_CODES,
  isRunStatusComplete,
  isStrictlyComplete,
  markRunIncomplete,
} from "../../src/run-status.js";
import { reportFromFindings } from "../../src/ui-graph.js";
import type {
  AnalysisCapabilities,
  BundlerFacts,
  ImportFacts,
  ProjectFacts,
} from "../../src/types.js";

function project(
  overrides: {
    project?: Partial<ProjectFacts["project"]>;
    capabilities?: Partial<AnalysisCapabilities>;
    bundler?: Partial<BundlerFacts>;
    imports?: Partial<ImportFacts>;
    analysis?: ProjectFacts["analysis"];
    moduleFederation?: ProjectFacts["moduleFederation"];
    federationInstances?: ProjectFacts["federationInstances"];
  } = {},
): ProjectFacts {
  const capabilities: AnalysisCapabilities = {
    config: true,
    sourceImports: true,
    manifest: true,
    stats: true,
    emittedAssets: true,
    installedVersions: true,
    ...overrides.capabilities,
  };
  return {
    schemaVersion: 1,
    project: { name: overrides.project?.name ?? "demo", root: ".", ...overrides.project },
    bundler: {
      name: "vite",
      mode: "production",
      ...overrides.bundler,
    },
    capabilities,
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
      ...overrides.imports,
    },
    artifacts: { emittedAssets: capabilities.emittedAssets ? ["remoteEntry.js"] : [] },
    ...(overrides.analysis ? { analysis: overrides.analysis } : {}),
    ...(overrides.moduleFederation ? { moduleFederation: overrides.moduleFederation } : {}),
    ...(overrides.federationInstances
      ? { federationInstances: overrides.federationInstances }
      : {}),
  };
}

function hostWithRemote(): NonNullable<ProjectFacts["moduleFederation"]> {
  return {
    name: "host",
    exposes: {},
    remotes: {
      app1: {
        name: "app1",
        entry: "http://localhost:3001/remoteEntry.js",
        shareScope: "default",
      },
    },
    shared: {},
  };
}

describe("computeRunStatus", () => {
  it("returns an empty list when the run is complete", () => {
    expect(computeRunStatus([project()])).toEqual({
      complete: true,
      incompleteReasons: [],
    });
    expect(emptyRunStatus()).toEqual({ complete: true, incompleteReasons: [] });
  });

  it("reports missing-emit when emitted asset facts are absent", () => {
    expect(computeRunStatus([project({ capabilities: { emittedAssets: false } })])).toEqual({
      complete: false,
      incompleteReasons: ["missing-emit"],
    });
  });

  it.each(["webpack", "rspack", "rsbuild"] as const)(
    "reports missing-stats for %s emit with remotes when stats are off",
    (bundler) => {
      expect(
        computeRunStatus([
          project({
            bundler: { name: bundler, mode: "production" },
            capabilities: { stats: false },
            moduleFederation: hostWithRemote(),
          }),
        ]),
      ).toEqual({
        complete: false,
        incompleteReasons: ["missing-stats"],
      });
    },
  );

  it("does not treat Vite missing stats with remotes as missing-stats", () => {
    expect(
      computeRunStatus([
        project({
          bundler: { name: "vite", mode: "production" },
          capabilities: { stats: false, manifest: false },
          moduleFederation: hostWithRemote(),
        }),
      ]),
    ).toEqual({
      complete: true,
      incompleteReasons: [],
    });
  });

  it("does not add missing-stats on CLI-only Enhanced checks (missing-emit covers them)", () => {
    expect(
      computeRunStatus([
        project({
          bundler: { name: "webpack", mode: "production" },
          capabilities: { emittedAssets: false, stats: false },
          moduleFederation: hostWithRemote(),
        }),
      ]),
    ).toEqual({
      complete: false,
      incompleteReasons: ["missing-emit"],
    });
  });

  it("does not add missing-stats when Enhanced remotes explicitly disable manifest", () => {
    expect(
      computeRunStatus([
        project({
          bundler: { name: "webpack", mode: "production" },
          capabilities: { stats: false, manifest: false },
          moduleFederation: { ...hostWithRemote(), manifest: { enabled: false, options: {} } },
        }),
      ]),
    ).toEqual({
      complete: true,
      incompleteReasons: [],
    });
  });

  it("does not add missing-stats for Enhanced emit without remotes", () => {
    expect(
      computeRunStatus([
        project({
          bundler: { name: "rspack", mode: "production" },
          capabilities: { stats: false },
          moduleFederation: {
            name: "producer",
            exposes: { "./Widget": "./src/Widget.ts" },
            remotes: {},
            shared: {},
          },
        }),
      ]),
    ).toEqual({
      complete: true,
      incompleteReasons: [],
    });
  });

  it("reports partial-bundler for modern, unknown, and Rolldown/Vite Plus lifecycles", () => {
    expect(
      computeRunStatus([project({ bundler: { name: "modern", mode: "production" } })]),
    ).toEqual({
      complete: false,
      incompleteReasons: ["partial-bundler"],
    });
    expect(
      computeRunStatus([
        project({
          bundler: {
            name: "vite",
            mode: "production",
            lifecycle: { flavor: "rolldown-vite", engine: "rolldown", evidence: ["pkg"] },
          },
        }),
      ]),
    ).toEqual({
      complete: false,
      incompleteReasons: ["partial-bundler"],
    });
    expect(
      computeRunStatus([
        project({
          bundler: {
            name: "vite",
            mode: "production",
            lifecycle: { flavor: "vite-plus", engine: "rolldown", evidence: ["pkg"] },
          },
        }),
      ]),
    ).toEqual({
      complete: false,
      incompleteReasons: ["partial-bundler"],
    });
  });

  it("reports probe-skipped from workspace probe diagnostics", () => {
    expect(
      computeRunStatus([project()], {
        workspaceDiagnostics: [
          {
            kind: "probe",
            files: ["apps/host/.mf/doctor/project.json"],
            message: "Group pre-probe could not determine federationGroup.",
          },
        ],
      }),
    ).toEqual({
      complete: false,
      incompleteReasons: ["probe-skipped"],
    });
  });

  it.each(["invalid", "stale", "duplicate", "conflict"] as const)(
    "reports %s workspace diagnostics as evidence-unknown",
    (kind) => {
      expect(
        computeRunStatus([project()], {
          workspaceDiagnostics: [{ kind, files: ["project.json"], message: "diagnostic" }],
        }),
      ).toEqual({
        complete: false,
        incompleteReasons: ["evidence-unknown"],
      });
    },
  );

  it("reports evidence-unknown for budget, source-read, and unresolved dynamic gaps", () => {
    expect(
      computeRunStatus([
        project({
          analysis: {
            status: "unknown",
            limits: DEFAULT_ANALYSIS_BUDGETS,
            usage: {
              files: 0,
              sourceBytes: 0,
              artifacts: 0,
              evidenceNodes: 0,
              serializedBytes: 0,
            },
            exceeded: [],
          },
        }),
      ]),
    ).toEqual({
      complete: false,
      incompleteReasons: ["evidence-unknown"],
    });

    expect(
      computeRunStatus([project()], {
        workspaceAnalysis: {
          status: "partial",
          limits: DEFAULT_ANALYSIS_BUDGETS,
          usage: {
            files: 1,
            sourceBytes: 0,
            artifacts: 0,
            evidenceNodes: 0,
            serializedBytes: 0,
          },
          exceeded: [{ kind: "files", limit: 1 }],
        },
      }),
    ).toEqual({
      complete: false,
      incompleteReasons: ["evidence-unknown"],
    });

    expect(
      computeRunStatus([
        project({
          imports: {
            sourceReadFailures: ["src/unreadable.ts"],
          },
        }),
      ]),
    ).toEqual({
      complete: false,
      incompleteReasons: ["evidence-unknown"],
    });
  });

  it("dedupes and sorts multiple reason codes stably", () => {
    const status = computeRunStatus(
      [
        project({
          capabilities: { emittedAssets: false },
          bundler: { name: "modern", mode: "production" },
          imports: {
            unresolvedDynamic: [{ api: "import", file: "a.ts" }],
          },
        }),
        project({
          project: { name: "enhanced-host" },
          bundler: { name: "webpack", mode: "production" },
          capabilities: { stats: false },
          moduleFederation: hostWithRemote(),
        }),
      ],
      {
        workspaceDiagnostics: [
          { kind: "probe", files: ["a.json"], message: "skipped" },
          { kind: "invalid", files: ["b.json"], message: "bad" },
        ],
      },
    );
    expect(status).toEqual({
      complete: false,
      incompleteReasons: [
        "missing-emit",
        "missing-stats",
        "partial-bundler",
        "probe-skipped",
        "evidence-unknown",
      ],
    });
    expect(status.incompleteReasons).toEqual([...INCOMPLETE_REASON_CODES]);
  });

  it("keeps report.schema.json incompleteReasons enum in sync", async () => {
    const schemaPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../schemas/report.schema.json",
    );
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8")) as {
      properties: { status: { properties: { incompleteReasons: { items: { enum: string[] } } } } };
    };
    expect(schema.properties.status.properties.incompleteReasons.items.enum).toEqual([
      ...INCOMPLETE_REASON_CODES,
    ]);
  });

  it("attaches status on reportFromFindings", () => {
    const complete = reportFromFindings([project()], []);
    expect(complete.status).toEqual({ complete: true, incompleteReasons: [] });

    const incomplete = reportFromFindings(
      [project({ capabilities: { emittedAssets: false } })],
      [],
    );
    expect(incomplete.status).toEqual({
      complete: false,
      incompleteReasons: ["missing-emit"],
    });
    expect(reportFromFindings([], [], { requireProjects: true }).status).toEqual({
      complete: false,
      incompleteReasons: ["evidence-unknown"],
    });
    expect(
      reportFromFindings([project()], [], {
        workspaceAnalysis: {
          status: "unknown",
          limits: DEFAULT_ANALYSIS_BUDGETS,
          usage: {
            files: 0,
            sourceBytes: 0,
            artifacts: 0,
            evidenceNodes: 0,
            serializedBytes: 0,
          },
          exceeded: [],
        },
      }).status,
    ).toEqual({ complete: false, incompleteReasons: ["evidence-unknown"] });
  });

  it("requires an explicit complete status and emitted build evidence for strict gates", () => {
    const complete = project();
    const status = emptyRunStatus();

    expect(isRunStatusComplete(status)).toBe(true);
    expect(hasRequiredEvidence([complete])).toBe(true);
    expect(isStrictlyComplete([complete], status)).toBe(true);

    expect(isRunStatusComplete(undefined)).toBe(false);
    expect(isStrictlyComplete([complete], undefined)).toBe(false);
    expect(isStrictlyComplete([project({ capabilities: { emittedAssets: false } })], status)).toBe(
      false,
    );
    expect(isStrictlyComplete([], status)).toBe(false);
  });

  it("adds failure incompleteness without losing existing stable reasons", () => {
    expect(
      markRunIncomplete({ complete: false, incompleteReasons: ["missing-emit"] }, "probe-skipped"),
    ).toEqual({ complete: false, incompleteReasons: ["missing-emit", "probe-skipped"] });
  });
});
