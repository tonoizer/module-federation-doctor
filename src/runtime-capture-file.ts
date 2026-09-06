import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  redactEvidenceValue,
  type EvidenceCompletenessInfo,
  type EvidenceProvenance,
  type EvidenceValue,
} from "./evidence.js";
import type { RuntimeTraceReport } from "./types.js";
import { writeFileAtomic } from "./atomic-write.js";
import {
  DEFAULT_RUNTIME_CAPTURE_LIMITS,
  HARD_RUNTIME_CAPTURE_LIMITS,
  RUNTIME_CAPTURE_CONTRACT_VERSION,
  RuntimeCaptureExportError,
  capability,
  isObject,
  normalizeRuntimeCaptureEnvelope,
  normalizedJson,
  parseSafeValue,
  relationId,
  runtimeCaptureContentDigest,
  runtimeCaptureRecordId,
  validateRuntimeCaptureEnvelope,
  type RuntimeCaptureCapability,
  type RuntimeCaptureCapabilityInfo,
  type RuntimeCaptureDevtoolsRecord,
  type RuntimeCaptureDevtoolsValue,
  type RuntimeCaptureEnvelope,
  type RuntimeCaptureIdentity,
  type RuntimeCaptureLimits,
  type RuntimeCaptureObservabilityRecord,
  type RuntimeCaptureRelationRecord,
  type RuntimeCaptureReportValue,
  type RuntimeCaptureSource,
  type RuntimeCaptureTransport,
  type RuntimeCaptureTruncation,
} from "./runtime-capture-contract.js";

/**
 * Existing file/export adapters for Observability, DevTools, app-owned, and
 * Node/SSR JSON. The CLI `mfdoctor runtime` command does not call these;
 * it validates an already-formed envelope through the contract module.
 * Adapters never attach to a browser or inject into a page.
 */

/** File/export adapter kinds supported without attaching to a live runtime. */
export type RuntimeCaptureExportAdapter = "observability" | "devtools" | "app" | "node";
export type RuntimeCaptureExportKind = "capture" | RuntimeCaptureExportAdapter | "unknown";

export interface RuntimeCaptureExportOptions {
  adapter?: RuntimeCaptureExportAdapter;
  transport?: RuntimeCaptureTransport;
  captureId?: string;
  navigationId?: string;
  realmId?: string;
  sourceScope?: string;
  capturedAt?: number;
  collector?: { name: string; version: string };
  limits?: Partial<RuntimeCaptureLimits>;
  location?: string;
}

const EXPORT_KIND_TAGS: Record<RuntimeCaptureExportAdapter, string[]> = {
  observability: ["observability", "observability-export", "runtime-trace"],
  devtools: ["devtools", "devtools-export", "module-federation-devtools"],
  app: ["app", "app-export", "application-export", "onreport", "onevent"],
  node: ["node", "node-file", "ssr", "ssr-export", "node-ssr"],
};

function exportRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function normalizedTag(value: unknown): string | undefined {
  return typeof value === "string" ? value.toLowerCase().replace(/[_\s]+/g, "-") : undefined;
}

function hasReportShape(value: unknown): boolean {
  const record = exportRecord(value);
  return Boolean(
    record &&
    [
      "traceId",
      "summary",
      "remote",
      "shared",
      "events",
      "diagnosis",
      "moduleInfo",
      "errorCode",
    ].some((key) => Object.prototype.hasOwnProperty.call(record, key)),
  );
}

function extractExportReports(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const record = exportRecord(value);
  if (!record) return undefined;
  if (Array.isArray(record.reports)) return record.reports;
  if (Object.prototype.hasOwnProperty.call(record, "report")) return [record.report];
  for (const key of ["observability", "export", "data"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
    const nestedReports = extractExportReports(nested);
    if (nestedReports) return nestedReports;
  }
  return hasReportShape(record) ? [record] : undefined;
}

function detectSafeRuntimeCaptureExport(value: unknown): RuntimeCaptureExportKind {
  const record = exportRecord(value);
  if (
    record &&
    record.schemaVersion === 1 &&
    record.contractVersion !== undefined &&
    Array.isArray(record.reports) &&
    Array.isArray(record.events) &&
    Array.isArray(record.devtools) &&
    Array.isArray(record.snapshots) &&
    Array.isArray(record.instances) &&
    Array.isArray(record.network) &&
    Array.isArray(record.errors)
  )
    return "capture";

  const tags = record
    ? [record.adapter, record.kind, record.documentKind, record.source, record.transport]
        .map(normalizedTag)
        .filter((tag): tag is string => Boolean(tag))
    : [];
  for (const adapter of ["devtools", "node", "app", "observability"] as const) {
    if (tags.some((tag) => EXPORT_KIND_TAGS[adapter].includes(tag))) return adapter;
  }
  if (
    record &&
    (Array.isArray(record.scopes) ||
      record.config !== undefined ||
      record.hasUserObservabilityPlugin !== undefined ||
      record.devtools !== undefined)
  )
    return "devtools";
  if (extractExportReports(value)) return "observability";
  return "unknown";
}

function safeRuntimeExportInput(input: unknown): unknown {
  const safe = parseSafeValue(input, HARD_RUNTIME_CAPTURE_LIMITS, "/", 0, new WeakSet(), false);
  if (!Array.isArray(safe) && !isObject(safe))
    throw new RuntimeCaptureExportError("Runtime capture export must be an object or array");
  return safe;
}

/** Detect a canonical capture or a supported file/export adapter without live attachment. */
export function detectRuntimeCaptureExport(input: unknown): RuntimeCaptureExportKind {
  try {
    return detectSafeRuntimeCaptureExport(safeRuntimeExportInput(input));
  } catch {
    return "unknown";
  }
}

function adapterTransport(adapter: RuntimeCaptureExportAdapter): RuntimeCaptureTransport {
  if (adapter === "devtools") return "devtools-export";
  if (adapter === "node") return "node-file";
  if (adapter === "app") return "app-export";
  return "file";
}

function adapterSource(adapter: RuntimeCaptureExportAdapter): string {
  if (adapter === "devtools") return "official-devtools-export";
  if (adapter === "node") return "node-ssr-export";
  if (adapter === "app") return "app-owned-export";
  return "official-observability";
}

function adapterInputKind(adapter: RuntimeCaptureExportAdapter): string {
  if (adapter === "devtools") return "devtools-export";
  if (adapter === "node") return "node-ssr-file";
  if (adapter === "app") return "app-owned-export";
  return "observability-export";
}

function safeExportString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function safeExportLocation(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const redacted = redactEvidenceValue(value);
  return typeof redacted === "string" ? redacted : undefined;
}

function reportValue(trace: RuntimeTraceReport): RuntimeCaptureReportValue {
  const value: RuntimeCaptureReportValue = {};
  if (trace.traceId) value.traceId = trace.traceId;
  if (trace.requestId) value.requestId = trace.requestId;
  if (trace.requestAlias) value.requestAlias = trace.requestAlias;
  if (trace.hostName) value.hostName = trace.hostName;
  if (trace.runtimeVersion) value.runtimeVersion = trace.runtimeVersion;
  if (trace.outcome) value.outcome = trace.outcome;
  if (trace.lastPhase) value.phase = trace.lastPhase;
  if (trace.errorCode) value.errorCode = trace.errorCode;
  if (trace.ownerHint) value.ownerHint = trace.ownerHint;
  if (typeof trace.loadedBefore === "boolean") value.loadedBefore = trace.loadedBefore;
  if (trace.diagnosis?.title) value.diagnosisTitle = trace.diagnosis.title;
  if (trace.moduleInfo?.reason) value.moduleInfoReason = trace.moduleInfo.reason;
  if (trace.moduleInfo?.availableNames?.length)
    value.moduleInfoNames = trace.moduleInfo.availableNames;
  return value;
}

function eventValue(
  trace: RuntimeTraceReport,
  event: RuntimeTraceReport["events"][number],
): RuntimeCaptureReportValue {
  const value: RuntimeCaptureReportValue = {};
  if (trace.traceId) value.traceId = trace.traceId;
  if (trace.requestId) value.requestId = trace.requestId;
  if (trace.hostName) value.hostName = trace.hostName;
  if (trace.runtimeVersion) value.runtimeVersion = trace.runtimeVersion;
  if (event.phase) value.phase = event.phase;
  if (event.status) value.outcome = event.status;
  if (event.errorCode) value.errorCode = event.errorCode;
  return value;
}

function runtimeIdentity(
  captureId: string,
  navigationId: string,
  realmId: string,
  sequence: number,
  trace: RuntimeTraceReport | undefined,
  scope: string,
): RuntimeCaptureIdentity {
  return {
    captureId,
    navigationId,
    realmId,
    sequence,
    sourceScope: scope,
    ...(trace?.runtimeVersion ? { runtimeVersion: trace.runtimeVersion } : {}),
    ...(trace?.traceId ? { traceId: trace.traceId } : {}),
    ...(trace?.requestId ? { requestId: trace.requestId } : {}),
    ...(trace?.hostName ? { hostName: trace.hostName } : {}),
    ...(trace?.moduleInfo?.name ? { instanceName: trace.moduleInfo.name } : {}),
    ...(trace?.remote?.name ? { remoteName: trace.remote.name } : {}),
    ...(trace?.remote?.alias ? { remoteAlias: trace.remote.alias } : {}),
    ...(trace?.shared?.package ? { sharedPackage: trace.shared.package } : {}),
  };
}

function runtimeCompleteness(
  trace: RuntimeTraceReport | undefined,
  partialReason: string | undefined,
): EvidenceCompletenessInfo {
  if (partialReason || trace?.evidenceClipped)
    return {
      status: "partial",
      reason: partialReason ?? "The source report was clipped before export.",
    };
  return { status: "complete", reason: "The validated export contained the projected fields." };
}

function runtimeExportSourceVersion(
  reports: RuntimeTraceReport[],
  adapter: RuntimeCaptureExportAdapter,
): string {
  const versions = [...new Set(reports.map((report) => report.sourceContract).filter(Boolean))];
  return versions.join(",") || (adapter === "devtools" ? "devtools-export-v1" : "unknown");
}

function runtimeSharedCapability(
  reports: RuntimeTraceReport[],
  source: RuntimeCaptureSource,
  scope: string,
  sourceSchemaVersion: string,
  runtimeVersion?: string,
  truncated = false,
): RuntimeCaptureCapabilityInfo {
  const states = reports.map((report) => report.sharedCompleteness ?? "unknown");
  const inferredState: RuntimeCaptureCapability =
    states.length > 0 && states.every((item) => item === "complete")
      ? "exact"
      : states.some((item) => item === "partial")
        ? "partial"
        : "unknown";
  const state = truncated && inferredState === "exact" ? "partial" : inferredState;
  return capability(
    "shared-lifecycle",
    state,
    source,
    state === "exact"
      ? "Every projected report carried complete shared-lifecycle evidence."
      : truncated && inferredState === "exact"
        ? "The export was truncated before all report/event evidence could be retained."
        : "The adapter does not infer missing shared-lifecycle evidence; absent fields remain unknown.",
    scope,
    sourceSchemaVersion,
    runtimeVersion,
  );
}

/**
 * Adapt an existing export into the versioned offline envelope. This function
 * only reads the supplied value; it never attaches to a browser or calls a
 * Module Federation runtime API.
 */
export async function importRuntimeCaptureExport(
  input: unknown,
  options: RuntimeCaptureExportOptions = {},
): Promise<RuntimeCaptureEnvelope> {
  const safeInput = safeRuntimeExportInput(input);
  const detected = detectSafeRuntimeCaptureExport(safeInput);
  const kind = detected === "capture" ? "capture" : (options.adapter ?? detected);
  if (kind === "unknown")
    throw new RuntimeCaptureExportError(
      "Unsupported runtime export: expected a capture envelope, Observability report/export, DevTools export, app-owned export, or Node/SSR export.",
    );
  if (kind === "capture") return normalizeRuntimeCaptureEnvelope(safeInput);

  const reportsInput = extractExportReports(safeInput) ?? [];
  const limits = { ...DEFAULT_RUNTIME_CAPTURE_LIMITS, ...options.limits };
  const adapter = kind;
  const transport = options.transport ?? adapterTransport(adapter);
  const scope = safeExportString(
    options.sourceScope,
    adapter === "node" ? "node-ssr" : "external-export",
  );
  const navigationId = safeExportString(options.navigationId, "navigation-1");
  const realmId = safeExportString(options.realmId, adapter === "node" ? "node-ssr" : "realm-top");
  const capturedAt = options.capturedAt ?? 0;
  if (!Number.isFinite(capturedAt) || capturedAt < 0)
    throw new RuntimeCaptureExportError("capturedAt must be a non-negative finite number");
  const collector = {
    name: safeExportString(options.collector?.name, "mfdoctor-capture-adapter"),
    version: safeExportString(options.collector?.version, "1"),
  };
  const rawDigest = runtimeCaptureContentDigest(safeInput as EvidenceValue);
  const captureId = safeExportString(options.captureId, `capture-${rawDigest.slice(0, 16)}`);
  const reportSource: RuntimeCaptureSource = adapter === "devtools" ? "devtools" : "observability";
  const sourceLabel = adapterSource(adapter);
  const inputKind = adapterInputKind(adapter);
  const location = safeExportLocation(options.location);
  const parsedReports: RuntimeTraceReport[] = [];
  const maxReports = limits.maxReports;
  for (const [index, rawReport] of reportsInput.slice(0, maxReports).entries()) {
    try {
      const { parseRuntimeTraces } = await import("./runtime-trace.js");
      const parsed = parseRuntimeTraces(rawReport);
      if (parsed[0]) parsedReports.push(parsed[0]);
    } catch (error) {
      throw new RuntimeCaptureExportError(
        `Unable to adapt ${adapter} report ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const runtimeVersion = parsedReports.find((report) => report.runtimeVersion)?.runtimeVersion;
  const reportSchemaVersion = runtimeExportSourceVersion(parsedReports, adapter);
  const totalEvents = parsedReports.reduce((total, report) => total + report.events.length, 0);
  const reportsTruncated = reportsInput.length > maxReports;
  const eventsTruncated = totalEvents > limits.maxEvents;
  const truncation: RuntimeCaptureTruncation[] = [];
  if (reportsTruncated) {
    truncation.push({
      collection: "observability",
      dropped: reportsInput.length - maxReports,
      firstSequence: maxReports,
      lastSequence: reportsInput.length - 1,
      reason: "The source export exceeded maxReports.",
    });
  }
  const records: RuntimeCaptureObservabilityRecord[] = [];
  const events: RuntimeCaptureObservabilityRecord[] = [];
  const devtools: RuntimeCaptureDevtoolsRecord[] = [];
  let sequence = 0;
  const nextIdentity = (trace?: RuntimeTraceReport): RuntimeCaptureIdentity =>
    runtimeIdentity(captureId, navigationId, realmId, sequence++, trace, scope);
  const provenance = (trace: RuntimeTraceReport | undefined): EvidenceProvenance => ({
    collector: { ...collector },
    inputKind,
    source: sourceLabel,
    sourceSchemaVersion: trace?.sourceContract ?? reportSchemaVersion,
    contentDigest: rawDigest,
    ...(location ? { location } : {}),
  });
  let devtoolsRecord: RuntimeCaptureDevtoolsRecord | undefined;
  const devtoolsIdentity = adapter === "devtools" ? nextIdentity() : undefined;
  const reportPartialReason =
    adapter === "devtools"
      ? "The DevTools projection is partial by source contract."
      : reportsTruncated
        ? "The source export exceeded maxReports; the report collection is truncated."
        : undefined;
  const eventPartialReason = eventsTruncated
    ? "The source export exceeded maxEvents; the event collection is truncated."
    : "Events are projected from the normalized report.";
  for (const trace of parsedReports) {
    const value = reportValue(trace);
    const identity = nextIdentity(trace);
    const record: RuntimeCaptureObservabilityRecord = {
      id: runtimeCaptureRecordId("observability", identity, value as unknown as EvidenceValue),
      identity,
      source: "observability",
      capturedAt,
      contentDigest: runtimeCaptureContentDigest(value as unknown as EvidenceValue),
      provenance: provenance(trace),
      completeness: runtimeCompleteness(trace, reportPartialReason),
      value,
    };
    records.push(record);
    for (const event of trace.events.slice(0, Math.max(0, limits.maxEvents - events.length))) {
      const eventValueProjected = eventValue(trace, event);
      const eventIdentity = nextIdentity(trace);
      events.push({
        id: runtimeCaptureRecordId(
          "observability",
          eventIdentity,
          eventValueProjected as unknown as EvidenceValue,
        ),
        identity: eventIdentity,
        source: "observability",
        capturedAt,
        contentDigest: runtimeCaptureContentDigest(eventValueProjected as unknown as EvidenceValue),
        provenance: provenance(trace),
        completeness: runtimeCompleteness(trace, eventPartialReason),
        value: eventValueProjected,
      });
    }
  }
  if (adapter === "devtools" && devtoolsIdentity) {
    const metadata = exportRecord(safeInput);
    const value: RuntimeCaptureDevtoolsValue = {
      ...(typeof metadata?.recordId === "string" ? { recordId: metadata.recordId } : {}),
      ...(typeof metadata?.scope === "string"
        ? { scope: metadata.scope }
        : Array.isArray(metadata?.scopes) && typeof metadata.scopes[0] === "string"
          ? { scope: metadata.scopes[0] }
          : {}),
      ...(runtimeVersion ? { runtimeVersion } : {}),
      ...(records.length ? { reportIds: records.map((record) => record.id) } : {}),
      fields: [
        ...(Array.isArray(metadata?.reports) ? ["reports"] : []),
        ...(Array.isArray(metadata?.scopes) ? ["scopes"] : []),
        ...(metadata?.config !== undefined ? ["config"] : []),
      ],
    };
    devtoolsRecord = {
      id: runtimeCaptureRecordId("devtools", devtoolsIdentity, value as unknown as EvidenceValue),
      identity: devtoolsIdentity,
      source: "devtools",
      capturedAt,
      contentDigest: runtimeCaptureContentDigest(value as unknown as EvidenceValue),
      provenance: {
        ...provenance(undefined),
        sourceSchemaVersion: "devtools-export-v1",
      },
      completeness: {
        status: "complete",
        reason: "The existing DevTools export metadata was projected without attachment.",
      },
      value,
    };
    for (const record of [...records, ...events]) record.provenanceRefs = [devtoolsRecord.id];
    devtools.push(devtoolsRecord);
  }
  if (eventsTruncated) {
    truncation.push({
      collection: "observability",
      dropped: totalEvents - limits.maxEvents,
      firstSequence: limits.maxEvents,
      lastSequence: totalEvents - 1,
      reason: "The source events exceeded maxEvents.",
    });
  }
  const observations: RuntimeCaptureCapabilityInfo[] = [
    capability(
      "reports",
      parsedReports.length > 0
        ? adapter === "devtools" || reportsTruncated
          ? "partial"
          : "exact"
        : "unavailable",
      reportSource,
      parsedReports.length > 0
        ? adapter === "devtools"
          ? "Reports came from an existing DevTools export and remain source-partial."
          : reportsTruncated
            ? "Reports were read from an existing export, but the report collection was truncated."
            : "Reports were read from an existing export and normalized through the runtime reader."
        : "The export did not contain a supported report.",
      scope,
      reportSchemaVersion,
      runtimeVersion,
    ),
    runtimeSharedCapability(
      parsedReports,
      reportSource,
      scope,
      reportSchemaVersion,
      runtimeVersion,
      reportsTruncated || eventsTruncated,
    ),
    capability(
      "snapshot",
      "unavailable",
      adapter === "devtools" ? "devtools" : "snapshot",
      "Snapshot projection is not part of the file/export adapter slice.",
      scope,
      "not-present",
      runtimeVersion,
    ),
    capability(
      "instance",
      "unavailable",
      adapter === "devtools" ? "devtools" : "instance",
      "Runtime-instance projection is not part of the file/export adapter slice.",
      scope,
      "not-present",
      runtimeVersion,
    ),
    capability(
      "network-error",
      "unavailable",
      adapter === "devtools" ? "devtools" : "network",
      "Network and error fallback is not part of the file/export adapter slice.",
      scope,
      "not-present",
      runtimeVersion,
    ),
    capability(
      "devtools",
      adapter === "devtools" ? "exact" : "unavailable",
      "devtools",
      adapter === "devtools"
        ? "Existing DevTools metadata was projected without enabling or attaching to DevTools."
        : "The input was not an existing DevTools export.",
      scope,
      adapter === "devtools" ? "devtools-export-v1" : "not-present",
      runtimeVersion,
    ),
  ];
  const relations: RuntimeCaptureRelationRecord[] = devtoolsRecord
    ? records.map((record) => ({
        id: relationId(devtoolsRecord!.id, record.id),
        from: devtoolsRecord!.id,
        to: record.id,
        relation: "source-supplied" as const,
        reason: "The existing DevTools export supplied the report record.",
      }))
    : [];
  const envelope: RuntimeCaptureEnvelope = {
    schemaVersion: 1,
    contractVersion: RUNTIME_CAPTURE_CONTRACT_VERSION,
    collector,
    transport,
    captureId,
    capabilities: { observations },
    limits,
    truncation,
    reports: records,
    events,
    devtools,
    snapshots: [],
    instances: [],
    network: [],
    errors: [],
    relations,
  };
  try {
    validateRuntimeCaptureEnvelope(envelope);
  } catch (error) {
    throw new RuntimeCaptureExportError(
      `Adapted runtime export failed capture validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return envelope;
}

/** Read one bounded JSON export file and adapt it without starting a runtime. */
export async function loadRuntimeCaptureExportFile(
  filePath: string,
  options: RuntimeCaptureExportOptions = {},
): Promise<RuntimeCaptureEnvelope> {
  const resolved = nodePath.resolve(filePath);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(resolved, "r");
    const stat = await handle.stat();
    if (stat.size > HARD_RUNTIME_CAPTURE_LIMITS.maxBytes)
      throw new RuntimeCaptureExportError(
        `Runtime capture export exceeds the ${HARD_RUNTIME_CAPTURE_LIMITS.maxBytes} byte input limit`,
        resolved,
      );
    const buffer = Buffer.allocUnsafe(
      Math.min(stat.size + 1, HARD_RUNTIME_CAPTURE_LIMITS.maxBytes + 1),
    );
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (
      bytesRead > HARD_RUNTIME_CAPTURE_LIMITS.maxBytes ||
      (await handle.stat()).size > HARD_RUNTIME_CAPTURE_LIMITS.maxBytes
    )
      throw new RuntimeCaptureExportError(
        `Runtime capture export exceeds the ${HARD_RUNTIME_CAPTURE_LIMITS.maxBytes} byte input limit`,
        resolved,
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString("utf8", 0, bytesRead)) as unknown;
    } catch {
      throw new RuntimeCaptureExportError("Runtime capture export is not valid JSON", resolved);
    }
    return await importRuntimeCaptureExport(parsed, {
      ...options,
      location: options.location ?? resolved,
    });
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError && error.fileLabel === resolved) {
      throw error;
    }
    if (error instanceof RuntimeCaptureExportError) {
      throw new RuntimeCaptureExportError(`${resolved}: ${error.message}`, resolved);
    }
    throw new RuntimeCaptureExportError(
      `Unable to read runtime capture export: ${resolved}`,
      resolved,
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export interface RuntimeCaptureFileWriteResult {
  path: string;
  bytes: number;
}

function runtimeCaptureFsErrorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined;
}

async function syncRuntimeCaptureDirectory(directory: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EISDIR", "EINVAL", "ENOTSUP", "EPERM"].includes(runtimeCaptureFsErrorCode(error) ?? ""))
      throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Validate and atomically hand off one capture envelope as a bounded JSON file. */
export async function writeRuntimeCaptureExportFile(
  input: unknown,
  filePath: string,
): Promise<RuntimeCaptureFileWriteResult> {
  const resolved = nodePath.resolve(filePath);
  let normalized: RuntimeCaptureEnvelope;
  try {
    normalized = normalizeRuntimeCaptureEnvelope(input);
  } catch (error) {
    throw new RuntimeCaptureExportError(
      `Runtime capture export failed validation: ${error instanceof Error ? error.message : String(error)}`,
      resolved,
    );
  }
  const serialized = normalizedJson(normalized);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > normalized.limits.maxBytes)
    throw new RuntimeCaptureExportError(
      `Runtime capture export exceeds the ${normalized.limits.maxBytes} byte output limit`,
      resolved,
    );
  if (bytes > HARD_RUNTIME_CAPTURE_LIMITS.maxBytes)
    throw new RuntimeCaptureExportError(
      `Runtime capture export exceeds the ${HARD_RUNTIME_CAPTURE_LIMITS.maxBytes} byte hard output limit`,
      resolved,
    );

  const directory = nodePath.dirname(resolved);
  try {
    await writeFileAtomic(resolved, serialized, { mode: 0o600 });
    await syncRuntimeCaptureDirectory(directory).catch(() => undefined);
    return { path: resolved, bytes };
  } catch (error) {
    if (error instanceof RuntimeCaptureExportError && error.fileLabel === resolved) throw error;
    throw new RuntimeCaptureExportError(
      `Unable to atomically write runtime capture export: ${resolved}`,
      resolved,
    );
  }
}
