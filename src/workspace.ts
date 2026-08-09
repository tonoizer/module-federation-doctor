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

export type WorkspaceProjectDiagnosticKind =
  | "stale"
  | "duplicate"
  | "conflict"
  | "invalid"
  | "probe";

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

const GROUP_PROBE_MAX_BYTES = 16 * 1024;
// Keep group selection preflight independent from analysis budgets while
// bounding its total disk read to 8 MiB. Probes start with a 16 KiB prefix and
// may continue in deterministic, ordered chunks when the group is later.
const GROUP_PROBE_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

type GroupProbeStatus = "found" | "absent" | "unknown";

interface GroupProbeResult {
  file: string;
  contents?: string;
  complete: boolean;
  status: GroupProbeStatus;
  group?: string;
}

function skipJsonWhitespace(contents: string, start: number): number {
  let index = start;
  while (/\s/.test(contents[index] ?? "")) index += 1;
  return index;
}

interface JsonStringResult {
  value: string;
  end: number;
}

function readJsonString(contents: string, start: number): JsonStringResult | undefined {
  if (contents[start] !== '"') return undefined;
  let escaped = false;
  for (let index = start + 1; index < contents.length; index += 1) {
    const character = contents[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;
    try {
      const value = JSON.parse(contents.slice(start, index + 1)) as unknown;
      return typeof value === "string" ? { value, end: index + 1 } : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function skipJsonValue(contents: string, start: number): number | undefined {
  const valueStart = skipJsonWhitespace(contents, start);
  const first = contents[valueStart];
  if (first === '"') return readJsonString(contents, valueStart)?.end;
  if (first !== "{" && first !== "[") {
    let end = valueStart;
    while (end < contents.length && !/[\s,}\]]/.test(contents[end]!)) end += 1;
    if (end === valueStart) return undefined;
    try {
      JSON.parse(contents.slice(valueStart, end));
      return end;
    } catch {
      return undefined;
    }
  }

  const stack = [first];
  let inString = false;
  let escaped = false;
  for (let index = valueStart + 1; index < contents.length; index += 1) {
    const character = contents[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;
    const expected = character === "}" ? "{" : "[";
    if (stack.at(-1) !== expected) return undefined;
    stack.pop();
    if (stack.length === 0) return index + 1;
  }
  return undefined;
}

interface ProjectObjectPrefixResult {
  complete: boolean;
  end?: number;
  group?: string;
}

function groupFromProjectObjectPrefix(
  contents: string,
  objectStart: number,
): ProjectObjectPrefixResult {
  let index = objectStart + 1;
  while (true) {
    index = skipJsonWhitespace(contents, index);
    if (index >= contents.length) return { complete: false };
    if (contents[index] === "}") return { complete: true, end: index + 1 };

    const key = readJsonString(contents, index);
    if (!key) return { complete: false };
    index = skipJsonWhitespace(contents, key.end);
    if (contents[index] !== ":") return { complete: false };
    const valueStart = skipJsonWhitespace(contents, index + 1);
    if (key.value === "federationGroup" && contents[valueStart] === '"') {
      const value = readJsonString(contents, valueStart);
      if (!value) return { complete: false };
      const group = value.value.trim();
      if (group.length > 0) return { complete: false, group };
      index = value.end;
    } else {
      const valueEnd = skipJsonValue(contents, valueStart);
      if (valueEnd === undefined) return { complete: false };
      index = valueEnd;
    }

    index = skipJsonWhitespace(contents, index);
    if (contents[index] === ",") {
      index += 1;
      continue;
    }
    if (contents[index] === "}") return { complete: true, end: index + 1 };
    return { complete: false };
  }
}

function federationGroupFromPrefix(contents: string | undefined): {
  status: GroupProbeStatus;
  group?: string;
} {
  if (!contents) return { status: "unknown" };
  let index = skipJsonWhitespace(contents, 0);
  if (contents[index] !== "{") return { status: "unknown" };
  index += 1;

  while (true) {
    index = skipJsonWhitespace(contents, index);
    if (index >= contents.length) return { status: "unknown" };
    if (contents[index] === "}") return { status: "absent" };
    const key = readJsonString(contents, index);
    if (!key) return { status: "unknown" };
    index = skipJsonWhitespace(contents, key.end);
    if (contents[index] !== ":") return { status: "unknown" };
    const valueStart = skipJsonWhitespace(contents, index + 1);

    if (key.value === "project" && contents[valueStart] === "{") {
      const project = groupFromProjectObjectPrefix(contents, valueStart);
      if (project.group) return { status: "found", group: project.group };
      if (!project.complete) return { status: "unknown" };
      index = project.end!;
    } else {
      const valueEnd = skipJsonValue(contents, valueStart);
      if (valueEnd === undefined) return { status: "unknown" };
      index = valueEnd;
    }

    index = skipJsonWhitespace(contents, index);
    if (contents[index] === ",") {
      index += 1;
      continue;
    }
    if (contents[index] === "}") return { status: "absent" };
    return { status: "unknown" };
  }
}

function groupFromProjectEnvelope(envelope: ProjectEnvelope | undefined): string | undefined {
  const group = envelope?.project?.federationGroup;
  return typeof group === "string" && group.trim().length > 0 ? group.trim() : undefined;
}

function federationGroupFromContents(contents: string | undefined): string | undefined {
  if (!contents) return undefined;
  try {
    const value = JSON.parse(contents) as ProjectEnvelope;
    return groupFromProjectEnvelope(value);
  } catch {
    return undefined;
  }
}

interface WorkspaceReadResult {
  envelope?: ProjectEnvelope | undefined;
  contents?: string | undefined;
  withinBudget: boolean;
}

async function readGroupProbe(
  file: string,
  offset: number,
  contentLimit: number,
  fileSize: number,
): Promise<{ chunk?: Buffer; complete: boolean }> {
  const safeOffset = Math.max(0, offset);
  const safeContentLimit = Math.max(safeOffset, contentLimit);
  const safeFileSize = Math.max(0, fileSize);
  const maxBytes = Math.max(0, Math.min(safeContentLimit + 1, safeFileSize + 1) - safeOffset);
  if (maxBytes <= 0) return { chunk: Buffer.alloc(0), complete: true };
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, safeOffset);
    return {
      chunk: buffer.subarray(0, bytesRead),
      complete: bytesRead < maxBytes,
    };
  } catch {
    return { complete: false };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function probeWorkspaceGroups(
  files: string[],
  sizes: number[],
  selectedGroup: string,
): Promise<{
  scopedFiles: string[];
  scopedContents: Map<string, string | undefined>;
  groups: Set<string>;
  ungrouped: number;
  diagnostics: WorkspaceProjectDiagnostic[];
}> {
  // Group selection is a scope preflight, so unrelated projects must not
  // consume the selected group's analysis budget. The aggregate cap is
  // deliberately deterministic: files are already sorted by the caller.
  const probeTracker = new AnalysisBudgetTracker(
    resolveAnalysisBudgets({
      maxFiles: files.length,
      maxSerializedBytes: GROUP_PROBE_MAX_TOTAL_BYTES,
      maxWallTimeMs: Number.MAX_SAFE_INTEGER,
    }),
  );
  const probed: GroupProbeResult[] = [];
  const skippedFiles: string[] = [];
  const unknownFiles: string[] = [];
  let aggregateCapReached = false;
  for (const [index, file] of files.entries()) {
    const size = Math.max(0, sizes[index] ?? 0);
    const initialContentLimit = Math.min(size, GROUP_PROBE_MAX_BYTES);
    let reservedBytes = Math.min(size + 1, GROUP_PROBE_MAX_BYTES + 1);
    if (!probeTracker.reserve({ files: 1, serializedBytes: reservedBytes })) {
      skippedFiles.push(file);
      aggregateCapReached = true;
      continue;
    }

    let contentLimit = initialContentLimit;
    let offset = 0;
    let complete = false;
    let classification: { status: GroupProbeStatus; group?: string } = {
      status: "unknown",
    };
    let readSucceeded = false;
    const chunks: Buffer[] = [];
    while (true) {
      const result = await readGroupProbe(file, offset, contentLimit, size);
      if (result.chunk === undefined) break;
      readSucceeded = true;
      const contentBytes = Math.max(0, contentLimit - offset);
      const appendedBytes = Math.min(result.chunk.length, contentBytes);
      chunks.push(result.chunk.subarray(0, appendedBytes));
      offset += appendedBytes;
      complete = result.complete;
      const contents = Buffer.concat(chunks).toString("utf8");
      classification = complete
        ? (() => {
            try {
              const value = JSON.parse(contents) as ProjectEnvelope;
              const group = groupFromProjectEnvelope(value);
              return group ? { status: "found" as const, group } : { status: "absent" as const };
            } catch {
              return { status: "unknown" as const };
            }
          })()
        : federationGroupFromPrefix(contents);
      if (classification.status !== "unknown" || complete) break;
      if (contentLimit >= size) break;

      const nextContentLimit = Math.min(
        size,
        Math.max(contentLimit * 2, contentLimit + GROUP_PROBE_MAX_BYTES),
      );
      const nextReservedBytes = Math.min(size + 1, nextContentLimit + 1);
      const additionalBytes = nextReservedBytes - reservedBytes;
      if (additionalBytes <= 0 || !probeTracker.reserve({ serializedBytes: additionalBytes })) {
        aggregateCapReached = true;
        break;
      }
      reservedBytes = nextReservedBytes;
      contentLimit = nextContentLimit;
    }

    const contents = readSucceeded ? Buffer.concat(chunks).toString("utf8") : undefined;
    if (classification.status === "unknown") unknownFiles.push(file);
    probed.push({
      file,
      ...(contents !== undefined ? { contents } : {}),
      complete,
      status: classification.status,
      ...(classification.group ? { group: classification.group } : {}),
    });
  }
  const scopedFiles: string[] = [];
  const scopedContents = new Map<string, string | undefined>();
  const groups = new Set<string>();
  let ungrouped = 0;
  for (const item of probed) {
    if (item.group) groups.add(item.group);
    else if (item.status === "absent") ungrouped += 1;
    if (item.group !== selectedGroup) continue;
    scopedFiles.push(item.file);
    if (item.complete) scopedContents.set(item.file, item.contents);
  }
  const unresolvedFiles = [...new Set([...unknownFiles, ...skippedFiles])].sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    scopedFiles,
    scopedContents,
    groups,
    ungrouped,
    diagnostics:
      unresolvedFiles.length > 0
        ? [
            {
              kind: "probe",
              files: unresolvedFiles,
              message: aggregateCapReached
                ? "Group pre-probe could not determine federationGroup for " +
                  unresolvedFiles.length +
                  " project files before reaching its " +
                  GROUP_PROBE_MAX_TOTAL_BYTES +
                  "-byte aggregate cap; group selection is unknown."
                : "Group pre-probe could not determine federationGroup for " +
                  unresolvedFiles.length +
                  " project files; group selection is unknown.",
            } satisfies WorkspaceProjectDiagnostic,
          ]
        : [],
  };
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
  const analysisBudgets = resolveAnalysisBudgets(options.analysisBudgets);
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
  let scopedContents = new Map<string, string | undefined>();
  const observedGroups = new Set<string>();
  let observedUngrouped = 0;
  let scopedFiles = orderedFiles;
  let preflightSizes: Map<string, number> | undefined;
  let probeDiagnostics: WorkspaceProjectDiagnostic[] = [];
  if (options.group !== undefined) {
    const allSizes = await mapBounded(orderedFiles, (file) =>
      fs
        .stat(file)
        .then((item) => item.size)
        .catch(() => 0),
    );
    const probe = await probeWorkspaceGroups(orderedFiles, allSizes, options.group);
    scopedFiles = probe.scopedFiles.sort((left, right) => left.localeCompare(right));
    scopedContents = probe.scopedContents;
    for (const group of probe.groups) observedGroups.add(group);
    observedUngrouped = probe.ungrouped;
    probeDiagnostics = probe.diagnostics;
    preflightSizes = new Map(orderedFiles.map((file, index) => [file, allSizes[index] ?? 0]));
  }
  const tracker = new AnalysisBudgetTracker(analysisBudgets);
  const selected: Array<{ file: string; reservedBytes: number }> = [];
  const sizes =
    preflightSizes !== undefined
      ? scopedFiles.map((file) => preflightSizes!.get(file) ?? 0)
      : await mapBounded(scopedFiles, (file) =>
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
    diagnostics: [
      ...probeDiagnostics,
      ...(budget.exceeded.length > 0 ? [] : inspected.diagnostics),
    ],
  };
}

export async function discoverWorkspaceProjects(
  options: DiscoverWorkspaceProjectsOptions = {},
): Promise<string[]> {
  return (await discoverWorkspaceProjectsWithBudget(options)).files;
}
