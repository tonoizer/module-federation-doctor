import fs from "node:fs/promises";
import path from "node:path";
import type { BaselineEntry, BaselineFile, BaselineOptions, DoctorFinding } from "./types.js";
import { fingerprint, stableStringify } from "./utils.js";

export type { BaselineEntry, BaselineFile, BaselineOptions };

export interface ResolvedBaselineOptions {
  path: string;
  failOnSuppressed: boolean;
  reportStale: boolean;
}

export interface ApplyBaselineResult {
  findings: DoctorFinding[];
  matched: number;
  stale: BaselineEntry[];
}

const BASELINE_SCHEMA_VERSION = 1 as const;

export function resolveBaselineOptions(
  baseline: string | BaselineOptions | undefined,
  root: string,
): ResolvedBaselineOptions | undefined {
  if (baseline === undefined) return undefined;
  if (typeof baseline === "string") {
    return {
      path: path.resolve(root, baseline),
      failOnSuppressed: false,
      reportStale: true,
    };
  }
  return {
    path: path.resolve(root, baseline.path),
    failOnSuppressed: baseline.failOnSuppressed ?? false,
    reportStale: baseline.reportStale ?? true,
  };
}

export function parseBaseline(raw: unknown): BaselineFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Baseline file must be a JSON object.");
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== BASELINE_SCHEMA_VERSION)
    throw new Error(`Unsupported baseline schemaVersion: ${String(value.schemaVersion)}`);
  if (!Array.isArray(value.entries)) throw new Error('Baseline file requires an "entries" array.');
  const entries: BaselineEntry[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`Baseline entries[${index}] must be an object.`);
    const entry = item as Record<string, unknown>;
    if (typeof entry.fingerprint !== "string" || entry.fingerprint.length === 0)
      throw new Error(`Baseline entries[${index}].fingerprint must be a non-empty string.`);
    if (entry.ruleId !== undefined && typeof entry.ruleId !== "string")
      throw new Error(`Baseline entries[${index}].ruleId must be a string when present.`);
    if (entry.project !== undefined && typeof entry.project !== "string")
      throw new Error(`Baseline entries[${index}].project must be a string when present.`);
    if (entry.reason !== undefined && typeof entry.reason !== "string")
      throw new Error(`Baseline entries[${index}].reason must be a string when present.`);
    const normalized: BaselineEntry = { fingerprint: entry.fingerprint };
    if (typeof entry.ruleId === "string") normalized.ruleId = entry.ruleId;
    if (typeof entry.project === "string") normalized.project = entry.project;
    if (typeof entry.reason === "string") normalized.reason = entry.reason;
    const key = entryKey(normalized);
    if (seen.has(key))
      throw new Error(`Duplicate baseline entry for fingerprint "${normalized.fingerprint}".`);
    seen.add(key);
    entries.push(normalized);
  }
  return { schemaVersion: BASELINE_SCHEMA_VERSION, entries };
}

/** Load a baseline from disk. JSON and JSON-compatible YAML content are accepted. */
export async function loadBaseline(filePath: string): Promise<BaselineFile> {
  const text = await fs.readFile(filePath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Failed to parse baseline file ${filePath} as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  return parseBaseline(raw);
}

export function entryMatchesFinding(entry: BaselineEntry, finding: DoctorFinding): boolean {
  if (entry.fingerprint !== finding.fingerprint) return false;
  if (entry.ruleId !== undefined && entry.ruleId !== finding.ruleId) return false;
  if (entry.project !== undefined && entry.project !== finding.project) return false;
  return true;
}

function entryKey(entry: BaselineEntry): string {
  return `${entry.fingerprint}\0${entry.ruleId ?? ""}\0${entry.project ?? ""}`;
}

function staleFinding(entry: BaselineEntry): DoctorFinding {
  const base = {
    schemaVersion: 1 as const,
    ruleId: "doctor/stale-baseline",
    severity: "info" as const,
    message: `Baseline fingerprint "${entry.fingerprint}" no longer matches any finding.`,
    project: entry.project ?? "baseline",
    evidence: {
      fingerprint: entry.fingerprint,
      ...(entry.ruleId ? { ruleId: entry.ruleId } : {}),
      ...(entry.project ? { project: entry.project } : {}),
    },
    suggestion:
      "Remove this entry from the baseline file — the finding is gone and the debt is paid.",
    documentation: "/baselines",
  };
  return { ...base, fingerprint: fingerprint(base) };
}

/**
 * Mark findings that match the baseline as suppressed. Optionally append
 * `doctor/stale-baseline` info findings for unused baseline entries.
 */
export function applyBaseline(
  findings: DoctorFinding[],
  baseline: BaselineFile,
  options: { reportStale?: boolean } = {},
): ApplyBaselineResult {
  const reportStale = options.reportStale ?? true;
  const unused = new Set(baseline.entries.map(entryKey));
  let matched = 0;

  const marked = findings.map((finding) => {
    const entry = baseline.entries.find((item) => entryMatchesFinding(item, finding));
    if (!entry) return finding;
    matched += 1;
    unused.delete(entryKey(entry));
    return {
      ...finding,
      suppressed: true as const,
      ...(entry.reason ? { suppressionReason: entry.reason } : {}),
    };
  });

  const stale = baseline.entries.filter((entry) => unused.has(entryKey(entry)));
  const withStale =
    reportStale && stale.length > 0 ? [...marked, ...stale.map(staleFinding)] : marked;

  return { findings: withStale, matched, stale };
}

export function generateBaseline(findings: DoctorFinding[]): BaselineFile {
  const entries: BaselineEntry[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    if (finding.ruleId === "doctor/stale-baseline") continue;
    if (seen.has(finding.fingerprint)) continue;
    seen.add(finding.fingerprint);
    entries.push({
      fingerprint: finding.fingerprint,
      ruleId: finding.ruleId,
      project: finding.project,
    });
  }
  entries.sort(
    (a, b) =>
      (a.project ?? "").localeCompare(b.project ?? "") ||
      (a.ruleId ?? "").localeCompare(b.ruleId ?? "") ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
  return { schemaVersion: BASELINE_SCHEMA_VERSION, entries };
}

/**
 * Merge current findings into an existing baseline. Adds new fingerprints;
 * does not remove stale entries (use prune or edit manually after debt is paid).
 */
export function updateBaseline(existing: BaselineFile, findings: DoctorFinding[]): BaselineFile {
  const byKey = new Map(existing.entries.map((entry) => [entryKey(entry), entry]));
  for (const finding of findings) {
    if (finding.ruleId === "doctor/stale-baseline") continue;
    const entry: BaselineEntry = {
      fingerprint: finding.fingerprint,
      ruleId: finding.ruleId,
      project: finding.project,
    };
    const key = entryKey(entry);
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  const entries = [...byKey.values()].sort(
    (a, b) =>
      (a.project ?? "").localeCompare(b.project ?? "") ||
      (a.ruleId ?? "").localeCompare(b.ruleId ?? "") ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
  return { schemaVersion: BASELINE_SCHEMA_VERSION, entries };
}

/** Drop baseline entries that no longer match any finding in the report. */
export function pruneBaseline(existing: BaselineFile, findings: DoctorFinding[]): BaselineFile {
  const entries = existing.entries.filter((entry) =>
    findings.some((finding) => entryMatchesFinding(entry, finding)),
  );
  return { schemaVersion: BASELINE_SCHEMA_VERSION, entries };
}

export function policyRelevantFindings(
  findings: DoctorFinding[],
  failOnSuppressed: boolean,
): DoctorFinding[] {
  if (failOnSuppressed) return findings;
  return findings.filter((finding) => !finding.suppressed);
}

export function policyFails(
  findings: DoctorFinding[],
  failOn: "never" | "warning" | "error",
  failOnSuppressed = false,
): boolean {
  if (failOn === "never") return false;
  const relevant = policyRelevantFindings(findings, failOnSuppressed);
  if (failOn === "warning") return relevant.some((item) => item.severity !== "info");
  return relevant.some((item) => item.severity === "error");
}

export function summarizeFindings(findings: DoctorFinding[]): {
  info: number;
  warnings: number;
  errors: number;
  suppressed: number;
} {
  return {
    info: findings.filter((item) => item.severity === "info").length,
    warnings: findings.filter((item) => item.severity === "warning").length,
    errors: findings.filter((item) => item.severity === "error").length,
    suppressed: findings.filter((item) => item.suppressed).length,
  };
}

export async function writeBaselineFile(filePath: string, baseline: BaselineFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stableStringify(baseline, 2) + "\n");
}
