import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { runtimeRuleMeta } from "./rules.js";
import { writeFederationReports } from "./reporters.js";
import type {
  DoctorFinding,
  OutputFormat,
  ProjectFacts,
  RuntimeAnalysisResult,
  RuntimeTraceReport,
  Severity,
} from "./types.js";
import { buildUiPayload, reportFromFindings } from "./ui-graph.js";
import { fingerprint, looksLikeUrl, redact, redactRuntimeUrl, sortFindings } from "./utils.js";

const FAILED = new Set(["error", "failed", "timeout"]);
const REMOTE_PHASES = new Set([
  "matchRemote",
  "manifest",
  "remoteEntry",
  "expose",
  "moduleFactory",
  "loadRemote",
  "preload",
]);
const INIT_PHASES = new Set(["remoteEntryInit", "init"]);
const ERROR_CODE = /^RUNTIME-\d+$/i;
const KNOWN_OUTCOMES = new Set([
  "pending",
  "runtime-loaded",
  "shared-resolved",
  "preloaded",
  "component-loaded",
  "failed",
  "recovered",
  "success",
]);
const MAX_EVIDENCE_ITEMS = 24;

export class RuntimeTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeTraceError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function expectNumber(value: unknown, fieldPath: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new RuntimeTraceError(`Invalid runtime trace field ${fieldPath}: expected a number.`);
  return value;
}

function expectRecord(value: unknown, fieldPath: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (!record)
    throw new RuntimeTraceError(`Invalid runtime trace field ${fieldPath}: expected an object.`);
  return record;
}

function expectString(value: unknown, fieldPath: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0)
    throw new RuntimeTraceError(
      `Invalid runtime trace field ${fieldPath}: expected a non-empty string.`,
    );
  return value;
}

function expectBoolean(value: unknown, fieldPath: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new RuntimeTraceError(`Invalid runtime trace field ${fieldPath}: expected a boolean.`);
  return value;
}

function expectArray(value: unknown, fieldPath: string): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value))
    throw new RuntimeTraceError(`Invalid runtime trace field ${fieldPath}: expected an array.`);
  return value;
}

function expectStringArray(value: unknown, fieldPath: string): string[] | undefined {
  const items = expectArray(value, fieldPath);
  if (!items) return undefined;
  if (items.some((item) => typeof item !== "string" || item.length === 0))
    throw new RuntimeTraceError(
      `Invalid runtime trace field ${fieldPath}: expected an array of non-empty strings.`,
    );
  return items as string[];
}

function readStatus(value: unknown, fieldPath: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0)
    throw new RuntimeTraceError(
      `Invalid runtime trace field ${fieldPath}: expected a non-empty string status.`,
    );
  return value;
}

function boundedStrings(value: unknown, limit = 24): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, limit)
    .map((item) => String(redactDeep(item)).slice(0, 500));
}

function boundedRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const bound = (item: unknown, depth: number): unknown => {
    if (typeof item === "string") return String(redactDeep(item)).slice(0, 500);
    if (depth <= 0) return typeof item === "object" && item !== null ? "[TRUNCATED]" : item;
    if (Array.isArray(item)) return item.slice(0, 24).map((entry) => bound(entry, depth - 1));
    const object = asRecord(item);
    if (!object) return item;
    return Object.fromEntries(
      Object.entries(object)
        .filter(([key]) => !/(?:stack|debug|trace)/i.test(key))
        .slice(0, 32)
        .map(([key, entry]) => [key, bound(entry, depth - 1)]),
    );
  };
  return bound(record, 3) as Record<string, unknown>;
}

function phaseFailed(status: unknown): boolean {
  return typeof status === "string" && FAILED.has(status.toLowerCase());
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    const redacted = redact(value) as string;
    if (looksLikeUrl(redacted)) return redactRuntimeUrl(redacted);
    return redacted
      .replace(
        /(?:file:\/\/)?(?:\/Users\/|\/home\/|\/private\/|\/var\/|\/tmp\/|[A-Za-z]:\\)[^\s"']*/g,
        "[REDACTED_PATH]",
      )
      .replace(/(?:^|\s)(?:\/[^\s:]+)+(?::\d+(?::\d+)?)?/g, (match) =>
        match.trimStart().startsWith("/")
          ? match.replace(match.trimStart(), "[REDACTED_PATH]")
          : match,
      );
  }
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
        if (/^(?:errorStack|stack|stackTrace|causeStack)$/i.test(key)) return [];
        return [
          [
            key,
            /token|cookie|authorization|password|secret|api[-_]?key/i.test(key)
              ? "[REDACTED]"
              : redactDeep(item),
          ],
        ];
      }),
    );
  }
  return value;
}

function readPhases(summary: Record<string, unknown> | undefined): RuntimeTraceReport["phases"] {
  const phases = asRecord(summary?.phases);
  if (!phases) return undefined;
  return Object.fromEntries(
    Object.entries(phases).map(([name, value]) => {
      if (!asRecord(value))
        throw new RuntimeTraceError(
          `Invalid runtime trace field /summary/phases/${name}: expected an object.`,
        );
      const status = readStatus(asRecord(value)?.status, `/summary/phases/${name}/status`);
      const normalizedName =
        name === "init" ? "remoteEntryInit" : name === "factory" ? "moduleFactory" : name;
      return [normalizedName, status ? { status } : {}];
    }),
  );
}

function readEvents(raw: unknown): RuntimeTraceReport["events"] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw))
    throw new RuntimeTraceError("Invalid runtime trace field /events: expected an array.");
  const events: RuntimeTraceReport["events"] = [];
  for (const item of raw.slice(0, MAX_EVIDENCE_ITEMS)) {
    const event = asRecord(item);
    if (!event)
      throw new RuntimeTraceError(
        "Invalid runtime trace field /events: every item must be an object.",
      );
    const next: RuntimeTraceReport["events"][number] = {};
    const phase = expectString(event.phase, "/events/phase");
    const status = readStatus(event.status, "/events/status");
    const errorCode = expectString(event.errorCode, "/events/errorCode");
    if (phase)
      next.phase =
        phase === "init" ? "remoteEntryInit" : phase === "factory" ? "moduleFactory" : phase;
    if (status) next.status = status;
    if (errorCode) next.errorCode = errorCode;
    events.push(next);
  }
  return events;
}

function normalizeReport(raw: unknown): RuntimeTraceReport | undefined {
  const record = asRecord(raw);
  if (!record)
    throw new RuntimeTraceError("Invalid runtime trace report: every report must be an object.");
  const summary = expectRecord(record.summary, "/summary");
  const remote = expectRecord(record.remote, "/remote");
  const summaryShared = expectRecord(summary?.shared, "/summary/shared");
  const shared = expectRecord(record.shared, "/shared") ?? summaryShared;
  const moduleInfo = expectRecord(record.moduleInfo, "/moduleInfo");
  const diagnosis = expectRecord(record.diagnosis, "/diagnosis");
  const summaryError = expectRecord(summary?.error, "/summary/error");
  const outcome = expectString(summary?.outcome, "/summary/outcome");
  if (outcome && !KNOWN_OUTCOMES.has(outcome))
    throw new RuntimeTraceError(
      `Unsupported runtime trace outcome at /summary/outcome: ${outcome}`,
    );
  const topLevelError = expectRecord(record.error, "/error");
  const errorCode =
    expectString(record.errorCode, "/errorCode") ??
    expectString(summaryError?.errorCode, "/summary/error/errorCode") ??
    expectString(diagnosis?.errorCode, "/diagnosis/errorCode") ??
    expectString(topLevelError?.code, "/error/code");
  const hasShape =
    asString(record.traceId) !== undefined ||
    summary !== undefined ||
    remote !== undefined ||
    shared !== undefined ||
    Array.isArray(record.events) ||
    errorCode !== undefined;
  if (!hasShape)
    throw new RuntimeTraceError(
      "Unsupported runtime trace report shape: expected an Observability report envelope.",
    );
  if (summary && !asRecord(summary.phases) && summary.phases !== undefined)
    throw new RuntimeTraceError("Invalid runtime trace field /summary/phases: expected an object.");

  const legacy =
    diagnosis?.owner !== undefined ||
    diagnosis?.summary !== undefined ||
    (moduleInfo && (moduleInfo.name !== undefined || moduleInfo.id !== undefined)) ||
    outcome === "success" ||
    (summary?.phases && asRecord(summary.phases)?.init !== undefined);
  const hasCurrentEvidence = Boolean(
    summary &&
    (summary.outcome !== undefined ||
      summary.phases !== undefined ||
      summary.error !== undefined ||
      summary.flags !== undefined ||
      ["loadCompleted", "runtimeLoaded", "sharedResolved", "preloaded", "componentLoaded"].some(
        (key) => summary[key] !== undefined,
      )),
  );
  const report: RuntimeTraceReport = {
    schemaVersion: 1,
    sourceContract: legacy
      ? "legacy-doctor-v1"
      : hasCurrentEvidence
        ? "upstream-observability-2.5.3"
        : "partial",
    events: readEvents(record.events),
  };
  if (Array.isArray(record.events) && record.events.length > MAX_EVIDENCE_ITEMS)
    report.evidenceClipped = true;
  const traceId = expectString(record.traceId, "/traceId");
  const status = readStatus(record.status, "/status");
  if (traceId) report.traceId = traceId;
  if (status) report.status = status;
  for (const key of ["requestId", "requestAlias", "hostName", "runtimeVersion"] as const) {
    const value = expectString(record[key], `/${key}`);
    if (value) report[key] = value;
  }
  if (errorCode) report.errorCode = errorCode;
  if (outcome) report.outcome = outcome;
  const recovered =
    expectBoolean(summary?.recovered, "/summary/recovered") ??
    expectBoolean(asRecord(summary?.flags)?.recovered, "/summary/flags/recovered");
  if (recovered !== undefined) report.recovered = recovered;
  const loadedBefore =
    expectBoolean(record.loadedBefore, "/loadedBefore") ??
    expectBoolean(summary?.loadedBefore, "/summary/loadedBefore");
  if (loadedBefore !== undefined) report.loadedBefore = loadedBefore;
  const flags = expectRecord(summary?.flags, "/summary/flags");
  if (flags)
    report.flags = Object.fromEntries(
      Object.entries(flags).map(([key, value]) => {
        const flag = expectBoolean(value, `/summary/flags/${key}`);
        return [key, flag];
      }),
    ) as Record<string, boolean>;
  for (const key of [
    "loadCompleted",
    "runtimeLoaded",
    "sharedResolved",
    "preloaded",
    "componentLoaded",
  ] as const) {
    const value = expectBoolean(summary?.[key], `/summary/${key}`);
    if (value !== undefined) report[key] = value;
  }
  const lastPhase = expectString(summary?.lastPhase, "/summary/lastPhase");
  if (lastPhase) report.lastPhase = lastPhase;
  for (const key of ["errorName", "errorMessage"] as const) {
    const value =
      expectString(record[key], `/${key}`) ??
      expectString(summaryError?.[key], `/summary/error/${key}`);
    if (value) report[key] = String(redactDeep(value)).slice(0, 1000);
  }
  const errorContext = boundedRecord(
    expectRecord(record.errorContext, "/errorContext") ??
      expectRecord(summaryError?.context, "/summary/error/context"),
  );
  if (errorContext) report.errorContext = errorContext;
  const failedPhase =
    expectString(record.failedPhase, "/failedPhase") ??
    expectString(summaryError?.failedPhase, "/summary/error/failedPhase");
  if (failedPhase)
    report.failedPhase =
      failedPhase === "init"
        ? "remoteEntryInit"
        : failedPhase === "factory"
          ? "moduleFactory"
          : failedPhase;
  const ownerHints = [
    asString(diagnosis?.ownerHint),
    asString(record.ownerHint),
    asString(summaryError?.ownerHint),
    asString(diagnosis?.owner),
  ].filter((value): value is string => Boolean(value));
  const distinctOwnerHints = [...new Set(ownerHints)];
  const onlyOwnerHint = distinctOwnerHints[0];
  if (distinctOwnerHints.length === 1 && onlyOwnerHint) report.ownerHint = onlyOwnerHint;
  if (distinctOwnerHints.length > 1) {
    report.ownerHints = distinctOwnerHints.sort();
    report.ownerHintConflict = true;
  }
  const phases = readPhases(summary);
  if (phases) report.phases = phases;
  if (outcome === "success") {
    const completedRemotePhase = ["remoteEntry", "expose", "loadRemote"].some(
      (phase) => phases?.[phase]?.status === "complete" || phases?.[phase]?.status === "success",
    );
    const completedByEvidence =
      completedRemotePhase ||
      report.loadCompleted === true ||
      report.runtimeLoaded === true ||
      report.componentLoaded === true ||
      report.events.some(
        (event) =>
          ["remoteEntry", "expose", "loadRemote"].includes(event.phase ?? "") &&
          (event.status === "complete" || event.status === "success"),
      );
    report.outcome = completedByEvidence ? "runtime-loaded" : "partial";
  }
  if (remote) {
    const normalizedRemote: NonNullable<RuntimeTraceReport["remote"]> = {};
    const name = expectString(remote.name, "/remote/name");
    const alias = expectString(remote.alias, "/remote/alias");
    const entry = expectString(remote.entry, "/remote/entry");
    if (name) normalizedRemote.name = name;
    if (alias) normalizedRemote.alias = alias;
    if (entry) normalizedRemote.entry = redactRuntimeUrl(entry);
    report.remote = normalizedRemote;
  }
  if (shared) {
    const packageName =
      expectString(shared.package, "/shared/package") ??
      expectString(shared.name, "/shared/name") ??
      expectString(shared.pkg, "/shared/pkg") ??
      expectString(shared.shareKey, "/shared/shareKey");
    const normalizedShared: NonNullable<RuntimeTraceReport["shared"]> = {};
    const provider = expectString(shared.provider, "/shared/provider");
    const requiredVersion = expectString(shared.requiredVersion, "/shared/requiredVersion");
    const selectedVersion = expectString(shared.selectedVersion, "/shared/selectedVersion");
    const reason = expectString(shared.reason, "/shared/reason");
    if (packageName) normalizedShared.package = packageName;
    if (provider) normalizedShared.provider = provider;
    if (requiredVersion) normalizedShared.requiredVersion = requiredVersion;
    if (selectedVersion) normalizedShared.selectedVersion = selectedVersion;
    if (shared.availableVersions !== undefined && !Array.isArray(shared.availableVersions))
      throw new RuntimeTraceError(
        "Invalid runtime trace field /shared/availableVersions: expected an array.",
      );
    if (Array.isArray(shared.availableVersions)) {
      if (shared.availableVersions.some((item) => typeof item !== "string"))
        throw new RuntimeTraceError(
          "Invalid runtime trace field /shared/availableVersions: expected strings.",
        );
      normalizedShared.availableVersions = shared.availableVersions
        .slice(0, MAX_EVIDENCE_ITEMS)
        .filter((item): item is string => typeof item === "string");
      if (shared.availableVersions.length > MAX_EVIDENCE_ITEMS) report.evidenceClipped = true;
    }
    if (reason) normalizedShared.reason = reason;
    report.shared = normalizedShared;
  }
  if (moduleInfo) {
    const normalizedModule: NonNullable<RuntimeTraceReport["moduleInfo"]> = {};
    const name = expectString(moduleInfo.name, "/moduleInfo/name");
    const id = expectString(moduleInfo.id, "/moduleInfo/id");
    const publicPath = expectString(moduleInfo.publicPath, "/moduleInfo/publicPath");
    if (name) normalizedModule.name = name;
    if (id) normalizedModule.id = id;
    if (publicPath) normalizedModule.publicPath = redactRuntimeUrl(publicPath);
    const reason = expectString(moduleInfo.reason, "/moduleInfo/reason");
    const clipped = expectBoolean(moduleInfo.clipped, "/moduleInfo/clipped");
    const totalCount = expectNumber(moduleInfo.totalCount, "/moduleInfo/totalCount");
    const matchedCount = expectNumber(moduleInfo.matchedCount, "/moduleInfo/matchedCount");
    if (reason) normalizedModule.reason = reason;
    if (clipped !== undefined) normalizedModule.clipped = clipped;
    if (totalCount !== undefined) normalizedModule.totalCount = totalCount;
    if (matchedCount !== undefined) normalizedModule.matchedCount = matchedCount;
    const availableNamesInput = expectStringArray(
      moduleInfo.availableNames,
      "/moduleInfo/availableNames",
    );
    const availableNames = boundedStrings(availableNamesInput);
    if (availableNames) normalizedModule.availableNames = availableNames;
    if (availableNamesInput && availableNamesInput.length > MAX_EVIDENCE_ITEMS)
      report.evidenceClipped = true;
    if (moduleInfo.entries !== undefined && !Array.isArray(moduleInfo.entries))
      throw new RuntimeTraceError(
        "Invalid runtime trace field /moduleInfo/entries: expected an array.",
      );
    if (Array.isArray(moduleInfo.entries)) {
      if (moduleInfo.entries.some((item) => !asRecord(item)))
        throw new RuntimeTraceError(
          "Invalid runtime trace field /moduleInfo/entries: every item must be an object.",
        );
      normalizedModule.entries = moduleInfo.entries.slice(0, MAX_EVIDENCE_ITEMS).flatMap((item) => {
        const entry = asRecord(item);
        if (!entry) return [];
        const next: NonNullable<NonNullable<RuntimeTraceReport["moduleInfo"]>["entries"]>[number] =
          {};
        for (const key of ["name", "getPublicPath", "globalName"] as const) {
          const value = expectString(entry[key], `/moduleInfo/entries/${key}`);
          if (value) next[key] = String(redactDeep(value)).slice(0, 500);
        }
        for (const key of ["publicPath", "remoteEntry"] as const) {
          const value = expectString(entry[key], `/moduleInfo/entries/${key}`);
          if (value) next[key] = redactRuntimeUrl(value);
        }
        return [next];
      });
      if (moduleInfo.entries.length > MAX_EVIDENCE_ITEMS) report.evidenceClipped = true;
    }
    report.moduleInfo = normalizedModule;
  }
  if (diagnosis) {
    const normalizedDiagnosis: NonNullable<RuntimeTraceReport["diagnosis"]> = {};
    const owner = expectString(diagnosis.owner, "/diagnosis/owner");
    const diagnosisSummary =
      expectString(diagnosis.summary, "/diagnosis/summary") ??
      expectString(diagnosis.message, "/diagnosis/message");
    const diagnosisOwnerHint = expectString(diagnosis.ownerHint, "/diagnosis/ownerHint");
    const title = expectString(diagnosis.title, "/diagnosis/title");
    if (owner) normalizedDiagnosis.owner = owner;
    if (diagnosisOwnerHint) normalizedDiagnosis.ownerHint = diagnosisOwnerHint;
    if (title) normalizedDiagnosis.title = String(redactDeep(title)).slice(0, 500);
    if (diagnosisSummary)
      normalizedDiagnosis.summary = String(redactDeep(diagnosisSummary)).slice(0, 1000);
    for (const key of [
      "outcome",
      "status",
      "errorCode",
      "failedPhase",
      "errorName",
      "errorMessage",
      "docLink",
    ] as const) {
      const value = expectString(diagnosis[key], `/diagnosis/${key}`);
      if (value) normalizedDiagnosis[key] = String(redactDeep(value)).slice(0, 1000);
    }
    const facts = boundedRecord(expectRecord(diagnosis.facts, "/diagnosis/facts"));
    if (facts) normalizedDiagnosis.facts = facts;
    const actionsInput = expectArray(diagnosis.actions, "/diagnosis/actions");
    const actions = actionsInput
      ? actionsInput.slice(0, MAX_EVIDENCE_ITEMS).flatMap((item, index) => {
          const action = boundedRecord(item);
          if (!action)
            throw new RuntimeTraceError(
              `Invalid runtime trace field /diagnosis/actions/${index}: expected an object.`,
            );
          return [action];
        })
      : undefined;
    if (actions) normalizedDiagnosis.actions = actions;
    const warningsInput = expectStringArray(diagnosis.warnings, "/diagnosis/warnings");
    const completedInput = expectStringArray(
      diagnosis.completedPhases,
      "/diagnosis/completedPhases",
    );
    const pendingInput = expectStringArray(diagnosis.pendingPhases, "/diagnosis/pendingPhases");
    const warnings = boundedStrings(warningsInput);
    const completedPhases = boundedStrings(completedInput);
    const pendingPhases = boundedStrings(pendingInput);
    if (warnings) normalizedDiagnosis.warnings = warnings;
    if (completedPhases) normalizedDiagnosis.completedPhases = completedPhases;
    if (pendingPhases) normalizedDiagnosis.pendingPhases = pendingPhases;
    if (
      [actionsInput, warningsInput, completedInput, pendingInput].some(
        (items) => items && items.length > MAX_EVIDENCE_ITEMS,
      )
    )
      report.evidenceClipped = true;
    report.diagnosis = normalizedDiagnosis;
  }
  return redactDeep(report) as RuntimeTraceReport;
}

function extractRawReports(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const record = asRecord(raw);
  if (!record)
    throw new RuntimeTraceError(
      "Runtime trace JSON must be an object, report array, or supported envelope.",
    );
  if (record.reports !== undefined) {
    if (!Array.isArray(record.reports))
      throw new RuntimeTraceError("Invalid runtime trace field /reports: expected an array.");
    if (record.report !== undefined)
      throw new RuntimeTraceError(
        "Invalid runtime trace envelope: use either report or reports, not both.",
      );
    return record.reports;
  }
  if (record.report !== undefined) return [record.report];
  return [record];
}

function isBuildReportDocument(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(
    record &&
    (record.findings !== undefined ||
      record.projects !== undefined ||
      record.kind === "build-report" ||
      record.documentKind === "build-report" ||
      record.type === "build-report"),
  );
}

function assertSupportedDocumentVersion(value: unknown): void {
  const record = asRecord(value);
  if (!record) return;
  if (record.schemaVersion !== undefined && record.schemaVersion !== 1)
    throw new RuntimeTraceError(
      `Invalid runtime trace schema version at /schemaVersion: expected 1, received ${String(record.schemaVersion)}.`,
    );
  if (
    typeof record.sourceContract === "string" &&
    !["upstream-observability-2.5.3", "legacy-doctor-v1", "partial"].includes(record.sourceContract)
  )
    throw new RuntimeTraceError(
      `Unsupported future runtime trace source contract at /sourceContract: ${record.sourceContract}.`,
    );
}

export function parseRuntimeTraces(raw: unknown): RuntimeTraceReport[] {
  const record = asRecord(raw);
  assertSupportedDocumentVersion(record);
  if (isBuildReportDocument(record))
    throw new RuntimeTraceError(
      "Wrong runtime trace document kind: build-report/Doctor report is not a runtime Observability report.",
    );
  const rawReports = extractRawReports(raw);
  rawReports.forEach(assertSupportedDocumentVersion);
  if (rawReports.some(isBuildReportDocument))
    throw new RuntimeTraceError(
      "Wrong runtime trace document kind: build-report/Doctor report is not a runtime Observability report.",
    );
  const reports = rawReports
    .map(normalizeReport)
    .filter((item): item is RuntimeTraceReport => item !== undefined);
  if (reports.length === 0)
    throw new RuntimeTraceError(
      "Runtime trace JSON must contain at least one Observability-style report.",
    );
  return reports;
}

export async function loadRuntimeTraceFile(filePath: string): Promise<RuntimeTraceReport[]> {
  const resolved = path.resolve(filePath);
  let text: string;
  try {
    text = await fs.readFile(resolved, "utf8");
  } catch {
    throw new RuntimeTraceError(`Unable to read runtime trace: ${resolved}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new RuntimeTraceError(`Runtime trace is not valid JSON: ${resolved}`);
  }
  return parseRuntimeTraces(parsed);
}

function remoteKeys(project: ProjectFacts): string[] {
  const remotes = project.moduleFederation?.remotes ?? {};
  return Object.entries(remotes).flatMap(([alias, remote]) =>
    [alias, remote.name, remote.alias].filter((value): value is string => Boolean(value)),
  );
}

function findProjectsForRemote(projects: ProjectFacts[], remoteName: string): ProjectFacts[] {
  return projects.filter((project) => {
    if (project.moduleFederation?.name === remoteName) return true;
    if (
      project.artifacts.manifest?.name === remoteName ||
      project.artifacts.manifest?.id === remoteName
    )
      return true;
    return remoteKeys(project).includes(remoteName);
  });
}

function failedPhases(trace: RuntimeTraceReport): string[] {
  const fromEvents = trace.events
    .filter((event) => event.phase && phaseFailed(event.status))
    .map((event) => event.phase!);
  const fromSummary = Object.entries(trace.phases ?? {})
    .filter(([, value]) => phaseFailed(value.status))
    .map(([phase]) => phase);
  return [
    ...new Set([...fromEvents, ...fromSummary, ...(trace.failedPhase ? [trace.failedPhase] : [])]),
  ];
}

function exactProject(
  projects: ProjectFacts[],
  name: string | undefined,
): ProjectFacts | undefined {
  if (!name) return undefined;
  return projects.find(
    (project) =>
      project.moduleFederation?.name === name ||
      project.artifacts.manifest?.name === name ||
      project.artifacts.manifest?.id === name,
  );
}

function runtimeFinding(
  ruleId: (typeof runtimeRuleMeta)[number]["id"],
  severity: Severity,
  project: string,
  message: string,
  evidence: Record<string, unknown>,
  suggestion?: string,
): DoctorFinding {
  const base = {
    schemaVersion: 1 as const,
    ruleId,
    severity,
    project,
    message,
    evidence: redact(evidence) as Record<string, unknown>,
    documentation: `/rules/${ruleId}`,
    ...(suggestion ? { suggestion } : {}),
  };
  return { ...base, fingerprint: fingerprint(base) };
}

function sharedVersionMismatch(
  selected: string | undefined,
  required: string | undefined,
  installed: string | undefined,
): boolean {
  if (selected && required && semver.valid(selected) && semver.validRange(required))
    return !semver.satisfies(selected, required);
  if (selected && installed && semver.valid(selected) && semver.valid(installed))
    return semver.neq(selected, installed);
  return false;
}

export function correlateRuntime(
  traces: RuntimeTraceReport[],
  projects: ProjectFacts[],
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];

  for (const trace of traces) {
    const remoteName = trace.remote?.name ?? trace.remote?.alias;
    const matches = remoteName ? findProjectsForRemote(projects, remoteName) : [];
    const hostProject = exactProject(projects, trace.hostName);
    const producerProject = exactProject(projects, trace.remote?.name);
    const ownerHintConflict = trace.ownerHintConflict === true;
    const owner = ownerHintConflict
      ? undefined
      : (trace.diagnosis?.ownerHint ?? trace.ownerHint ?? trace.diagnosis?.owner);
    const exactProducer = Boolean(trace.remote?.name && producerProject);
    const exactHost = Boolean(trace.hostName && hostProject);
    const ambiguousIdentity =
      ownerHintConflict ||
      (!owner &&
        exactHost &&
        exactProducer &&
        hostProject!.project.name !== producerProject!.project.name);
    const supportedOwner =
      owner === "host" ||
      owner === "remote" ||
      owner === "runtime" ||
      owner === "shared" ||
      owner === "network" ||
      owner === "unknown";
    const ownerProject =
      owner === "host" ? hostProject : owner === "remote" ? producerProject : undefined;
    const ownerEvidenceProject = ownerProject;
    const projectName =
      !supportedOwner ||
      ownerHintConflict ||
      owner === "runtime" ||
      owner === "network" ||
      owner === "shared" ||
      owner === "unknown"
        ? "runtime"
        : ownerEvidenceProject
          ? ownerEvidenceProject.project.name
          : ambiguousIdentity
            ? "runtime"
            : producerProject
              ? producerProject.project.name
              : !remoteName && hostProject
                ? hostProject.project.name
                : "runtime";
    const identityEvidence = {
      ...(trace.hostName ? { hostName: trace.hostName } : {}),
      ...(trace.remote?.name ? { producer: trace.remote.name } : {}),
      ...(owner ? { ownerHint: owner } : {}),
      ...(ambiguousIdentity ||
      !supportedOwner ||
      ownerHintConflict ||
      owner === "shared" ||
      owner === "network" ||
      owner === "unknown"
        ? {
            matchReason: ownerHintConflict
              ? "conflicting owner hints; neutral runtime attribution"
              : !supportedOwner
                ? "unsupported owner hint; neutral runtime attribution"
                : owner === "network"
                  ? "network failure; requesting host is context"
                  : owner === "shared"
                    ? "shared resolver/provider evidence"
                    : "ambiguous host/producer identity",
            ...(ownerHintConflict && trace.ownerHints ? { ownerHints: trace.ownerHints } : {}),
            candidates: [
              ...new Set(
                [
                  hostProject?.project.name,
                  producerProject?.project.name,
                  ...matches.map((project) => project.project.name),
                  trace.shared?.provider,
                ].filter((value): value is string => Boolean(value)),
              ),
            ].sort(),
          }
        : {}),
    };
    const matchedManifest = matches
      .map((project) => project.artifacts.manifest)
      .find((manifest) => manifest && (manifest.valid || manifest.name || manifest.id));
    const phases = failedPhases(trace);

    if (remoteName && matches.length === 0) {
      findings.push(
        runtimeFinding(
          "runtime/remote-unknown",
          "warning",
          projectName,
          `Runtime trace remote "${remoteName}" is not present in loaded project facts.`,
          {
            remote: remoteName,
            ...(trace.traceId ? { traceId: trace.traceId } : {}),
            ...(trace.remote?.entry ? { entry: trace.remote.entry } : {}),
            identity: identityEvidence,
          },
          "Re-run mfdoctor check/federation for every host and remote, or fix the remote name in the trace source.",
        ),
      );
    }

    const recovered = trace.outcome === "recovered" || trace.recovered === true;
    const remoteFailurePhases = phases.filter((phase) => REMOTE_PHASES.has(phase));
    if (!recovered && remoteFailurePhases.length > 0)
      for (const phase of remoteFailurePhases) {
        const phaseMessage =
          phase === "moduleFactory"
            ? "Runtime remote module factory failed during moduleFactory."
            : phase === "preload"
              ? "Runtime remote preload failed during preload."
              : `Runtime remote load failed during ${phase}.`;
        findings.push(
          runtimeFinding(
            "runtime/remote-load-failed",
            "error",
            projectName,
            phaseMessage,
            {
              ...(remoteName ? { remote: remoteName } : {}),
              phases: [phase],
              phaseKind: phase === "moduleFactory" || phase === "preload" ? phase : "remote-load",
              ...(trace.traceId ? { traceId: trace.traceId } : {}),
              ...(trace.errorCode ? { errorCode: trace.errorCode } : {}),
              ...(trace.remote?.entry ? { entry: trace.remote.entry } : {}),
              identity: identityEvidence,
              projects: matches.map((project) => project.project.name).sort(),
            },
            "Compare the redacted entry URL and manifest metadata with the producer build output.",
          ),
        );
      }

    if (!recovered && phases.some((phase) => INIT_PHASES.has(phase))) {
      const host =
        owner === "host"
          ? (hostProject ?? (matches.length === 1 ? matches[0] : undefined))
          : hostProject;
      const hosts = host ? [host] : [];
      findings.push(
        runtimeFinding(
          "runtime/init-failed",
          "error",
          projectName,
          "Runtime container initialization failed.",
          {
            ...(remoteName ? { remote: remoteName } : {}),
            ...(trace.traceId ? { traceId: trace.traceId } : {}),
            ...(trace.errorCode ? { errorCode: trace.errorCode } : {}),
            identity: identityEvidence,
            asyncStartup: Boolean(host?.moduleFederation?.experiments?.asyncStartup),
            externalRuntime: Boolean(host?.moduleFederation?.experiments?.externalRuntime),
            provideExternalRuntime: Boolean(
              host?.moduleFederation?.experiments?.provideExternalRuntime,
            ),
            projects: hosts.map((project) => project.project.name).sort(),
          },
          "Verify async startup, external runtime provider order, and runtime plugins against Doctor project facts.",
        ),
      );
    }

    const sharedName = trace.shared?.package;
    if (sharedName) {
      const sharedEntries = projects
        .map((project) => ({
          project: project.project.name,
          shared: project.moduleFederation?.shared[sharedName],
          installed: project.dependencies.installed[sharedName],
        }))
        .filter((entry) => entry.shared);
      const required =
        trace.shared?.requiredVersion ??
        sharedEntries
          .map((entry) => entry.shared?.requiredVersion)
          .find((value): value is string => typeof value === "string");
      const installed = sharedEntries
        .map((entry) => entry.installed)
        .find((value): value is string => typeof value === "string");
      const consumersWithoutFallback = sharedEntries.filter(
        (entry) => entry.shared?.import === false,
      );
      const providers = sharedEntries.filter((entry) => entry.shared?.import !== false);
      const sharedPhaseFailed = phases.includes("shared");
      const sharedReasonEvidence = Boolean(
        trace.shared?.reason && /unmatched|mismatch|missing|fail|error/i.test(trace.shared.reason),
      );
      const sharedErrorEvidence =
        trace.failedPhase === "shared" ||
        (trace.errorMessage !== undefined &&
          /shared|share scope|version/i.test(trace.errorMessage));
      const sharedFailed =
        !recovered && (sharedPhaseFailed || sharedReasonEvidence || sharedErrorEvidence);
      const versionMismatch = sharedVersionMismatch(
        trace.shared?.selectedVersion,
        typeof required === "string" ? required : undefined,
        installed,
      );
      const providerFallbackMismatch =
        consumersWithoutFallback.length > 0 && providers.length === 0;
      if (!recovered && (sharedFailed || versionMismatch || providerFallbackMismatch)) {
        const providerCandidates = trace.shared?.provider
          ? projects.filter(
              (project) =>
                project.moduleFederation?.name === trace.shared?.provider ||
                project.artifacts.manifest?.name === trace.shared?.provider ||
                project.artifacts.manifest?.id === trace.shared?.provider,
            )
          : [];
        const sharedCandidates = [
          ...sharedEntries.map((entry) => entry.project),
          ...providerCandidates.map((project) => project.project.name),
        ].sort();
        const sharedIdentity = {
          ...(trace.shared?.provider ? { provider: trace.shared.provider } : {}),
          matchReason: providerFallbackMismatch
            ? "consumer import=false has no configured provider"
            : versionMismatch
              ? "selected version does not satisfy required or installed version"
              : sharedPhaseFailed
                ? "shared phase failed"
                : "shared error/reason evidence",
          candidates: [...new Set(sharedCandidates)],
        };
        const sharedProject =
          providerCandidates.length === 1 && !ownerHintConflict
            ? providerCandidates[0]!.project.name
            : "runtime";
        findings.push(
          runtimeFinding(
            "runtime/shared-mismatch",
            "error",
            sharedProject,
            `Runtime shared resolution for "${sharedName}" does not match project evidence.`,
            {
              package: sharedName,
              ...(trace.shared?.selectedVersion
                ? { selectedVersion: trace.shared.selectedVersion }
                : {}),
              ...(typeof required === "string" ? { requiredVersion: required } : {}),
              ...(installed ? { installedVersion: installed } : {}),
              ...(trace.shared?.provider ? { provider: trace.shared.provider } : {}),
              ...(trace.shared?.reason ? { reason: trace.shared.reason } : {}),
              ...(trace.traceId ? { traceId: trace.traceId } : {}),
              consumersWithoutFallback: consumersWithoutFallback
                .map((entry) => entry.project)
                .sort(),
              providers: providers.map((entry) => entry.project).sort(),
              identity: { ...identityEvidence, ...sharedIdentity },
            },
            "Align shared versions, singleton/import settings, and providers across hosts and remotes.",
          ),
        );
      }
    }

    if (trace.errorCode && ERROR_CODE.test(trace.errorCode)) {
      findings.push(
        runtimeFinding(
          "runtime/error-correlated",
          !recovered &&
            (phases.length > 0 || trace.status === "error" || trace.outcome === "failed")
            ? "error"
            : "warning",
          projectName,
          `Runtime error ${trace.errorCode} correlated with Doctor project evidence.`,
          {
            errorCode: trace.errorCode,
            ...(trace.traceId ? { traceId: trace.traceId } : {}),
            ...(remoteName ? { remote: remoteName } : {}),
            ...(trace.outcome ? { outcome: trace.outcome } : {}),
            phases: phases.sort(),
            projects: matches.map((project) => project.project.name).sort(),
            ...(matchedManifest
              ? {
                  manifest: {
                    ...(matchedManifest.id ? { id: matchedManifest.id } : {}),
                    ...(matchedManifest.name ? { name: matchedManifest.name } : {}),
                    ...(matchedManifest.publicPath
                      ? {
                          publicPath: looksLikeUrl(matchedManifest.publicPath)
                            ? redactRuntimeUrl(matchedManifest.publicPath)
                            : matchedManifest.publicPath,
                        }
                      : {}),
                  },
                }
              : {}),
            ...(owner ? { owner } : {}),
            ...(trace.diagnosis?.title
              ? { diagnosis: trace.diagnosis.title }
              : trace.diagnosis?.summary
                ? { diagnosis: trace.diagnosis.summary }
                : {}),
          },
          "Use the stable RUNTIME code with the matched build facts; do not infer browser behavior from static analysis alone.",
        ),
      );
    }
  }

  return sortFindings(findings);
}

export async function analyzeRuntime(options: {
  tracePath: string;
  projectFiles: string[];
  outputDirectory?: string;
  formats?: OutputFormat[];
  quiet?: boolean;
  printLog?: { success?: boolean };
}): Promise<RuntimeAnalysisResult> {
  const traces = await loadRuntimeTraceFile(options.tracePath);
  const projects = (
    await Promise.all(
      [...options.projectFiles]
        .sort()
        .map(
          async (file) => JSON.parse(await fs.readFile(path.resolve(file), "utf8")) as ProjectFacts,
        ),
    )
  ).sort((a, b) => a.project.name.localeCompare(b.project.name));
  if (projects.length === 0)
    throw new RuntimeTraceError("No project.json files matched for runtime correlation.");

  const findings = correlateRuntime(traces, projects);
  const report = reportFromFindings(projects, findings);
  const ui = buildUiPayload(projects, report);
  const formats = options.formats ?? [];
  if (options.outputDirectory && formats.length > 0)
    await writeFederationReports(projects, report, options.outputDirectory, formats, {
      ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
      ...(options.printLog !== undefined ? { printLog: options.printLog } : {}),
    });

  return {
    traces,
    projects,
    findings,
    report,
    ui,
    summary: {
      schemaVersion: 1,
      traces: traces.length,
      projects: projects.length,
      findings: findings.length,
    },
    exitCode: findings.some((item) => item.severity === "error") ? 1 : 0,
  };
}
