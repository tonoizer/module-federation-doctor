import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import fg from "fast-glob";
import {
  AnalysisBudgetTracker,
  type AnalysisBudgetOptions,
  type AnalysisBudgetReport,
  resolveAnalysisBudgets,
} from "./analysis-budgets.js";
import { workspaceRootForProjects } from "./monorepo-identity.js";
import { mapBounded } from "./async-map.js";
import { compareCodePoint, relativePath } from "./utils.js";

/** Default discovery for MFDoctor project facts under each app. */
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
  /** Override globs (manual escape hatch). Defaults to MFDoctor project.json layout. */
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
  /** Local host/remote expectations inferred from logical remote entries. */
  expectedParticipants: WorkspaceExpectedParticipant[];
}

export interface WorkspaceExpectedParticipant {
  host: string;
  remote: string;
  source: string;
  federationGroup?: string;
}

export type WorkspaceProjectDiagnosticKind =
  | "stale"
  | "duplicate"
  | "conflict"
  | "invalid"
  | "probe"
  | "missing-participant";

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
  moduleFederation?: unknown;
  federationInstances?: unknown;
  imports?: unknown;
  artifacts?: unknown;
  builds?: unknown;
}

const GROUP_PROBE_MAX_BYTES = 16 * 1024;
// Keep group selection preflight's file/serialized-byte reservations isolated
// from selected analysis while bounding its total disk read to 8 MiB. Probes
// start with a 16 KiB prefix and may continue in deterministic, ordered chunks
// when the group is later.
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
  const incomplete = (): ProjectObjectPrefixResult => ({
    complete: false,
    ...(group ? { group } : {}),
  });
  let index = objectStart + 1;
  let group: string | undefined;
  while (true) {
    index = skipJsonWhitespace(contents, index);
    if (index >= contents.length) return incomplete();
    if (contents[index] === "}") return { complete: true, end: index + 1 };

    const key = readJsonString(contents, index);
    if (!key) return incomplete();
    index = skipJsonWhitespace(contents, key.end);
    if (contents[index] !== ":") return incomplete();
    const valueStart = skipJsonWhitespace(contents, index + 1);
    if (key.value === "federationGroup") {
      if (contents[valueStart] === '"') {
        const value = readJsonString(contents, valueStart);
        if (!value) return incomplete();
        group = value.value.trim() || undefined;
        index = value.end;
      } else {
        const valueEnd = skipJsonValue(contents, valueStart);
        if (valueEnd === undefined) return incomplete();
        group = undefined;
        index = valueEnd;
      }
    } else {
      const valueEnd = skipJsonValue(contents, valueStart);
      if (valueEnd === undefined) return incomplete();
      index = valueEnd;
    }

    index = skipJsonWhitespace(contents, index);
    if (contents[index] === ",") {
      index += 1;
      continue;
    }
    if (contents[index] === "}") {
      return { complete: true, end: index + 1, ...(group ? { group } : {}) };
    }
    return incomplete();
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
  let provisionalGroup: string | undefined;

  while (true) {
    index = skipJsonWhitespace(contents, index);
    if (index >= contents.length)
      return provisionalGroup
        ? { status: "found", group: provisionalGroup }
        : { status: "unknown" };
    if (contents[index] === "}")
      return provisionalGroup ? { status: "found", group: provisionalGroup } : { status: "absent" };
    const key = readJsonString(contents, index);
    if (!key) return { status: "unknown" };
    index = skipJsonWhitespace(contents, key.end);
    if (contents[index] !== ":") return { status: "unknown" };
    const valueStart = skipJsonWhitespace(contents, index + 1);

    if (key.value === "project" && contents[valueStart] === "{") {
      const project = groupFromProjectObjectPrefix(contents, valueStart);
      if (!project.complete) {
        return project.group ? { status: "found", group: project.group } : { status: "unknown" };
      }
      if (project.group) provisionalGroup = project.group;
      index = project.end!;
    } else {
      const valueEnd = skipJsonValue(contents, valueStart);
      if (valueEnd === undefined)
        return provisionalGroup
          ? { status: "found", group: provisionalGroup }
          : { status: "unknown" };
      index = valueEnd;
    }

    index = skipJsonWhitespace(contents, index);
    if (contents[index] === ",") {
      index += 1;
      continue;
    }
    if (contents[index] === "}")
      return provisionalGroup ? { status: "found", group: provisionalGroup } : { status: "absent" };
    return provisionalGroup ? { status: "found", group: provisionalGroup } : { status: "unknown" };
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
  maxWallTimeMs: number,
  startedAt: number,
): Promise<{
  scopedFiles: string[];
  scopedContents: Map<string, string | undefined>;
  groups: Set<string>;
  ungrouped: number;
  diagnostics: WorkspaceProjectDiagnostic[];
}> {
  // Group selection is a scope preflight, so unrelated projects must not
  // consume the selected group's file/serialized-byte budget. Its wall-time
  // deadline is shared with selected analysis. The aggregate cap is
  // deliberately deterministic: files are already sorted by the caller.
  const probeTracker = new AnalysisBudgetTracker(
    resolveAnalysisBudgets({
      maxFiles: files.length,
      maxSerializedBytes: GROUP_PROBE_MAX_TOTAL_BYTES,
      maxWallTimeMs,
    }),
    { startedAt },
  );
  const probed: GroupProbeResult[] = [];
  const skippedFiles: string[] = [];
  const unknownFiles: string[] = [];
  let aggregateCapReached = false;
  let timeCutoffReached = false;
  for (const [index, file] of files.entries()) {
    if (!probeTracker.checkWallTime()) {
      timeCutoffReached = true;
      skippedFiles.push(...files.slice(index));
      break;
    }
    const size = Math.max(0, sizes[index] ?? 0);
    const initialContentLimit = Math.min(size, GROUP_PROBE_MAX_BYTES);
    let reservedBytes = Math.min(size + 1, GROUP_PROBE_MAX_BYTES + 1);
    if (!probeTracker.reserve({ files: 1, serializedBytes: reservedBytes })) {
      skippedFiles.push(file);
      if (!probeTracker.checkWallTime()) {
        timeCutoffReached = true;
        skippedFiles.push(...files.slice(index + 1));
        break;
      }
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
    let stopAfterCurrent = false;
    while (true) {
      if (!probeTracker.checkWallTime()) {
        timeCutoffReached = true;
        skippedFiles.push(...files.slice(index + 1));
        break;
      }
      const result = await readGroupProbe(file, offset, contentLimit, size);
      if (result.chunk === undefined) break;
      if (!probeTracker.checkWallTime()) {
        timeCutoffReached = true;
        skippedFiles.push(...files.slice(index + 1));
        stopAfterCurrent = true;
        break;
      }
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
      if (!probeTracker.checkWallTime()) {
        timeCutoffReached = true;
        skippedFiles.push(...files.slice(index + 1));
        classification = { status: "unknown" };
        complete = false;
        stopAfterCurrent = true;
        break;
      }
      if (classification.status !== "unknown" || complete) break;
      if (contentLimit >= size) break;

      const nextContentLimit = Math.min(
        size,
        Math.max(contentLimit * 2, contentLimit + GROUP_PROBE_MAX_BYTES),
      );
      const nextReservedBytes = Math.min(size + 1, nextContentLimit + 1);
      const additionalBytes = nextReservedBytes - reservedBytes;
      if (additionalBytes <= 0) break;
      if (!probeTracker.reserve({ serializedBytes: additionalBytes })) {
        if (!probeTracker.checkWallTime()) {
          timeCutoffReached = true;
          skippedFiles.push(...files.slice(index + 1));
          stopAfterCurrent = true;
        } else aggregateCapReached = true;
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
    if (stopAfterCurrent || timeCutoffReached) break;
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
  const unresolvedFiles = [...new Set([...unknownFiles, ...skippedFiles])].sort(compareCodePoint);
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
              message: timeCutoffReached
                ? "Group pre-probe could not determine federationGroup for " +
                  unresolvedFiles.length +
                  " project files before reaching its " +
                  maxWallTimeMs +
                  "-ms wall-time limit; group selection is unknown."
                : aggregateCapReached
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

type JsonRecord = Record<string, unknown>;

interface WorkspaceEvidenceTarget {
  kind: "source" | "artifact";
  absolutePath: string;
  relativePath: string;
  expectedDigest?: string;
  buildId?: string;
}

interface WorkspaceEvidenceObservation {
  target: WorkspaceEvidenceTarget;
  exists: boolean;
  mtimeMs?: number;
  digestMatches?: boolean;
}

function asJsonRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeEvidenceDigest(value: unknown): string | undefined {
  const digest = stringValue(value)
    ?.replace(/^sha256:/i, "")
    .toLowerCase();
  return digest && /^[a-f0-9]{64}$/.test(digest) ? digest : undefined;
}

function digestForPath(digests: unknown, candidate: string): string | undefined {
  const values = asJsonRecord(digests);
  if (!values) return undefined;
  const normalized = candidate.replaceAll("\\", "/");
  return normalizeEvidenceDigest(values[candidate] ?? values[normalized]);
}

function safeProjectEvidencePath(
  projectRoot: string,
  candidate: unknown,
): { absolutePath: string; relativePath: string } | undefined {
  const value = stringValue(candidate);
  if (!value) return undefined;
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|[a-z]:[\\/])/i.test(value)) return undefined;
  const absolutePath = path.resolve(projectRoot, value);
  const relativeEvidencePath = path.relative(projectRoot, absolutePath);
  if (
    relativeEvidencePath === "" ||
    relativeEvidencePath === ".." ||
    relativeEvidencePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeEvidencePath)
  )
    return undefined;
  return {
    absolutePath,
    relativePath: relativeEvidencePath.replaceAll(path.sep, "/"),
  };
}

function collectWorkspaceEvidenceTargets(
  envelope: ProjectEnvelope,
  projectRoot: string,
): WorkspaceEvidenceTarget[] {
  const targets = new Map<string, WorkspaceEvidenceTarget>();
  const add = (
    kind: WorkspaceEvidenceTarget["kind"],
    candidate: unknown,
    expectedDigest?: string,
    buildId?: string,
  ): void => {
    const resolved = safeProjectEvidencePath(projectRoot, candidate);
    if (!resolved) return;
    const key = `${kind}\0${resolved.absolutePath}`;
    const current = targets.get(key);
    if (current) {
      if (!current.expectedDigest && expectedDigest) current.expectedDigest = expectedDigest;
      if (!current.buildId && buildId) current.buildId = buildId;
      return;
    }
    targets.set(key, {
      kind,
      ...resolved,
      ...(expectedDigest ? { expectedDigest } : {}),
      ...(buildId ? { buildId } : {}),
    });
  };

  const imports = asJsonRecord(envelope.imports);
  for (const sourceFile of stringValues(imports?.sourceFiles)) {
    add("source", sourceFile, digestForPath(imports?.sourceDigests, sourceFile));
  }

  const artifacts = asJsonRecord(envelope.artifacts);
  const addArtifact = (value: unknown, buildId?: string): void => {
    if (typeof value === "string") {
      add("artifact", value, undefined, buildId);
      return;
    }
    const record = asJsonRecord(value);
    if (!record) return;
    add(
      "artifact",
      record.path,
      normalizeEvidenceDigest(record.digest ?? record.contentDigest ?? record.artifactDigest),
      buildId ?? stringValue(record.buildId),
    );
  };
  for (const record of Array.isArray(artifacts?.records) ? artifacts.records : [])
    addArtifact(record);
  for (const key of ["manifest", "stats"] as const) addArtifact(artifacts?.[key]);

  const builds = Array.isArray(envelope.builds) ? envelope.builds : [];
  for (const build of builds) {
    const buildRecord = asJsonRecord(build);
    if (!buildRecord) continue;
    const buildId = stringValue(buildRecord.id);
    for (const record of Array.isArray(buildRecord.artifacts) ? buildRecord.artifacts : [])
      addArtifact(record, buildId);
    for (const asset of stringValues(buildRecord.emittedAssets))
      add("artifact", asset, undefined, buildId);
  }
  return [...targets.values()].sort((left, right) =>
    compareCodePoint(`${left.kind}:${left.relativePath}`, `${right.kind}:${right.relativePath}`),
  );
}

async function digestWorkspaceEvidenceFile(file: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(file, "r");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function buildRecords(envelope: ProjectEnvelope): JsonRecord[] {
  return (Array.isArray(envelope.builds) ? envelope.builds : [])
    .map(asJsonRecord)
    .filter((value): value is JsonRecord => value !== undefined);
}

async function workspaceEvidenceDiagnostics(
  projectFile: string,
  projectRoot: string,
  workspaceRoot: string,
  envelope: ProjectEnvelope,
  tracker: AnalysisBudgetTracker,
): Promise<WorkspaceProjectDiagnostic[]> {
  if (!tracker.checkWallTime()) return [];
  const reportMtimeMs = await fs
    .stat(projectFile)
    .then((stat) => stat.mtimeMs)
    .catch(() => undefined);
  if (reportMtimeMs === undefined) return [];
  const targets = collectWorkspaceEvidenceTargets(envelope, projectRoot);
  if (targets.length === 0) return [];
  const observations = await mapBounded(
    targets,
    async (target): Promise<WorkspaceEvidenceObservation> => {
      try {
        const stat = await fs.stat(target.absolutePath);
        if (!stat.isFile()) return { target, exists: false };
        const digestMatches = target.expectedDigest
          ? (await digestWorkspaceEvidenceFile(target.absolutePath)) === target.expectedDigest
          : undefined;
        return {
          target,
          exists: true,
          mtimeMs: stat.mtimeMs,
          ...(digestMatches !== undefined ? { digestMatches } : {}),
        };
      } catch {
        return { target, exists: false };
      }
    },
  );
  const builds = buildRecords(envelope);
  const knownBuildIds = new Set(builds.map((build) => stringValue(build.id)).filter(Boolean));
  const hasBuildIdentity = builds.some(
    (build) => stringValue(build.id) || stringValue(build.hash) || stringValue(build.revision),
  );
  const artifactObservations = observations.filter(
    (observation) => observation.target.kind === "artifact" && observation.exists,
  );
  const diagnostics: WorkspaceProjectDiagnostic[] = [];
  for (const observation of observations) {
    const { target } = observation;
    if (!observation.exists) {
      diagnostics.push({
        kind: "stale",
        files: [relativePath(workspaceRoot, target.absolutePath)],
        message: `Project evidence references a missing ${target.kind}: ${target.relativePath}`,
      });
      continue;
    }
    if (target.expectedDigest && observation.digestMatches === false) {
      diagnostics.push({
        kind: "stale",
        files: [relativePath(workspaceRoot, target.absolutePath)],
        message: `Project evidence digest does not match ${target.kind}: ${target.relativePath}`,
      });
      continue;
    }
    if (
      target.kind === "source" &&
      observation.mtimeMs !== undefined &&
      observation.mtimeMs > reportMtimeMs &&
      !(target.expectedDigest && observation.digestMatches === true)
    ) {
      const hasLinkedArtifact = artifactObservations.some(
        (artifact) =>
          artifact.target.buildId &&
          knownBuildIds.has(artifact.target.buildId) &&
          artifact.mtimeMs !== undefined &&
          artifact.mtimeMs >= observation.mtimeMs!,
      );
      if (!hasBuildIdentity || !hasLinkedArtifact) {
        diagnostics.push({
          kind: "stale",
          files: [relativePath(workspaceRoot, target.absolutePath)],
          message: `Project evidence is stale: source input "${target.relativePath}" is newer than project facts.`,
        });
      }
    }
  }
  for (const observation of observations) {
    const buildId = observation.target.buildId;
    if (
      observation.target.kind === "artifact" &&
      buildId &&
      builds.length > 0 &&
      !knownBuildIds.has(buildId)
    ) {
      diagnostics.push({
        kind: "stale",
        files: [relativePath(workspaceRoot, observation.target.absolutePath)],
        message: `Project evidence references build "${buildId}" that is not present in the build records.`,
      });
    }
  }
  return diagnostics;
}

function federationConfigRecords(envelope: ProjectEnvelope): JsonRecord[] {
  const records: JsonRecord[] = [];
  const topLevel = asJsonRecord(envelope.moduleFederation);
  if (topLevel) records.push(topLevel);
  for (const instance of Array.isArray(envelope.federationInstances)
    ? envelope.federationInstances
    : []) {
    const record = asJsonRecord(instance);
    const config = asJsonRecord(record?.moduleFederation);
    if (config) records.push(config);
  }
  return records;
}

const EXTERNAL_REMOTE_ENTRY = /^(?:[a-z][a-z\d+.-]*:|\/\/|[\\/])/i;

/** True for URL/absolute remotes, including NormalizedRemote `name@url` shorthands. */
function isExternalRemoteEntry(entry: string): boolean {
  if (EXTERNAL_REMOTE_ENTRY.test(entry)) return true;
  const separator = entry.indexOf("@");
  if (separator <= 0) return false;
  return EXTERNAL_REMOTE_ENTRY.test(entry.slice(separator + 1).trim());
}

function expectedParticipantsForEnvelope(
  envelope: ProjectEnvelope,
  workspaceRoot: string,
  projectFile: string,
  federationGroup: string | undefined,
): { names: string[]; expected: WorkspaceExpectedParticipant[] } {
  const configs = federationConfigRecords(envelope);
  const projectName = stringValue(envelope.project?.name);
  const names = [
    ...new Set([projectName, ...configs.map((config) => stringValue(config.name)).filter(Boolean)]),
  ] as string[];
  const expected = new Map<string, WorkspaceExpectedParticipant>();
  for (const config of configs) {
    const host = stringValue(config.name) ?? projectName;
    if (!host) continue;
    const remotes = asJsonRecord(config.remotes);
    if (!remotes) continue;
    for (const [key, value] of Object.entries(remotes)) {
      let remoteName = key;
      let entry: string | undefined;
      if (typeof value === "string") {
        const separator = value.indexOf("@");
        if (separator > 0) {
          remoteName = value.slice(0, separator).trim() || key;
          entry = value.slice(separator + 1).trim();
        } else entry = value.trim();
      } else {
        const remote = asJsonRecord(value);
        remoteName = stringValue(remote?.name) ?? key;
        entry = stringValue(remote?.entry) ?? stringValue(remote?.url);
      }
      if (!remoteName || !entry || isExternalRemoteEntry(entry)) continue;
      const source = relativePath(workspaceRoot, projectFile);
      const identity = `${federationGroup ?? ""}\0${host}\0${remoteName}`;
      expected.set(identity, {
        host,
        remote: remoteName,
        source,
        ...(federationGroup ? { federationGroup } : {}),
      });
    }
  }
  return {
    names,
    expected: [...expected.values()].sort((left, right) =>
      compareCodePoint(
        `${left.federationGroup ?? ""}:${left.host}:${left.remote}:${left.source}`,
        `${right.federationGroup ?? ""}:${right.host}:${right.remote}:${right.source}`,
      ),
    ),
  };
}

async function inspectWorkspaceProjects(
  files: Array<{ file: string; reservedBytes: number }>,
  workspaceRoot: string,
  tracker: AnalysisBudgetTracker,
  preloadedContents: Map<string, string | undefined>,
  selectedGroup?: string,
): Promise<{
  files: string[];
  diagnostics: WorkspaceProjectDiagnostic[];
  expectedParticipants: WorkspaceExpectedParticipant[];
}> {
  const diagnostics: WorkspaceProjectDiagnostic[] = [];
  const identities = new Map<string, string[]>();
  const inspected = await mapBounded(files, async (file) => {
    const displayFile = relativePath(workspaceRoot, file.file);
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
        included: false,
        participantNames: [],
        expectedParticipants: [],
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
    const participants =
      included && rootExists
        ? expectedParticipantsForEnvelope(envelope, workspaceRoot, file.file, federationGroup)
        : { names: [], expected: [] };
    const evidenceDiagnostics =
      included && rootExists
        ? await workspaceEvidenceDiagnostics(
            file.file,
            resolvedRoot,
            workspaceRoot,
            envelope,
            tracker,
          )
        : [];
    return {
      file: file.file,
      contents: read.contents,
      identity: included ? identity : undefined,
      included,
      participantNames: participants.names,
      expectedParticipants: participants.expected,
      diagnostics: !included
        ? []
        : rootExists
          ? evidenceDiagnostics
          : [
              {
                kind: "stale",
                files: [displayFile],
                message: `Project facts point to a missing project root: ${declaredRoot ?? "<missing>"}`,
              } satisfies WorkspaceProjectDiagnostic,
            ],
    };
  });
  const discoveredParticipants = new Set<string>();
  const expectedParticipants = new Map<string, WorkspaceExpectedParticipant>();
  for (const item of inspected) {
    if (!item) continue;
    diagnostics.push(...item.diagnostics);
    if (item.identity)
      identities.set(item.identity, [...(identities.get(item.identity) ?? []), item.file]);
    if (item.included) {
      for (const name of item.participantNames)
        discoveredParticipants.add(`${federationGroupFromContents(item.contents) ?? ""}\0${name}`);
      for (const participant of item.expectedParticipants) {
        const key = `${participant.federationGroup ?? ""}\0${participant.host}\0${participant.remote}`;
        expectedParticipants.set(key, participant);
      }
    }
  }
  for (const [identity, matches] of identities) {
    if (matches.length < 2) continue;
    const sorted = matches.slice().sort(compareCodePoint);
    diagnostics.push({
      kind: "duplicate",
      files: sorted.map((file) => relativePath(workspaceRoot, file)),
      message: `Duplicate project identity "${identity}" was found in ${sorted.length} files.`,
    });
    const contents = sorted.map((file) => inspected.find((item) => item?.file === file)?.contents);
    if (new Set(contents).size > 1) {
      diagnostics.push({
        kind: "conflict",
        files: sorted.map((file) => relativePath(workspaceRoot, file)),
        message: `Project files with identity "${identity}" disagree.`,
      });
    }
  }
  const missingParticipants = new Map<
    string,
    { participant: WorkspaceExpectedParticipant; files: Set<string> }
  >();
  for (const participant of expectedParticipants.values()) {
    const participantKey = `${participant.federationGroup ?? ""}\0${participant.remote}`;
    if (discoveredParticipants.has(participantKey)) continue;
    const key = `${participant.federationGroup ?? ""}\0${participant.host}\0${participant.remote}`;
    const current = missingParticipants.get(key);
    if (current) current.files.add(participant.source);
    else missingParticipants.set(key, { participant, files: new Set([participant.source]) });
  }
  for (const { participant, files: missingFiles } of missingParticipants.values()) {
    diagnostics.push({
      kind: "missing-participant",
      files: [...missingFiles].sort(compareCodePoint),
      message: `Workspace host "${participant.host}" expects local remote participant "${participant.remote}" in federation group "${participant.federationGroup ?? "<ungrouped>"}", but it was not discovered.`,
    });
  }
  return {
    files: inspected
      .filter((item): item is NonNullable<typeof item> => !!item && item.included)
      .map((item) => item.file),
    diagnostics: diagnostics.sort((left, right) =>
      compareCodePoint(
        `${left.kind}:${left.files.join(",")}`,
        `${right.kind}:${right.files.join(",")}`,
      ),
    ),
    expectedParticipants: [...expectedParticipants.values()].sort((left, right) =>
      compareCodePoint(
        `${left.federationGroup ?? ""}:${left.host}:${left.remote}:${left.source}`,
        `${right.federationGroup ?? ""}:${right.host}:${right.remote}:${right.source}`,
      ),
    ),
  };
}

/**
 * Discover MFDoctor `project.json` files under workspace roots.
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
  const orderedFiles = [...files].sort(compareCodePoint);
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
  let sharedWallTimeStartedAt: number | undefined;
  if (options.group !== undefined) {
    const groupPreflightStartedAt = performance.now();
    sharedWallTimeStartedAt = groupPreflightStartedAt;
    const allSizes = await mapBounded(orderedFiles, (file) =>
      fs
        .stat(file)
        .then((item) => item.size)
        .catch(() => 0),
    );
    const probe = await probeWorkspaceGroups(
      orderedFiles,
      allSizes,
      options.group,
      analysisBudgets.maxWallTimeMs,
      groupPreflightStartedAt,
    );
    scopedFiles = probe.scopedFiles.sort(compareCodePoint);
    scopedContents = probe.scopedContents;
    for (const group of probe.groups) observedGroups.add(group);
    observedUngrouped = probe.ungrouped;
    probeDiagnostics = probe.diagnostics;
    preflightSizes = new Map(orderedFiles.map((file, index) => [file, allSizes[index] ?? 0]));
  }
  const tracker = new AnalysisBudgetTracker(
    analysisBudgets,
    sharedWallTimeStartedAt === undefined ? {} : { startedAt: sharedWallTimeStartedAt },
  );
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
  const selectedFiles = inspected.files.sort(compareCodePoint);
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
    groups: [...groups].sort(compareCodePoint),
    ungrouped,
    ...(options.group ? { selectedGroup: options.group } : {}),
    budget: budget.exceeded.length > 0 ? { ...budget, status: "unknown" } : budget,
    expectedParticipants: budget.exceeded.length > 0 ? [] : inspected.expectedParticipants,
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
