import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_CAPTURE_LIMITS,
  HARD_RUNTIME_CAPTURE_LIMITS,
  RUNTIME_CAPTURE_CONTRACT_VERSION,
  runtimeCaptureContentDigest,
  runtimeCaptureRecordId,
  validateRuntimeCaptureEnvelope,
  type RuntimeCaptureEnvelope,
  type RuntimeCaptureIdentity,
} from "../../src/capture.js";
import { validatePayload } from "../helpers/schema-contract.js";

const identity = (sequence: number, captureId = "capture-1"): RuntimeCaptureIdentity => ({
  captureId,
  navigationId: "navigation-1",
  realmId: "realm-1",
  sequence,
});

const report = (sequence = 0, captureId = "capture-1") => {
  const value = { traceId: "trace-1", outcome: "runtime-loaded" };
  const recordIdentity = identity(sequence, captureId);
  return {
    id: runtimeCaptureRecordId("observability", recordIdentity, value),
    identity: recordIdentity,
    source: "observability" as const,
    capturedAt: 123,
    contentDigest: runtimeCaptureContentDigest(value),
    provenance: {
      collector: { name: "test-capture", version: "1" },
      inputKind: "observability-report",
      source: "official-observability",
      sourceSchemaVersion: "2.5",
    },
    completeness: { status: "complete" as const, reason: "fixture is complete" },
    provenanceRefs: ["scope:top-page"],
    value,
  };
};

const envelope = (): RuntimeCaptureEnvelope => ({
  schemaVersion: 1,
  contractVersion: RUNTIME_CAPTURE_CONTRACT_VERSION,
  collector: { name: "test-capture", version: "1" },
  transport: "file",
  captureId: "capture-1",
  capabilities: {
    observations: [
      {
        capability: "exact",
        reason: "official report fixture",
        source: "observability",
        scope: "top-page",
        priority: 1,
        sourceSchemaVersion: "2.5",
        runtimeVersion: "2.5.3",
      },
    ],
  },
  limits: DEFAULT_RUNTIME_CAPTURE_LIMITS,
  truncation: [],
  reports: [report()],
  events: [],
  devtools: [],
  snapshots: [],
  instances: [],
  network: [],
  errors: [],
  relations: [],
});

describe("runtime capture contract", () => {
  it("keeps safe defaults below hard ceilings", () => {
    expect(DEFAULT_RUNTIME_CAPTURE_LIMITS.maxBytes).toBeLessThanOrEqual(
      HARD_RUNTIME_CAPTURE_LIMITS.maxBytes,
    );
  });

  it("validates populated TypeScript and JSON schema parity", async () => {
    const value = envelope();
    validateRuntimeCaptureEnvelope(value);
    await validatePayload("runtime-capture.schema.json", value, "capture fixture");
  });

  it("keeps schema collections discriminated and provenance required", async () => {
    const wrongCollection = envelope();
    wrongCollection.reports = [
      { ...report(), source: "error" } as unknown as (typeof wrongCollection.reports)[number],
    ];
    await expect(
      validatePayload("runtime-capture.schema.json", wrongCollection, "wrong collection"),
    ).rejects.toThrow("Schema validation failed");
    const missingProvenance = envelope();
    missingProvenance.reports = [
      { ...report(), provenance: { ...report().provenance, source: "" } },
    ];
    await expect(
      validatePayload("runtime-capture.schema.json", missingProvenance, "missing provenance"),
    ).rejects.toThrow("Schema validation failed");
  });

  it("rejects future, zero-limit, oversized, deep, wide, and private values", () => {
    expect(() => validateRuntimeCaptureEnvelope({ ...envelope(), contractVersion: 2 })).toThrow(
      "unsupported capture contract version",
    );
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        limits: { ...DEFAULT_RUNTIME_CAPTURE_LIMITS, maxDepth: 0 },
      }),
    ).toThrow("must be positive");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [{ ...report(), value: { traceId: "x".repeat(27 * 1024 * 1024) } }],
      }),
    ).toThrow("maxStringLength");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [{ ...report(), value: { rawStack: "secret" } }],
      }),
    ).toThrow("forbidden");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [{ ...report(), value: { authorization: "Bearer secret" } }],
      }),
    ).toThrow("forbidden");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [
          { ...report(), value: { traceId: "https://user:pass@example.test/a?token=secret" } },
        ],
      }),
    ).toThrow("canonically redacted");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [{ ...report(), value: { traceId: "/Users/alice/project/main.ts" } }],
      }),
    ).toThrow("canonically redacted");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        errors: [{ ...report(), source: "error", value: { message: "token=secret" } } as never],
      }),
    ).toThrow("canonically redacted");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        errors: [{ ...report(), source: "error", value: { message: 42 } } as never],
      }),
    ).toThrow("must be a string");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        errors: [
          { ...report(), source: "error", value: { message: "x".repeat(16 * 1024 + 1) } } as never,
        ],
      }),
    ).toThrow("maxDiagnosisStringLength");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [
          {
            ...report(),
            value: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, "v"])),
          },
        ],
      }),
    ).toThrow("maxObjectKeys");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [{ ...report(), value: { network: "not a report" } }],
      }),
    ).toThrow("not allowed for observability");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [{ ...report(), value: { deep: { deeper: { deepest: "x" } } } }],
      }),
    ).toThrow("not allowed");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        limits: { ...DEFAULT_RUNTIME_CAPTURE_LIMITS, maxDepth: 2 },
        reports: [{ ...report(), value: { moduleInfoNames: [["nested"]] } }],
      }),
    ).toThrow("maxDepth");
  });

  it("rejects collection confusion, cross-capture records, duplicate sequences, and dangling relations", () => {
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        errors: [{ ...report(), source: "observability" }],
      }),
    ).toThrow("wrong source");
    expect(() =>
      validateRuntimeCaptureEnvelope({ ...envelope(), reports: [report(0, "other-capture")] }),
    ).toThrow("crosses captureId");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [
          report(),
          (() => {
            const duplicate = { ...report(), value: { traceId: "other" } };
            duplicate.contentDigest = runtimeCaptureContentDigest(duplicate.value);
            duplicate.id = runtimeCaptureRecordId(
              "observability",
              duplicate.identity,
              duplicate.value,
            );
            return duplicate;
          })(),
        ],
      }),
    ).toThrow("duplicate realm sequence");
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        relations: [
          { id: "r", from: "missing", to: "missing", relation: "exact-id", reason: "bad" },
        ],
      }),
    ).toThrow("dangling relation");
  });

  it("orders sequence checks independently of collection order", () => {
    const value = envelope();
    value.reports = [report(2)];
    value.events = [report(1)];
    expect(() => validateRuntimeCaptureEnvelope(value)).not.toThrow();
  });

  it("does not execute hostile proxy or getter-backed values", () => {
    const getterValue = {
      get traceId() {
        throw new Error("getter ran");
      },
    };
    expect(() =>
      validateRuntimeCaptureEnvelope({
        ...envelope(),
        reports: [{ ...report(), value: getterValue }],
      }),
    ).toThrow("own data property");
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("proxy ran");
        },
      },
    );
    expect(() =>
      validateRuntimeCaptureEnvelope({ ...envelope(), reports: [{ ...report(), value: hostile }] }),
    ).toThrow("cannot be safely read");
  });

  it("keeps capture separate from the default app-facing export", async () => {
    const packageJson = (await import("../../package.json", { with: { type: "json" } }))
      .default as {
      exports: Record<string, unknown>;
    };
    const defaultIndex = await import("../../src/index.js");
    expect(packageJson.exports["./capture"]).toBeDefined();
    expect(defaultIndex).not.toHaveProperty("validateRuntimeCaptureEnvelope");
  });
});
