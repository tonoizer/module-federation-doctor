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
  /** Select one explicit federation group while discovering project facts. */
  group?: string;
  analysisBudgets?: AnalysisBudgetOptions;
}

export interface WorkspaceProjectDiscovery {
  files: string[];
  /** Explicit groups observed in the discovered project facts. */
  groups: string[];
  /** Number of discovered projects without an explicit federation group. */
  ungrouped: number;
  /** Group used to filter `files`, when supplied. */
  selectedGroup?: string;
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
  project?: {
    name?: unknown;
    root?: unknown;
    identityKey?: unknown;
    federationGroup?: unknown;
  };
}

function federationGroupFromContents(contents: string | undefined): string | undefined {
  if (!contents) return undefined;
  try {
    const value = JSON.parse(contents) as ProjectEnvelope;
    const group = value.project?.federationGroup;
    return typeof group === "string" && group.trim().length > 0 ? group.trim() : undefined;
  } catch {
    return undefined;
  }
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
  selectedGroup?: string,
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
        included: true,
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
    const federationGroup = federationGroupFromContents(read.contents);
    const included = selectedGroup === undefined || federationGroup === selectedGroup;
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
      identity: included ? identity : undefined,
      included,
      diagnostics: !included
        ? []
        : rootExists
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
      .filter((item): item is NonNullable<typeof item> => !!item && item.included)
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
  const orderedFiles = [...files].sort((left, right) => left.localeCompare(right));
  // A selected group is a scope boundary, not a post-processing filter. Probe
  // the tiny project envelopes first so unrelated fixture groups cannot spend
  // the selected group's file/byte budget. The selected files are still fully
  // budgeted below; invalid/unreadable envelopes are left out of an explicit
  // group selection because their group cannot be established safely.
  const scopedContents = new Map<string, string | undefined>();
  const observedGroups = new Set<string>();
  let observedUngrouped = 0;
  let scopedFiles = orderedFiles;
  if (options.group !== undefined) {
    const probed = await mapBounded(orderedFiles, async (file) => ({
      file,
      contents: await fs.readFile(file, "utf8").catch(() => undefined),
    }));
    for (const { file, contents } of probed) {
      const group = federationGroupFromContents(contents);
      if (group) observedGroups.add(group);
      else if (contents !== undefined) observedUngrouped += 1;
      if (group !== options.group) continue;
      scopedContents.set(file, contents);
    }
    scopedFiles = [...scopedContents.keys()].sort((left, right) => left.localeCompare(right));
  }
  const selected: Array<{ file: string; reservedBytes: number }> = [];
  const sizes = await mapBounded(scopedFiles, (file) =>
    fs
      .stat(file)
      .then((item) => item.size)
      .catch(() => 0),
  );
  for (const [index, file] of scopedFiles.entries()) {
    const size = sizes[index] ?? 0;
    if (tracker.reserve({ files: 1, serializedBytes: size }))
      selected.push({ file, reservedBytes: size });
  }
  const selectedContents = await mapBounded(selected, async ({ file }) => {
    if (!tracker.checkWallTime()) return undefined;
    return scopedContents.get(file) ?? fs.readFile(file, "utf8").catch(() => undefined);
  });
  const preloadedContents = new Map(scopedContents);
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
    options.group,
  );
  const budget = tracker.report();
  const selectedFiles = inspected.files.sort((left, right) => left.localeCompare(right));
  const groups = new Set<string>(observedGroups);
  let ungrouped = observedUngrouped;
  for (const selectedFile of prepared) {
    if (options.group !== undefined) continue;
    const contents = preloadedContents.get(selectedFile.file);
    if (!contents) continue;
    try {
      const group = federationGroupFromContents(contents);
      if (group) groups.add(group);
      else ungrouped += 1;
    } catch {
      // Invalid payloads are surfaced through diagnostics, not group metadata.
    }
  }
  return {
    files: selectedFiles,
    groups: [...groups].sort((left, right) => left.localeCompare(right)),
    ungrouped,
    ...(options.group ? { selectedGroup: options.group } : {}),
    budget: budget.exceeded.length > 0 ? { ...budget, status: "unknown" } : budget,
    diagnostics: budget.exceeded.length > 0 ? [] : inspected.diagnostics,
  };
}

export async function discoverWorkspaceProjects(
  options: DiscoverWorkspaceProjectsOptions = {},
): Promise<string[]> {
  return (await discoverWorkspaceProjectsWithBudget(options)).files;
}
