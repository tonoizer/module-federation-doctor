import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runtimeCaptureContentDigest,
  runtimeCaptureRecordId,
  validateRuntimeCaptureEnvelope,
  type RuntimeCaptureEnvelope,
} from "../../src/capture.js";
import { redactEvidenceValue, type EvidenceValue } from "../../src/evidence.js";
import { readEvidenceDocument } from "../../src/evidence-reader.js";
import { fingerprint } from "../../src/utils.js";
import { validatePayload } from "../helpers/schema-contract.js";

const fixturePath = path.resolve("test/fixtures/security/adversarial-runtime-capture.json");

async function loadFixture(): Promise<RuntimeCaptureEnvelope> {
  return JSON.parse(await fs.readFile(fixturePath, "utf8")) as RuntimeCaptureEnvelope;
}

function refreshRecordIntegrity(fixture: RuntimeCaptureEnvelope): RuntimeCaptureEnvelope {
  for (const record of fixture.reports) {
    const value = record.value as unknown as EvidenceValue;
    record.contentDigest = runtimeCaptureContentDigest(value);
    record.id = runtimeCaptureRecordId(record.source, record.identity, value);
  }
  return fixture;
}

describe("adversarial privacy and capture-security fixtures", () => {
  it("keeps safe topology evidence while excluding secrets, paths, and payload fields", async () => {
    const fixture = refreshRecordIntegrity(await loadFixture());

    validateRuntimeCaptureEnvelope(fixture);
    await validatePayload("runtime-capture.schema.json", fixture, fixturePath);

    const output = JSON.stringify(fixture);
    expect(output).toContain("checkout-host");
    expect(output).toContain("catalog");
    expect(output).not.toMatch(/authorization|cookie|bearer|password|secret|token|headers|body/i);
    expect(output).not.toMatch(/(?:\/Users\/|[A-Z]:\\|\\\\[^\\]+\\)/);
  });

  it("makes secret and private-path changes irrelevant to digests and record IDs", () => {
    const identity = {
      captureId: "capture-1",
      navigationId: "navigation-1",
      realmId: "realm-1",
      sequence: 1,
    } as const;
    const first = {
      message: "authorization=Bearer first-secret file=/Users/alice/project/src/app.ts",
      remote: "https://user:pass@example.test/app/mf-manifest.json?token=first",
    };
    const second = {
      message: "authorization=Bearer second-secret file=/Users/bob/other/src/app.ts",
      remote: "https://user:other@example.test/app/mf-manifest.json?token=second",
    };

    expect(runtimeCaptureContentDigest(first)).toBe(runtimeCaptureContentDigest(second));
    expect(runtimeCaptureRecordId("error", identity, first)).toBe(
      runtimeCaptureRecordId("error", identity, second),
    );
    expect(
      fingerprint({
        ruleId: "runtime/error-correlated",
        project: "host",
        evidence: redactEvidenceValue(first) as Record<string, unknown>,
      }),
    ).toBe(
      fingerprint({
        ruleId: "runtime/error-correlated",
        project: "host",
        evidence: redactEvidenceValue(second) as Record<string, unknown>,
      }),
    );
  });

  it("rejects prototype-pollution keys without changing Object.prototype", async () => {
    const fixture = await loadFixture();
    const hostile = JSON.parse('{"__proto__":{"polluted":true}}');
    fixture.reports[0]!.value = hostile;

    expect(() => validateRuntimeCaptureEnvelope(fixture)).toThrow(/forbidden|not allowed/i);
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const evidence = readEvidenceDocument({
      protocol: {
        protocolVersion: 2,
        schemaVersion: 2,
        producer: { name: "fixture", version: "1" },
        source: { kind: "fixture", schemaVersion: "2" },
      },
      scope: { adapter: "vite", bundler: { name: "vite" }, target: "web" },
      identity: { project: "host" },
      subjects: [{ id: "subject:host", kind: "project", name: "host" }],
      assertions: [
        {
          id: "assertion:host",
          subject: "subject:host",
          predicate: "project.topology",
          value: hostile,
          layer: "runtime",
          scope: { adapter: "vite", bundler: { name: "vite" }, target: "web" },
          provenance: {
            collector: { name: "fixture", version: "1" },
            inputKind: "fixture",
            source: "fixture",
            sourceSchemaVersion: "1",
          },
          confidence: { level: "low", reason: "hostile fixture" },
          completeness: { status: "partial", reason: "hostile fixture" },
        },
      ],
      edges: [],
      evaluations: [],
    });
    expect((evidence.graph.assertions[0]!.value as Record<string, unknown>).__proto__).toEqual({
      polluted: true,
    });
    expect(
      (evidence.graph.assertions[0]!.value as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("keeps truncation visible and validates bounded limits", async () => {
    const fixture = refreshRecordIntegrity(await loadFixture());
    expect(fixture.truncation).toEqual([
      {
        collection: "network",
        dropped: 2,
        firstSequence: 8,
        lastSequence: 9,
        reason: "network quota",
      },
    ]);
    expect(fixture.limits.maxBytes).toBe(5 * 1024 * 1024);
    expect(() => validateRuntimeCaptureEnvelope(fixture)).not.toThrow();

    const overLimit = structuredClone(fixture);
    overLimit.limits.maxBytes = 25 * 1024 * 1024 + 1;
    expect(() => validateRuntimeCaptureEnvelope(overLimit)).toThrow(/hard ceiling|maxBytes/i);
  });
});
