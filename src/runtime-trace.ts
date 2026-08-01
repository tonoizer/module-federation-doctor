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
const REMOTE_PHASES = new Set(["matchRemote", "manifest", "remoteEntry", "expose", "loadRemote"]);
const INIT_PHASES = new Set(["remoteEntryInit", "init"]);
const ERROR_CODE = /^RUNTIME-\d+$/i;

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

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
    return looksLikeUrl(redacted) ? redactRuntimeUrl(redacted) : redacted;
  }
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        /token|cookie|authorization|password|secret|api[-_]?key/i.test(key)
          ? "[REDACTED]"
          : redactDeep(item),
      ]),
    );
  }
  return value;
}

function readPhases(summary: Record<string, unknown> | undefined): RuntimeTraceReport["phases"] {
  const phases = asRecord(summary?.phases);
  if (!phases) return undefined;
  return Object.fromEntries(
    Object.entries(phases).map(([name, value]) => {
      const status = asString(asRecord(value)?.status);
      return [name, status ? { status } : {}];
    }),
  );
}

function readEvents(raw: unknown): RuntimeTraceReport["events"] {
  if (!Array.isArray(raw)) return [];
  const events: RuntimeTraceReport["events"] = [];
  for (const item of raw) {
    const event = asRecord(item);
    if (!event) continue;
    const next: RuntimeTraceReport["events"][number] = {};
    const phase = asString(event.phase);
    const status = asString(event.status);
    const errorCode = asString(event.errorCode);
    if (phase) next.phase = phase;
    if (status) next.status = status;
    if (errorCode) next.errorCode = errorCode;
    events.push(next);
  }
  return events;
}

function normalizeReport(raw: unknown): RuntimeTraceReport | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const summary = asRecord(record.summary);
  const remote = asRecord(record.remote);
  const shared = asRecord(record.shared) ?? asRecord(summary?.shared);
  const moduleInfo = asRecord(record.moduleInfo);
  const diagnosis = asRecord(record.diagnosis);
  const summaryError = asRecord(summary?.error);
  const outcome = asString(summary?.outcome);
  const errorCode =
    asString(record.errorCode) ??
    asString(summaryError?.errorCode) ??
    asString(diagnosis?.errorCode) ??
    asString(asRecord(record.error)?.code);
  const hasShape =
    asString(record.traceId) !== undefined ||
    summary !== undefined ||
    remote !== undefined ||
    shared !== undefined ||
    Array.isArray(record.events) ||
    errorCode !== undefined;
  if (!hasShape) return undefined;

  const legacy =
    diagnosis?.owner !== undefined ||
    diagnosis?.summary !== undefined ||
    (moduleInfo && (moduleInfo.name !== undefined || moduleInfo.id !== undefined)) ||
    outcome === "success" ||
    (summary?.phases && asRecord(summary.phases)?.init !== undefined);
  const report: RuntimeTraceReport = {
    schemaVersion: 1,
    sourceContract: legacy
      ? "legacy-doctor-v1"
      : summary === undefined && (!Array.isArray(record.events) || record.events.length === 0)
        ? "partial"
        : "upstream-observability-2.5.3",
    events: readEvents(record.events),
  };
  const traceId = asString(record.traceId);
  const status = asString(record.status);
  if (traceId) report.traceId = traceId;
  if (status) report.status = status;
  for (const key of ["requestId", "requestAlias", "hostName", "runtimeVersion"] as const) {
    const value = asString(record[key]);
    if (value) report[key] = value;
  }
  if (errorCode) report.errorCode = errorCode;
  if (outcome) report.outcome = outcome;
  const recovered = asBoolean(summary?.recovered) ?? asBoolean(asRecord(summary?.flags)?.recovered);
  if (recovered !== undefined) report.recovered = recovered;
  const failedPhase = asString(record.failedPhase) ?? asString(summaryError?.failedPhase);
  if (failedPhase) report.failedPhase = failedPhase;
  const ownerHint =
    asString(record.ownerHint) ??
    asString(summaryError?.ownerHint) ??
    asString(diagnosis?.ownerHint);
  if (ownerHint) report.ownerHint = ownerHint;
  const phases = readPhases(summary);
  if (phases) report.phases = phases;
  if (outcome === "success" && phases) {
    const completedRemotePhase = ["remoteEntry", "expose", "loadRemote"].some(
      (phase) => phases[phase]?.status === "complete" || phases[phase]?.status === "success",
    );
    if (completedRemotePhase) report.outcome = "runtime-loaded";
  }
  if (remote) {
    const normalizedRemote: NonNullable<RuntimeTraceReport["remote"]> = {};
    const name = asString(remote.name);
    const alias = asString(remote.alias);
    const entry = asString(remote.entry);
    if (name) normalizedRemote.name = name;
    if (alias) normalizedRemote.alias = alias;
    if (entry) normalizedRemote.entry = redactRuntimeUrl(entry);
    report.remote = normalizedRemote;
  }
  if (shared) {
    const packageName =
      asString(shared.package) ??
      asString(shared.name) ??
      asString(shared.pkg) ??
      asString(shared.shareKey);
    const normalizedShared: NonNullable<RuntimeTraceReport["shared"]> = {};
    const provider = asString(shared.provider);
    const requiredVersion = asString(shared.requiredVersion);
    const selectedVersion = asString(shared.selectedVersion);
    const reason = asString(shared.reason);
    if (packageName) normalizedShared.package = packageName;
    if (provider) normalizedShared.provider = provider;
    if (requiredVersion) normalizedShared.requiredVersion = requiredVersion;
    if (selectedVersion) normalizedShared.selectedVersion = selectedVersion;
    if (Array.isArray(shared.availableVersions)) {
      normalizedShared.availableVersions = shared.availableVersions.filter(
        (item): item is string => typeof item === "string",
      );
    }
    if (reason) normalizedShared.reason = reason;
    report.shared = normalizedShared;
  }
  if (moduleInfo) {
    const normalizedModule: NonNullable<RuntimeTraceReport["moduleInfo"]> = {};
    const name = asString(moduleInfo.name);
    const id = asString(moduleInfo.id);
    const publicPath = asString(moduleInfo.publicPath);
    if (name) normalizedModule.name = name;
    if (id) normalizedModule.id = id;
    if (publicPath) normalizedModule.publicPath = redactRuntimeUrl(publicPath);
    const reason = asString(moduleInfo.reason);
    const clipped = asBoolean(moduleInfo.clipped);
    const totalCount = asNumber(moduleInfo.totalCount);
    const matchedCount = asNumber(moduleInfo.matchedCount);
    if (reason) normalizedModule.reason = reason;
    if (clipped !== undefined) normalizedModule.clipped = clipped;
    if (totalCount !== undefined) normalizedModule.totalCount = totalCount;
    if (matchedCount !== undefined) normalizedModule.matchedCount = matchedCount;
    const availableNames = boundedStrings(moduleInfo.availableNames);
    if (availableNames) normalizedModule.availableNames = availableNames;
    if (Array.isArray(moduleInfo.entries)) {
      normalizedModule.entries = moduleInfo.entries.slice(0, 24).flatMap((item) => {
        const entry = asRecord(item);
        if (!entry) return [];
        const next: NonNullable<NonNullable<RuntimeTraceReport["moduleInfo"]>["entries"]>[number] =
          {};
        for (const key of ["name", "getPublicPath", "globalName"] as const) {
          const value = asString(entry[key]);
          if (value) next[key] = String(redactDeep(value)).slice(0, 500);
        }
        for (const key of ["publicPath", "remoteEntry"] as const) {
          const value = asString(entry[key]);
          if (value) next[key] = redactRuntimeUrl(value);
        }
        return [next];
      });
    }
    report.moduleInfo = normalizedModule;
  }
  if (diagnosis) {
    const normalizedDiagnosis: NonNullable<RuntimeTraceReport["diagnosis"]> = {};
    const owner = asString(diagnosis.owner);
    const diagnosisSummary = asString(diagnosis.summary) ?? asString(diagnosis.message);
    const diagnosisOwnerHint = asString(diagnosis.ownerHint);
    const title = asString(diagnosis.title);
    if (owner) normalizedDiagnosis.owner = owner;
    if (diagnosisOwnerHint) normalizedDiagnosis.ownerHint = diagnosisOwnerHint;
    if (title) normalizedDiagnosis.title = String(redactDeep(title)).slice(0, 500);
    if (diagnosisSummary) normalizedDiagnosis.summary = diagnosisSummary;
    const facts = boundedRecord(diagnosis.facts);
    if (facts) normalizedDiagnosis.facts = facts;
    const actions = Array.isArray(diagnosis.actions)
      ? diagnosis.actions.slice(0, 24).flatMap((item) => {
          const action = boundedRecord(item);
          return action ? [action] : [];
        })
      : undefined;
    if (actions) normalizedDiagnosis.actions = actions;
    const warnings = boundedStrings(diagnosis.warnings);
    const completedPhases = boundedStrings(diagnosis.completedPhases);
    const pendingPhases = boundedStrings(diagnosis.pendingPhases);
    if (warnings) normalizedDiagnosis.warnings = warnings;
    if (completedPhases) normalizedDiagnosis.completedPhases = completedPhases;
    if (pendingPhases) normalizedDiagnosis.pendingPhases = pendingPhases;
    report.diagnosis = normalizedDiagnosis;
  }
  return redactDeep(report) as RuntimeTraceReport;
}

function extractRawReports(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const record = asRecord(raw);
  if (!record) return [];
  if (Array.isArray(record.reports)) return record.reports;
  if (record.report) return [record.report];
  return [record];
}

export function parseRuntimeTraces(raw: unknown): RuntimeTraceReport[] {
  const record = asRecord(raw);
  if (record && (record.findings !== undefined || record.projects !== undefined))
    throw new RuntimeTraceError(
      "Unsupported runtime trace document kind: build/Doctor report; expected an Observability runtime report.",
    );
  const reports = extractRawReports(raw)
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

function preferredProject(matches: ProjectFacts[], fallback = "runtime"): string {
  return matches.map((project) => project.project.name).sort()[0] ?? fallback;
}

function failedPhases(trace: RuntimeTraceReport): string[] {
  const fromEvents = trace.events
    .filter((event) => event.phase && phaseFailed(event.status))
    .map((event) => event.phase!);
  const fromSummary = Object.entries(trace.phases ?? {})
    .filter(([, value]) => phaseFailed(value.status))
    .map(([phase]) => phase);
  return [...new Set([...fromEvents, ...fromSummary])];
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
    const owner = trace.diagnosis?.ownerHint ?? trace.ownerHint ?? trace.diagnosis?.owner;
    const ambiguousIdentity =
      !owner &&
      hostProject &&
      producerProject &&
      hostProject.project.name !== producerProject.project.name;
    const ownerProject =
      owner === "host" ? hostProject : owner === "remote" ? producerProject : undefined;
    const identityCandidates = ownerProject
      ? [ownerProject]
      : producerProject
        ? [producerProject]
        : [];
    const projectName = ambiguousIdentity
      ? "runtime"
      : preferredProject(
          identityCandidates.length > 0
            ? identityCandidates
            : matches.length > 0
              ? matches
              : projects.filter(
                  (project) =>
                    project.moduleFederation?.name === trace.moduleInfo?.name ||
                    project.artifacts.manifest?.name === trace.moduleInfo?.name ||
                    project.artifacts.manifest?.id === trace.moduleInfo?.id,
                ),
        );
    const identityEvidence = {
      ...(trace.hostName ? { hostName: trace.hostName } : {}),
      ...(trace.remote?.name ? { producer: trace.remote.name } : {}),
      ...(owner ? { ownerHint: owner } : {}),
      ...(ambiguousIdentity
        ? {
            matchReason: "ambiguous host/producer identity",
            candidates: [hostProject!.project.name, producerProject!.project.name].sort(),
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
    if (!recovered && phases.some((phase) => REMOTE_PHASES.has(phase))) {
      findings.push(
        runtimeFinding(
          "runtime/remote-load-failed",
          "error",
          projectName,
          `Runtime remote load failed during ${phases.filter((phase) => REMOTE_PHASES.has(phase)).join(", ")}.`,
          {
            ...(remoteName ? { remote: remoteName } : {}),
            phases: phases.filter((phase) => REMOTE_PHASES.has(phase)).sort(),
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
      const hosts = matches.length > 0 ? matches : projects;
      const host = hosts[0];
      findings.push(
        runtimeFinding(
          "runtime/init-failed",
          "error",
          preferredProject(hosts),
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
      const sharedFailed =
        !recovered &&
        (phases.includes("shared") ||
          phaseFailed(trace.status) ||
          trace.outcome === "failed" ||
          Boolean(trace.shared?.reason && /unmatched|missing|fail/i.test(trace.shared.reason)));
      const versionMismatch = sharedVersionMismatch(
        trace.shared?.selectedVersion,
        typeof required === "string" ? required : undefined,
        installed,
      );
      if (
        !recovered &&
        (sharedFailed ||
          versionMismatch ||
          (consumersWithoutFallback.length > 0 && providers.length === 0))
      ) {
        findings.push(
          runtimeFinding(
            "runtime/shared-mismatch",
            "error",
            preferredProject(
              sharedEntries
                .map((entry) => projects.find((project) => project.project.name === entry.project))
                .filter((project): project is ProjectFacts => Boolean(project)),
              projectName,
            ),
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
