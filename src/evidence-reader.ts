import fs from "node:fs/promises";
import nodePath from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import evidenceSchema from "../schemas/evidence.schema.json";
import projectSchema from "../schemas/project.schema.json";
import reportSchema from "../schemas/report.schema.json";
import {
  canonicalizeEvidenceValue,
  EvidenceIntegrityError,
  normalizeEvidenceGraph,
  stableEvidenceId,
  type EvidenceAssertion,
  type EvidenceCompletenessInfo,
  type EvidenceGraphV2,
  type EvidenceLimits,
  type EvidenceSubject,
  type EvidenceValue,
} from "./evidence.js";
import {
  AnalysisBudgetTracker,
  resolveAnalysisBudgets,
  type AnalysisBudgetOptions,
  type AnalysisBudgetReport,
} from "./analysis-budgets.js";
import {
  EvidenceBudgetExceededError,
  markEvidenceBudgetDimension,
  reserveEvidenceBudget,
} from "./evidence-budget.js";
import type { DoctorFinding, DoctorReport, ProjectFacts } from "./types.js";
import { buildFederationModel } from "./federation-model.js";
import { fingerprint } from "./utils.js";

export type EvidenceDocumentKind = "project-facts" | "doctor-report" | "evidence-graph";
export type EvidenceReaderFailureCode =
  | "malformed-json"
  | "not-found"
  | "permission-denied"
  | "read-failed"
  | "wrong-document-kind"
  | "schema-invalid"
  | "unsupported-version"
  | "integrity-invalid"
  | "budget-exceeded";

export interface EvidenceReaderOptions {
  fileLabel?: string;
  /** Reuse one analysis budget across imported evidence documents. */
  analysisBudget?: AnalysisBudgetTracker;
  /** Convenience form for one document; prefer analysisBudget for batches. */
  analysisBudgets?: AnalysisBudgetOptions;
}

export interface EvidenceProjectionOptions {
  /** Bound normalization and the atomically-created legacy projection. */
  analysisBudget?: AnalysisBudgetTracker;
  /** Convenience form for one projection. */
  analysisBudgets?: AnalysisBudgetOptions;
}

export interface EvidenceReaderErrorDetails {
  fileLabel?: string;
  detectedDocumentKind: EvidenceDocumentKind | "unknown";
  sourceVersion?: number | string;
  failureCode: EvidenceReaderFailureCode;
  pointer: string;
  report?: AnalysisBudgetReport;
}

export class EvidenceReaderError extends Error {
  readonly details: EvidenceReaderErrorDetails;
  readonly fileLabel: string | undefined;
  readonly detectedDocumentKind: EvidenceDocumentKind | "unknown";
  readonly sourceVersion: number | string | undefined;
  readonly failureCode: EvidenceReaderFailureCode;
  readonly pointer: string;
  readonly report: AnalysisBudgetReport | undefined;

  constructor(details: EvidenceReaderErrorDetails, message: string) {
    super(message);
    this.name = "EvidenceReaderError";
    this.details = details;
    this.fileLabel = details.fileLabel;
    this.detectedDocumentKind = details.detectedDocumentKind;
    this.sourceVersion = details.sourceVersion;
    this.failureCode = details.failureCode;
    this.pointer = details.pointer;
    this.report = details.report;
  }
}

/** A v2 graph did not contain enough legacy data to build a v1 product. */
export class EvidenceProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceProjectionError";
  }
}

export interface EvidenceDocumentReadResult {
  kind: EvidenceDocumentKind;
  sourceVersion: 1 | 2;
  graph: EvidenceGraphV2;
  analysis?: AnalysisBudgetReport;
}

function trackerFor(options: EvidenceReaderOptions): AnalysisBudgetTracker | undefined {
  return (
    options.analysisBudget ??
    (options.analysisBudgets
      ? new AnalysisBudgetTracker(resolveAnalysisBudgets(options.analysisBudgets))
      : undefined)
  );
}

function reserveBeforeCopy(
  value: unknown,
  tracker: AnalysisBudgetTracker,
  options: EvidenceReaderOptions,
  kind: EvidenceDocumentKind | "unknown",
  version?: number | string,
): AnalysisBudgetReport {
  try {
    reserveEvidenceBudget(value, tracker);
  } catch (error) {
    if (error instanceof EvidenceBudgetExceededError)
      throwReader(options, kind, version, "budget-exceeded", "/", error.message, error.report);
    throwReader(
      options,
      kind,
      version,
      "malformed-json",
      "/",
      error instanceof Error ? error.message : "Document is not JSON-safe.",
    );
  }
  return tracker.report();
}

/** Read one local v1/v2 evidence file through the same reader used by commands. */
export async function readEvidenceFile(
  filePath: string,
  options: EvidenceReaderOptions = {},
): Promise<EvidenceDocumentReadResult> {
  const resolved = nodePath.resolve(filePath);
  const fileLabel = options.fileLabel ?? resolved;
  const tracker = trackerFor(options);
  let raw: unknown;
  try {
    const stat = await fs.stat(resolved);
    if (tracker && !tracker.reserve({ serializedBytes: stat.size }))
      throwReader(
        { ...options, fileLabel },
        "unknown",
        undefined,
        "budget-exceeded",
        "/",
        `Evidence file exceeds the serialized-byte budget (${stat.size} bytes).`,
        tracker.report(),
      );
    const contents = await fs.readFile(resolved);
    const text = contents.toString("utf8");
    try {
      raw = JSON.parse(text) as unknown;
      if (tracker) markEvidenceBudgetDimension(raw, tracker, "serializedBytes");
    } catch {
      throw new EvidenceReaderError(
        {
          fileLabel,
          detectedDocumentKind: "unknown",
          failureCode: "malformed-json",
          pointer: "/",
        },
        `${fileLabel}: Document is not valid JSON at /`,
      );
    }
  } catch (error) {
    if (error instanceof EvidenceReaderError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    const failureCode: EvidenceReaderFailureCode =
      code === "ENOENT"
        ? "not-found"
        : code === "EACCES" || code === "EPERM"
          ? "permission-denied"
          : "read-failed";
    throw new EvidenceReaderError(
      {
        fileLabel,
        detectedDocumentKind: "unknown",
        failureCode,
        pointer: "/",
      },
      `${fileLabel}: Unable to read document${code ? ` (${code})` : ""}`,
    );
  }
  return readEvidenceDocument(raw, {
    ...options,
    fileLabel,
    ...(tracker ? { analysisBudget: tracker } : {}),
  });
}

type JsonRecord = Record<string, unknown>;
type Validator = ((value: unknown) => boolean) & { errors?: ErrorObject[] | null };

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validateProject = ajv.compile(projectSchema) as Validator;
const validateReport = ajv.compile(reportSchema) as Validator;
const validateEvidence = ajv.compile(evidenceSchema) as Validator;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceVersionOf(value: JsonRecord): number | string | undefined {
  if (isRecord(value.protocol)) {
    if (value.protocol.schemaVersion !== undefined)
      return value.protocol.schemaVersion as number | string;
    if (value.protocol.protocolVersion !== undefined)
      return value.protocol.protocolVersion as number | string;
  }
  return typeof value.schemaVersion === "number" || typeof value.schemaVersion === "string"
    ? value.schemaVersion
    : undefined;
}

function futureVersionOf(
  value: JsonRecord,
  kind: EvidenceDocumentKind,
): { value: number | string; pointer: string } | undefined {
  const expected = kind === "evidence-graph" ? 2 : 1;
  const candidates =
    kind === "evidence-graph" && isRecord(value.protocol)
      ? [
          { value: value.protocol.schemaVersion, pointer: "/protocol/schemaVersion" },
          { value: value.protocol.protocolVersion, pointer: "/protocol/protocolVersion" },
        ]
      : [{ value: value.schemaVersion, pointer: "/schemaVersion" }];
  return candidates.find(
    (candidate): candidate is { value: number | string; pointer: string } =>
      (typeof candidate.value === "number" && candidate.value > expected) ||
      (typeof candidate.value === "string" && Number(candidate.value) > expected),
  );
}

function looksLikeRuntimeObservabilityReport(value: JsonRecord): boolean {
  if (typeof value.traceId === "string") return true;
  if (value.hostName !== undefined || value.runtimeVersion !== undefined) return true;
  if (value.remote !== undefined || Array.isArray(value.events)) return true;
  const summary = isRecord(value.summary) ? value.summary : undefined;
  return Boolean(
    summary &&
    (summary.outcome !== undefined ||
      summary.phases !== undefined ||
      summary.flags !== undefined ||
      summary.runtimeLoaded !== undefined ||
      summary.loadCompleted !== undefined),
  );
}

function looksLikeRuntimeObservabilityDocument(value: JsonRecord): boolean {
  if ("findings" in value && "capabilities" in value) return false;
  if (value.report !== undefined && isRecord(value.report))
    return looksLikeRuntimeObservabilityReport(value.report);
  if (Array.isArray(value.reports))
    return value.reports.some(
      (item) => isRecord(item) && looksLikeRuntimeObservabilityReport(item),
    );
  return looksLikeRuntimeObservabilityReport(value);
}

function documentKindOf(value: JsonRecord): EvidenceDocumentKind | "unknown" {
  if ("protocol" in value || "subjects" in value || "assertions" in value) return "evidence-graph";
  // MFDoctor reports always include findings; bare `summary` also appears on Observability exports.
  if ("findings" in value) return "doctor-report";
  if (looksLikeRuntimeObservabilityDocument(value)) return "unknown";
  if ("project" in value || "bundler" in value || "dependencies" in value) return "project-facts";
  return "unknown";
}

function pointer(error: ErrorObject | undefined): string {
  return error?.instancePath || "/";
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function jsonValue(
  value: unknown,
  path: string,
  options: EvidenceReaderOptions,
  seen = new WeakSet<object>(),
  tracker?: AnalysisBudgetTracker,
): EvidenceValue {
  if (tracker && !tracker.checkWallTime()) throw new EvidenceBudgetExceededError(tracker.report());
  if (value === undefined || typeof value === "function" || typeof value === "symbol")
    throwReader(options, "unknown", undefined, "malformed-json", path, "Value is not JSON-safe.");
  if (typeof value === "bigint")
    throwReader(options, "unknown", undefined, "malformed-json", path, "Value is not JSON-safe.");
  if (typeof value === "number" && !Number.isFinite(value))
    throwReader(options, "unknown", undefined, "malformed-json", path, "Number must be finite.");
  if (Array.isArray(value) || isRecord(value)) {
    if (
      isRecord(value) &&
      !([Object.prototype, null] as (object | null)[]).includes(Object.getPrototypeOf(value))
    )
      throwReader(
        options,
        "unknown",
        undefined,
        "malformed-json",
        path,
        "Value must be a plain JSON object.",
      );
    if (seen.has(value))
      throwReader(
        options,
        "unknown",
        undefined,
        "malformed-json",
        path,
        "Document contains a cycle.",
      );
    seen.add(value);
  }
  if (Array.isArray(value)) {
    const result = value.map((item, index) =>
      jsonValue(item, `${path === "/" ? "" : path}/${index}`, options, seen, tracker),
    );
    seen.delete(value);
    return result;
  }
  if (isRecord(value)) {
    const result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonValue(
          item,
          `${path === "/" ? "" : path}/${escapeJsonPointerSegment(key)}`,
          options,
          seen,
          tracker,
        ),
      ]),
    );
    seen.delete(value);
    return result;
  }
  return value as EvidenceValue;
}

function throwReader(
  options: EvidenceReaderOptions,
  kind: EvidenceDocumentKind | "unknown",
  version: number | string | undefined,
  code: EvidenceReaderFailureCode,
  path: string,
  message: string,
  report?: AnalysisBudgetReport,
): never {
  const label = options.fileLabel ? `${options.fileLabel}: ` : "";
  throw new EvidenceReaderError(
    {
      ...(options.fileLabel ? { fileLabel: options.fileLabel } : {}),
      detectedDocumentKind: kind,
      ...(version !== undefined ? { sourceVersion: version } : {}),
      failureCode: code,
      pointer: path,
      ...(report ? { report } : {}),
    },
    `${label}${message} at ${path}`,
  );
}

function validateOrThrow(
  value: JsonRecord,
  kind: EvidenceDocumentKind,
  options: EvidenceReaderOptions,
): void {
  const version = sourceVersionOf(value);
  const futureVersion = futureVersionOf(value, kind);
  if (futureVersion)
    throwReader(
      options,
      kind,
      futureVersion.value,
      "unsupported-version",
      futureVersion.pointer,
      "Unsupported future document version",
    );

  const validator =
    kind === "project-facts"
      ? validateProject
      : kind === "doctor-report"
        ? validateReport
        : validateEvidence;
  if (validator(value)) return;
  const error = validator.errors?.[0];
  throwReader(
    options,
    kind,
    version,
    "schema-invalid",
    pointer(error),
    error?.message ?? "Schema validation failed",
  );
}

function baseGraph(
  scope: EvidenceGraphV2["scope"],
  identity: EvidenceGraphV2["identity"],
  source: string,
): EvidenceGraphV2 {
  return {
    protocol: {
      protocolVersion: 2,
      schemaVersion: 2,
      producer: { name: "@tonoizer/mfdoctor", version: "1" },
      source: { kind: source, schemaVersion: "1" },
    },
    scope: { ...scope, bundler: { ...scope.bundler } },
    identity,
    subjects: [],
    assertions: [],
    edges: [],
    evaluations: [],
  };
}

function completeness(
  status: EvidenceCompletenessInfo["status"],
  reason: string,
  missing?: string[],
): EvidenceCompletenessInfo {
  return { status, reason, ...(missing ? { missing: missing.slice() } : {}) };
}

function cloneCompleteness(info: EvidenceCompletenessInfo): EvidenceCompletenessInfo {
  return completeness(info.status, info.reason, info.missing);
}

function projectFieldCapability(field: string): string | undefined {
  return {
    bundler: "config",
    moduleFederation: "config",
    imports: "sourceImports",
    dependencies: "installedVersions",
    "artifacts.manifest": "manifest",
    "artifacts.stats": "stats",
    "artifacts.emittedAssets": "emittedAssets",
  }[field];
}

function sourceScanCompleteness(input: ProjectFacts): EvidenceCompletenessInfo {
  const analysis = input.analysis;
  const sourceReadFailures = input.imports.sourceReadFailures ?? [];
  if (sourceReadFailures.length > 0) {
    return completeness(
      "unknown",
      "Some source files could not be read; absence-based source rules cannot claim certainty.",
      sourceReadFailures.map((file) => `imports.sourceReadFailures:${file}`),
    );
  }
  if (
    input.imports.sourceScope === "partial" ||
    (analysis?.exceeded.length ?? 0) > 0 ||
    (analysis !== undefined && analysis.status !== "complete")
  ) {
    return completeness(
      analysis?.status === "unknown" ? "unknown" : "partial",
      "Source scan was partial or budget-limited; absence-based source rules cannot claim certainty.",
      [
        ...(input.imports.sourceScope === "partial" ? ["imports.sourceScope:partial"] : []),
        ...(analysis?.exceeded.length ? analysis.exceeded.map((item) => `analysis:${item}`) : []),
      ],
    );
  }
  return completeness("complete", "Source scan completed without read failures.");
}

function fieldCompleteness(
  input: JsonRecord,
  field: string,
  present: boolean,
): EvidenceCompletenessInfo {
  const capabilities = isRecord(input.capabilities) ? input.capabilities : undefined;
  const capability = projectFieldCapability(field);
  if (!present)
    return completeness(
      "unknown",
      "Field was omitted from the v1 document and was not collected.",
      [field],
    );
  if (capability && capabilities && capabilities[capability] === false)
    return completeness(
      "not-collected",
      `The v1 capability ${capability} was false; this field is not claimed as collected.`,
      [field],
    );
  if (field === "artifacts" && capabilities) {
    const unavailable = ["manifest", "stats", "emittedAssets"].filter(
      (name) => capabilities[name] === false,
    );
    if (unavailable.length > 0)
      return completeness(
        "partial",
        "Some artifact capabilities were false; unavailable artifact data is not claimed as collected.",
        unavailable,
      );
  }
  return completeness("complete", "Field is present and its v1 capability was not false.");
}

function manifestWasExplicitlyDisabled(input: ProjectFacts): boolean {
  if (input.capabilities.manifest || input.moduleFederation?.manifest?.enabled !== false)
    return false;

  // A collected canonical declaration distinguishes an explicit `manifest: false`
  // from a bundler default (notably Vite's default-off manifest behavior).
  const canonicalConfig = input.federationInstanceId
    ? input.federationInstances?.find((instance) => instance.id === input.federationInstanceId)
        ?.canonicalConfig
    : input.canonicalConfig;
  const declaredManifest = canonicalConfig?.declared.fields.find(
    (field) => field.key === "manifest",
  );
  if (declaredManifest)
    return declaredManifest.value.state === "known" && declaredManifest.value.value === false;

  // Enhanced bundlers default manifests on, so a normalized false value in a
  // legacy/persisted facts document is enough to establish explicit disablement.
  return ["webpack", "rspack", "rsbuild", "modern"].includes(input.bundler.name);
}

function nonEmpty(value: string, fallback: string): string {
  return value || fallback;
}

function largeLegacyLimits(
  value: EvidenceValue,
  tracker?: AnalysisBudgetTracker,
): EvidenceLimits & { allowLarge: true } {
  let nodes = 0;
  let maxDepth = 0;
  let maxWidth = 1;
  const seen = new WeakSet<object>();
  const pending: Array<{ value: EvidenceValue; depth: number }> = [{ value, depth: 0 }];
  while (pending.length > 0) {
    if (tracker && !tracker.checkWallTime())
      throw new EvidenceBudgetExceededError(tracker.report());
    const item = pending.pop();
    if (!item) continue;
    nodes += 1;
    maxDepth = Math.max(maxDepth, item.depth);
    if (Array.isArray(item.value)) {
      if (seen.has(item.value))
        throw new EvidenceIntegrityError("Evidence value contains a cycle.");
      seen.add(item.value);
      maxWidth = Math.max(maxWidth, item.value.length);
      item.value.forEach((child) => pending.push({ value: child, depth: item.depth + 1 }));
    } else if (isRecord(item.value)) {
      if (seen.has(item.value))
        throw new EvidenceIntegrityError("Evidence value contains a cycle.");
      seen.add(item.value);
      const entries = Object.values(item.value);
      maxWidth = Math.max(maxWidth, entries.length);
      entries.forEach((child) => pending.push({ value: child, depth: item.depth + 1 }));
    }
  }
  if (tracker && !tracker.checkWallTime()) throw new EvidenceBudgetExceededError(tracker.report());
  const inputBytes = Buffer.byteLength(JSON.stringify(value));
  return {
    maxDepth: maxDepth + 16,
    maxNodes: nodes * 4 + 256,
    maxBytes: inputBytes * 8 + 65_536,
    maxWidth: maxWidth + 16,
    allowLarge: true,
  };
}

function finalizeGraph(graph: EvidenceGraphV2, options: EvidenceReaderOptions): EvidenceGraphV2 {
  const tracker = trackerFor(options);
  if (tracker) {
    markEvidenceBudgetDimension(graph, tracker, "evidenceNodes");
    markEvidenceBudgetDimension(graph, tracker, "serializedBytes");
  }
  const normalized = normalizeEvidenceGraph(
    graph,
    largeLegacyLimits(graph as unknown as EvidenceValue, tracker),
    tracker,
  );
  validateOrThrow(normalized as unknown as JsonRecord, "evidence-graph", options);
  return normalized;
}

function projectionRecord(value: EvidenceValue, label: string): JsonRecord {
  if (!isRecord(value)) throw new EvidenceProjectionError(`${label} must be an object`);
  return value;
}

function projectionValue(value: EvidenceValue, limits?: EvidenceLimits): EvidenceValue {
  return canonicalizeEvidenceValue(value, limits);
}

function assertionValue(
  graph: EvidenceGraphV2,
  predicate: string,
  subject?: string,
): EvidenceValue | undefined {
  return graph.assertions
    .filter(
      (item) => item.predicate === predicate && (subject === undefined || item.subject === subject),
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0]?.value;
}

function projectionSubject(graph: EvidenceGraphV2): string | undefined {
  return graph.subjects
    .filter((subject) => subject.kind === "project")
    .sort((left, right) => left.id.localeCompare(right.id))[0]?.id;
}

/**
 * Build the legacy ProjectFacts view from a graph that carries project
 * compatibility assertions. The graph stays the source of truth; this is a
 * pure, additive compatibility view and does not enable v2 collection.
 */
export function projectFactsFromEvidence(
  graph: EvidenceGraphV2,
  options: EvidenceProjectionOptions = {},
): ProjectFacts {
  const tracker = trackerFor(options);
  const limits = largeLegacyLimits(graph as unknown as EvidenceValue, tracker);
  const normalized = normalizeEvidenceGraph(graph, limits, tracker);
  const subject = projectionSubject(normalized);
  if (subject === undefined)
    throw new EvidenceProjectionError("Evidence graph has no project subject");

  const fields = [
    "project",
    "bundler",
    "capabilities",
    "moduleFederation",
    "federationInstances",
    "dependencies",
    "imports",
    "runtimePluginContracts",
    "artifacts",
    "builds",
  ] as const;
  const output: JsonRecord = { schemaVersion: 1 };
  for (const field of fields) {
    const value = assertionValue(normalized, `project.${field}`, subject);
    if (value !== undefined) output[field] = projectionValue(value, limits);
  }
  for (const field of [
    "project",
    "bundler",
    "capabilities",
    "dependencies",
    "imports",
    "artifacts",
  ])
    if (output[field] === undefined)
      throw new EvidenceProjectionError(`Evidence graph is missing project.${field}`);

  validateOrThrow(output, "project-facts", {});
  if (tracker) reserveEvidenceBudget(output, tracker);
  return output as unknown as ProjectFacts;
}

/**
 * Build the legacy DoctorReport view from v1-compatible finding assertions
 * linked by fail evaluations. Non-fail outcomes stay out of strict v1.
 */
export function reportFromEvaluations(
  graph: EvidenceGraphV2,
  options: EvidenceProjectionOptions = {},
): DoctorReport {
  const tracker = trackerFor(options);
  const limits = largeLegacyLimits(graph as unknown as EvidenceValue, tracker);
  const normalized = normalizeEvidenceGraph(graph, limits, tracker);
  const capabilities = assertionValue(normalized, "doctor.capabilities");
  const summary = assertionValue(normalized, "doctor.summary");
  if (capabilities === undefined || summary === undefined)
    throw new EvidenceProjectionError("Evidence graph is missing doctor report metadata");

  const findings: DoctorFinding[] = [];
  for (const evaluation of normalized.evaluations
    .filter((item) => item.outcome === "fail")
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const finding = evaluation.evidenceIds
      .map((id) => normalized.assertions.find((candidate) => candidate.id === id))
      .find((candidate) => candidate?.predicate === "doctor.finding")?.value;
    if (finding === undefined)
      throw new EvidenceProjectionError(
        `Fail evaluation ${evaluation.id} has no v1 doctor.finding assertion`,
      );
    findings.push(
      projectionRecord(
        projectionValue(finding, limits),
        "doctor.finding",
      ) as unknown as DoctorFinding,
    );
  }

  const output: JsonRecord = {
    schemaVersion: 1,
    capabilities: projectionValue(capabilities, limits),
    summary: projectionValue(summary, limits),
    findings,
  };
  const status = assertionValue(normalized, "doctor.status");
  if (status !== undefined) output.status = projectionValue(status, limits);
  validateOrThrow(output, "doctor-report", {});
  if (tracker) reserveEvidenceBudget(output, tracker);
  return output as unknown as DoctorReport;
}

/**
 * Build the v1 report view from a generic v2 graph that carries evaluations.
 * Graphs produced before MFDoctor finding assertions existed still have enough
 * stable rule/evidence data for a useful offline report and baseline entry.
 */
export function reportFromV2Evaluations(
  graph: EvidenceGraphV2,
  options: EvidenceProjectionOptions = {},
): DoctorReport {
  const tracker = trackerFor(options);
  const normalized = normalizeEvidenceGraph(
    graph,
    largeLegacyLimits(graph as unknown as EvidenceValue, tracker),
    tracker,
  );
  const subjects = new Map(normalized.subjects.map((subject) => [subject.id, subject] as const));
  const project =
    normalized.identity.project ??
    normalized.subjects.find((subject) => subject.kind === "project")?.name ??
    "[evidence-v2]";
  const findings: DoctorFinding[] = normalized.evaluations
    .filter((evaluation) => evaluation.outcome === "fail")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((evaluation) => {
      const subject = subjects.get(evaluation.subject);
      const evidence = {
        evidenceIds: evaluation.evidenceIds.slice().sort(),
        assertions: evaluation.evidenceIds
          .map((id) => normalized.assertions.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is EvidenceAssertion => candidate !== undefined)
          .map((candidate) => ({
            predicate: candidate.predicate,
            value: candidate.value,
            layer: candidate.layer,
          })),
      };
      const base = {
        schemaVersion: 1 as const,
        ruleId: evaluation.rule.id,
        severity: "warning" as const,
        message: evaluation.reason,
        project,
        evidence,
      };
      return Object.assign(
        {},
        base,
        { fingerprint: fingerprint(base) },
        subject && subject.kind !== "project" ? { details: { subject: subject.name } } : {},
      ) as DoctorFinding;
    });
  const summary = {
    projects: normalized.subjects.filter((subject) => subject.kind === "project").length || 1,
    info: 0,
    warnings: findings.length,
    errors: 0,
  };
  const output: JsonRecord = {
    schemaVersion: 1,
    capabilities: {
      config: false,
      sourceImports: false,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: false,
    },
    summary,
    findings,
  };
  validateOrThrow(output, "doctor-report", {});
  if (tracker) reserveEvidenceBudget(output, tracker);
  return output as unknown as DoctorReport;
}

function assertion(
  subject: EvidenceSubject,
  predicate: string,
  value: EvidenceValue,
  scope: EvidenceGraphV2["scope"],
  source: string,
  complete: EvidenceCompletenessInfo,
  idSuffix?: string | number,
  limits?: EvidenceLimits,
): EvidenceAssertion {
  const id = stableEvidenceId(
    "assertion",
    {
      subject: subject.id,
      predicate,
      value,
      ...(idSuffix !== undefined ? { idSuffix: String(idSuffix) } : {}),
    },
    limits,
  );
  return {
    id,
    subject: subject.id,
    predicate,
    value,
    layer: predicate.startsWith("artifacts.")
      ? "artifact"
      : predicate === "project.moduleFederation" ||
          predicate === "project.scope" ||
          predicate === "federation.graph"
        ? "declared"
        : "effective",
    scope: { ...scope, bundler: { ...scope.bundler } },
    provenance: {
      collector: { name: "@tonoizer/mfdoctor", version: "1" },
      inputKind: source,
      source: "legacy-v1",
      sourceSchemaVersion: "1",
    },
    confidence: { level: "exact", reason: "Copied from a schema-valid v1 document." },
    completeness: complete,
  };
}

export function migrateProjectFacts(
  input: ProjectFacts,
  options: EvidenceReaderOptions = {},
): EvidenceGraphV2 {
  const tracker = trackerFor(options);
  if (tracker) reserveBeforeCopy(input, tracker, options, "project-facts", 1);
  // canonicalConfig is an in-memory declaration bridge, not part of the
  // persisted project-facts schema. Keep it on `input` for evidence derivation
  // but validate the schema-shaped projection without that private metadata.
  const persistedArtifacts = (artifacts: ProjectFacts["artifacts"]): ProjectFacts["artifacts"] => {
    const { records: _records, ...withoutRecords } = artifacts;
    return withoutRecords;
  };
  const valueInput = {
    ...input,
    artifacts: persistedArtifacts(input.artifacts),
  };
  delete valueInput.canonicalConfig;
  if (valueInput.federationInstances)
    valueInput.federationInstances = valueInput.federationInstances.map((instance) => {
      const { canonicalConfig: _canonicalConfig, artifacts, ...persistedInstance } = instance;
      return {
        ...persistedInstance,
        artifacts: persistedArtifacts(artifacts),
      };
    });
  const value = jsonValue(valueInput, "/", options, new WeakSet<object>(), tracker) as JsonRecord;
  if (tracker) {
    markEvidenceBudgetDimension(value, tracker, "evidenceNodes");
    markEvidenceBudgetDimension(value, tracker, "serializedBytes");
  }
  validateOrThrow(value, "project-facts", options);
  const limits = largeLegacyLimits(value as EvidenceValue, tracker);
  const project = input.project.name;
  const scope = {
    adapter: input.bundler.name,
    bundler: {
      name: input.bundler.name,
      ...(input.bundler.version ? { version: input.bundler.version } : {}),
    },
    target: "unknown" as const,
  };
  const subject: EvidenceSubject = {
    id: stableEvidenceId(
      "subject.project",
      {
        name: project,
        root: input.project.root,
        ...(input.federationInstanceId ? { federationInstanceId: input.federationInstanceId } : {}),
      },
      limits,
    ),
    kind: "project",
    name: project,
  };
  const graph = baseGraph(scope, { project }, "v1-project-facts");
  graph.subjects.push(subject);
  const scopeValue: EvidenceValue = {
    name: project,
    root: input.project.root,
    bundler: input.bundler.name,
    ...(input.federationInstanceId ? { federationInstanceId: input.federationInstanceId } : {}),
  };
  const fields = [
    "project",
    "bundler",
    "capabilities",
    "moduleFederation",
    "federationInstances",
    "dependencies",
    "imports",
    "artifacts",
    "runtimePluginContracts",
    "builds",
  ] as const;
  const fieldEvidence = new Map<
    (typeof fields)[number],
    { value: EvidenceValue; completeness: EvidenceCompletenessInfo }
  >();
  const bundlerFieldEvidence = new Map<
    string,
    { value: EvidenceValue; completeness: EvidenceCompletenessInfo }
  >();
  graph.assertions.push(
    assertion(
      subject,
      "project.scope",
      scopeValue,
      scope,
      "v1-project-facts",
      completeness("complete", "Project identity and bundler scope are present."),
      "scope",
      limits,
    ),
  );
  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(input, field);
    if (!present) continue;
    const completenessInfo = fieldCompleteness(value, field, present);
    const fieldValue = value[field] as EvidenceValue | undefined;
    if (fieldValue === undefined) continue;
    fieldEvidence.set(field, {
      value: structuredClone(fieldValue),
      completeness: structuredClone(completenessInfo),
    });
    graph.assertions.push(
      assertion(
        subject,
        `project.${field}`,
        structuredClone(fieldValue),
        scope,
        "v1-project-facts",
        completenessInfo,
        undefined,
        limits,
      ),
    );
    if (field === "imports") {
      graph.assertions.push(
        assertion(
          subject,
          "imports.sourceScan",
          jsonValue(
            {
              sourceScope: input.imports.sourceScope ?? "complete",
              sourceReadFailures: input.imports.sourceReadFailures ?? [],
              ...(input.analysis ? { analysis: input.analysis } : {}),
            },
            "/imports/sourceScan",
            options,
            new WeakSet<object>(),
            tracker,
          ),
          scope,
          "v1-project-facts",
          sourceScanCompleteness(input),
          undefined,
          limits,
        ),
      );
    }
  }

  const bundlerValue = value.bundler;
  if (isRecord(bundlerValue)) {
    const bundlerCompleteness = fieldCompleteness(value, "bundler", true);
    for (const [field, fieldValue] of Object.entries(bundlerValue)) {
      const evidence = {
        value: structuredClone(fieldValue as EvidenceValue),
        completeness: structuredClone(bundlerCompleteness),
      };
      bundlerFieldEvidence.set(field, evidence);
      graph.assertions.push(
        assertion(
          subject,
          `project.bundler.${field}`,
          evidence.value,
          scope,
          "v1-project-facts",
          evidence.completeness,
          undefined,
          limits,
        ),
      );
    }
    if (
      !bundlerFieldEvidence.has("moduleFederationPluginCount") &&
      typeof bundlerValue.name === "string" &&
      bundlerValue.name === "webpack"
    ) {
      const pluginCountEvidence = {
        value: 0 as EvidenceValue,
        completeness: completeness(
          "not-collected",
          "Webpack plugin registration count requires compiler diagnostics and was not collected.",
          ["bundler.moduleFederationPluginCount"],
        ),
      };
      bundlerFieldEvidence.set("moduleFederationPluginCount", pluginCountEvidence);
      graph.assertions.push(
        assertion(
          subject,
          "project.bundler.moduleFederationPluginCount",
          pluginCountEvidence.value,
          scope,
          "v1-project-facts",
          pluginCountEvidence.completeness,
          undefined,
          limits,
        ),
      );
    }
  }

  const appendProjectEvidence = (target: EvidenceSubject): void => {
    graph.assertions.push(
      assertion(
        target,
        "project.scope",
        structuredClone(scopeValue),
        scope,
        "v1-project-facts",
        completeness("complete", "Project identity and bundler scope are present."),
        "scope",
        limits,
      ),
    );
    for (const field of fields) {
      const evidence = fieldEvidence.get(field);
      if (!evidence) continue;
      graph.assertions.push(
        assertion(
          target,
          `project.${field}`,
          structuredClone(evidence.value),
          scope,
          "v1-project-facts",
          structuredClone(evidence.completeness),
          undefined,
          limits,
        ),
      );
    }
    for (const [field, evidence] of bundlerFieldEvidence) {
      graph.assertions.push(
        assertion(
          target,
          `project.bundler.${field}`,
          structuredClone(evidence.value),
          scope,
          "v1-project-facts",
          structuredClone(evidence.completeness),
          undefined,
          limits,
        ),
      );
    }
  };

  type ArtifactEvidenceField = "manifest" | "stats" | "emittedAssets" | "assetSizes";
  const artifactCapabilities: Partial<
    Record<ArtifactEvidenceField, keyof typeof input.capabilities>
  > = {
    manifest: "manifest",
    stats: "stats",
    emittedAssets: "emittedAssets",
  };
  const artifactEvidence = (
    field: ArtifactEvidenceField,
  ): { value: EvidenceValue; completeness: EvidenceCompletenessInfo } | undefined => {
    const present = Object.prototype.hasOwnProperty.call(input.artifacts, field);
    if (!present) return undefined;
    const raw = input.artifacts[field];
    if (raw === undefined) return undefined;
    const capability = artifactCapabilities[field];
    if (capability && input.capabilities[capability] === false)
      return {
        value: jsonValue(raw, `/artifacts/${field}`, options, new WeakSet<object>(), tracker),
        completeness: completeness(
          "not-collected",
          `The v1 capability ${capability} was false; artifact field ${field} is not claimed as collected.`,
          [`artifacts.${field}`],
        ),
      };
    const rawValid = isRecord(raw) ? (raw as JsonRecord).valid : undefined;
    if ((field === "manifest" || field === "stats") && rawValid === false)
      return {
        value: jsonValue(raw, `/artifacts/${field}`, options, new WeakSet<object>(), tracker),
        completeness: completeness(
          "unknown",
          `Artifact field ${field} was collected but is malformed; dependent rules cannot judge it.`,
          [`artifacts.${field}`],
        ),
      };
    if (field === "assetSizes" && input.capabilities.emittedAssets === false)
      return {
        value: jsonValue(raw, `/artifacts/${field}`, options, new WeakSet<object>(), tracker),
        completeness: completeness(
          "partial",
          "Emitted-asset collection was partial or unavailable; asset sizes may be incomplete.",
          ["artifacts.emittedAssets"],
        ),
      };
    return {
      value: jsonValue(raw, `/artifacts/${field}`, options, new WeakSet<object>(), tracker),
      completeness: completeness("complete", `Artifact field ${field} is present in the v1 facts.`),
    };
  };

  const manifestValidityEvidence = ():
    | {
        value: EvidenceValue;
        completeness: EvidenceCompletenessInfo;
      }
    | undefined => {
    const manifest = input.artifacts.manifest;
    if (manifest !== undefined) {
      if (input.capabilities.manifest === false)
        return {
          value: jsonValue(
            manifest,
            "/artifacts/manifest",
            options,
            new WeakSet<object>(),
            tracker,
          ),
          completeness: completeness(
            "not-collected",
            "The v1 manifest capability was false; manifest validity is not claimed as collected.",
            ["artifacts.manifestValidity"],
          ),
        };
      return {
        value: { valid: manifest.valid, path: manifest.path },
        completeness: completeness(
          "complete",
          "Manifest validity was explicitly collected from the v1 artifact record.",
        ),
      };
    }
    return undefined;
  };

  const manifestExplicitlyDisabledEvidence = ():
    | {
        value: EvidenceValue;
        completeness: EvidenceCompletenessInfo;
      }
    | undefined => {
    if (!manifestWasExplicitlyDisabled(input)) return undefined;
    return {
      value: { disabled: true, reason: "explicitly-disabled" },
      completeness: completeness(
        "complete",
        "Manifest generation is explicitly disabled; absence of a manifest is confirmed.",
      ),
    };
  };

  const artifactPath =
    input.artifacts.manifest?.path ?? input.artifacts.stats?.path ?? `${project}:artifacts`;
  const artifactSubject: EvidenceSubject = {
    id: stableEvidenceId(
      "subject.artifact",
      {
        project,
        root: input.project.root,
        path: artifactPath,
        ...(input.builds?.length === 1 ? { buildId: input.builds[0]!.id } : {}),
        ...(input.federationInstanceId ? { federationInstanceId: input.federationInstanceId } : {}),
      },
      limits,
    ),
    kind: "artifact",
    name: artifactPath,
    attributes: {
      project,
      ...(input.builds?.length === 1 ? { buildId: input.builds[0]!.id } : {}),
    },
  };
  graph.subjects.push(artifactSubject);
  appendProjectEvidence(artifactSubject);
  const manifestValidity = manifestValidityEvidence();
  if (manifestValidity)
    graph.assertions.push(
      assertion(
        artifactSubject,
        "artifacts.manifestValidity",
        manifestValidity.value,
        scope,
        "v1-project-facts",
        manifestValidity.completeness,
        undefined,
        limits,
      ),
    );
  const manifestExplicitlyDisabled = manifestExplicitlyDisabledEvidence();
  if (manifestExplicitlyDisabled)
    graph.assertions.push(
      assertion(
        artifactSubject,
        "artifacts.manifestExplicitlyDisabled",
        manifestExplicitlyDisabled.value,
        scope,
        "v1-project-facts",
        manifestExplicitlyDisabled.completeness,
        undefined,
        limits,
      ),
    );
  for (const field of ["manifest", "stats", "emittedAssets", "assetSizes"] as const) {
    const evidence = artifactEvidence(field);
    if (!evidence) continue;
    graph.assertions.push(
      assertion(
        artifactSubject,
        `artifacts.${field}`,
        evidence.value,
        scope,
        "v1-project-facts",
        evidence.completeness,
        undefined,
        limits,
      ),
    );
  }

  const buildRecords = input.builds?.length ? input.builds : [undefined];
  for (const build of buildRecords) {
    const buildId = build?.id ?? "unknown";
    const buildSubject: EvidenceSubject = {
      id: stableEvidenceId(
        "subject.build",
        {
          project,
          buildId,
          ...(build?.compilationName ? { compilationId: build.compilationName } : {}),
          ...(build?.outputRoot ? { outputRoot: build.outputRoot } : {}),
          ...(input.federationInstanceId
            ? { federationInstanceId: input.federationInstanceId }
            : {}),
        },
        limits,
      ),
      kind: "build",
      name: buildId,
      attributes: {
        project,
        ...(build?.compilationName ? { compilationId: build.compilationName } : {}),
        ...(build?.outputRoot ? { outputRoot: build.outputRoot } : {}),
      },
    };
    graph.subjects.push(buildSubject);
    appendProjectEvidence(buildSubject);
  }
  const requiredFields = [
    "project",
    "bundler",
    "capabilities",
    "moduleFederation",
    "dependencies",
    "imports",
    "artifacts",
  ] as const;
  const missing = requiredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(input, field),
  );
  if (missing.length > 0)
    graph.assertions.push(
      assertion(
        subject,
        "project.completeness",
        { missing: missing.slice() },
        scope,
        "v1-project-facts",
        completeness("partial", "Optional v1 fields were omitted.", missing),
        undefined,
        limits,
      ),
    );
  return finalizeGraph(graph, options);
}

const COMPLETENESS_RANK: Record<EvidenceCompletenessInfo["status"], number> = {
  "not-collected": 0,
  unknown: 1,
  partial: 2,
  complete: 3,
};

function weakestCompletenessInfo(...infos: EvidenceCompletenessInfo[]): EvidenceCompletenessInfo {
  return infos.reduce(
    (weak, info) => (COMPLETENESS_RANK[info.status] < COMPLETENESS_RANK[weak.status] ? info : weak),
    completeness("complete", "Evidence is complete."),
  );
}

function isFederationCapableProject(project: ProjectFacts): boolean {
  return Boolean(project.moduleFederation || (project.federationInstances?.length ?? 0) > 0);
}

function memberGraphCompleteness(project: ProjectFacts): EvidenceCompletenessInfo {
  if (!isFederationCapableProject(project)) {
    return completeness("unknown", "Project module federation config is missing.", [
      "moduleFederation",
    ]);
  }
  const analysis = project.analysis;
  if (analysis && (analysis.status !== "complete" || analysis.exceeded.length > 0)) {
    return completeness(
      analysis.status === "unknown" ? "unknown" : "partial",
      "Project analysis was partial or budget-limited.",
      analysis.exceeded.map((item) => `analysis:${item}`),
    );
  }
  return completeness("complete", "Declared federation topology is available.");
}

export interface FederationWorkspaceMigrationInput {
  projects: readonly ProjectFacts[];
  groupKey: string;
  workspaceAnalysis?: AnalysisBudgetReport;
  groupEvidenceIncomplete: boolean;
}

/** Build a workspace evidence graph with weakest-complete federation topology across members. */
export function migrateFederationWorkspace(
  input: FederationWorkspaceMigrationInput,
  options: EvidenceReaderOptions = {},
): EvidenceGraphV2 {
  const tracker = trackerFor(options);
  const limits = largeLegacyLimits(
    jsonValue(input, "/", options, new WeakSet<object>(), tracker) as EvidenceValue,
    tracker,
  );
  const representativeBundler = input.projects[0]?.bundler.name ?? "unknown";
  const scope = {
    adapter: representativeBundler,
    bundler: { name: representativeBundler },
    target: "unknown" as const,
  };
  const workspaceName = input.groupKey === "\0ungrouped" ? "workspace" : input.groupKey;
  const graph = baseGraph(scope, { workspace: workspaceName }, "v1-federation-workspace");
  const workspaceSubject: EvidenceSubject = {
    id: stableEvidenceId("subject.workspace", { name: workspaceName }, limits),
    kind: "project",
    name: workspaceName,
  };
  graph.subjects.push(workspaceSubject);

  const federationProjects = input.projects.filter((project) =>
    isFederationCapableProject(project),
  );
  const memberCompleteness = federationProjects.map((project) => memberGraphCompleteness(project));
  const sourceCompleteness = input.projects.map((project) => sourceScanCompleteness(project));
  let graphCompleteness =
    memberCompleteness.length > 0
      ? weakestCompletenessInfo(...memberCompleteness)
      : completeness(
          "unknown",
          "No federation-capable projects are present in the workspace group.",
          ["moduleFederation"],
        );
  if (
    input.workspaceAnalysis &&
    (input.workspaceAnalysis.status !== "complete" || input.workspaceAnalysis.exceeded.length > 0)
  ) {
    graphCompleteness = weakestCompletenessInfo(
      graphCompleteness,
      completeness(
        input.workspaceAnalysis.status === "unknown" ? "unknown" : "partial",
        "Workspace analysis was partial or budget-limited.",
        input.workspaceAnalysis.exceeded.map((item) => `analysis:${item}`),
      ),
    );
  }
  let workspaceSourceCompleteness = weakestCompletenessInfo(...sourceCompleteness);
  for (const project of input.projects) {
    if (
      (project.imports?.unresolvedDynamic ?? []).some((item) =>
        ["import", "loadShare", "loadShareSync"].includes(item.api),
      )
    ) {
      workspaceSourceCompleteness = weakestCompletenessInfo(
        workspaceSourceCompleteness,
        completeness(
          "partial",
          "Unresolved dynamic import or loadShare evidence cannot establish absence certainty.",
        ),
      );
    }
  }
  if (
    input.workspaceAnalysis &&
    (input.workspaceAnalysis.status !== "complete" || input.workspaceAnalysis.exceeded.length > 0)
  ) {
    workspaceSourceCompleteness = weakestCompletenessInfo(
      workspaceSourceCompleteness,
      completeness(
        input.workspaceAnalysis.status === "unknown" ? "unknown" : "partial",
        "Workspace analysis was partial or budget-limited.",
        input.workspaceAnalysis.exceeded.map((item) => `analysis:${item}`),
      ),
    );
  }
  if (input.groupEvidenceIncomplete) {
    workspaceSourceCompleteness = weakestCompletenessInfo(
      workspaceSourceCompleteness,
      completeness(
        "partial",
        "Workspace federation evidence is incomplete; absence-based rules cannot claim certainty.",
        ["groupEvidenceIncomplete"],
      ),
    );
  }

  const federation = buildFederationModel([...input.projects]);
  const federationGraphTemplate = {
    groupKey: input.groupKey,
    groupEvidenceIncomplete: input.groupEvidenceIncomplete,
    projects: federation.projects.map((node) => ({
      id: node.id,
      projectName: node.projectName,
      ...(node.federationName ? { federationName: node.federationName } : {}),
      ...(node.instanceId ? { instanceId: node.instanceId } : {}),
      shareStrategy: node.shareStrategy,
      asyncStartup: node.asyncStartup,
    })),
    remoteEdges: federation.remoteEdges.map((edge) => ({
      id: edge.id,
      fromProject: edge.fromProject,
      fromFederationName: edge.fromFederationName,
      remoteName: edge.remoteName,
      alias: edge.alias,
      matched: edge.matched,
    })),
    federationNames: [...federation.federationNames.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, owners]) => ({
        name,
        owners: owners.map((owner) => ({
          projectName: owner.projectName,
          ...(owner.instanceId ? { instanceId: owner.instanceId } : {}),
        })),
      })),
  };
  const federationGraphValue = (pathSuffix: string) =>
    jsonValue(
      structuredClone(federationGraphTemplate),
      `/federation.graph/${pathSuffix}`,
      options,
      new WeakSet<object>(),
      tracker,
    );

  const workspaceScopeTemplate = {
    workspace: workspaceName,
    projects: input.projects.map((project) => project.project.name),
  };
  const sourceScanTemplate = {
    projects: input.projects.map((project) => ({
      name: project.project.name,
      sourceScope: project.imports.sourceScope ?? "complete",
      sourceReadFailures: project.imports.sourceReadFailures ?? [],
    })),
    groupEvidenceIncomplete: input.groupEvidenceIncomplete,
  };

  graph.assertions.push(
    assertion(
      workspaceSubject,
      "project.scope",
      jsonValue(
        workspaceScopeTemplate,
        "/project.scope/workspace",
        options,
        new WeakSet<object>(),
        tracker,
      ),
      scope,
      "v1-federation-workspace",
      completeness("complete", "Workspace scope is present."),
      "scope",
      limits,
    ),
    assertion(
      workspaceSubject,
      "federation.graph",
      federationGraphValue("workspace"),
      scope,
      "v1-federation-workspace",
      graphCompleteness,
      undefined,
      limits,
    ),
    assertion(
      workspaceSubject,
      "imports.sourceScan",
      jsonValue(
        sourceScanTemplate,
        "/imports.sourceScan/workspace",
        options,
        new WeakSet<object>(),
        tracker,
      ),
      scope,
      "v1-federation-workspace",
      workspaceSourceCompleteness,
      undefined,
      limits,
    ),
  );

  for (const project of input.projects) {
    const subject: EvidenceSubject = {
      id: stableEvidenceId(
        "subject.project",
        { name: project.project.name, root: project.project.root },
        limits,
      ),
      kind: "project",
      name: project.project.name,
    };
    graph.subjects.push(subject);
    graph.assertions.push(
      assertion(
        subject,
        "project.scope",
        {
          name: project.project.name,
          root: project.project.root,
          bundler: project.bundler.name,
        },
        scope,
        "v1-federation-workspace",
        completeness("complete", "Project identity and bundler scope are present."),
        "scope",
        limits,
      ),
      assertion(
        subject,
        "imports.sourceScan",
        jsonValue(
          {
            sourceScope: project.imports.sourceScope ?? "complete",
            sourceReadFailures: project.imports.sourceReadFailures ?? [],
            ...(project.analysis ? { analysis: project.analysis } : {}),
          },
          `/projects/${project.project.name}/imports.sourceScan`,
          options,
          new WeakSet<object>(),
          tracker,
        ),
        scope,
        "v1-federation-workspace",
        sourceScanCompleteness(project),
        undefined,
        limits,
      ),
    );
  }

  const sharedPackages = new Set<string>();
  for (const node of federation.projects) {
    const config = node.instance?.moduleFederation ?? node.project.moduleFederation;
    for (const pkg of Object.keys(config?.shared ?? {})) sharedPackages.add(pkg);
  }
  for (const pkg of [...sharedPackages].sort()) {
    const sharedSubject: EvidenceSubject = {
      id: stableEvidenceId(
        "subject.shared-package",
        { workspace: workspaceName, package: pkg },
        limits,
      ),
      kind: "shared-package",
      name: pkg,
      attributes: {
        workspace: workspaceName,
        package: pkg,
      },
    };
    graph.subjects.push(sharedSubject);
    graph.assertions.push(
      assertion(
        sharedSubject,
        "project.scope",
        jsonValue(
          structuredClone(workspaceScopeTemplate),
          `/project.scope/shared-package/${pkg}`,
          options,
          new WeakSet<object>(),
          tracker,
        ),
        scope,
        "v1-federation-workspace",
        completeness("complete", "Workspace scope is present."),
        "scope",
        limits,
      ),
      assertion(
        sharedSubject,
        "federation.graph",
        federationGraphValue(`shared-package/${pkg}`),
        scope,
        "v1-federation-workspace",
        cloneCompleteness(graphCompleteness),
        undefined,
        limits,
      ),
      assertion(
        sharedSubject,
        "imports.sourceScan",
        jsonValue(
          structuredClone(sourceScanTemplate),
          `/imports.sourceScan/shared-package/${pkg}`,
          options,
          new WeakSet<object>(),
          tracker,
        ),
        scope,
        "v1-federation-workspace",
        cloneCompleteness(workspaceSourceCompleteness),
        undefined,
        limits,
      ),
    );
  }

  for (const edge of federation.remoteEdges) {
    const remoteSubject: EvidenceSubject = {
      id: stableEvidenceId("subject.remote", { edgeId: edge.id }, limits),
      kind: "remote",
      name: edge.alias || edge.remoteName,
      attributes: {
        edgeId: edge.id,
        fromProject: edge.fromProject,
        remoteName: edge.remoteName,
        alias: edge.alias,
        ...(edge.fromInstanceId ? { federationInstanceId: edge.fromInstanceId } : {}),
      },
    };
    graph.subjects.push(remoteSubject);
    graph.assertions.push(
      assertion(
        remoteSubject,
        "project.scope",
        {
          name: edge.fromProject,
          ...(edge.fromInstanceId ? { federationInstanceId: edge.fromInstanceId } : {}),
        },
        scope,
        "v1-federation-workspace",
        completeness("complete", "Remote edge project scope is present."),
        "scope",
        limits,
      ),
      assertion(
        remoteSubject,
        "federation.graph",
        federationGraphValue(`remote/${edge.id}`),
        scope,
        "v1-federation-workspace",
        cloneCompleteness(graphCompleteness),
        undefined,
        limits,
      ),
    );
  }

  return finalizeGraph(graph, options);
}

export function migrateDoctorReport(
  input: DoctorReport,
  options: EvidenceReaderOptions = {},
): EvidenceGraphV2 {
  const tracker = trackerFor(options);
  if (tracker) reserveBeforeCopy(input, tracker, options, "doctor-report", 1);
  const value = jsonValue(input, "/", options, new WeakSet<object>(), tracker) as JsonRecord;
  if (tracker) {
    markEvidenceBudgetDimension(value, tracker, "evidenceNodes");
    markEvidenceBudgetDimension(value, tracker, "serializedBytes");
  }
  validateOrThrow(value, "doctor-report", options);
  const limits = largeLegacyLimits(value as EvidenceValue, tracker);
  const scope = { adapter: "legacy-v1", bundler: { name: "unknown" }, target: "unknown" as const };
  const graph = baseGraph(scope, {}, "v1-doctor-report");
  const subjects = new Map<string, EvidenceSubject>();
  const subjectFor = (project: string): EvidenceSubject => {
    let subject = subjects.get(project);
    if (!subject) {
      subject = {
        id: stableEvidenceId("subject.project", { name: project }, limits),
        kind: "project",
        name: nonEmpty(project, "[legacy-v1-report]"),
      };
      subjects.set(project, subject);
      graph.subjects.push(subject);
    }
    return subject;
  };
  const findingEntries = input.findings.map((finding, findingIndex) => {
    const findingValue = jsonValue(
      finding,
      `/findings/${findingIndex}`,
      options,
      new WeakSet<object>(),
      tracker,
    );
    return {
      finding,
      findingIndex,
      value: findingValue,
      key: stableEvidenceId("finding", findingValue, limits),
      occurrence: 0,
    };
  });
  const occurrenceByKey = new Map<string, number>();
  const canonicalFindings = findingEntries
    .slice()
    .sort(
      (left, right) =>
        left.key.localeCompare(right.key) ||
        JSON.stringify(canonicalizeEvidenceValue(left.value, limits)).localeCompare(
          JSON.stringify(canonicalizeEvidenceValue(right.value, limits)),
        ) ||
        left.findingIndex - right.findingIndex,
    );
  for (const entry of canonicalFindings) {
    const occurrence = occurrenceByKey.get(entry.key) ?? 0;
    occurrenceByKey.set(entry.key, occurrence + 1);
    entry.occurrence = occurrence;
  }
  for (const { finding, value: findingValue, key: findingKey, occurrence } of findingEntries) {
    const subject = subjectFor(finding.project);
    const evidence = assertion(
      subject,
      "doctor.finding",
      findingValue,
      scope,
      "v1-doctor-report",
      completeness("complete", "Finding is present in the v1 report."),
      occurrence,
      limits,
    );
    graph.assertions.push(evidence);
    graph.evaluations.push({
      id: stableEvidenceId(
        "evaluation",
        {
          project: finding.project,
          ruleId: finding.ruleId,
          fingerprint: finding.fingerprint,
          findingKey,
          occurrence,
        },
        limits,
      ),
      rule: { id: finding.ruleId, version: "1" },
      subject: subject.id,
      outcome: "fail",
      evidenceIds: [evidence.id],
      reason: nonEmpty(finding.message, "Legacy v1 finding message was empty."),
      completeness: completeness(
        "complete",
        "Evaluation is copied from a schema-valid v1 finding.",
      ),
    });
  }
  if (input.findings.length === 0) subjectFor("");
  const metadataSubject = graph.subjects
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (metadataSubject) {
    graph.assertions.push(
      assertion(
        metadataSubject,
        "doctor.capabilities",
        jsonValue(input.capabilities, "/capabilities", options, new WeakSet<object>(), tracker),
        scope,
        "v1-doctor-report",
        completeness("complete", "Report capabilities are copied from the schema-valid v1 report."),
        "capabilities",
        limits,
      ),
      assertion(
        metadataSubject,
        "doctor.summary",
        jsonValue(input.summary, "/summary", options, new WeakSet<object>(), tracker),
        scope,
        "v1-doctor-report",
        completeness("complete", "Report summary is copied from the schema-valid v1 report."),
        "summary",
        limits,
      ),
    );
    if (input.status) {
      graph.assertions.push(
        assertion(
          metadataSubject,
          "doctor.status",
          jsonValue(input.status, "/status", options, new WeakSet<object>(), tracker),
          scope,
          "v1-doctor-report",
          completeness("complete", "Report status is copied from the schema-valid v1 report."),
          "status",
          limits,
        ),
      );
    }
  }
  return finalizeGraph(graph, options);
}

export function readEvidenceDocument(
  input: unknown,
  options: EvidenceReaderOptions = {},
): EvidenceDocumentReadResult {
  const detectedKind = isRecord(input) ? documentKindOf(input) : "unknown";
  const detectedVersion = isRecord(input) ? sourceVersionOf(input) : undefined;
  const tracker = trackerFor(options);
  if (tracker) reserveBeforeCopy(input, tracker, options, detectedKind, detectedVersion);
  let value: EvidenceValue;
  try {
    value = jsonValue(input, "/", options, new WeakSet<object>(), tracker);
    if (tracker) {
      markEvidenceBudgetDimension(value, tracker, "evidenceNodes");
      markEvidenceBudgetDimension(value, tracker, "serializedBytes");
    }
  } catch (error) {
    if (error instanceof EvidenceBudgetExceededError)
      throwReader(
        options,
        detectedKind,
        detectedVersion,
        "budget-exceeded",
        "/",
        error.message,
        error.report,
      );
    if (error instanceof EvidenceReaderError) {
      if (
        error.failureCode === "malformed-json" &&
        (detectedKind !== "unknown" || detectedVersion !== undefined)
      )
        throw new EvidenceReaderError(
          {
            ...error.details,
            detectedDocumentKind: detectedKind,
            ...(detectedVersion !== undefined ? { sourceVersion: detectedVersion } : {}),
          },
          error.message,
        );
      throw error;
    }
    throwReader(options, "unknown", undefined, "malformed-json", "/", "Document is not JSON-safe.");
  }
  if (!isRecord(value))
    throwReader(
      options,
      "unknown",
      undefined,
      "wrong-document-kind",
      "/",
      "Document must be a JSON object.",
    );
  const kind = documentKindOf(value);
  const version = sourceVersionOf(value);
  if (kind === "unknown") {
    if (looksLikeRuntimeObservabilityDocument(value))
      throwReader(
        options,
        "unknown",
        version,
        "wrong-document-kind",
        "/",
        "Runtime Observability reports must be read with parseRuntimeTraces/loadRuntimeTraceFile, not readEvidenceDocument.",
      );
    throwReader(options, kind, version, "wrong-document-kind", "/", "Unknown document kind");
  }
  validateOrThrow(value, kind, options);
  try {
    if (kind === "evidence-graph")
      return {
        kind,
        sourceVersion: 2,
        graph: normalizeEvidenceGraph(value as unknown as EvidenceGraphV2, undefined, tracker),
        ...(tracker ? { analysis: tracker.report() } : {}),
      };
    if (kind === "project-facts")
      return {
        kind,
        sourceVersion: 1,
        graph: migrateProjectFacts(value as unknown as ProjectFacts, options),
        ...(tracker ? { analysis: tracker.report() } : {}),
      };
    return {
      kind,
      sourceVersion: 1,
      graph: migrateDoctorReport(value as unknown as DoctorReport, options),
      ...(tracker ? { analysis: tracker.report() } : {}),
    };
  } catch (error) {
    if (error instanceof EvidenceReaderError) throw error;
    if (error instanceof EvidenceBudgetExceededError)
      throwReader(options, kind, version, "budget-exceeded", "/", error.message, error.report);
    throwReader(
      options,
      kind,
      version,
      "integrity-invalid",
      "/",
      error instanceof Error ? error.message : "Evidence graph integrity failed",
    );
  }
}
