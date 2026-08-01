import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import evidenceSchema from "../schemas/evidence.schema.json";
import projectSchema from "../schemas/project.schema.json";
import reportSchema from "../schemas/report.schema.json";
import {
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
  if (isRecord(value.protocol) && value.protocol.protocolVersion !== undefined)
    return value.protocol.protocolVersion as number | string;
  return typeof value.schemaVersion === "number" || typeof value.schemaVersion === "string"
    ? value.schemaVersion
    : undefined;
}

function documentKindOf(value: JsonRecord): EvidenceDocumentKind | "unknown" {
  if ("protocol" in value || "subjects" in value || "assertions" in value) return "evidence-graph";
  if ("findings" in value || "summary" in value) return "doctor-report";
  if ("project" in value || "bundler" in value || "dependencies" in value) return "project-facts";
  return "unknown";
}

function pointer(error: ErrorObject | undefined): string {
  return error?.instancePath || "/";
}

function jsonValue(
  value: unknown,
  path: string,
  options: EvidenceReaderOptions,
  seen = new WeakSet<object>(),
): EvidenceValue {
  if (value === undefined || typeof value === "function" || typeof value === "symbol")
    throwReader(options, "unknown", undefined, "malformed-json", path, "Value is not JSON-safe.");
  if (typeof value === "number" && !Number.isFinite(value))
    throwReader(options, "unknown", undefined, "malformed-json", path, "Number must be finite.");
  if (Array.isArray(value) || isRecord(value)) {
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
  if (Array.isArray(value))
    return value.map((item, index) =>
      jsonValue(item, `${path === "/" ? "" : path}/${index}`, options, seen),
    );
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonValue(item, `${path === "/" ? "" : path}/${key}`, options, seen),
      ]),
    );
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
  if (
    (typeof version === "number" && version > (kind === "evidence-graph" ? 2 : 1)) ||
    (isRecord(value.protocol) && value.protocol.protocolVersion !== 2 && kind === "evidence-graph")
  )
    throwReader(
      options,
      kind,
      version,
      "unsupported-version",
      "/schemaVersion",
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

function assertion(
  subject: EvidenceSubject,
  predicate: string,
  value: EvidenceValue,
  scope: EvidenceGraphV2["scope"],
  source: string,
  complete: EvidenceCompletenessInfo,
): EvidenceAssertion {
  const id = stableEvidenceId("assertion", { subject: subject.id, predicate, value });
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
        completeness("complete", "Field is present in the v1 document."),
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
  return normalizeEvidenceGraph(graph);
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
  for (const [findingIndex, finding] of input.findings.entries()) {
    let subject = subjects.get(finding.project);
    if (!subject) {
      subject = {
        id: stableEvidenceId("subject.project", { name: finding.project }),
        kind: "project",
        name: finding.project,
      };
      subjects.set(finding.project, subject);
      graph.subjects.push(subject);
    }
    const findingValue = jsonValue(finding, `/findings/${findingIndex}`, options);
    const evidence = assertion(
      subject,
      "doctor.finding",
      findingValue,
      scope,
      "v1-doctor-report",
      completeness("complete", "Finding is present in the v1 report."),
    );
    graph.assertions.push(evidence);
    graph.evaluations.push({
      id: stableEvidenceId("evaluation", {
        project: finding.project,
        ruleId: finding.ruleId,
        fingerprint: finding.fingerprint,
      }),
      rule: { id: finding.ruleId, version: "1" },
      subject: subject.id,
      outcome: "fail",
      evidenceIds: [evidence.id],
      reason: finding.message,
      completeness: completeness(
        "complete",
        "Evaluation is copied from a schema-valid v1 finding.",
      ),
    });
  }
  return normalizeEvidenceGraph(graph);
}

export function readEvidenceDocument(
  input: unknown,
  options: EvidenceReaderOptions = {},
): EvidenceDocumentReadResult {
  let value: EvidenceValue;
  try {
    value = jsonValue(input, "/", options);
  } catch (error) {
    if (error instanceof EvidenceReaderError) throw error;
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
  if (kind === "unknown")
    throwReader(options, kind, version, "wrong-document-kind", "/", "Unknown document kind");
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
