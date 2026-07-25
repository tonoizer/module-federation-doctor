import { describe, expect, it } from "vitest";
import { buildUiPayload, reportFromFindings } from "../../src/ui-graph.js";
import type { ProjectFacts } from "../../src/types.js";

function project(
  name: string,
  federation: NonNullable<ProjectFacts["moduleFederation"]>,
): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name, root: "." },
    bundler: { name: "vite", mode: "production" },
    capabilities: {
      config: true,
      sourceImports: false,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: federation,
    dependencies: { declared: { react: "^18" }, installed: { react: "18.3.1" } },
    imports: { sourceFiles: [], specifiers: [], packages: [] },
    artifacts: { emittedAssets: [] },
  };
}

describe("ui graphs", () => {
  it("builds remotes, shared, and orchestration graphs", () => {
    const host = project("host", {
      name: "host",
      exposes: {},
      remotes: {
        remote: {
          name: "remote",
          entry: "http://localhost:3001/mf-manifest.json",
          shareScope: ["default"],
        },
      },
      shared: {
        react: {
          package: "react",
          singleton: true,
          eager: false,
          shareScope: ["default"],
          requiredVersion: "^18",
        },
      },
      experiments: {
        asyncStartup: false,
        externalRuntime: true,
        provideExternalRuntime: false,
      },
    });
    const remote = project("remote-app", {
      name: "remote",
      exposes: { "./Button": "./src/Button.tsx" },
      remotes: {},
      shared: {
        react: {
          package: "react",
          singleton: true,
          eager: false,
          shareScope: ["default"],
          requiredVersion: "^18",
        },
      },
      experiments: {
        asyncStartup: false,
        externalRuntime: false,
        provideExternalRuntime: true,
      },
    });
    const report = reportFromFindings([host, remote], []);
    const ui = buildUiPayload([host, remote], report);
    expect(ui.graphs.remotes.edges.some((edge) => edge.source === "project:host")).toBe(true);
    expect(ui.graphs.shared.nodes.some((node) => node.id === "shared:react")).toBe(true);
    expect(ui.graphs.orchestration.nodes.some((node) => node.kind === "expose")).toBe(true);
    expect(ui.graphs.orchestration.nodes.some((node) => node.id === "runtime:external")).toBe(true);
  });
});
