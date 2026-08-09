import { createHash } from "node:crypto";
import path from "node:path";
import type { DoctorFinding, SourceLocation } from "./types.js";

const SECRET_KEY = /token|cookie|authorization|password|secret|api[-_]?key/i;
/** Bounded quantifiers keep credential scrubbing linear on untrusted strings. */
const CREDENTIAL_URL = /([a-z][a-z0-9+.-]{0,32}:\/\/)([^/\s:@]{1,256}):([^/\s@]{1,256})@/gi;
const SECRET_QUERY = /([?&](?:token|authorization|password|secret|api[-_]?key)=)[^&#\s]{0,2048}/gi;

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function relativePath(root: string, value: string): string {
  const result = normalizePath(path.relative(root, value));
  return result.startsWith("../") ? "[external]/" + path.basename(value) : result || ".";
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(stableValue(value), null, space);
}

export function redact(value: unknown, root?: string, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    let result = value
      .replace(CREDENTIAL_URL, "$1[REDACTED]@")
      .replace(SECRET_QUERY, "$1[REDACTED]");
    if (root) result = result.replaceAll(root, ".");
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, root));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [
        childKey,
        redact(item, root, childKey),
      ]),
    );
  }
  return value;
}

/** Strip credentials/query/fragment and collapse private path to origin + basename. */
export function redactRuntimeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const parts = url.pathname.split("/").filter(Boolean);
    const basename = parts.at(-1);
    url.pathname = basename ? (parts.length > 1 ? `/.../${basename}` : `/${basename}`) : "/";
    return url.href;
  } catch {
    // Prefer URL parsing above; fall back without the credential regex on junk input.
    return value.replace(SECRET_QUERY, "$1[REDACTED]");
  }
}

export function looksLikeUrl(value: string): boolean {
  if (value.length > 4096) return false;
  return /^[a-z][a-z0-9+.-]{0,32}:\/\//i.test(value);
}

export function fingerprint(input: {
  ruleId: string;
  project: string;
  federationInstanceId?: string;
  location?: SourceLocation;
  evidence: Record<string, unknown>;
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        ruleId: input.ruleId,
        project: input.project,
        ...(input.federationInstanceId ? { federationInstanceId: input.federationInstanceId } : {}),
        location: input.location,
        evidence: input.evidence,
      }),
    )
    .digest("hex");
}

export function sortFindings(findings: DoctorFinding[]): DoctorFinding[] {
  const rank = { error: 0, warning: 1, info: 2 };
  return [...new Map(findings.map((item) => [item.fingerprint, item])).values()].sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      rank[a.severity] - rank[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      (a.location?.path ?? "").localeCompare(b.location?.path ?? "") ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
