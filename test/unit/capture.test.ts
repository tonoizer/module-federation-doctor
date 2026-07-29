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
        capabilityKind: "reports",
        state: "exact",
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

  it("rejects schema-invalid fields in both the runtime parser and AJV", async () => {
    const networkValue = { url: "https://cdn.example.test/mf-manifest.json", kind: "manifest" };
    const networkIdentity = { ...identity(1) };
    const networkRecord = {
      id: runtimeCaptureRecordId("network", networkIdentity, networkValue),
      identity: networkIdentity,
      source: "network" as const,
      capturedAt: 123,
      contentDigest: runtimeCaptureContentDigest(networkValue),
      provenance: {
        collector: { name: "test-capture", version: "1" },
        inputKind: "network-record",
        source: "official-network",
        sourceSchemaVersion: "1",
      },
      completeness: { status: "complete" as const, reason: "fixture is complete" },
      value: networkValue,
    };
    const cases: Array<[string, (value: RuntimeCaptureEnvelope) => void]> = [
      [
        "loadedBefore type",
        (value) =>
          ((value.reports[0]!.value as unknown as Record<string, unknown>).loadedBefore = "yes"),
      ],
      [
        "runtimeVersion type",
        (value) =>
          ((value.reports[0]!.value as unknown as Record<string, unknown>).runtimeVersion = 42),
      ],
      [
        "network kind enum",
        (value) => {
          value.network = [
            { ...networkRecord, value: { ...networkValue, kind: "made-up" } } as never,
          ];
        },
      ],
      ["empty provenance ref", (value) => (value.reports[0]!.provenanceRefs = [""])],
    ];
    for (const [label, mutate] of cases) {
      const value = envelope();
      mutate(value);
      expect(() => validateRuntimeCaptureEnvelope(value), label).toThrow();
      await expect(validatePayload("runtime-capture.schema.json", value, label)).rejects.toThrow(
        "Schema validation failed",
      );
    }
  });

  it("keeps capability kind, state, and source claims in runtime/schema parity", async () => {
    const allowedSources = {
      reports: ["observability"],
      "shared-lifecycle": ["observability"],
      snapshot: ["snapshot"],
      instance: ["instance"],
      "network-error": ["network", "error"],
      devtools: ["devtools"],
    } as const;
    const states = ["exact", "partial", "unavailable", "not-applicable", "unknown"] as const;
    const sources = [
      "observability",
      "devtools",
      "snapshot",
      "instance",
      "network",
      "error",
    ] as const;

    for (const [capabilityKind, permitted] of Object.entries(allowedSources)) {
      for (const state of states) {
        for (const source of sources) {
          const value = envelope();
          value.capabilities.observations[0] = {
            ...value.capabilities.observations[0]!,
            capabilityKind:
              capabilityKind as (typeof value.capabilities.observations)[number]["capabilityKind"],
            state,
            source,
            priority: (
              {
                observability: 1,
                devtools: 2,
                snapshot: 3,
                instance: 3,
                network: 4,
                error: 4,
              } as const
            )[source],
          };
          const allowed = (permitted as readonly string[]).includes(source);
          if (allowed) {
            expect(
              () => validateRuntimeCaptureEnvelope(value),
              `${capabilityKind}/${state}/${source}`,
            ).not.toThrow();
            await expect(
              validatePayload("runtime-capture.schema.json", value, "capability parity"),
            ).resolves.toBeUndefined();
          } else {
            expect(
              () => validateRuntimeCaptureEnvelope(value),
              `${capabilityKind}/${state}/${source}`,
            ).toThrow("is invalid");
            await expect(
              validatePayload("runtime-capture.schema.json", value, "capability parity"),
            ).rejects.toThrow("Schema validation failed");
          }
        }
      }
    }
  });

  it("keeps 4096-character envelope strings in runtime/schema parity", async () => {
    const boundary = "x".repeat(4096);
    const over = "x".repeat(4097);
    const fields: Array<[string, (value: RuntimeCaptureEnvelope, text: string) => void, boolean]> =
      [
        [
          "captureId",
          (value, text) => {
            value.captureId = text;
            value.reports[0]!.identity.captureId = text;
            value.reports[0]!.id = runtimeCaptureRecordId(
              "observability",
              value.reports[0]!.identity,
              value.reports[0]!.value as never,
            );
          },
          true,
        ],
        ["collector name", (value, text) => (value.collector.name = text), true],
        ["collector version", (value, text) => (value.collector.version = text), true],
        [
          "truncation reason",
          (value, text) => (value.truncation = [{ collection: "total", dropped: 1, reason: text }]),
          true,
        ],
        [
          "relation id",
          (value, text) =>
            (value.relations = [
              {
                id: text,
                from: value.reports[0]!.id,
                to: value.reports[0]!.id,
                relation: "exact-id",
                reason: "linked",
              },
            ]),
          true,
        ],
        [
          "relation from",
          (value, text) =>
            (value.relations = [
              {
                id: "relation",
                from: text,
                to: value.reports[0]!.id,
                relation: "exact-id",
                reason: "linked",
              },
            ]),
          false,
        ],
        [
          "relation to",
          (value, text) =>
            (value.relations = [
              {
                id: "relation",
                from: value.reports[0]!.id,
                to: text,
                relation: "exact-id",
                reason: "linked",
              },
            ]),
          false,
        ],
        [
          "relation reason",
          (value, text) =>
            (value.relations = [
              {
                id: "relation",
                from: value.reports[0]!.id,
                to: value.reports[0]!.id,
                relation: "exact-id",
                reason: text,
              },
            ]),
          true,
        ],
      ];
    for (const [label, mutate, acceptsBoundary] of fields) {
      const accepted = envelope();
      mutate(accepted, boundary);
      if (acceptsBoundary) {
        expect(() => validateRuntimeCaptureEnvelope(accepted), `${label} 4096`).not.toThrow();
        await expect(
          validatePayload("runtime-capture.schema.json", accepted, `${label} 4096`),
        ).resolves.toBeUndefined();
      }

      const rejected = envelope();
      mutate(rejected, over);
      expect(() => validateRuntimeCaptureEnvelope(rejected), `${label} 4097`).toThrow(
        "maxStringLength",
      );
      await expect(
        validatePayload("runtime-capture.schema.json", rejected, `${label} 4097`),
      ).rejects.toThrow("Schema validation failed");
    }
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

  it("keeps navigation and realm tuple scopes collision-safe", () => {
    const first = report(2);
    first.identity.navigationId = "a";
    first.identity.realmId = "b:c";
    first.id = runtimeCaptureRecordId("observability", first.identity, first.value);
    const second = report(1);
    second.identity.navigationId = "a:b";
    second.identity.realmId = "c";
    second.id = runtimeCaptureRecordId("observability", second.identity, second.value);
    const value = envelope();
    value.reports = [first, second];
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
