import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
});
