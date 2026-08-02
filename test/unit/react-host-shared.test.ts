import { describe, expect, it } from "vitest";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";

function facts(): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: "react-host", root: "." },
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
      name: "react_host",
      exposes: {},
      remotes: {
        remote: {
          name: "remote",
          entry: "https://example.com/remote.js",
          shareScope: "default",
        },
      },
      shared: {},
    },
    dependencies: { declared: { react: "19.0.0", "react-dom": "19.0.0" }, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: ["react", "react-dom"],
      packages: ["react", "react-dom"],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: ["source"],
    },
    artifacts: { emittedAssets: [] },
  };
}

async function run(id: string, projectFacts: ProjectFacts) {
  const findings: Array<
    Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
  > = [];
  const rule = builtInRules.find((item) => item.meta.id === id)!;
  await rule.check({
    facts: projectFacts,
    options: {},
    report: (finding) => findings.push(finding),
  });
  return findings;
}

describe("React host shared guidance (#126)", () => {
  it("emits one warning with a singleton snippet and suppresses overlapping candidates", async () => {
    const projectFacts = facts();
    const warning = await run("shared/react-host-missing", projectFacts);
    const candidates = await run("shared/candidate", projectFacts);

    expect(warning).toHaveLength(1);
    expect(warning[0]?.message).toContain("react and react-dom");
    expect(warning[0]?.suggestion).toContain('"react": { singleton: true }');
    expect(warning[0]?.suggestion).toContain('"react-dom": { singleton: true }');
    expect(candidates).toHaveLength(0);
  });

  it("stays quiet for remotes without React imports and for properly shared hosts", async () => {
    const projectFacts = facts();
    projectFacts.imports.packages = ["some-package"];
    projectFacts.imports.specifiers = ["some-package"];
    expect(await run("shared/react-host-missing", projectFacts)).toHaveLength(0);

    projectFacts.imports.packages = ["react", "react-dom"];
    projectFacts.imports.specifiers = ["react", "react-dom"];
    projectFacts.moduleFederation!.shared = {
      react: { package: "react", singleton: true, eager: false, shareScope: "default" },
      "react-dom": {
        package: "react-dom",
        singleton: true,
        eager: false,
        shareScope: "default",
      },
    };
    expect(await run("shared/react-host-missing", projectFacts)).toHaveLength(0);
  });

  it("does not warn a remote project just because React is imported", async () => {
    const projectFacts = facts();
    projectFacts.moduleFederation!.remotes = {};
    expect(await run("shared/react-host-missing", projectFacts)).toHaveLength(0);
  });
});
