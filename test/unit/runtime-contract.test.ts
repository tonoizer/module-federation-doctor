import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixtureRoot = path.resolve("fixtures/runtime-traces");

async function readFixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(fixtureRoot, name), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("runtime Observability contract fixtures", () => {
  it("keeps a provenance-pinned current 2.5.3 report shape", async () => {
    const report = await readFixture("current-2.5.3.json");
    const summary = report.summary as Record<string, unknown>;
    const phases = summary.phases as Record<string, unknown>;
    const moduleInfo = report.moduleInfo as Record<string, unknown>;
    const diagnosis = report.diagnosis as Record<string, unknown>;

    expect(report.runtimeVersion).toBe("0.20.0");
    expect(report).toMatchObject({
      traceId: expect.any(String),
      status: "success",
      requestId: expect.any(String),
      requestAlias: "checkout",
      hostName: "host",
      remote: expect.objectContaining({ name: "checkout", entry: expect.any(String) }),
      expose: "./Button",
      startedAt: expect.any(Number),
      updatedAt: expect.any(Number),
      duration: expect.any(Number),
      ownerHint: "host",
      retryable: false,
      loadedBefore: expect.objectContaining({ producer: false, expose: false }),
      events: expect.arrayContaining([
        expect.objectContaining({ phase: "matchRemote", source: "runtime" }),
      ]),
    });
    expect(summary.outcome).toBe("component-loaded");
    expect(summary).toMatchObject({
      eventCount: 3,
      recovered: false,
      loadCompleted: true,
      runtimeLoaded: true,
      sharedResolved: true,
      preloaded: false,
      componentLoaded: true,
      lastPhase: "component",
      flags: { cached: false, fallback: false, recovered: false },
      shared: expect.objectContaining({ name: "react", provider: "host" }),
    });
    expect(Object.keys(phases)).toEqual([
      "matchRemote",
      "manifest",
      "remoteEntry",
      "remoteEntryInit",
      "expose",
      "moduleFactory",
      "loadRemote",
      "shared",
      "preload",
      "component",
    ]);
    expect(moduleInfo).toMatchObject({
      reason: expect.any(String),
      clipped: true,
      totalCount: 1,
      matchedCount: 1,
      entries: [expect.objectContaining({ name: "checkout", remoteEntry: expect.any(String) })],
    });
    expect(diagnosis).toMatchObject({
      title: expect.any(String),
      outcome: "component-loaded",
      ownerHint: "host",
      completedPhases: expect.arrayContaining(["remoteEntryInit", "component"]),
      pendingPhases: [],
      actions: [],
    });
  });

  it("keeps partial DevTools reports visibly partial by omission", async () => {
    const envelope = await readFixture("partial-devtools.json");
    const reports = envelope.reports as Array<Record<string, unknown>>;
    const report = reports[0]!;
    const summary = report.summary as Record<string, unknown>;

    expect(reports).toHaveLength(1);
    expect(report.runtimeVersion).toBe("preview");
    expect(summary.outcome).toBe("pending");
    expect(report.events).toEqual([]);
    expect(report.moduleInfo).toBeUndefined();
    expect(report.diagnosis).toBeUndefined();
  });

  it("keeps legacy fixtures separate from current fixtures", async () => {
    const legacy = await readFixture("healthy.json");
    const current = await readFixture("current-2.5.3.json");

    expect((legacy.summary as Record<string, unknown>).outcome).toBe("success");
    expect((current.summary as Record<string, unknown>).outcome).toBe("component-loaded");
    expect(legacy).not.toHaveProperty("hostName");
    expect(current).toHaveProperty("hostName", "host");
  });
});
