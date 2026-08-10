import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import {
  HARD_RUNTIME_CAPTURE_LIMITS,
  RuntimeCaptureValidationError,
  validateRuntimeCaptureEnvelope,
  type RuntimeCaptureEnvelope,
  type RuntimeCaptureObservabilityRecord,
} from "./capture.js";
import {
  stableEvidenceId,
  type EvidenceCompletenessInfo,
  type EvidenceGraphV2,
  type EvidenceSubject,
  type EvidenceValue,
} from "./evidence.js";
import { runtimeRuleMeta } from "./rules.js";
import { projectFactsFromEvidence, readEvidenceFile } from "./evidence-reader.js";
import { writeFederationReports } from "./reporters.js";
import type {
  DoctorFinding,
  EvidenceAnalysisMetadata,
  OutputFormat,
  ProjectFacts,
  RuntimeAnalysisResult,
  RuntimeTraceReport,
  Severity,
} from "./types.js";
import { buildUiPayload, reportFromFindings } from "./ui-graph.js";
import { fingerprint, looksLikeUrl, redact, redactRuntimeUrl, sortFindings } from "./utils.js";
import { mapBounded } from "./async-map.js";
import type { EvidenceRolloutController } from "./evidence-rollout.js";
import { createEvidenceRolloutController } from "./evidence-rollout.js";
import { compareV1Outputs } from "./evidence-parity.js";

const FAILED = new Set(["error", "failed", "timeout"]);
const REMOTE_PHASES = new Set([
  "matchRemote",
  "manifest",
  "remoteEntry",
  "expose",
  "factory",
  "moduleFactory",
  "loadRemote",
  "preload",
]);
const INIT_PHASES = new Set(["remoteEntryInit", "init"]);
const CURRENT_PHASES = new Set([
  "matchRemote",
  "remoteEntryInit",
  "moduleFactory",
  "loadRemote",
  "preload",
]);
const CURRENT_OUTCOMES = new Set([
  "pending",
  "runtime-loaded",
  "shared-resolved",
  "preloaded",
  "component-loaded",
  "failed",
  "recovered",
]);
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

type RuntimeTraceFailureCode =
  | "malformed-json"
  | "not-found"
  | "permission-denied"
  | "read-failed"
  | "oversized-input"
  | "wrong-document-kind"
  | "unsupported-version"
  | "invalid-field"
  | "unsupported-shape";

interface RuntimeTraceErrorDetails {
  fileLabel?: string;
  failureCode: RuntimeTraceFailureCode;
  pointer: string;
}

export class RuntimeTraceError extends Error {
  readonly details: RuntimeTraceErrorDetails;
  readonly fileLabel: string | undefined;
  readonly failureCode: RuntimeTraceFailureCode;
  readonly pointer: string;

  constructor(message: string, details?: Partial<RuntimeTraceErrorDetails>) {
    super(message);
    this.name = "RuntimeTraceError";
    const pointer =
      details?.pointer ?? message.match(/\/(?:[A-Za-z0-9_~-]+(?:\/[A-Za-z0-9_~-]+)*)?/)?.[0] ?? "/";
    const failureCode =
      details?.failureCode ??
      (message.includes("Wrong runtime trace document kind")
        ? "wrong-document-kind"
        : message.includes("schema version") || message.includes("source contract")
          ? "unsupported-version"
          : message.includes("shape") || message.includes("must be an object")
            ? "unsupported-shape"
            : "invalid-field");
    this.details = {
      ...(details?.fileLabel ? { fileLabel: details.fileLabel } : {}),
      failureCode,
      pointer,
    };
    this.fileLabel = details?.fileLabel;
    this.failureCode = failureCode;
    this.pointer = pointer;
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

function isRuntimeCaptureEnvelope(value: unknown): value is RuntimeCaptureEnvelope {
  const record = asRecord(value);
  return Boolean(
    record &&
    record.contractVersion !== undefined &&
    record.captureId !== undefined &&
    Array.isArray(record.reports),
  );
}

function captureOutcome(outcome: string | undefined): string | undefined {
  if (outcome === undefined) return undefined;
  if (outcome === "remote-loaded") return "runtime-loaded";
  return outcome;
}

function captureRecordToRawReport(
  record: RuntimeCaptureObservabilityRecord,
): Record<string, unknown> {
  const value = record.value;
  const identity = record.identity;
  const outcome = captureOutcome(value.outcome);
  const phase = value.phase;
  const raw: Record<string, unknown> = {
    ...((value.traceId ?? identity.traceId) ? { traceId: value.traceId ?? identity.traceId } : {}),
    ...((value.requestId ?? identity.requestId)
      ? { requestId: value.requestId ?? identity.requestId }
      : {}),
    ...(value.requestAlias ? { requestAlias: value.requestAlias } : {}),
    ...((value.hostName ?? identity.hostName)
      ? { hostName: value.hostName ?? identity.hostName }
      : {}),
    ...((value.runtimeVersion ?? identity.runtimeVersion)
      ? { runtimeVersion: value.runtimeVersion ?? identity.runtimeVersion }
      : {}),
    ...(value.errorCode ? { errorCode: value.errorCode } : {}),
    ...(identity.remoteName || identity.remoteAlias
      ? {
          remote: {
            ...(identity.remoteName ? { name: identity.remoteName } : {}),
            ...(identity.remoteAlias ? { alias: identity.remoteAlias } : {}),
          },
        }
      : {}),
    ...(identity.sharedPackage ? { shared: { package: identity.sharedPackage } } : {}),
    ...(value.loadedBefore !== undefined ? { loadedBefore: value.loadedBefore } : {}),
    ...(outcome || phase
      ? {
          summary: {
            ...(outcome ? { outcome } : {}),
            ...(phase
              ? {
                  phases: {
                    [phase]: { status: outcome === "failed" ? "failed" : "complete" },
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(value.ownerHint || value.diagnosisTitle
      ? {
          diagnosis: {
            ...(value.ownerHint ? { ownerHint: value.ownerHint } : {}),
            ...(value.diagnosisTitle ? { title: value.diagnosisTitle } : {}),
          },
        }
      : {}),
    ...(value.moduleInfoNames ? { moduleInfo: { availableNames: value.moduleInfoNames } } : {}),
  };
  return raw;
}

function parseRuntimeCapture(raw: RuntimeCaptureEnvelope): RuntimeTraceReport[] {
  try {
    validateRuntimeCaptureEnvelope(raw);
  } catch (error) {
    if (error instanceof RuntimeCaptureValidationError) {
      const futureVersion = /unsupported capture contract version/.test(error.message);
      throw new RuntimeTraceError(`Invalid runtime capture: ${error.message}`, {
        failureCode: futureVersion ? "unsupported-version" : "invalid-field",
        pointer: futureVersion ? "/contractVersion" : "/",
      });
    }
    throw error;
  }
  if (raw.reports.length === 0)
    throw new RuntimeTraceError("Runtime capture contains no Observability reports at /reports.", {
      failureCode: "unsupported-shape",
      pointer: "/reports",
    });
  const truncated = raw.truncation.some((item) => item.dropped > 0);
  return raw.reports
    .map(captureRecordToRawReport)
    .map(normalizeReport)
    .filter((report): report is RuntimeTraceReport => report !== undefined)
    .map((report, index) => {
      const record = raw.reports[index]!;
      if (truncated || record.completeness.status !== "complete") report.evidenceClipped = true;
      Object.defineProperty(report, "capture", {
        configurable: false,
        enumerable: false,
        value: {
          captureId: record.identity.captureId,
          navigationId: record.identity.navigationId,
          realmId: record.identity.realmId,
          sequence: record.identity.sequence,
          source: record.source,
          capturedAt: record.capturedAt,
          provenance: record.provenance,
          completeness: record.completeness,
          truncation: raw.truncation,
          relations: raw.relations.filter(
            (relation) => relation.from === record.id || relation.to === record.id,
          ),
        },
        writable: false,
      });
      return report;
    });
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

function boundedLoadedBefore(
  value: unknown,
  fieldPath: string,
): RuntimeTraceReport["loadedBefore"] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  const record = asRecord(value);
  if (!record)
    throw new RuntimeTraceError(
      `Invalid runtime trace field ${fieldPath}: expected a boolean or object.`,
    );
  const producer = expectBoolean(record.producer, `${fieldPath}/producer`);
  const expose = expectBoolean(record.expose, `${fieldPath}/expose`);
  const consumers = expectArray(record.consumers, `${fieldPath}/consumers`);
  if (consumers && consumers.some((item) => !asRecord(item)))
    throw new RuntimeTraceError(
      `Invalid runtime trace field ${fieldPath}/consumers: every item must be an object.`,
    );
  const normalizedConsumers = consumers?.slice(0, MAX_EVIDENCE_ITEMS).map((item, index) => {
    const consumer = asRecord(item)!;
    type LoadedBeforeInfo = Exclude<NonNullable<RuntimeTraceReport["loadedBefore"]>, boolean>;
    const next: NonNullable<LoadedBeforeInfo["consumers"]>[number] = {};
    const name = expectString(consumer.name, `${fieldPath}/consumers/${index}/name`);
    const remoteEntryExports = expectBoolean(
      consumer.remoteEntryExports,
      `${fieldPath}/consumers/${index}/remoteEntryExports`,
    );
    const containerInitialized = expectBoolean(
      consumer.containerInitialized,
      `${fieldPath}/consumers/${index}/containerInitialized`,
    );
    const exposes = expectStringArray(consumer.exposes, `${fieldPath}/consumers/${index}/exposes`);
    if (name) next.name = String(redactDeep(name)).slice(0, 500);
    if (remoteEntryExports !== undefined) next.remoteEntryExports = remoteEntryExports;
    if (containerInitialized !== undefined) next.containerInitialized = containerInitialized;
    if (exposes) next.exposes = boundedStrings(exposes) ?? [];
    return next;
  });
  return {
    ...(producer !== undefined ? { producer } : {}),
    ...(expose !== undefined ? { expose } : {}),
    ...(normalizedConsumers ? { consumers: normalizedConsumers } : {}),
  } as RuntimeTraceReport["loadedBefore"];
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

function detectSourceContract(input: {
  outcome: string | undefined;
  summary: Record<string, unknown> | undefined;
  moduleInfo: Record<string, unknown> | undefined;
  diagnosis: Record<string, unknown> | undefined;
}): NonNullable<RuntimeTraceReport["sourceContract"]> {
  const phases = input.summary ? asRecord(input.summary.phases) : undefined;
  const hasCurrentOutcome = Boolean(input.outcome && CURRENT_OUTCOMES.has(input.outcome));
  const hasCurrentPhase = Boolean(
    phases && [...CURRENT_PHASES].some((phase) => phases[phase] !== undefined),
  );
  const hasCurrentDiagnosis = Boolean(
    input.diagnosis &&
    (input.diagnosis.ownerHint !== undefined ||
      input.diagnosis.title !== undefined ||
      input.diagnosis.facts !== undefined ||
      input.diagnosis.actions !== undefined ||
      input.diagnosis.completedPhases !== undefined ||
      input.diagnosis.pendingPhases !== undefined),
  );
  const hasClippedModuleInfo = Boolean(
    input.moduleInfo &&
    (input.moduleInfo.reason !== undefined ||
      input.moduleInfo.clipped !== undefined ||
      input.moduleInfo.entries !== undefined ||
      input.moduleInfo.availableNames !== undefined ||
      input.moduleInfo.totalCount !== undefined ||
      input.moduleInfo.matchedCount !== undefined),
  );
  const hasCurrentSummaryFlags = Boolean(
    input.summary &&
    (input.summary.flags !== undefined ||
      ["loadCompleted", "runtimeLoaded", "sharedResolved", "preloaded", "componentLoaded"].some(
        (key) => input.summary?.[key] !== undefined,
      )),
  );
  const hasCurrent =
    hasCurrentOutcome ||
    hasCurrentPhase ||
    hasCurrentDiagnosis ||
    hasClippedModuleInfo ||
    hasCurrentSummaryFlags;

  const hasLegacyOutcome = input.outcome === "success";
  const hasLegacyPhase = Boolean(phases && phases.init !== undefined);
  const hasLegacyDiagnosis = Boolean(
    input.diagnosis &&
    (input.diagnosis.owner !== undefined || input.diagnosis.summary !== undefined) &&
    input.diagnosis.ownerHint === undefined &&
    input.diagnosis.title === undefined,
  );
  const hasLegacyModuleInfo = Boolean(
    input.moduleInfo &&
    (input.moduleInfo.name !== undefined || input.moduleInfo.id !== undefined) &&
    !hasClippedModuleInfo,
  );
  const hasLegacy = hasLegacyOutcome || hasLegacyPhase || hasLegacyDiagnosis || hasLegacyModuleInfo;

  if (hasCurrent && !hasLegacy) return "upstream-observability-2.5.3";
  if (hasLegacy && !hasCurrent) return "legacy-doctor-v1";
  if (hasCurrent && hasLegacy) {
    // Prefer explicit current structure over shared outcome vocabulary like "failed".
    if (hasCurrentPhase || hasCurrentDiagnosis || hasClippedModuleInfo || hasCurrentSummaryFlags)
      return "upstream-observability-2.5.3";
    if (hasLegacyPhase || hasLegacyModuleInfo || hasLegacyDiagnosis || hasLegacyOutcome)
      return "legacy-doctor-v1";
    return "upstream-observability-2.5.3";
  }
  return "partial";
}

function sharedCompletenessFor(report: RuntimeTraceReport): "complete" | "partial" | "unknown" {
  const hasSharedSection = Boolean(
    report.shared ||
    report.phases?.shared ||
    report.events.some((event) => event.phase === "shared") ||
    report.sharedResolved === true ||
    report.outcome === "shared-resolved",
  );
  if (hasSharedSection) {
    return report.shared?.package || report.phases?.shared || report.sharedResolved !== undefined
      ? "complete"
      : "partial";
  }
  const runtimeVersion = report.runtimeVersion;
  const previewOrMissing =
    !runtimeVersion ||
    /preview|canary|nightly/i.test(runtimeVersion) ||
    (semver.valid(runtimeVersion) !== null && semver.lt(runtimeVersion, "2.5.0"));
  // Chrome DevTools compatibility reports and older runtimes omit shared lifecycle evidence.
  if (report.sourceContract === "partial" || previewOrMissing) return "unknown";
  return "unknown";
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
      // Keep raw phase names; correlation maps legacy/current aliases to rule semantics.
      return [name, status ? { status } : {}];
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
    const retryable = expectBoolean(event.retryable, "/events/retryable");
    if (phase)
      next.phase =
        phase === "init" ? "remoteEntryInit" : phase === "factory" ? "moduleFactory" : phase;
    if (status) next.status = status;
    if (errorCode) next.errorCode = errorCode;
    if (retryable !== undefined) next.retryable = retryable;
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
    record.loadedBefore !== undefined ||
    record.retryable !== undefined ||
    Array.isArray(record.events) ||
    errorCode !== undefined ||
    moduleInfo !== undefined ||
    diagnosis !== undefined;
  if (!hasShape)
    throw new RuntimeTraceError(
      "Unsupported runtime trace report shape: expected an Observability report envelope.",
    );
  if (summary && !asRecord(summary.phases) && summary.phases !== undefined)
    throw new RuntimeTraceError("Invalid runtime trace field /summary/phases: expected an object.");

  const report: RuntimeTraceReport = {
    schemaVersion: 1,
    sourceContract: detectSourceContract({ outcome, summary, moduleInfo, diagnosis }),
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
    boundedLoadedBefore(record.loadedBefore, "/loadedBefore") ??
    boundedLoadedBefore(summary?.loadedBefore, "/summary/loadedBefore");
  if (loadedBefore !== undefined) report.loadedBefore = loadedBefore;
  if (
    [record.loadedBefore, summary?.loadedBefore].some((value) => {
      const loadedBeforeRecord = asRecord(value);
      const consumers = loadedBeforeRecord?.consumers;
      return Array.isArray(consumers) && consumers.length > MAX_EVIDENCE_ITEMS;
    })
  )
    report.evidenceClipped = true;
  const retryable =
    expectBoolean(record.retryable, "/retryable") ??
    expectBoolean(summaryError?.retryable, "/summary/error/retryable");
  if (retryable !== undefined) report.retryable = retryable;
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
  // Preserve raw upstream/legacy phase names; correlation maps semantics without rewriting.
  if (failedPhase) report.failedPhase = failedPhase;
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
    const requiredVersion =
      shared.requiredVersion === false
        ? false
        : expectString(shared.requiredVersion, "/shared/requiredVersion");
    const selectedVersion = expectString(shared.selectedVersion, "/shared/selectedVersion");
    const reason = expectString(shared.reason, "/shared/reason");
    if (packageName) normalizedShared.package = packageName;
    if (provider) normalizedShared.provider = provider;
    if (requiredVersion !== undefined) normalizedShared.requiredVersion = requiredVersion;
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
  report.sharedCompleteness = sharedCompletenessFor(report);
  return redactDeep(report) as RuntimeTraceReport;
}

function extractRawReports(raw: unknown): { reports: unknown[]; clipped: boolean } {
  if (Array.isArray(raw))
    return { reports: raw.slice(0, MAX_EVIDENCE_ITEMS), clipped: raw.length > MAX_EVIDENCE_ITEMS };
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
    return {
      reports: record.reports.slice(0, MAX_EVIDENCE_ITEMS),
      clipped: record.reports.length > MAX_EVIDENCE_ITEMS,
    };
  }
  if (record.report !== undefined) return { reports: [record.report], clipped: false };
  return { reports: [record], clipped: false };
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
  if (isRuntimeCaptureEnvelope(raw)) return parseRuntimeCapture(raw);
  const record = asRecord(raw);
  assertSupportedDocumentVersion(record);
  if (isBuildReportDocument(record))
    throw new RuntimeTraceError(
      "Wrong runtime trace document kind: build-report/Doctor report is not a runtime Observability report.",
    );
  const extracted = extractRawReports(raw);
  const rawReports = extracted.reports;
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
  if (extracted.clipped && reports[0]) reports[0].evidenceClipped = true;
  return reports;
}

export async function loadRuntimeTraceFile(filePath: string): Promise<RuntimeTraceReport[]> {
  const resolved = path.resolve(filePath);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(resolved, "r");
    const stat = await handle.stat();
    const maxBytes = HARD_RUNTIME_CAPTURE_LIMITS.maxBytes;
    if (stat.size > maxBytes)
      throw new RuntimeTraceError(
        `Runtime trace exceeds the ${maxBytes} byte input limit: ${resolved}`,
        { fileLabel: resolved, failureCode: "oversized-input", pointer: "/" },
      );
    const buffer = Buffer.allocUnsafe(Math.min(stat.size + 1, maxBytes + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes || (await handle.stat()).size > maxBytes)
      throw new RuntimeTraceError(
        `Runtime trace exceeds the ${maxBytes} byte input limit: ${resolved}`,
        { fileLabel: resolved, failureCode: "oversized-input", pointer: "/" },
      );
    const text = buffer.toString("utf8", 0, bytesRead);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new RuntimeTraceError(`Runtime trace is not valid JSON: ${resolved}`, {
        fileLabel: resolved,
        failureCode: "malformed-json",
        pointer: "/",
      });
    }
    return parseRuntimeTraces(parsed);
  } catch (error) {
    if (error instanceof RuntimeTraceError) {
      throw new RuntimeTraceError(`${resolved}: ${error.message}`, {
        fileLabel: resolved,
        failureCode: error.failureCode,
        pointer: error.pointer,
      });
    }
    throw new RuntimeTraceError(`Unable to read runtime trace: ${resolved}`, {
      fileLabel: resolved,
      failureCode: "malformed-json",
      pointer: "/",
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function runtimeScopedProjects(projects: ProjectFacts[]): ProjectFacts[] {
  return projects.flatMap((project) => {
    if (project.federationInstanceId || !project.federationInstances?.length) return [project];
    return project.federationInstances.map((instance) => ({
      ...project,
      moduleFederation: instance.moduleFederation,
      capabilities: instance.capabilities,
      imports: instance.imports,
      artifacts: instance.artifacts,
      ...(instance.canonicalConfig ? { canonicalConfig: instance.canonicalConfig } : {}),
      ...(instance.runtimePluginContracts
        ? { runtimePluginContracts: instance.runtimePluginContracts }
        : {}),
      ...(instance.builds ? { builds: instance.builds } : {}),
      federationInstanceId: instance.id,
    }));
  });
}

function uniqueFederationInstanceId(projects: ProjectFacts[]): string | undefined {
  const ids = [
    ...new Set(
      projects
        .map((project) => project.federationInstanceId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  return ids.length === 1 ? ids[0] : undefined;
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

function exactProjectCandidates(
  projects: ProjectFacts[],
  name: string | undefined,
): ProjectFacts[] {
  if (!name) return [];
  return projects.filter(
    (project) =>
      project.moduleFederation?.name === name ||
      project.artifacts.manifest?.name === name ||
      project.artifacts.manifest?.id === name,
  );
}

function exactProject(
  projects: ProjectFacts[],
  name: string | undefined,
): ProjectFacts | undefined {
  const candidates = exactProjectCandidates(projects, name);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function aliasRemoteProjects(projects: ProjectFacts[], alias: string | undefined): ProjectFacts[] {
  if (!alias) return [];
  return projects.filter((project) => remoteKeys(project).includes(alias));
}

function moduleInfoNameCandidates(projects: ProjectFacts[], trace: RuntimeTraceReport): string[] {
  const entryNames = (trace.moduleInfo?.entries ?? [])
    .map((entry) => entry.name)
    .filter((value): value is string => Boolean(value));
  const names = [
    ...(trace.moduleInfo?.availableNames ?? []),
    ...entryNames,
    ...(trace.moduleInfo?.name ? [trace.moduleInfo.name] : []),
    ...(trace.moduleInfo?.id ? [trace.moduleInfo.id] : []),
  ];
  return [
    ...new Set(
      names.flatMap((name) => {
        return exactProjectCandidates(projects, name).map((project) => project.project.name);
      }),
    ),
  ].sort();
}

function runtimeFinding(
  ruleId: (typeof runtimeRuleMeta)[number]["id"],
  severity: Severity,
  project: string,
  message: string,
  evidence: Record<string, unknown>,
  suggestion?: string,
  federationInstanceId?: string,
): DoctorFinding {
  const base = {
    schemaVersion: 1 as const,
    ruleId,
    severity,
    project,
    ...(federationInstanceId ? { federationInstanceId } : {}),
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

export type RuntimeAttributionConfidence = "exact" | "high" | "low" | "unknown";
export type RuntimeAttributionCompleteness = "complete" | "partial" | "unknown";

export interface RuntimeAttribution {
  remoteName: string | undefined;
  matches: ProjectFacts[];
  hostProject: ProjectFacts | undefined;
  producerProject: ProjectFacts | undefined;
  hostCandidates: ProjectFacts[];
  producerCandidates: ProjectFacts[];
  projectName: string;
  attributedProjects: ProjectFacts[];
  federationInstanceId: string | undefined;
  identityEvidence: Record<string, unknown>;
  roleCandidates: {
    host: string[];
    producer: string[];
    consumer: string[];
    provider: string[];
    moduleInfo: string[];
  };
  owner: string | undefined;
  exactProducer: boolean;
  exactHost: boolean;
  ambiguousIdentity: boolean;
  weakAliasOnly: boolean;
  ownerHintConflict: boolean;
  ownerHintUnresolved: boolean;
  supportedOwner: boolean;
  matchedManifest: ProjectFacts["artifacts"]["manifest"] | undefined;
  confidence: RuntimeAttributionConfidence;
  completeness: RuntimeAttributionCompleteness;
  /** True when attribution is exact enough for the evidence bridge oracle. */
  exactAttribution: boolean;
  scopeProject: ProjectFacts | undefined;
}

function traceEvidenceCompleteness(trace: RuntimeTraceReport): RuntimeAttributionCompleteness {
  if (trace.sourceContract === "partial" || trace.outcome === "partial") return "partial";
  if (trace.evidenceClipped) return "partial";
  return "complete";
}

/** Classify how a runtime trace can be attributed to loaded project facts. */
export function classifyRuntimeAttribution(
  trace: RuntimeTraceReport,
  projectFacts: ProjectFacts[],
): RuntimeAttribution {
  const projects = runtimeScopedProjects(projectFacts);
  const remoteName = trace.remote?.name ?? trace.remote?.alias;
  const matches = remoteName ? findProjectsForRemote(projects, remoteName) : [];
  const hostProject = exactProject(projects, trace.hostName);
  const producerProject = exactProject(projects, trace.remote?.name);
  const hostCandidates = exactProjectCandidates(projects, trace.hostName);
  const producerCandidates = exactProjectCandidates(projects, trace.remote?.name);
  const aliasHostMatches = aliasRemoteProjects(projects, trace.requestAlias);
  const aliasRemoteMatches = aliasRemoteProjects(projects, trace.remote?.alias);
  const moduleInfoCandidates = moduleInfoNameCandidates(projects, trace);
  const ownerHintConflict = trace.ownerHintConflict === true;
  const owner = ownerHintConflict
    ? undefined
    : (trace.diagnosis?.ownerHint ?? trace.ownerHint ?? trace.diagnosis?.owner);
  const exactProducer = Boolean(trace.remote?.name && producerProject);
  const exactHost = Boolean(trace.hostName && hostProject);
  const weakAliasOnly =
    !exactProducer &&
    !exactHost &&
    (aliasHostMatches.length > 0 || aliasRemoteMatches.length > 0 || Boolean(trace.remote?.alias));
  const ownerHintUnresolved =
    (owner === "host" && !hostProject) || (owner === "remote" && !producerProject);
  const ambiguousIdentity =
    ownerHintConflict ||
    ownerHintUnresolved ||
    weakAliasOnly ||
    hostCandidates.length > 1 ||
    producerCandidates.length > 1 ||
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
    weakAliasOnly ||
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
  const attributedProjects = ownerEvidenceProject
    ? [ownerEvidenceProject]
    : projectName !== "runtime"
      ? producerProject
        ? [producerProject]
        : hostProject
          ? [hostProject]
          : []
      : [];
  const federationInstanceId = uniqueFederationInstanceId(attributedProjects);
  const roleCandidates = {
    host: hostProject ? [hostProject.project.name] : [],
    producer: producerProject ? [producerProject.project.name] : [],
    consumer: aliasHostMatches.map((project) => project.project.name).sort(),
    provider: trace.shared?.provider
      ? projects
          .filter(
            (project) =>
              project.moduleFederation?.name === trace.shared?.provider ||
              project.artifacts.manifest?.name === trace.shared?.provider ||
              project.artifacts.manifest?.id === trace.shared?.provider,
          )
          .map((project) => project.project.name)
          .sort()
      : [],
    moduleInfo: moduleInfoCandidates,
  };
  const identityEvidence = {
    ...(trace.hostName ? { hostName: trace.hostName } : {}),
    ...(trace.remote?.name ? { producer: trace.remote.name } : {}),
    ...(trace.remote?.alias ? { remoteAlias: trace.remote.alias } : {}),
    ...(trace.requestAlias ? { requestAlias: trace.requestAlias } : {}),
    ...(owner ? { ownerHint: owner } : {}),
    roles: roleCandidates,
    ...(ambiguousIdentity ||
    !supportedOwner ||
    ownerHintConflict ||
    weakAliasOnly ||
    owner === "shared" ||
    owner === "network" ||
    owner === "unknown"
      ? {
          matchReason: ownerHintConflict
            ? "conflicting owner hints; neutral runtime attribution"
            : ownerHintUnresolved
              ? "owner hint did not match an exact candidate; neutral runtime attribution"
              : hostCandidates.length > 1 || producerCandidates.length > 1
                ? "multiple exact candidates; neutral runtime attribution"
                : weakAliasOnly
                  ? "alias-only or requestAlias evidence is weak; neutral runtime attribution"
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
                ...roleCandidates.host,
                ...roleCandidates.producer,
                ...roleCandidates.consumer,
                ...roleCandidates.provider,
                ...roleCandidates.moduleInfo,
                ...matches.map((project) => project.project.name),
              ].filter((value): value is string => Boolean(value)),
            ),
          ].sort(),
        }
      : {
          matchReason: exactProducer
            ? "exact producer identity"
            : exactHost
              ? "exact host identity"
              : "runtime attribution",
        }),
  };
  const manifests = matches
    .map((project) => project.artifacts.manifest)
    .filter((manifest) => manifest && (manifest.valid || manifest.name || manifest.id));
  const matchedManifest = manifests.length === 1 ? manifests[0] : undefined;
  const completeness = traceEvidenceCompleteness(trace);
  const neutralAttribution =
    projectName === "runtime" ||
    ambiguousIdentity ||
    ownerHintConflict ||
    weakAliasOnly ||
    ownerHintUnresolved;
  const exactAttribution = !neutralAttribution && completeness === "complete";
  const confidence: RuntimeAttributionConfidence = exactAttribution
    ? "exact"
    : neutralAttribution
      ? "low"
      : completeness === "partial"
        ? "high"
        : "high";
  const scopeProject = attributedProjects[0] ?? hostProject ?? producerProject ?? projects[0];
  return {
    remoteName,
    matches,
    hostProject,
    producerProject,
    hostCandidates,
    producerCandidates,
    projectName,
    attributedProjects,
    federationInstanceId,
    identityEvidence,
    roleCandidates,
    owner,
    exactProducer,
    exactHost,
    ambiguousIdentity,
    weakAliasOnly,
    ownerHintConflict,
    ownerHintUnresolved,
    supportedOwner,
    matchedManifest,
    confidence,
    completeness,
    exactAttribution,
    scopeProject,
  };
}

function completenessInfo(
  status: RuntimeAttributionCompleteness,
  reason: string,
): EvidenceCompletenessInfo {
  return { status, reason };
}

function redactTraceEvidenceValue(trace: RuntimeTraceReport): EvidenceValue {
  return redact(JSON.parse(JSON.stringify(trace))) as EvidenceValue;
}

/** Attach opted-in runtime traces to an evidence graph as runtime-instance subjects. */
export function attachRuntimeTraceEvidence(
  graph: EvidenceGraphV2,
  traces: readonly RuntimeTraceReport[],
  projects: readonly ProjectFacts[],
): void {
  if (traces.length === 0) return;
  const projectSubject = graph.subjects.find((subject) => subject.kind === "project");
  const projectAssertions = projectSubject
    ? graph.assertions.filter((assertion) => assertion.subject === projectSubject.id)
    : [];
  const scopedProjects = runtimeScopedProjects([...projects]);
  for (const [index, trace] of traces.entries()) {
    const attribution = classifyRuntimeAttribution(trace, scopedProjects);
    if (!attribution.scopeProject) continue;
    const traceKey = trace.traceId ?? `trace-${index + 1}`;
    const runtimeSubject: EvidenceSubject = {
      id: stableEvidenceId("subject.runtime-instance", {
        project: attribution.scopeProject.project.name,
        traceKey,
        ...(attribution.federationInstanceId
          ? { federationInstanceId: attribution.federationInstanceId }
          : {}),
      }),
      kind: "runtime-instance",
      name: traceKey,
      attributes: {
        project: attribution.scopeProject.project.name,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
        ...(attribution.federationInstanceId
          ? { federationInstanceId: attribution.federationInstanceId }
          : {}),
      },
    };
    graph.subjects.push(runtimeSubject);
    for (const source of projectAssertions) {
      if (source.predicate !== "project.scope") continue;
      graph.assertions.push({
        id: stableEvidenceId("assertion", {
          subject: runtimeSubject.id,
          predicate: source.predicate,
          value: source.value,
          traceKey,
        }),
        subject: runtimeSubject.id,
        predicate: source.predicate,
        value: structuredClone(source.value),
        layer: source.layer,
        scope: structuredClone(source.scope),
        provenance: structuredClone(source.provenance),
        confidence: structuredClone(source.confidence),
        completeness: structuredClone(source.completeness),
      });
    }
    if (attribution.projectName === "runtime") continue;
    const traceValue = redactTraceEvidenceValue(trace);
    const confidenceLevel =
      attribution.confidence === "exact"
        ? "high"
        : attribution.confidence === "low"
          ? "low"
          : "high";
    graph.assertions.push({
      id: stableEvidenceId("assertion", {
        subject: runtimeSubject.id,
        predicate: "runtime.trace",
        value: traceValue,
        traceKey,
      }),
      subject: runtimeSubject.id,
      predicate: "runtime.trace",
      value: traceValue,
      layer: "runtime",
      scope: { ...graph.scope, bundler: { ...graph.scope.bundler } },
      provenance: {
        collector: { name: "@module-federation/doctor", version: "1" },
        inputKind: "runtime-trace",
        source: "runtime-trace",
        sourceSchemaVersion: "1",
      },
      confidence: {
        level: confidenceLevel,
        reason: attribution.exactAttribution
          ? "Imported runtime trace evidence is exact when attributed."
          : attribution.completeness === "partial"
            ? "Imported runtime trace evidence is partial or stale."
            : "Imported runtime trace attribution is weak or ambiguous.",
      },
      completeness: completenessInfo(
        attribution.completeness,
        attribution.exactAttribution
          ? "Runtime trace attribution and payload are complete."
          : attribution.completeness === "partial"
            ? "Runtime trace payload or contract is partial or stale."
            : "Runtime trace attribution is weak or ambiguous.",
      ),
    });
  }
}

export function correlateRuntime(
  traces: RuntimeTraceReport[],
  projectFacts: ProjectFacts[],
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const projects = runtimeScopedProjects(projectFacts);

  for (const trace of traces) {
    const attribution = classifyRuntimeAttribution(trace, projects);
    const {
      remoteName,
      matches,
      hostProject,
      projectName,
      federationInstanceId: findingInstanceId,
      identityEvidence,
      owner,
      matchedManifest,
      ownerHintConflict,
    } = attribution;
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
          findingInstanceId,
        ),
      );
    }

    const recovered = trace.outcome === "recovered" || trace.recovered === true;
    const remoteFailurePhases = phases.filter((phase) => REMOTE_PHASES.has(phase));
    if (!recovered && remoteFailurePhases.length > 0)
      for (const phase of remoteFailurePhases) {
        const phaseKind =
          phase === "moduleFactory" || phase === "factory"
            ? "moduleFactory"
            : phase === "preload"
              ? "preload"
              : "remote-load";
        const phaseMessage =
          phaseKind === "moduleFactory"
            ? `Runtime remote module factory failed during ${phase}.`
            : phaseKind === "preload"
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
              phaseKind,
              ...(trace.traceId ? { traceId: trace.traceId } : {}),
              ...(trace.errorCode ? { errorCode: trace.errorCode } : {}),
              ...(trace.remote?.entry ? { entry: trace.remote.entry } : {}),
              identity: identityEvidence,
              projects: matches.map((project) => project.project.name).sort(),
            },
            "Compare the redacted entry URL and manifest metadata with the producer build output.",
            findingInstanceId,
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
          uniqueFederationInstanceId(hosts),
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
      const sharedObserved = trace.sharedCompleteness !== "unknown";
      const sharedFailed =
        sharedObserved &&
        !recovered &&
        (sharedPhaseFailed || sharedReasonEvidence || sharedErrorEvidence);
      const versionMismatch =
        sharedObserved &&
        sharedVersionMismatch(
          trace.shared?.selectedVersion,
          typeof required === "string" ? required : undefined,
          installed,
        );
      const providerCandidates = trace.shared?.provider
        ? projects.filter(
            (project) =>
              project.moduleFederation?.name === trace.shared?.provider ||
              project.artifacts.manifest?.name === trace.shared?.provider ||
              project.artifacts.manifest?.id === trace.shared?.provider,
          )
        : [];
      const providerFallbackMismatch =
        sharedObserved &&
        Boolean(trace.shared?.provider) &&
        consumersWithoutFallback.length > 0 &&
        providers.length === 0;
      if (!recovered && (sharedFailed || versionMismatch || providerFallbackMismatch)) {
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
              ...(required !== undefined ? { requiredVersion: required } : {}),
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
            uniqueFederationInstanceId(providerCandidates.length === 1 ? providerCandidates : []),
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
          findingInstanceId,
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
  /** When false, omit health score from terminal output. */
  score?: boolean;
  /** When false, omit top agent prompts from terminal output. */
  prompt?: boolean;
  evidenceRollout?: EvidenceRolloutController;
  rules?: Readonly<Record<string, import("./types.js").RuleSetting>>;
}): Promise<RuntimeAnalysisResult> {
  const traces = await loadRuntimeTraceFile(options.tracePath);
  const projects = (
    await mapBounded([...options.projectFiles].sort(), async (file) => {
      const resolved = path.resolve(file);
      const document = await readEvidenceFile(resolved);
      if (document.kind !== "project-facts")
        throw new RuntimeTraceError(`Runtime project import requires project facts: ${resolved}`, {
          fileLabel: resolved,
          failureCode: "wrong-document-kind",
          pointer: "/",
        });
      return projectFactsFromEvidence(document.graph);
    })
  ).sort((a, b) => a.project.name.localeCompare(b.project.name));
  if (projects.length === 0)
    throw new RuntimeTraceError("No project.json files matched for runtime correlation.");

  const legacyFindings = correlateRuntime(traces, projects);
  const rollout = options.evidenceRollout ?? createEvidenceRolloutController();
  const rolloutMode = rollout.modeFor("rules");
  const settings = options.rules ?? {};
  let findings = legacyFindings;
  let evidence: EvidenceAnalysisMetadata | undefined;
  if (rolloutMode !== "legacy") {
    const {
      migratedRuntimeEvidenceRuleIds,
      projectMigratedFailures,
      runMigratedRuntimeEvidenceRules,
    } = await import("./evidence-rule-bridge.js");
    const primary = projects[0]!;
    const run = await runMigratedRuntimeEvidenceRules(
      primary,
      projects,
      traces,
      settings,
      undefined,
      { root: primary.project.root },
    );
    const migratedFindings = sortFindings(
      projectMigratedFailures(run.output.evaluations, primary, settings, primary.project.root),
    );
    const exactAttribution = (item: DoctorFinding) => item.project !== "runtime";
    const parity =
      rolloutMode === "shadow"
        ? compareV1Outputs(
            legacyFindings.filter(
              (finding) =>
                migratedRuntimeEvidenceRuleIds.has(finding.ruleId) && exactAttribution(finding),
            ),
            migratedFindings.filter(exactAttribution),
          )
        : undefined;
    if (rolloutMode === "v2-compat")
      findings = sortFindings([...legacyFindings, ...migratedFindings]);
    evidence = {
      rollout: { scope: "rules", mode: rolloutMode },
      evaluations: run.output.evaluations,
      execution: run.output.execution,
      ...(parity ? { parity } : {}),
    };
  }
  const report = reportFromFindings(projects, findings);
  const ui = buildUiPayload(projects, report);
  const formats = options.formats ?? [];
  if (options.outputDirectory && formats.length > 0)
    await writeFederationReports(report, options.outputDirectory, formats, {
      ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
      ...(options.printLog !== undefined ? { printLog: options.printLog } : {}),
      ...(options.score !== undefined ? { score: options.score } : {}),
      ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
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
    ...(evidence ? { evidence } : {}),
  };
}
