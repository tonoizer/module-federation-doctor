import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { collectProjectFacts } from "../../src/collect.js";
import { resolveOptions } from "../../src/config.js";
import { analyzeFederation } from "../../src/engine.js";
import { writeReports } from "../../src/reporters.js";
import { resolveAnalysisBudgets } from "../../src/analysis-budgets.js";
import type { DoctorReport, ProjectFacts } from "../../src/types.js";
import {
  DEFAULT_WORKSPACE_PROJECT_GLOBS,
  discoverWorkspaceProjects,
  discoverWorkspaceProjectsWithBudget,
} from "../../src/workspace.js";

const repository = path.resolve(fileURLToPath(import.meta.url), "../../..");

function emptyWorkspaceReport(project: ProjectFacts): DoctorReport {
  return {
    schemaVersion: 1,
    capabilities: project.capabilities,
    summary: { projects: 1, info: 0, warnings: 0, errors: 0 },
    findings: [],
  };
}

describe("workspace discovery", () => {
  it("defaults to Doctor project.json layout", () => {
    expect(DEFAULT_WORKSPACE_PROJECT_GLOBS).toEqual(["**/.mf/doctor/project.json"]);
  });

  it("discovers clean and conflict fixtures under configured roots", async () => {
    const clean = await discoverWorkspaceProjects({
      cwd: repository,
      roots: ["fixtures/workspaces/clean"],
    });
    expect(clean).toHaveLength(2);
    expect(
      clean.every((file) =>
        file.endsWith(`${path.sep}.mf${path.sep}doctor${path.sep}project.json`),
      ),
    ).toBe(true);

    const conflict = await discoverWorkspaceProjects({
      cwd: repository,
      roots: ["fixtures/workspaces/conflict"],
    });
    expect(conflict).toHaveLength(2);
  });

  it("supports manual glob overrides as an escape hatch", async () => {
    const files = await discoverWorkspaceProjects({
      cwd: repository,
      roots: ["examples/showcase/federation/version-conflict"],
      globs: ["*.project.json"],
    });
    expect(files.map((file) => path.basename(file)).sort()).toEqual([
      "host.project.json",
      "remote.project.json",
    ]);
  });

  it("reports explicit federation groups and filters one group without cross-group diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-groups-"));
    try {
      const fixture = JSON.parse(
        await fs.readFile(
          path.join(repository, "fixtures/workspaces/clean/host/.mf/doctor/project.json"),
          "utf8",
        ),
      );
      for (const [index, group] of ["checkout", "catalog"].entries()) {
        const projectRoot = path.join(root, `apps/${group}`);
        const project = structuredClone(fixture);
        project.project.name = `${group}-host`;
        project.project.federationGroup = group;
        await fs.mkdir(path.join(projectRoot, ".mf/doctor"), { recursive: true });
        await fs.writeFile(
          path.join(projectRoot, ".mf/doctor/project.json"),
          JSON.stringify(project),
        );
        if (index === 0) await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
      }

      const all = await discoverWorkspaceProjectsWithBudget({ cwd: root });
      expect(all.groups).toEqual(["catalog", "checkout"]);
      expect(all.ungrouped).toBe(0);
      expect(all.files).toHaveLength(2);

      const checkout = await discoverWorkspaceProjectsWithBudget({ cwd: root, group: "checkout" });
      expect(checkout.selectedGroup).toBe("checkout");
      expect(checkout.groups).toEqual(["catalog", "checkout"]);
      expect(checkout.files).toHaveLength(1);
      expect(checkout.diagnostics).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("applies an explicit group before workspace budgets are spent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-group-budget-"));
    try {
      const fixture = JSON.parse(
        await fs.readFile(
          path.join(repository, "fixtures/workspaces/clean/host/.mf/doctor/project.json"),
          "utf8",
        ),
      );
      const entries = [
        ["a-independent", "independent"],
        ["z-selected", "selected"],
      ] as const;
      for (const [directory, group] of entries) {
        const file = path.join(root, "apps", directory, ".mf/doctor/project.json");
        const project = structuredClone(fixture);
        project.project.name = directory;
        project.project.federationGroup = group;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(project));
      }

      const selected = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        group: "selected",
        analysisBudgets: { maxFiles: 1 },
      });

      expect(selected.files).toHaveLength(1);
      expect(selected.files[0]).toContain(`${path.sep}z-selected${path.sep}`);
      expect(selected.budget.status).toBe("complete");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("selects a group when the root project object exceeds the bounded probe", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-large-project-"));
    try {
      const file = path.join(root, ".mf", "doctor", "project.json");
      const contents = JSON.stringify({
        project: {
          name: "large-project",
          federationGroup: "selected",
          padding: "x".repeat(20 * 1024),
        },
      });
      expect(Buffer.byteLength(contents, "utf8")).toBeGreaterThan(16 * 1024);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        group: "selected",
      });

      expect(discovery.files).toEqual([file]);
      expect(discovery.groups).toEqual(["selected"]);
      expect(discovery.diagnostics).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("ignores string and nested project lookalikes before the root project", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-root-project-"));
    try {
      const file = path.join(root, ".mf", "doctor", "project.json");
      const contents = JSON.stringify({
        metadata: {
          text: '"project": {"federationGroup": "string-fake"}',
          nested: { project: { federationGroup: "nested-fake" } },
        },
        project: {
          name: "real-project",
          federationGroup: "selected",
          padding: "x".repeat(20 * 1024),
        },
      });
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        group: "selected",
      });

      expect(discovery.files).toEqual([file]);
      expect(discovery.groups).toEqual(["selected"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("continues the bounded probe past large padding before federationGroup", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-group-padding-"));
    try {
      const cases = [
        ["string", "x".repeat(20 * 1024)],
        ["object", { nested: "x".repeat(20 * 1024) }],
      ] as const;
      const files: string[] = [];
      for (const [kind, padding] of cases) {
        const file = path.join(root, "apps", kind, ".mf", "doctor", "project.json");
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
          file,
          JSON.stringify({
            project: {
              name: `padded-${kind}`,
              padding,
              federationGroup: "selected",
            },
          }),
        );
        files.push(file);
      }

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        group: "selected",
      });

      expect(discovery.files).toEqual(files.slice().sort());
      expect(discovery.groups).toEqual(["selected"]);
      expect(discovery.diagnostics).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["an empty string", '""'],
    ["a non-string value", "false"],
  ])(
    "matches JSON last-key-wins semantics when the later federationGroup is %s",
    async (_label, laterValue) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-group-duplicate-"));
      try {
        const file = path.join(root, "apps", "duplicate", ".mf", "doctor", "project.json");
        const contents =
          '{"project":{"name":"duplicate","federationGroup":"selected","padding":"' +
          "x".repeat(12 * 1024) +
          '","federationGroup":' +
          laterValue +
          "}}" +
          " ".repeat(20 * 1024);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, contents);

        const discovery = await discoverWorkspaceProjectsWithBudget({
          cwd: root,
          group: "selected",
        });

        expect(discovery.files).toEqual([]);
        expect(discovery.groups).toEqual([]);
        expect(discovery.ungrouped).toBe(1);
        expect(discovery.diagnostics).toEqual([]);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("excludes malformed project files selected by a group probe", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-group-invalid-"));
    try {
      const file = path.join(root, ".mf", "doctor", "project.json");
      const contents =
        '{"project":{"name":"malformed","federationGroup":"selected"},"padding":"' +
        "x".repeat(20 * 1024) +
        '"';
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        group: "selected",
      });

      expect(discovery.files).toEqual([]);
      expect(discovery.diagnostics).toEqual([
        {
          kind: "invalid",
          files: [".mf/doctor/project.json"],
          message: "Invalid project facts: .mf/doctor/project.json",
        },
      ]);

      const result = await analyzeFederation(discovery.files, {
        workspaceDiagnostics: discovery.diagnostics,
      });

      expect(result.exitCode).toBe(2);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          ruleId: "doctor/partial-analysis",
          details: expect.objectContaining({
            workspaceDiagnostics: expect.arrayContaining([
              expect.objectContaining({ kind: "invalid" }),
            ]),
          }),
        }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports project files skipped by the aggregate group probe cap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-probe-cap-"));
    try {
      const padding = "x".repeat(20 * 1024);
      for (let index = 0; index < 520; index += 1) {
        const appName = "app-" + String(index).padStart(3, "0");
        const file = path.join(root, "apps", appName, ".mf", "doctor", "project.json");
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
          file,
          JSON.stringify({
            project: {
              name: appName,
              federationGroup: "unrelated",
              padding,
            },
          }),
        );
      }
      const selectedFile = path.join(root, "apps", "zz-selected", ".mf", "doctor", "project.json");
      await fs.mkdir(path.dirname(selectedFile), { recursive: true });
      await fs.writeFile(
        selectedFile,
        JSON.stringify({
          project: {
            name: "selected",
            federationGroup: "selected",
            padding,
          },
        }),
      );

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        group: "selected",
      });

      expect(discovery.files).toEqual([]);
      expect(discovery.budget.usage.files).toBe(0);
      expect(discovery.budget.usage.serializedBytes).toBe(0);
      expect(discovery.diagnostics).toHaveLength(1);
      expect(discovery.diagnostics[0]).toMatchObject({
        kind: "probe",
        files: expect.arrayContaining([selectedFile]),
        message: expect.stringContaining("aggregate cap"),
      });
      expect(discovery.diagnostics[0]?.files).toEqual(
        discovery.diagnostics[0]?.files.slice().sort(),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports all files as unresolved when group preflight reaches its wall-time budget", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-probe-time-"));
    try {
      const files: string[] = [];
      for (const group of ["first", "second"]) {
        const file = path.join(root, "apps", group, ".mf", "doctor", "project.json");
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
          file,
          JSON.stringify({ project: { name: group, federationGroup: "selected" } }),
        );
        files.push(file);
      }

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        group: "selected",
        analysisBudgets: { maxWallTimeMs: 0 },
      });

      expect(discovery.files).toEqual([]);
      expect(discovery.budget.status).toBe("unknown");
      expect(discovery.budget.exceeded).toEqual([{ kind: "wallTimeMs", limit: 0 }]);
      expect(discovery.diagnostics).toEqual([
        {
          kind: "probe",
          files: files.slice().sort(),
          message: expect.stringContaining("wall-time limit"),
        },
      ]);
      expect(discovery.diagnostics[0]?.message).not.toContain("aggregate cap");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not restart the wall-time budget after selected-group preflight", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-shared-time-"));
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock++);
    try {
      const file = path.join(root, ".mf", "doctor", "project.json");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        file,
        JSON.stringify({ project: { name: "selected", federationGroup: "selected" } }),
      );

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        group: "selected",
        analysisBudgets: { maxWallTimeMs: 6 },
      });

      expect(discovery.files).toEqual([]);
      expect(discovery.budget.exceeded).toEqual([{ kind: "wallTimeMs", limit: 6 }]);
    } finally {
      nowSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns an empty list when nothing matches", async () => {
    const files = await discoverWorkspaceProjects({
      cwd: repository,
      roots: ["fixtures/manifests"],
    });
    expect(files).toEqual([]);
  });

  it("keeps federation-wide conflicts inside explicit groups", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-federation-groups-"));
    try {
      const fixture = JSON.parse(
        await fs.readFile(
          path.join(repository, "fixtures/workspaces/clean/host/.mf/doctor/project.json"),
          "utf8",
        ),
      );
      const files: string[] = [];
      for (const group of ["checkout", "catalog"]) {
        for (const suffix of ["one", "two"]) {
          const projectRoot = path.join(root, "apps", `${group}-${suffix}`);
          const project = structuredClone(fixture);
          project.project.name = `${group}-${suffix}`;
          project.project.federationGroup = group;
          project.moduleFederation.name = "shared-name";
          const file = path.join(projectRoot, ".mf/doctor/project.json");
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, JSON.stringify(project));
          files.push(file);
        }
      }

      const result = await analyzeFederation(files);
      const conflicts = result.findings.filter(
        (item) => item.ruleId === "federation/name-conflict",
      );
      expect(conflicts).toHaveLength(2);
      expect(conflicts.map((item) => item.evidence.projects)).toEqual([
        ["catalog-one", "catalog-two"],
        ["checkout-one", "checkout-two"],
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not let incomplete evidence in one group suppress another group", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-federation-group-evidence-"));
    try {
      const fixture = JSON.parse(
        await fs.readFile(
          path.join(repository, "fixtures/workspaces/clean/host/.mf/doctor/project.json"),
          "utf8",
        ),
      );
      const files: string[] = [];
      for (const [index, group] of ["complete", "complete", "partial"].entries()) {
        const project = structuredClone(fixture);
        project.project.name = `${group}-${index}`;
        project.project.federationGroup = group;
        project.moduleFederation.shared = {};
        project.imports.packages = group === "complete" ? ["lodash"] : [];
        if (group === "partial") {
          project.analysis = { status: "partial", exceeded: [{ kind: "files", limit: 1 }] };
        }
        const file = path.join(root, "apps", `${group}-${index}`, ".mf/doctor/project.json");
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(project));
        files.push(file);
      }

      const result = await analyzeFederation(files);

      expect(result.findings.some((item) => item.ruleId === "federation/host-gaps")).toBe(true);
      expect(result.findings.some((item) => item.ruleId === "doctor/partial-analysis")).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("suppresses ghost shares when a workspace budget omits project facts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-budget-"));
    try {
      const fixtureRoot = path.join(repository, "fixtures/workspaces/clean");
      const fixtureFiles = ["host", "remote"];
      for (const [index, name] of [...fixtureFiles, "omitted"].entries()) {
        const fixtureName = name === "omitted" ? "remote" : name;
        const project = JSON.parse(
          await fs.readFile(path.join(fixtureRoot, fixtureName, ".mf/doctor/project.json"), "utf8"),
        );
        if (name === "host") {
          project.moduleFederation.shared = {
            lodash: {
              package: "lodash",
              singleton: false,
              eager: false,
              shareScope: ["default"],
            },
          };
        }
        if (name === "remote") project.moduleFederation.shared = {};
        if (name === "omitted") project.project.name = "omitted";
        const file = path.join(
          root,
          `apps/${String.fromCharCode(97 + index)}-${name}/.mf/doctor/project.json`,
        );
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(project));
      }

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        analysisBudgets: { maxFiles: 2 },
      });
      expect(discovery.files).toHaveLength(2);
      expect(discovery.budget.status).toBe("unknown");
      expect(discovery.budget.exceeded).toEqual([{ kind: "files", limit: 2 }]);

      const result = await analyzeFederation(discovery.files, { analysis: discovery.budget });
      expect(result.exitCode).toBe(2);
      expect(result.findings.some((item) => item.ruleId === "federation/ghost-shares")).toBe(false);
      expect(result.findings).toContainEqual(
        expect.objectContaining({ ruleId: "doctor/partial-analysis" }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("suppresses ghost shares when a project reports unreadable source input", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-read-failure-"));
    try {
      const fixtureRoot = path.join(repository, "fixtures/workspaces/clean");
      const files: string[] = [];
      for (const name of ["host", "remote"]) {
        const project = JSON.parse(
          await fs.readFile(path.join(fixtureRoot, name, ".mf/doctor/project.json"), "utf8"),
        );
        if (name === "host") {
          project.moduleFederation.shared = {
            lodash: {
              package: "lodash",
              singleton: false,
              eager: false,
              shareScope: ["default"],
            },
          };
          project.imports.sourceReadFailures = [
            "src/unreadable.ts",
            path.join(root, "apps/host/src/unreadable.ts"),
            "src/unreadable.ts",
          ];
        } else {
          project.moduleFederation.shared = {};
        }
        const file = path.join(root, `apps/${name}/.mf/doctor/project.json`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(project));
        files.push(file);
      }

      const result = await analyzeFederation(files);
      const finding = result.findings.find((item) => item.ruleId === "doctor/partial-analysis");
      expect(result.exitCode).toBe(2);
      expect(finding?.project).toBe("workspace");
      expect(finding?.evidence).toEqual({
        sourceReadFailures: ["host/src/unreadable.ts"],
      });
      expect(finding?.detailsSchema).toBe("doctor.partial-analysis.v1");
      expect(finding?.details).toEqual({
        missing: [],
        sourceReadFailures: ["host/src/unreadable.ts"],
      });
      expect(result.findings.some((item) => item.ruleId === "federation/ghost-shares")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("persists project analysis and suppresses absence findings after reload", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-persisted-analysis-"));
    try {
      const fixtureRoot = path.join(repository, "fixtures/workspaces/clean");
      const files: string[] = [];
      for (const name of ["host", "remote"]) {
        const project = JSON.parse(
          await fs.readFile(path.join(fixtureRoot, name, ".mf/doctor/project.json"), "utf8"),
        ) as ProjectFacts;
        project.moduleFederation = project.moduleFederation ?? {
          name,
          exposes: {},
          remotes: {},
          shared: {},
        };
        project.moduleFederation.shared =
          name === "host"
            ? {
                lodash: {
                  package: "lodash",
                  singleton: false,
                  eager: false,
                  shareScope: ["default"],
                },
              }
            : {};
        if (name === "host") {
          project.analysis = {
            status: "partial",
            limits: resolveAnalysisBudgets({ maxFiles: 1 }),
            usage: { files: 1, sourceBytes: 0, artifacts: 0, evidenceNodes: 0, serializedBytes: 0 },
            exceeded: [{ kind: "files", limit: 1 }],
          };
        }
        const output = path.join(root, `apps/${name}/.mf/doctor`);
        await writeReports(project, emptyWorkspaceReport(project), output, []);
        files.push(path.join(output, "project.json"));
      }

      const result = await analyzeFederation(files);

      expect(result.exitCode).toBe(2);
      expect(result.findings.some((item) => item.ruleId === "federation/ghost-shares")).toBe(false);
      const finding = result.findings.find(
        (item) => item.ruleId === "doctor/partial-analysis" && item.evidence.projectAnalysis,
      );
      expect(finding?.detailsSchema).toBe("doctor.partial-analysis.v1");
      expect(finding?.details).toMatchObject({
        missing: [],
        projectAnalysis: [{ project: "host", analysis: { status: "partial" } }],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each(["partial", "unknown"] as const)(
    "preserves %s project analysis status through workspace reload",
    async (status) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-workspace-status-${status}-`));
      try {
        const fixtureRoot = path.join(repository, "fixtures/workspaces/clean");
        const files: string[] = [];
        for (const name of ["host", "remote"]) {
          const project = JSON.parse(
            await fs.readFile(path.join(fixtureRoot, name, ".mf/doctor/project.json"), "utf8"),
          ) as ProjectFacts;
          project.moduleFederation = project.moduleFederation ?? {
            name,
            exposes: {},
            remotes: {},
            shared: {},
          };
          project.moduleFederation.shared =
            name === "host"
              ? {
                  lodash: {
                    package: "lodash",
                    singleton: false,
                    eager: false,
                    shareScope: ["default"],
                  },
                }
              : {};
          if (name === "host") {
            project.analysis = {
              status,
              limits: resolveAnalysisBudgets({ maxFiles: 10 }),
              usage: {
                files: 1,
                sourceBytes: 0,
                artifacts: 0,
                evidenceNodes: 0,
                serializedBytes: 0,
              },
              exceeded: [],
            };
          }
          const output = path.join(root, `apps/${name}/.mf/doctor`);
          await writeReports(project, emptyWorkspaceReport(project), output, []);
          files.push(path.join(output, "project.json"));
        }

        const persistedHost = JSON.parse(await fs.readFile(files[0]!, "utf8")) as ProjectFacts;
        expect(persistedHost.analysis?.status).toBe(status);

        const result = await analyzeFederation(files);

        expect(result.exitCode).toBe(2);
        expect(result.findings.some((item) => item.ruleId === "federation/ghost-shares")).toBe(
          false,
        );
        const finding = result.findings.find(
          (item) => item.ruleId === "doctor/partial-analysis" && item.evidence.projectAnalysis,
        );
        expect(finding?.detailsSchema).toBe("doctor.partial-analysis.v1");
        expect(finding?.details).toMatchObject({
          missing: [],
          projectAnalysis: [{ project: "host", analysis: { status } }],
        });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("persists collected source-read incompleteness through workspace reload", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "mfdoctor-workspace-collected-read-failure-"),
    );
    try {
      const hostRoot = path.join(root, "apps/host");
      const remoteRoot = path.join(root, "apps/remote");
      for (const [projectRoot, name] of [
        [hostRoot, "host"],
        [remoteRoot, "remote"],
      ] as const) {
        await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
        await fs.writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name }));
        await fs.writeFile(path.join(projectRoot, "src/index.ts"), 'import "lodash";\n');
      }

      const hostSource = path.join(hostRoot, "src/index.ts");
      const originalReadFile = fs.readFile;
      const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
        if (path.resolve(String(file)) === hostSource) throw new Error("fixture read failed");
        return originalReadFile(file, options);
      });
      try {
        const host = await collectProjectFacts(
          await resolveOptions({
            root: hostRoot,
            bundler: "vite",
            mode: "ci",
            include: ["src/index.ts"],
            moduleFederation: {
              name: "host",
              exposes: {},
              remotes: {},
              shared: { lodash: { singleton: false, eager: false } },
            },
          }),
        );
        const remote = await collectProjectFacts(
          await resolveOptions({
            root: remoteRoot,
            bundler: "vite",
            mode: "ci",
            include: ["src/index.ts"],
            moduleFederation: { name: "remote", exposes: {}, remotes: {}, shared: {} },
          }),
        );
        expect(host.imports.sourceReadFailures).toEqual(["src/index.ts"]);
        expect(host.analysis?.status).toBe("unknown");

        const projectFiles: string[] = [];
        for (const [name, facts] of [
          ["host", host],
          ["remote", remote],
        ] as const) {
          const output = path.join(root, `apps/${name}/.mf/doctor`);
          await writeReports(facts, emptyWorkspaceReport(facts), output, []);
          projectFiles.push(path.join(output, "project.json"));
        }
        const persistedHost = JSON.parse(await fs.readFile(projectFiles[0]!, "utf8"));
        expect(persistedHost.imports.sourceReadFailures).toEqual(["src/index.ts"]);
        expect(persistedHost.analysis.status).toBe("unknown");

        const result = await analyzeFederation(projectFiles);
        expect(result.exitCode).toBe(2);
        expect(result.findings.some((item) => item.ruleId === "federation/ghost-shares")).toBe(
          false,
        );
        const partial = result.findings.find(
          (item) => item.ruleId === "doctor/partial-analysis" && item.evidence.projectAnalysis,
        );
        expect(partial?.detailsSchema).toBe("doctor.partial-analysis.v1");
        expect(partial?.details).toMatchObject({
          projectAnalysis: [{ project: "host", analysis: { status: "unknown" } }],
        });
      } finally {
        readFileSpy.mockRestore();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("suppresses all absence federation rules for unresolved package-capable usage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-unresolved-"));
    try {
      const files: string[] = [];
      for (const [index, name] of ["host", "consumer"].entries()) {
        const project = JSON.parse(
          await fs.readFile(
            path.join(repository, "fixtures/workspaces/clean/host/.mf/doctor/project.json"),
            "utf8",
          ),
        ) as ProjectFacts;
        project.project.name = name;
        project.moduleFederation = {
          name,
          exposes: {},
          remotes: {},
          shared:
            name === "host"
              ? {
                  lodash: {
                    package: "lodash",
                    singleton: false,
                    eager: false,
                    shareScope: ["default"],
                  },
                }
              : {
                  react: {
                    package: "react",
                    import: false,
                    singleton: true,
                    eager: false,
                    shareScope: ["default"],
                  },
                },
          ...(name === "host"
            ? {
                experiments: {
                  asyncStartup: false,
                  externalRuntime: true,
                  provideExternalRuntime: false,
                },
              }
            : {}),
        };
        project.imports.packages = ["lodash"];
        project.imports.unresolvedDynamic = [{ api: "loadShare", file: "src/app.ts" }];
        const output = path.join(
          root,
          `apps/${String.fromCharCode(97 + index)}-${name}/.mf/doctor`,
        );
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(path.join(output, "project.json"), JSON.stringify(project));
        files.push(path.join(output, "project.json"));
      }

      const result = await analyzeFederation(files);

      expect(result.exitCode).toBe(0);
      expect(result.findings.map((item) => item.ruleId)).not.toEqual(
        expect.arrayContaining([
          "federation/host-gaps",
          "federation/ghost-shares",
          "federation/missing-provider",
          "federation/external-runtime-provider-missing",
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports workspace diagnostics without changing discovery files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-"));
    try {
      for (const app of ["apps/one", "apps/two"]) {
        await fs.mkdir(path.join(root, app, ".mf", "doctor"), { recursive: true });
        await fs.writeFile(
          path.join(root, app, ".mf", "doctor", "project.json"),
          JSON.stringify({
            project: {
              name: "same-app",
              root: app === "apps/one" ? "." : "../missing",
              identityKey: "mfid:v1:application:000000000000000000000000",
            },
          }),
        );
      }
      const discovery = await discoverWorkspaceProjectsWithBudget({ cwd: root });
      expect(discovery.files).toHaveLength(2);
      expect(discovery.diagnostics.map((item) => item.kind)).toEqual([
        "conflict",
        "duplicate",
        "stale",
      ]);
      const cleanFiles = await discoverWorkspaceProjects({
        cwd: repository,
        roots: ["fixtures/workspaces/clean"],
      });
      const result = await analyzeFederation(cleanFiles, {
        workspaceDiagnostics: [
          {
            kind: "invalid",
            files: ["apps/invalid/.mf/doctor/project.json"],
            message: "Invalid project facts: apps/invalid/.mf/doctor/project.json",
          },
          {
            kind: "probe",
            files: ["apps/unknown/.mf/doctor/project.json"],
            message:
              "Group pre-probe could not determine federationGroup for 1 project file before reaching its 8388608-byte aggregate cap; group selection is unknown.",
          },
        ],
      });
      expect(result.exitCode).toBe(2);
      const finding = result.findings.find((item) => item.ruleId === "doctor/partial-analysis");
      expect(finding?.message).toBe("Doctor found workspace diagnostics; analysis is incomplete.");
      expect(finding?.message).not.toMatch(/stale|duplicate|conflicting|invalid/i);
      expect(finding?.detailsSchema).toBe("doctor.partial-analysis.v1");
      expect(finding?.details).toMatchObject({
        missing: [],
        workspaceDiagnostics: expect.arrayContaining([
          expect.objectContaining({ kind: "invalid" }),
          expect.objectContaining({ kind: "probe" }),
        ]),
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("omits a project that grows beyond the serialized-byte budget before parsing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-workspace-race-"));
    try {
      const file = path.join(root, ".mf", "doctor", "project.json");
      await fs.mkdir(path.dirname(file), { recursive: true });
      const original = JSON.stringify({ project: { name: "growing" } });
      await fs.writeFile(file, original);
      const originalReadFile = fs.readFile;
      vi.spyOn(fs, "readFile").mockImplementation(async (candidate, options) => {
        if (String(candidate) === file) return `${original} `;
        return originalReadFile(candidate, options);
      });

      const discovery = await discoverWorkspaceProjectsWithBudget({
        cwd: root,
        analysisBudgets: { maxSerializedBytes: Buffer.byteLength(original) },
      });

      expect(discovery.files).toEqual([]);
      expect(discovery.budget.status).toBe("unknown");
      expect(discovery.budget.exceeded).toEqual([
        { kind: "serializedBytes", limit: Buffer.byteLength(original) },
      ]);
    } finally {
      vi.restoreAllMocks();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
