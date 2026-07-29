import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixtureRoot = path.resolve("fixtures/runtime-traces");

async function readFixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(fixtureRoot, name), "utf8")) as Record<
    string,
    unknown
  >;
}

function assertReportRelationships(report: Record<string, unknown>): void {
  const summary = report.summary as Record<string, unknown>;
  const phases = summary.phases as Record<string, Record<string, unknown>>;
  const events = report.events as Array<Record<string, unknown>>;
  const startedAt = report.startedAt as number;
  const updatedAt = report.updatedAt as number;

  expect(events.length).toBe(summary.eventCount);
  expect(events.every((event) => event.traceId === report.traceId)).toBe(true);
  expect(events.every((event) => (event.timestamp as number) >= startedAt)).toBe(true);
  expect(events.every((event) => (event.timestamp as number) <= updatedAt)).toBe(true);
  expect(Object.keys(phases)).toEqual([...new Set(events.map((event) => event.phase))]);
  for (const [phase, phaseSummary] of Object.entries(phases)) {
    const phaseEvents = events.filter((event) => event.phase === phase);
    expect(phaseEvents.length).toBeGreaterThan(0);
    expect(phaseSummary.status).toBe(phaseEvents.at(-1)?.status);
  }
}

describe("runtime Observability contract fixtures", () => {
  it("keeps fixture provenance digests replayable", async () => {
    const provenance = await readFixture("provenance.json");
    const cases = provenance.cases as Array<Record<string, unknown>>;

    for (const item of cases.filter((entry) => entry.sanitizedSha256)) {
      const fixture = await fs.readFile(path.join(fixtureRoot, item.fixture as string));
      const digest = crypto.createHash("sha256").update(fixture).digest("hex");
      expect(digest).toBe(item.sanitizedSha256);
    }
    expect(JSON.stringify(provenance)).not.toContain("TO_BE_FILLED");
  });

  it("preserves the serialized upstream success report and relationships", async () => {
    const report = await readFixture("current-2.5.3.json");
    const summary = report.summary as Record<string, unknown>;
    const diagnosis = report.diagnosis as Record<string, unknown>;
    const facts = diagnosis.facts as Record<string, unknown>;
    const phase = (summary.phases as Record<string, Record<string, unknown>>).loadRemote!;

    assertReportRelationships(report);
    expect(report.traceId).toBe("mf-capture-runtime-loaded-success");
    expect(report.status).toBe("success");
    expect(report.runtimeVersion).toBe("2.5.0");
    expect(report.requestId).toBe("remote/Button");
    expect(report.hostName).toBe("host");
    expect((report.remote as Record<string, unknown>).name).toBe("remote");
    expect(report.expose).toBe("./Button");
    expect(summary.outcome).toBe("runtime-loaded");
    expect(summary.lastPhase).toBe("loadRemote");
    expect(summary.runtimeLoaded).toBe(true);
    expect(summary.loadCompleted).toBe(false);
    expect(summary.componentLoaded).toBe(false);
    expect(summary.recovered).toBe(false);
    expect(phase.status).toBe("success");
    expect(diagnosis.title).toBe("Remote loaded successfully");
    expect(diagnosis.ownerHint).toBe("remote");
    expect(diagnosis.completedPhases).toEqual(["loadRemote"]);
    expect(diagnosis.pendingPhases).toEqual([]);
    expect(diagnosis.warnings).toEqual(["Business component readiness signal was not recorded"]);
    expect(diagnosis.actions).toEqual([]);
    expect(facts.requestId).toBe(report.requestId);
    expect(facts.hostName).toBe(report.hostName);
    expect(facts.remoteName).toBe((report.remote as Record<string, unknown>).name);
    expect(facts.outcome).toBe(summary.outcome);
  });

  it("preserves snapshot failure error, action, and moduleInfo relationships", async () => {
    const report = await readFixture("snapshot-failure-2.5.3.json");
    const summary = report.summary as Record<string, unknown>;
    const error = summary.error as Record<string, unknown>;
    const context = report.errorContext as Record<string, unknown>;
    const diagnosis = report.diagnosis as Record<string, unknown>;
    const moduleInfo = report.moduleInfo as Record<string, unknown>;
    const entries = moduleInfo.entries as Array<Record<string, unknown>>;

    assertReportRelationships(report);
    expect(report.status).toBe("error");
    expect(report.errorCode).toBe(error.errorCode);
    expect(report.failedPhase).toBe(error.failedPhase);
    expect(report.ownerHint).toBe(error.ownerHint);
    expect(error.context).toEqual(context);
    expect(summary.outcome).toBe("failed");
    expect(summary.runtimeLoaded).toBe(false);
    expect(summary.loadCompleted).toBe(false);
    expect(summary.recovered).toBe(false);
    expect(diagnosis.title).toBe("Deployment moduleInfo did not match the requested remote");
    expect(diagnosis.errorCode).toBe(report.errorCode);
    expect(diagnosis.failedPhase).toBe(report.failedPhase);
    expect(
      (diagnosis.actions as Array<Record<string, unknown>>).map((action) => action.id),
    ).toEqual(["check-module-info", "check-host-remotes"]);
    expect(moduleInfo.reason).toBe("remote-snapshot");
    expect(moduleInfo.clipped).toBe(true);
    expect(entries.length).toBe(moduleInfo.matchedCount);
    expect((moduleInfo.matchedCount as number) <= (moduleInfo.totalCount as number)).toBe(true);
    expect(entries[0]?.name).toBe("remote:https://cdn.example.com/remote/mf-manifest.json");
    for (const name of [
      "current-2.5.3.json",
      "snapshot-failure-2.5.3.json",
      "partial-devtools.json",
    ]) {
      const fixture = await fs.readFile(path.join(fixtureRoot, name), "utf8");
      expect(fixture).not.toMatch(/token=secret|\/private\/tmp|Bearer\s|localhost:3001/);
    }
  });

  it("keeps partial DevTools reports visibly partial by omission", async () => {
    const envelope = await readFixture("partial-devtools.json");
    const reports = envelope.reports as Array<Record<string, unknown>>;
    const report = reports[0]!;

    expect(reports.length).toBe(1);
    expect(report.traceId).toBe("mf-capture-trace-unknown-version");
    expect(report.status).toBe("pending");
    expect(report.events).toEqual([]);
    expect(report["__scope"]).toBe("runtime_host");
    expect("runtimeVersion" in report).toBe(false);
    expect("summary" in report).toBe(false);
    expect("moduleInfo" in report).toBe(false);
    expect("diagnosis" in report).toBe(false);
  });

  it("keeps legacy fixtures separate from current fixtures", async () => {
    const legacy = await readFixture("healthy.json");
    const current = await readFixture("current-2.5.3.json");

    expect((legacy.summary as Record<string, unknown>).outcome).toBe("success");
    expect((current.summary as Record<string, unknown>).outcome).toBe("runtime-loaded");
    expect("hostName" in legacy).toBe(false);
    expect(current.hostName).toBe("host");
  });
});
