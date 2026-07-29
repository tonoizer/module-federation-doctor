import { createHash } from "node:crypto";

/** Values that can be safely persisted in an evidence document. */
export type EvidenceValue =
  | null
  | boolean
  | number
  | string
  | EvidenceValue[]
  | { [key: string]: EvidenceValue };

export type EvidenceProtocolVersion = 2;
export type EvidenceLayer = "declared" | "effective" | "artifact" | "deployment" | "runtime";
export type EvidenceConfidence = "exact" | "high" | "medium" | "low" | "unknown";
export type EvidenceCompleteness = "complete" | "partial" | "unknown" | "not-collected";
export type EvidenceSubjectKind =
  | "project"
  | "dependency"
  | "remote"
  | "expose"
  | "shared-package"
  | "build"
  | "artifact"
  | "deployment"
  | "runtime-instance";
export type EvidenceEdgeKind = "derived-from" | "conflicts-with" | "supersedes" | "identity";
export type RuleOutcome = "pass" | "fail" | "unknown" | "not-applicable";

export interface EvidenceProtocolIdentity {
  protocolVersion: EvidenceProtocolVersion;
  schemaVersion: EvidenceProtocolVersion;
  producer: { name: string; version: string };
  source: { kind: string; schemaVersion: string };
}

export interface EvidenceScope {
  adapter: string;
  bundler: { name: string; version?: string };
  target: "web" | "node" | "browser" | "ssr" | "unknown";
}

export interface EvidenceIdentity {
  project?: string;
  workspace?: string;
  buildId?: string;
  artifactDigest?: string;
  deploymentId?: string;
  releaseId?: string;
  runtimeInstanceId?: string;
  sessionId?: string;
  traceId?: string;
}

export interface EvidenceProvenance {
  collector: { name: string; version: string };
  inputKind: string;
  source: string;
  sourceSchemaVersion: string;
  location?: string;
  contentDigest?: string;
  /** Set-like IDs. Order is ignored during graph normalization. */
  parentEvidenceIds?: string[];
}

export interface EvidenceCompletenessInfo {
  status: EvidenceCompleteness;
  expectedCount?: number;
  observedCount?: number;
  /** Set-like names. Order is ignored during graph normalization. */
  missing?: string[];
  reason: string;
}

export interface EvidenceConfidenceInfo {
  level: EvidenceConfidence;
  reason: string;
}

export interface EvidenceSubject {
  id: string;
  kind: EvidenceSubjectKind;
  name: string;
  attributes?: Record<string, EvidenceValue>;
}

export interface EvidenceAssertion {
  id: string;
  subject: string;
  predicate: string;
  value: EvidenceValue;
  layer: EvidenceLayer;
  scope: EvidenceScope;
  identity?: EvidenceIdentity;
  provenance: EvidenceProvenance;
  confidence: EvidenceConfidenceInfo;
  completeness: EvidenceCompletenessInfo;
}

export interface EvidenceEdge {
  id: string;
  kind: EvidenceEdgeKind;
  from: string;
  to: string;
}

export interface EvidenceRuleEvaluation {
  id: string;
  rule: { id: string; version: string };
  subject: string;
  outcome: RuleOutcome;
  /** Set-like assertion IDs. Order is ignored during graph normalization. */
  evidenceIds: string[];
  reason: string;
  completeness: EvidenceCompletenessInfo;
}

export interface EvidenceGraphV2 {
  protocol: EvidenceProtocolIdentity;
  scope: EvidenceScope;
  identity: EvidenceIdentity;
  /** Set-like records, sorted by ID and then full record. */
  subjects: EvidenceSubject[];
  /** Set-like records, sorted by ID and then full record. */
  assertions: EvidenceAssertion[];
  /** Set-like records, sorted by ID and then full record. */
  edges: EvidenceEdge[];
  /** Set-like records, sorted by ID and then full record. */
  evaluations: EvidenceRuleEvaluation[];
}

export interface EvidenceLimits {
  maxDepth?: number;
  maxNodes?: number;
  maxBytes?: number;
  maxWidth?: number;
}

const DEFAULT_LIMITS: Required<EvidenceLimits> = {
  maxDepth: 64,
  maxNodes: 10_000,
  maxBytes: 1_048_576,
  maxWidth: 1_000,
};

const HARD_LIMITS: Required<EvidenceLimits> = {
  maxDepth: 128,
  maxNodes: 50_000,
  maxBytes: 8 * 1_048_576,
  maxWidth: 10_000,
};

export class EvidenceResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceResourceError";
  }
}

export class EvidenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceIntegrityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limitsWithDefaults(options?: EvidenceLimits): Required<EvidenceLimits> {
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > HARD_LIMITS[name as keyof EvidenceLimits]
    ) {
      throw new EvidenceResourceError(`${name} must be a positive safe integer.`);
    }
  }
  return limits;
}

/** Validate JSON-safe values without recursive traversal or unbounded work. */
export function assertEvidenceValue(
  value: unknown,
  options?: EvidenceLimits,
): asserts value is EvidenceValue {
  const limits = limitsWithDefaults(options);
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;

  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new EvidenceResourceError(`Evidence value exceeds maxNodes (${limits.maxNodes}).`);
    }
    if (item.depth > limits.maxDepth) {
      throw new EvidenceResourceError(`Evidence value exceeds maxDepth (${limits.maxDepth}).`);
    }

    const current = item.value;
    if (current === null || typeof current === "boolean") {
      bytes += Buffer.byteLength(JSON.stringify(current));
    } else if (typeof current === "number") {
      if (!Number.isFinite(current))
        throw new EvidenceResourceError("Evidence numbers must be finite.");
      bytes += Buffer.byteLength(JSON.stringify(current));
    } else if (typeof current === "string") {
      bytes += Buffer.byteLength(JSON.stringify(current));
    } else if (Array.isArray(current)) {
      if (seen.has(current)) throw new EvidenceResourceError("Evidence value contains a cycle.");
      seen.add(current);
      if (current.length > limits.maxWidth) {
        throw new EvidenceResourceError(`Evidence array exceeds maxWidth (${limits.maxWidth}).`);
      }
      bytes += 2 + Math.max(0, current.length - 1);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current[index], depth: item.depth + 1 });
      }
    } else if (isRecord(current)) {
      if (seen.has(current)) throw new EvidenceResourceError("Evidence value contains a cycle.");
      seen.add(current);
      const entries: Array<[string, unknown]> = [];
      for (const key in current) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        entries.push([key, current[key]]);
        if (entries.length > limits.maxWidth) {
          throw new EvidenceResourceError(`Evidence object exceeds maxWidth (${limits.maxWidth}).`);
        }
      }
      bytes += 2 + Math.max(0, entries.length - 1);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index] ?? ["", undefined];
        bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
        pending.push({ value: child, depth: item.depth + 1 });
      }
    } else {
      throw new EvidenceResourceError("Evidence value contains a non-JSON value.");
    }
    if (bytes > limits.maxBytes) {
      throw new EvidenceResourceError(`Evidence value exceeds maxBytes (${limits.maxBytes}).`);
    }
  }
}

function isSensitiveKey(key: string): boolean {
  return /(?:token|secret|password|passwd|credential|private[-_ ]?key|api[-_]?key|authorization|cookie|session[-_]?id|pem|certificate|cert)/i.test(
    key,
  );
}

const SCHEMA_DEFINED_KEYS = new Set([
  "protocolVersion",
  "schemaVersion",
  "producer",
  "source",
  "kind",
  "collector",
  "version",
  "adapter",
  "bundler",
  "name",
  "target",
  "project",
  "workspace",
  "buildId",
  "artifactDigest",
  "deploymentId",
  "releaseId",
  "runtimeInstanceId",
  "sessionId",
  "traceId",
  "subjects",
  "assertions",
  "edges",
  "evaluations",
  "id",
  "subject",
  "predicate",
  "value",
  "layer",
  "scope",
  "identity",
  "provenance",
  "confidence",
  "completeness",
  "inputKind",
  "sourceSchemaVersion",
  "location",
  "contentDigest",
  "parentEvidenceIds",
  "status",
  "expectedCount",
  "observedCount",
  "missing",
  "reason",
  "level",
  "attributes",
  "rule",
  "outcome",
  "evidenceIds",
  "from",
  "to",
]);

function isSchemaDefinedKey(key: string): boolean {
  return SCHEMA_DEFINED_KEYS.has(key);
}

function redactSecretAssignment(value: string): string {
  return value
    .replace(
      /(?:authorization|proxy-authorization)\s*=\s*(?:basic|bearer)\s+[^\s,;]+/gi,
      (_match) => _match.replace(/(=\s*(?:basic|bearer)\s+).*/i, "$1[REDACTED]"),
    )
    .replace(
      /(?:token|secret|password|passwd|api[-_]?key|credential|authorization|cookie|session[-_]?id)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match, _captured: string | undefined) => {
        const equals = _match.search(/=/);
        return `${_match.slice(0, equals + 1)}[REDACTED]`;
      },
    )
    .replace(/(?:bearer|basic)\s+[^\s,;]+/gi, (_match) => `${_match.split(/\s+/)[0]} [REDACTED]`);
}

function redactUrl(value: string): string | undefined {
  const urlPattern = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi;
  if (!urlPattern.test(value)) return undefined;
  return value.replace(urlPattern, (candidate) => {
    try {
      const url = new URL(candidate);
      if (url.username || url.password) {
        url.username = "[REDACTED]";
        url.password = "[REDACTED]";
      }
      for (const key of url.searchParams.keys()) {
        if (isSensitiveKey(key)) url.searchParams.set(key, "[REDACTED]");
      }
      return url.toString();
    } catch {
      return "[URI]";
    }
  });
}

function redactString(value: string): string {
  const withUris = redactUrl(value);
  if (withUris !== undefined) value = withUris;
  return redactSecretAssignment(value)
    .replace(/file:\/\/[^\s"'<>]+/gi, "[PATH]")
    .replace(
      /(?:[A-Za-z]:[\\/](?!\/)|\\\\[^\\/]+[\\/])[^\s"'<>;,)\]}]*|(^|[\s"'=([{])\/(?!\/)[^\s"'<>;,)\]}]*/g,
      (_match, boundary: string | undefined) => `${boundary ?? ""}[PATH]`,
    );
}

/** Sanitize secret keys/values and machine paths while preserving safe URLs. */
export function redactEvidenceValue(value: EvidenceValue, options?: EvidenceLimits): EvidenceValue {
  assertEvidenceValue(value, options);
  const pending: Array<{
    input: EvidenceValue;
    output: EvidenceValue[] | Record<string, EvidenceValue>;
    key?: string;
  }> = [];
  const root: EvidenceValue[] = [];
  pending.push({ input: value, output: root });

  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    const input = item.input;
    let output: EvidenceValue;
    if (typeof input === "string") {
      output = redactString(input);
    } else if (Array.isArray(input)) {
      const array: EvidenceValue[] = [];
      output = array;
      for (let index = input.length - 1; index >= 0; index -= 1) {
        pending.push({ input: input[index] ?? null, output: array });
      }
    } else if (isRecord(input)) {
      const record: Record<string, EvidenceValue> = Object.create(null) as Record<
        string,
        EvidenceValue
      >;
      output = record;
      const groups = new Map<string, Array<[string, EvidenceValue]>>();
      for (const [key, child] of Object.entries(input)) {
        const safeKey = isSchemaDefinedKey(key)
          ? key
          : isSensitiveKey(key)
            ? "[REDACTED_KEY]"
            : redactString(key);
        const group = groups.get(safeKey) ?? [];
        group.push([key, isSensitiveKey(key) ? "[REDACTED]" : (child as EvidenceValue)]);
        groups.set(safeKey, group);
      }
      for (const [safeKey, group] of [...groups.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        const values = group
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([, child]) => child);
        if (values.length === 1) {
          pending.push({ input: values[0] ?? null, output: record, key: safeKey });
        } else {
          const grouped: EvidenceValue[] = [];
          record[safeKey] = grouped;
          for (let index = values.length - 1; index >= 0; index -= 1) {
            pending.push({ input: values[index] ?? null, output: grouped });
          }
        }
      }
    } else {
      output = input;
    }
    if (Array.isArray(item.output)) item.output.push(output);
    else if (item.key !== undefined) item.output[item.key] = output;
  }
  const redacted = (root[0] ?? null) as EvidenceValue;
  assertEvidenceValue(redacted, options);
  return redacted;
}

function canonicalizeValue(value: EvidenceValue): EvidenceValue {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeValue(value[key] ?? null)]),
  );
}

/** Return a JSON-safe value with object keys sorted recursively. */
export function canonicalizeEvidenceValue(
  value: EvidenceValue,
  options?: EvidenceLimits,
): EvidenceValue {
  assertEvidenceValue(value, options);
  return canonicalizeValue(value);
}

function stableJson(value: EvidenceValue, options?: EvidenceLimits): string {
  const redacted = redactEvidenceValue(value, options);
  const canonical = canonicalizeEvidenceIdValue(redacted);
  return JSON.stringify(canonical);
}

const VOLATILE_KEY = /^(?:timestamp|time|createdAt|updatedAt|sessionId|traceId)$/i;

function canonicalizeEvidenceIdValue(value: EvidenceValue): EvidenceValue {
  if (Array.isArray(value)) return value.map((item) => canonicalizeEvidenceIdValue(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !VOLATILE_KEY.test(key))
      .sort()
      .map((key) => [key, canonicalizeEvidenceIdValue(value[key] ?? null)]),
  );
}

/** Create a deterministic `<prefix>:<sha256 first 16 hex chars>` ID. */
export function stableEvidenceId(
  prefix: string,
  value: EvidenceValue,
  options?: EvidenceLimits,
): string {
  if (!prefix || !/^[A-Za-z0-9._-]+$/.test(prefix))
    throw new EvidenceIntegrityError("Evidence ID prefix is invalid.");
  const digest = createHash("sha256").update(stableJson(value, options)).digest("hex").slice(0, 16);
  return `${prefix}:${digest}`;
}

function recordJson(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalizeValue(value as EvidenceValue));
}

function compareRecords<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id) || recordJson(left).localeCompare(recordJson(right));
}

function assertUniqueIds(
  records: Array<{ id: string }>,
  kind: string,
  ids: Map<string, string>,
): void {
  for (const record of records) {
    if (!record.id || typeof record.id !== "string")
      throw new EvidenceIntegrityError(`${kind} ID must be a non-empty string.`);
    if (redactString(record.id) !== record.id) {
      throw new EvidenceIntegrityError(`${kind} ID ${record.id} contains secret or path data.`);
    }
    const previous = ids.get(record.id);
    if (previous)
      throw new EvidenceIntegrityError(
        `Duplicate evidence ID ${record.id} in ${previous} and ${kind}.`,
      );
    ids.set(record.id, kind);
  }
}

function assertSafeReference(reference: string, label: string): void {
  if (typeof reference !== "string" || !reference || redactString(reference) !== reference) {
    throw new EvidenceIntegrityError(`${label} contains secret or path data.`);
  }
}

/** Validate graph IDs and every subject/evidence/edge reference before persistence. */
export function assertEvidenceGraphIntegrity(
  graph: EvidenceGraphV2,
  options?: EvidenceLimits,
): void {
  assertEvidenceValue(graph as unknown as EvidenceValue, options);
  if (
    !Array.isArray(graph.subjects) ||
    !Array.isArray(graph.assertions) ||
    !Array.isArray(graph.edges) ||
    !Array.isArray(graph.evaluations)
  ) {
    throw new EvidenceIntegrityError("Evidence graph collections must be arrays.");
  }
  const ids = new Map<string, string>();
  assertUniqueIds(graph.subjects, "subjects", ids);
  assertUniqueIds(graph.assertions, "assertions", ids);
  assertUniqueIds(graph.edges, "edges", ids);
  assertUniqueIds(graph.evaluations, "evaluations", ids);
  const subjects = new Set(graph.subjects.map((subject) => subject.id));
  const assertions = new Set(graph.assertions.map((assertion) => assertion.id));
  const all = new Set(ids.keys());
  for (const assertion of graph.assertions) {
    assertSafeReference(assertion.subject, `Assertion ${assertion.id} subject`);
    if (!subjects.has(assertion.subject))
      throw new EvidenceIntegrityError(
        `Assertion ${assertion.id} references missing subject ${assertion.subject}.`,
      );
    for (const parent of assertion.provenance.parentEvidenceIds ?? []) {
      assertSafeReference(parent, `Assertion ${assertion.id} parent evidence`);
      if (!all.has(parent))
        throw new EvidenceIntegrityError(
          `Assertion ${assertion.id} references missing parent evidence ${parent}.`,
        );
    }
  }
  for (const edge of graph.edges) {
    assertSafeReference(edge.from, `Edge ${edge.id} source`);
    assertSafeReference(edge.to, `Edge ${edge.id} target`);
    if (!all.has(edge.from) || !all.has(edge.to))
      throw new EvidenceIntegrityError(`Edge ${edge.id} references missing evidence.`);
  }
  for (const evaluation of graph.evaluations) {
    assertSafeReference(evaluation.subject, `Evaluation ${evaluation.id} subject`);
    if (!subjects.has(evaluation.subject))
      throw new EvidenceIntegrityError(
        `Evaluation ${evaluation.id} references missing subject ${evaluation.subject}.`,
      );
    for (const evidenceId of evaluation.evidenceIds) {
      assertSafeReference(evidenceId, `Evaluation ${evaluation.id} evidence`);
      if (!assertions.has(evidenceId))
        throw new EvidenceIntegrityError(
          `Evaluation ${evaluation.id} references missing assertion ${evidenceId}.`,
        );
    }
  }
}

/** Normalize a graph without depending on input order. Set-like arrays are sorted; value arrays stay ordered. */
export function normalizeEvidenceGraph(
  graph: EvidenceGraphV2,
  options?: EvidenceLimits,
): EvidenceGraphV2 {
  assertEvidenceGraphIntegrity(graph, options);
  const redacted = redactEvidenceValue(
    graph as unknown as EvidenceValue,
    options,
  ) as unknown as EvidenceGraphV2;
  assertEvidenceGraphIntegrity(redacted, options);
  const canonical = canonicalizeEvidenceValue(
    redacted as unknown as EvidenceValue,
    options,
  ) as unknown as EvidenceGraphV2;
  const sortSet = <T extends { id: string }>(records: T[]): T[] =>
    records.slice().sort(compareRecords);
  return {
    ...canonical,
    subjects: sortSet(canonical.subjects),
    assertions: sortSet(canonical.assertions).map((assertion) => {
      const normalized = Object.assign({}, assertion);
      if (assertion.provenance.parentEvidenceIds) {
        normalized.provenance = Object.assign({}, assertion.provenance, {
          parentEvidenceIds: assertion.provenance.parentEvidenceIds.slice().sort(),
        });
      }
      if (assertion.completeness.missing) {
        normalized.completeness = Object.assign({}, assertion.completeness, {
          missing: assertion.completeness.missing.slice().sort(),
        });
      }
      return normalized;
    }),
    edges: sortSet(canonical.edges),
    evaluations: sortSet(canonical.evaluations).map((evaluation) => {
      const normalized = Object.assign({}, evaluation, {
        evidenceIds: evaluation.evidenceIds.slice().sort(),
      });
      if (evaluation.completeness.missing) {
        normalized.completeness = Object.assign({}, evaluation.completeness, {
          missing: evaluation.completeness.missing.slice().sort(),
        });
      }
      return normalized;
    }),
  };
}
