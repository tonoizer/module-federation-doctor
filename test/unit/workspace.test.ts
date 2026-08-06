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

  it("marks omitted projects as unknown when a workspace budget is hit", async () => {
    const discovery = await discoverWorkspaceProjectsWithBudget({
      cwd: repository,
      roots: ["fixtures/workspaces/clean"],
      analysisBudgets: { maxFiles: 1 },
    });
    expect(discovery.files).toHaveLength(1);
    expect(discovery.budget.status).toBe("unknown");
    expect(discovery.budget.exceeded).toEqual([{ kind: "files", limit: 1 }]);
    const result = await analyzeFederation(discovery.files, { analysis: discovery.budget });
    expect(result.exitCode).toBe(2);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ ruleId: "doctor/partial-analysis" }),
    );
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
