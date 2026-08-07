import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { analyzeFederation } from "../../src/engine.js";
import {
  DEFAULT_WORKSPACE_PROJECT_GLOBS,
  discoverWorkspaceProjects,
  discoverWorkspaceProjectsWithBudget,
} from "../../src/workspace.js";

const repository = path.resolve(fileURLToPath(import.meta.url), "../../..");

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

  it("returns an empty list when nothing matches", async () => {
    const files = await discoverWorkspaceProjects({
      cwd: repository,
      roots: ["fixtures/manifests"],
    });
    expect(files).toEqual([]);
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
      expect(result.findings.some((item) => item.ruleId === "federation/ghost-shares")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports stale and conflicting project facts without changing discovery files", async () => {
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
