import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_BUDGETS } from "../../src/analysis-budgets.js";
import { computeRunStatus, emptyRunStatus, INCOMPLETE_REASON_CODES } from "../../src/run-status.js";
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
      incompleteReasons: ["missing-emit", "partial-bundler", "probe-skipped", "evidence-unknown"],
    });
    expect(status.incompleteReasons).toEqual([...INCOMPLETE_REASON_CODES]);
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
  });
});
