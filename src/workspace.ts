import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import {
  AnalysisBudgetTracker,
  type AnalysisBudgetOptions,
  type AnalysisBudgetReport,
  resolveAnalysisBudgets,
} from "./analysis-budgets.js";
import { workspaceRootForProjects } from "./monorepo-identity.js";

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
  diagnostics: WorkspaceProjectDiagnostic[];
}

export type WorkspaceProjectDiagnosticKind = "stale" | "duplicate" | "conflict" | "invalid";

export interface WorkspaceProjectDiagnostic {
  kind: WorkspaceProjectDiagnosticKind;
  files: string[];
  message: string;
}

interface ProjectEnvelope {
  project?: { name?: unknown; root?: unknown; identityKey?: unknown };
}

async function readProjectEnvelope(file: string): Promise<ProjectEnvelope | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as ProjectEnvelope)
      : undefined;
  } catch {
    return undefined;
  }
}

function projectRootForFile(file: string): string {
  return path.dirname(path.dirname(path.dirname(file)));
}

async function inspectWorkspaceProjects(
  files: string[],
  workspaceRoot: string,
): Promise<WorkspaceProjectDiagnostic[]> {
  const diagnostics: WorkspaceProjectDiagnostic[] = [];
  const identities = new Map<string, string[]>();
  for (const file of files) {
    const displayFile = path.relative(workspaceRoot, file) || ".";
    const envelope = await readProjectEnvelope(file);
    const projectRoot = projectRootForFile(file);
    if (!envelope?.project || typeof envelope.project.name !== "string") {
      diagnostics.push({
        kind: "invalid",
        files: [displayFile],
        message: `Invalid project facts: ${displayFile}`,
      });
      continue;
    }
    const declaredRoot =
      typeof envelope.project.root === "string" ? envelope.project.root : undefined;
    const resolvedRoot = path.resolve(projectRoot, declaredRoot ?? ".");
    const rootExists = await fs
      .stat(resolvedRoot)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (!rootExists) {
      diagnostics.push({
        kind: "stale",
        files: [displayFile],
        message: `Project facts point to a missing project root: ${declaredRoot ?? "<missing>"}`,
      });
    }
    const relativeProjectRoot = path.relative(workspaceRoot, resolvedRoot) || ".";
    const identity =
      typeof envelope.project.identityKey === "string" && envelope.project.identityKey.length > 0
        ? envelope.project.identityKey
        : `${envelope.project.name}:${relativeProjectRoot}`;
    identities.set(identity, [...(identities.get(identity) ?? []), file]);
  }
  for (const [identity, matches] of identities) {
    if (matches.length < 2) continue;
    const sorted = matches.slice().sort();
    diagnostics.push({
      kind: "duplicate",
      files: sorted.map((file) => path.relative(workspaceRoot, file) || "."),
      message: `Duplicate project identity "${identity}" was found in ${sorted.length} files.`,
    });
    const contents = await Promise.all(sorted.map((file) => fs.readFile(file, "utf8")));
    if (new Set(contents).size > 1) {
      diagnostics.push({
        kind: "conflict",
        files: sorted.map((file) => path.relative(workspaceRoot, file) || "."),
        message: `Project files with identity "${identity}" disagree.`,
      });
    }
  }
  return diagnostics.sort((left, right) =>
    `${left.kind}:${left.files.join(",")}`.localeCompare(`${right.kind}:${right.files.join(",")}`),
  );
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
  const selectedFiles = selected.sort((left, right) => left.localeCompare(right));
  const workspaceRoot = workspaceRootForProjects(roots);
  return {
    files: selectedFiles,
    budget: budget.exceeded.length > 0 ? { ...budget, status: "unknown" } : budget,
    diagnostics:
      budget.exceeded.length > 0
        ? []
        : await inspectWorkspaceProjects(selectedFiles, workspaceRoot),
  };
}

export async function discoverWorkspaceProjects(
  options: DiscoverWorkspaceProjectsOptions = {},
): Promise<string[]> {
  return (await discoverWorkspaceProjectsWithBudget(options)).files;
}
