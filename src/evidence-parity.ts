import { createHash } from "node:crypto";
import path from "node:path";

export type DriftClass =
  | "bug"
  | "nondeterminism"
  | "missing-compatibility"
  | "approved-fix"
  | "v2-only-addition"
  | "expected-unknown";

export type ParityValue = null | boolean | number | string | ParityValue[] | ParityObject;

export interface ParityObject {
  [key: string]: ParityValue;
}

export interface ParityDiff {
  path: string;
  kind: "added" | "removed" | "changed";
  legacy?: ParityValue;
  projected?: ParityValue;
}

export interface ParityComparison {
  equal: boolean;
  legacyDigest: string;
  projectedDigest: string;
  diffs: readonly ParityDiff[];
  truncated: boolean;
}

export interface ParityLimits {
  maxDepth?: number;
  maxNodes?: number;
  maxBytes?: number;
  maxDiffs?: number;
}

const DEFAULT_LIMITS: Required<ParityLimits> = {
  maxDepth: 32,
  maxNodes: 5_000,
  maxBytes: 64 * 1024,
  maxDiffs: 100,
};

const SECRET_KEY = /token|cookie|authorization|password|secret|api[-_]?key/i;
const PRIVATE_KEY = /^(?:props|source|factory|factories|body|headers|stack)$/i;
const CREDENTIAL_URL = /([a-z][a-z0-9+.-]{0,32}:\/\/)([^/\s:@]{1,256}):([^/\s@]{1,256})@/gi;
const SECRET_QUERY = /([?&](?:token|authorization|password|secret|api[-_]?key)=)[^&#\s]{0,2048}/gi;
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const DRIFT_CLASSES = new Set<DriftClass>([
  "bug",
  "nondeterminism",
  "missing-compatibility",
  "approved-fix",
  "v2-only-addition",
  "expected-unknown",
]);

export class ParityResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParityResourceError";
  }
}

function limitsWithDefaults(options?: ParityLimits): Required<ParityLimits> {
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
      throw new ParityResourceError(`${name} must be a positive safe integer.`);
    }
  }
  return limits;
}

function redactString(value: string): string {
  if (WINDOWS_PATH.test(value) || path.isAbsolute(value)) return "[PATH]";
  return value.replace(CREDENTIAL_URL, "$1[REDACTED]@").replace(SECRET_QUERY, "$1[REDACTED]");
}

function pointerPart(value: string | number): string {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function canonicalJson(value: ParityValue): string {
  return JSON.stringify(value);
}

function sanitize(value: unknown, limits: Required<ParityLimits>): ParityValue {
  const active = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;

  const visit = (current: unknown, depth: number, key = ""): ParityValue => {
    nodes += 1;
    if (nodes > limits.maxNodes)
      throw new ParityResourceError(`value exceeds maxNodes (${limits.maxNodes})`);
    if (depth > limits.maxDepth)
      throw new ParityResourceError(`value exceeds maxDepth (${limits.maxDepth})`);
    if (SECRET_KEY.test(key) || PRIVATE_KEY.test(key)) return "[REDACTED]";
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") return Number.isFinite(current) ? current : "[UNSAFE]";
    if (typeof current === "string") {
      const redacted = redactString(current);
      bytes += Buffer.byteLength(redacted);
      if (bytes > limits.maxBytes)
        throw new ParityResourceError(`value exceeds maxBytes (${limits.maxBytes})`);
      return redacted;
    }
    if (typeof current !== "object") return "[UNSAFE]";
    if (active.has(current)) return "[CYCLE]";
    active.add(current);
    try {
      if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));
      const output = Object.create(null) as ParityObject;
      let keys: string[];
      try {
        keys = Object.keys(current).sort();
      } catch {
        return "[UNSAFE]";
      }
      for (const childKey of keys) {
        let child: unknown;
        try {
          child = (current as Record<string, unknown>)[childKey];
        } catch {
          output[childKey] = "[UNSAFE]";
          continue;
        }
        output[childKey] = visit(child, depth + 1, childKey);
      }
      return output;
    } finally {
      active.delete(current);
    }
  };

  return visit(value, 0);
}

function digest(value: ParityValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function compareV1Outputs(
  legacy: unknown,
  projected: unknown,
  options?: ParityLimits,
): ParityComparison {
  const limits = limitsWithDefaults(options);
  const left = sanitize(legacy, limits);
  const right = sanitize(projected, limits);
  const diffs: ParityDiff[] = [];
  let truncated = false;

  const add = (diff: ParityDiff): void => {
    if (diffs.length >= limits.maxDiffs) {
      truncated = true;
      return;
    }
    diffs.push(diff);
  };
  const walk = (a: ParityValue | undefined, b: ParityValue | undefined, pointer: string): void => {
    if (diffs.length >= limits.maxDiffs) {
      truncated = true;
      return;
    }
    if (a === undefined)
      return add({ path: pointer, kind: "added", ...(b === undefined ? {} : { projected: b }) });
    if (b === undefined)
      return add({ path: pointer, kind: "removed", ...(a === undefined ? {} : { legacy: a }) });
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b))
        return add({ path: pointer, kind: "changed", legacy: a, projected: b });
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index += 1)
        walk(a[index], b[index], `${pointer}/${index}`);
      return;
    }
    if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) walk(a[key], b[key], `${pointer}/${pointerPart(key)}`);
      return;
    }
    if (a !== b) add({ path: pointer, kind: "changed", legacy: a, projected: b });
  };

  walk(left, right, "");
  return {
    equal: diffs.length === 0 && !truncated,
    legacyDigest: digest(left),
    projectedDigest: digest(right),
    diffs: Object.freeze(diffs),
    truncated,
  };
}

export interface DriftLedgerEntry {
  id: string;
  class: DriftClass;
  owner: string;
  linkedIssue: string;
  fixture: string;
  summary: string;
  affectedContracts: string[];
  releaseNoteStatus: "not-required" | "pending" | "complete";
  expires?: string;
}

export function assertDriftLedgerEntry(value: unknown): asserts value is DriftLedgerEntry {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("drift ledger entry must be an object");
  const entry = value as Partial<DriftLedgerEntry>;
  if (
    !entry.id ||
    !entry.class ||
    !entry.owner ||
    !entry.linkedIssue ||
    !entry.fixture ||
    !entry.summary
  ) {
    throw new TypeError("drift ledger entry is missing required metadata");
  }
  if (!DRIFT_CLASSES.has(entry.class)) {
    throw new TypeError(`drift ledger entry ${entry.id} has invalid class`);
  }
  if (!Array.isArray(entry.affectedContracts) || entry.affectedContracts.length === 0) {
    throw new TypeError(`drift ledger entry ${entry.id} needs affectedContracts`);
  }
  if (
    !entry.releaseNoteStatus ||
    !["not-required", "pending", "complete"].includes(entry.releaseNoteStatus)
  ) {
    throw new TypeError(`drift ledger entry ${entry.id} has invalid releaseNoteStatus`);
  }
}
