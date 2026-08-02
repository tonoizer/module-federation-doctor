import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import evidenceSchema from "../schemas/evidence.schema.json";
import projectSchema from "../schemas/project.schema.json";
import reportSchema from "../schemas/report.schema.json";
import {
  canonicalizeEvidenceValue,
  normalizeEvidenceGraph,
  stableEvidenceId,
  type EvidenceAssertion,
  type EvidenceCompletenessInfo,
  type EvidenceGraphV2,
  type EvidenceSubject,
  type EvidenceValue,
} from "./evidence.js";
import type { DoctorReport, ProjectFacts } from "./types.js";

export type EvidenceDocumentKind = "project-facts" | "doctor-report" | "evidence-graph";
export type EvidenceReaderFailureCode =
  | "malformed-json"
  | "wrong-document-kind"
  | "schema-invalid"
  | "unsupported-version"
  | "integrity-invalid";

export interface EvidenceReaderOptions {
  fileLabel?: string;
}

export interface EvidenceReaderErrorDetails {
  fileLabel?: string;
  detectedDocumentKind: EvidenceDocumentKind | "unknown";
  sourceVersion?: number | string;
  failureCode: EvidenceReaderFailureCode;
  pointer: string;
}

export class EvidenceReaderError extends Error {
  readonly details: EvidenceReaderErrorDetails;
  readonly fileLabel: string | undefined;
  readonly detectedDocumentKind: EvidenceDocumentKind | "unknown";
  readonly sourceVersion: number | string | undefined;
  readonly failureCode: EvidenceReaderFailureCode;
  readonly pointer: string;

  constructor(details: EvidenceReaderErrorDetails, message: string) {
    super(message);
    this.name = "EvidenceReaderError";
    this.details = details;
    this.fileLabel = details.fileLabel;
    this.detectedDocumentKind = details.detectedDocumentKind;
    this.sourceVersion = details.sourceVersion;
    this.failureCode = details.failureCode;
    this.pointer = details.pointer;
  }
}

export interface EvidenceDocumentReadResult {
  kind: EvidenceDocumentKind;
  sourceVersion: 1 | 2;
  graph: EvidenceGraphV2;
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
  // Doctor reports always include findings; bare `summary` also appears on Observability exports.
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
): EvidenceValue {
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
      jsonValue(item, `${path === "/" ? "" : path}/${index}`, options, seen),
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
): never {
  const label = options.fileLabel ? `${options.fileLabel}: ` : "";
  throw new EvidenceReaderError(
    {
      ...(options.fileLabel ? { fileLabel: options.fileLabel } : {}),
      detectedDocumentKind: kind,
      ...(version !== undefined ? { sourceVersion: version } : {}),
      failureCode: code,
      pointer: path,
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
      producer: { name: "@module-federation/doctor", version: "1" },
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

function nonEmpty(value: string, fallback: string): string {
  return value || fallback;
}

function finalizeGraph(graph: EvidenceGraphV2, options: EvidenceReaderOptions): EvidenceGraphV2 {
  const normalized = normalizeEvidenceGraph(graph);
  validateOrThrow(normalized as unknown as JsonRecord, "evidence-graph", options);
  return normalized;
}

function assertion(
  subject: EvidenceSubject,
  predicate: string,
  value: EvidenceValue,
  scope: EvidenceGraphV2["scope"],
  source: string,
  complete: EvidenceCompletenessInfo,
  idSuffix?: string | number,
): EvidenceAssertion {
  const id = stableEvidenceId("assertion", {
    subject: subject.id,
    predicate,
    value,
    ...(idSuffix !== undefined ? { idSuffix: String(idSuffix) } : {}),
  });
  return {
    id,
    subject: subject.id,
    predicate,
    value,
    layer: predicate === "project.moduleFederation" ? "declared" : "effective",
    scope: { ...scope, bundler: { ...scope.bundler } },
    provenance: {
      collector: { name: "@module-federation/doctor", version: "1" },
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
  const value = jsonValue(input, "/", options) as JsonRecord;
  validateOrThrow(value, "project-facts", options);
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
    id: stableEvidenceId("subject.project", { name: project, root: input.project.root }),
    kind: "project",
    name: project,
  };
  const graph = baseGraph(scope, { project }, "v1-project-facts");
  graph.subjects.push(subject);
  const fields = [
    "project",
    "bundler",
    "capabilities",
    "moduleFederation",
    "dependencies",
    "imports",
    "artifacts",
  ] as const;
  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(input, field);
    if (!present) continue;
    graph.assertions.push(
      assertion(
        subject,
        `project.${field}`,
        jsonValue(input[field], `/` + field, options),
        scope,
        "v1-project-facts",
        fieldCompleteness(value, field, present),
      ),
    );
  }
  const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(input, field));
  if (missing.length > 0)
    graph.assertions.push(
      assertion(
        subject,
        "project.completeness",
        { missing: missing.slice() },
        scope,
        "v1-project-facts",
        completeness("partial", "Optional v1 fields were omitted.", missing),
      ),
    );
  return finalizeGraph(graph, options);
}

export function migrateDoctorReport(
  input: DoctorReport,
  options: EvidenceReaderOptions = {},
): EvidenceGraphV2 {
  const value = jsonValue(input, "/", options) as JsonRecord;
  validateOrThrow(value, "doctor-report", options);
  const scope = { adapter: "legacy-v1", bundler: { name: "unknown" }, target: "unknown" as const };
  const graph = baseGraph(scope, {}, "v1-doctor-report");
  const subjects = new Map<string, EvidenceSubject>();
  const subjectFor = (project: string): EvidenceSubject => {
    let subject = subjects.get(project);
    if (!subject) {
      subject = {
        id: stableEvidenceId("subject.project", { name: project }),
        kind: "project",
        name: nonEmpty(project, "[legacy-v1-report]"),
      };
      subjects.set(project, subject);
      graph.subjects.push(subject);
    }
    return subject;
  };
  const findingEntries = input.findings.map((finding, findingIndex) => {
    const findingValue = jsonValue(finding, `/findings/${findingIndex}`, options);
    return {
      finding,
      findingIndex,
      value: findingValue,
      key: stableEvidenceId("finding", findingValue),
      occurrence: 0,
    };
  });
  const occurrenceByKey = new Map<string, number>();
  const canonicalFindings = findingEntries
    .slice()
    .sort(
      (left, right) =>
        left.key.localeCompare(right.key) ||
        JSON.stringify(canonicalizeEvidenceValue(left.value)).localeCompare(
          JSON.stringify(canonicalizeEvidenceValue(right.value)),
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
    );
    graph.assertions.push(evidence);
    graph.evaluations.push({
      id: stableEvidenceId("evaluation", {
        project: finding.project,
        ruleId: finding.ruleId,
        fingerprint: finding.fingerprint,
        findingKey,
        occurrence,
      }),
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
        jsonValue(input.capabilities, "/capabilities", options),
        scope,
        "v1-doctor-report",
        completeness("complete", "Report capabilities are copied from the schema-valid v1 report."),
        "capabilities",
      ),
      assertion(
        metadataSubject,
        "doctor.summary",
        jsonValue(input.summary, "/summary", options),
        scope,
        "v1-doctor-report",
        completeness("complete", "Report summary is copied from the schema-valid v1 report."),
        "summary",
      ),
    );
  }
  return finalizeGraph(graph, options);
}

export function readEvidenceDocument(
  input: unknown,
  options: EvidenceReaderOptions = {},
): EvidenceDocumentReadResult {
  const detectedKind = isRecord(input) ? documentKindOf(input) : "unknown";
  const detectedVersion = isRecord(input) ? sourceVersionOf(input) : undefined;
  let value: EvidenceValue;
  try {
    value = jsonValue(input, "/", options);
  } catch (error) {
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
        graph: normalizeEvidenceGraph(value as unknown as EvidenceGraphV2),
      };
    if (kind === "project-facts")
      return {
        kind,
        sourceVersion: 1,
        graph: migrateProjectFacts(value as unknown as ProjectFacts, options),
      };
    return {
      kind,
      sourceVersion: 1,
      graph: migrateDoctorReport(value as unknown as DoctorReport, options),
    };
  } catch (error) {
    if (error instanceof EvidenceReaderError) throw error;
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
