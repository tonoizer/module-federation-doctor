import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeFederation } from "../../src/engine.js";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, NormalizedRemote, ProjectFacts } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function projectFacts(
  name: string,
  shared: NonNullable<ProjectFacts["moduleFederation"]>["shared"],
  packages: string[] = [],
  extras: { exposes?: Record<string, string>; remotes?: Record<string, NormalizedRemote> } = {},
): ProjectFacts {
  return {
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
      exposes: extras.exposes ?? {},
      remotes: extras.remotes ?? {},
      shared,
    },
    dependencies: {
      declared: Object.fromEntries(packages.map((pkg) => [pkg, "^19.0.0"])),
      installed: Object.fromEntries(packages.map((pkg) => [pkg, "19.0.0"])),
    },
    imports: {
      sourceFiles: [],
      specifiers: packages,
      packages,
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: { emittedAssets: [] },
  };
}

const reactImportFalse = {
  react: {
    package: "react",
    singleton: true,
    eager: false,
    requiredVersion: "^19.0.0",
    shareScope: ["default"] as string[],
    import: false as const,
  },
};

const reactProvider = {
  react: {
    package: "react",
    singleton: true,
    eager: false,
    requiredVersion: "^19.0.0",
    shareScope: ["default"] as string[],
  },
};

async function writeFederation(projects: ProjectFacts[]): Promise<string[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-import-false-"));
  roots.push(root);
  const files: string[] = [];
  for (const project of projects) {
    const file = path.join(root, `${project.project.name}.json`);
    await fs.writeFile(file, JSON.stringify(project));
    files.push(file);
  }
  return files;
}

async function runSharedImportFalse(
  facts: ProjectFacts,
): Promise<
  Array<Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">>
> {
  const findings: Array<
    Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
  > = [];
  const rule = builtInRules.find((item) => item.meta.id === "reliability/shared-import-false")!;
  await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
  return findings;
}

describe("shared-import-false vs missing-provider discrimination", () => {
  it("does not report missing-provider when a workspace provider exists", async () => {
    const files = await writeFederation([
      projectFacts("host", reactProvider, ["react"]),
      projectFacts("remote", reactImportFalse, ["react"], {
        exposes: { "./Widget": "src/Widget.ts" },
      }),
    ]);
    const result = await analyzeFederation(files);
    expect(result.findings.map((item) => item.ruleId)).not.toContain("federation/missing-provider");
  });

  it("keeps shared-import-false for a federation participant when a provider exists", async () => {
    const findings = await runSharedImportFalse(
      projectFacts("remote", reactImportFalse, ["react"], {
        exposes: { "./Widget": "src/Widget.ts" },
      }),
    );
    expect(findings).toEqual([
      expect.objectContaining({
        message: 'Shared package "react" has no local fallback.',
        evidence: expect.objectContaining({ package: "react" }),
      }),
    ]);
  });

  it("reports missing-provider when every sharer disables fallback", async () => {
    const files = await writeFederation([
      projectFacts("consumer-a", reactImportFalse, ["react"]),
      projectFacts("consumer-b", reactImportFalse, ["react"]),
    ]);
    const result = await analyzeFederation(files);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "federation/missing-provider",
          evidence: expect.objectContaining({ package: "react" }),
        }),
      ]),
    );
  });

  it("reports missing-provider when a sibling uses the package but nobody provides it", async () => {
    const files = await writeFederation([
      projectFacts("host", {}, ["react"]),
      projectFacts("remote", reactImportFalse, ["react"]),
    ]);
    const result = await analyzeFederation(files);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "federation/missing-provider",
          evidence: expect.objectContaining({
            package: "react",
            consumers: ["remote"],
          }),
        }),
      ]),
    );
  });

  it("does not mis-blame a lone import:false sharer as missing-provider", async () => {
    const files = await writeFederation([
      projectFacts("remote", reactImportFalse, ["react"], {
        exposes: { "./Widget": "src/Widget.ts" },
      }),
      projectFacts("other", {}, []),
    ]);
    const result = await analyzeFederation(files);
    expect(result.findings.map((item) => item.ruleId)).not.toContain("federation/missing-provider");
  });

  it("does not report shared-import-false for shared-only stubs without federation edges", async () => {
    const findings = await runSharedImportFalse(projectFacts("stub", reactImportFalse, ["react"]));
    expect(findings).toEqual([]);
  });
});
