import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import {
  AnalysisBudgetTracker,
  type AnalysisBudgetOptions,
  type AnalysisBudgetReport,
  resolveAnalysisBudgets,
} from "./analysis-budgets.js";

/** Default discovery for Doctor project facts under each app. */
export const DEFAULT_WORKSPACE_PROJECT_GLOBS = ["**/.mf/doctor/project.json"] as const;

/** Paths skipped while walking workspace roots. */
export const WORKSPACE_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.turbo/**",
  "**/.next/**",
  "**/coverage/**",
] as const;

export interface DiscoverWorkspaceProjectsOptions {
  /** Absolute or cwd-relative roots to search. Defaults to `["."]`. */
  roots?: string[];
  /** Override globs (manual escape hatch). Defaults to Doctor project.json layout. */
  globs?: string[];
  /** Base directory for relative roots. Defaults to `process.cwd()`. */
  cwd?: string;
  analysisBudgets?: AnalysisBudgetOptions;
}

export interface WorkspaceProjectDiscovery {
  files: string[];
  budget: AnalysisBudgetReport;
}

/**
 * Discover Module Federation Doctor `project.json` files under workspace roots.
 * Offline only — does not fetch remotes or replace per-app build plugins.
 */
export async function discoverWorkspaceProjectsWithBudget(
  options: DiscoverWorkspaceProjectsOptions = {},
): Promise<WorkspaceProjectDiscovery> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const tracker = new AnalysisBudgetTracker(resolveAnalysisBudgets(options.analysisBudgets));
  const roots = (options.roots?.length ? options.roots : ["."]).map((root) =>
    path.resolve(cwd, root),
  );
  const globs = options.globs?.length ? options.globs : [...DEFAULT_WORKSPACE_PROJECT_GLOBS];
  const files = new Set<string>();
  for (const root of roots) {
    const matches = await fg(globs, {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      ignore: [...WORKSPACE_IGNORE],
      followSymbolicLinks: false,
    });
    for (const file of matches) files.add(path.normalize(file));
  }
  const selected: string[] = [];
  for (const file of [...files].sort((left, right) => left.localeCompare(right))) {
    const size = await fs
      .stat(file)
      .then((item) => item.size)
      .catch(() => 0);
    if (tracker.reserve({ files: 1, serializedBytes: size })) selected.push(file);
  }
  const budget = tracker.report();
  return {
    files: selected,
    budget: budget.exceeded.length > 0 ? { ...budget, status: "unknown" } : budget,
  };
}

export async function discoverWorkspaceProjects(
  options: DiscoverWorkspaceProjectsOptions = {},
): Promise<string[]> {
  return (await discoverWorkspaceProjectsWithBudget(options)).files;
}
