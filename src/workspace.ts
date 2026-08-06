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
import { mapBounded } from "./async-map.js";

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

interface WorkspaceReadResult {
  envelope?: ProjectEnvelope | undefined;
  contents?: string | undefined;
  withinBudget: boolean;
}

async function readProjectEnvelope(
  file: string,
  reservedBytes: number,
  tracker: AnalysisBudgetTracker,
  preloadedContents?: Map<string, string | undefined>,
): Promise<WorkspaceReadResult> {
  try {
    const isPreloaded = preloadedContents?.has(file) ?? false;
    const contents = isPreloaded ? preloadedContents!.get(file) : await fs.readFile(file, "utf8");
    if (!tracker.checkWallTime()) return { withinBudget: false };
    if (contents === undefined) return { withinBudget: true };
    const actualBytes = Buffer.byteLength(contents, "utf8");
    if (
      !isPreloaded &&
      actualBytes > reservedBytes &&
      !tracker.reserve({ serializedBytes: actualBytes - reservedBytes })
    )
      return { withinBudget: false };
    const value = JSON.parse(contents) as unknown;
    return {
      contents,
      withinBudget: true,
      envelope:
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as ProjectEnvelope)
          : undefined,
    };
  } catch {
    return { withinBudget: true };
  }
}

function projectRootForFile(file: string): string {
  return path.dirname(path.dirname(path.dirname(file)));
}

async function inspectWorkspaceProjects(
  files: Array<{ file: string; reservedBytes: number }>,
  workspaceRoot: string,
  tracker: AnalysisBudgetTracker,
  preloadedContents: Map<string, string | undefined>,
): Promise<{ files: string[]; diagnostics: WorkspaceProjectDiagnostic[] }> {
  const diagnostics: WorkspaceProjectDiagnostic[] = [];
  const identities = new Map<string, string[]>();
  const inspected = await mapBounded(files, async (file) => {
    const displayFile = path.relative(workspaceRoot, file.file) || ".";
    const read = await readProjectEnvelope(
      file.file,
      file.reservedBytes,
      tracker,
      preloadedContents,
    );
    if (!read.withinBudget) return undefined;
    const envelope = read.envelope;
    const projectRoot = projectRootForFile(file.file);
    if (!envelope?.project || typeof envelope.project.name !== "string") {
      return {
        file: file.file,
        contents: read.contents,
        identity: undefined,
        diagnostics: [
          {
            kind: "invalid",
            files: [displayFile],
            message: `Invalid project facts: ${displayFile}`,
          } satisfies WorkspaceProjectDiagnostic,
        ],
      };
    }
    const declaredRoot =
      typeof envelope.project.root === "string" ? envelope.project.root : undefined;
    const resolvedRoot = path.resolve(projectRoot, declaredRoot ?? ".");
    const rootExists = await fs
      .stat(resolvedRoot)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    const relativeProjectRoot = path.relative(workspaceRoot, resolvedRoot) || ".";
    const identity =
      typeof envelope.project.identityKey === "string" && envelope.project.identityKey.length > 0
        ? envelope.project.identityKey
        : `${envelope.project.name}:${relativeProjectRoot}`;
    return {
      file: file.file,
      contents: read.contents,
      identity,
      diagnostics: rootExists
        ? []
        : [
            {
              kind: "stale",
              files: [displayFile],
              message: `Project facts point to a missing project root: ${declaredRoot ?? "<missing>"}`,
            } satisfies WorkspaceProjectDiagnostic,
          ],
    };
  });
  for (const item of inspected) {
    if (!item) continue;
    diagnostics.push(...item.diagnostics);
    if (item.identity)
      identities.set(item.identity, [...(identities.get(item.identity) ?? []), item.file]);
  }
  for (const [identity, matches] of identities) {
    if (matches.length < 2) continue;
    const sorted = matches.slice().sort();
    diagnostics.push({
      kind: "duplicate",
      files: sorted.map((file) => path.relative(workspaceRoot, file) || "."),
      message: `Duplicate project identity "${identity}" was found in ${sorted.length} files.`,
    });
    const contents = sorted.map((file) => inspected.find((item) => item?.file === file)?.contents);
    if (new Set(contents).size > 1) {
      diagnostics.push({
        kind: "conflict",
        files: sorted.map((file) => path.relative(workspaceRoot, file) || "."),
        message: `Project files with identity "${identity}" disagree.`,
      });
    }
  }
  return {
    files: inspected
      .filter((item): item is NonNullable<typeof item> => !!item)
      .map((item) => item.file),
    diagnostics: diagnostics.sort((left, right) =>
      `${left.kind}:${left.files.join(",")}`.localeCompare(
        `${right.kind}:${right.files.join(",")}`,
      ),
    ),
  };
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
  const selected: Array<{ file: string; reservedBytes: number }> = [];
  const orderedFiles = [...files].sort((left, right) => left.localeCompare(right));
  const sizes = await mapBounded(orderedFiles, (file) =>
    fs
      .stat(file)
      .then((item) => item.size)
      .catch(() => 0),
  );
  for (const [index, file] of orderedFiles.entries()) {
    const size = sizes[index] ?? 0;
    if (tracker.reserve({ files: 1, serializedBytes: size }))
      selected.push({ file, reservedBytes: size });
  }
  const selectedContents = await mapBounded(selected, async ({ file }) => {
    if (!tracker.checkWallTime()) return undefined;
    return fs.readFile(file, "utf8").catch(() => undefined);
  });
  const preloadedContents = new Map<string, string | undefined>();
  const prepared: Array<{ file: string; reservedBytes: number }> = [];
  for (const [index, selectedFile] of selected.entries()) {
    const contents = selectedContents[index];
    preloadedContents.set(selectedFile.file, contents);
    if (contents === undefined) {
      prepared.push(selectedFile);
      continue;
    }
    const actualBytes = Buffer.byteLength(contents, "utf8");
    if (
      actualBytes > selectedFile.reservedBytes &&
      !tracker.reserve({ serializedBytes: actualBytes - selectedFile.reservedBytes })
    )
      continue;
    prepared.push(selectedFile);
  }
  const workspaceRoot = workspaceRootForProjects(roots);
  const inspected = await inspectWorkspaceProjects(
    prepared,
    workspaceRoot,
    tracker,
    preloadedContents,
  );
  const budget = tracker.report();
  const selectedFiles = inspected.files.sort((left, right) => left.localeCompare(right));
  return {
    files: selectedFiles,
    budget: budget.exceeded.length > 0 ? { ...budget, status: "unknown" } : budget,
    diagnostics: budget.exceeded.length > 0 ? [] : inspected.diagnostics,
  };
}

export async function discoverWorkspaceProjects(
  options: DiscoverWorkspaceProjectsOptions = {},
): Promise<string[]> {
  return (await discoverWorkspaceProjectsWithBudget(options)).files;
}
