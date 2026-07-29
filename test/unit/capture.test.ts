import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_CAPTURE_LIMITS,
  HARD_RUNTIME_CAPTURE_LIMITS,
  RUNTIME_CAPTURE_CONTRACT_VERSION,
  type RuntimeCaptureEnvelope,
} from "../../src/capture.js";
import { validatePayload } from "../helpers/schema-contract.js";

const envelope: RuntimeCaptureEnvelope = {
  schemaVersion: 1,
  contractVersion: RUNTIME_CAPTURE_CONTRACT_VERSION,
  collector: { name: "test-capture", version: "1" },
  transport: "file",
  captureId: "capture-1",
  capabilities: {
    reports: { state: "unavailable", reason: "fixture has no report reader" },
    sharedLifecycle: { state: "unknown", reason: "runtime version was not supplied" },
    snapshot: { state: "not-applicable", reason: "no page was attached" },
    instance: { state: "unavailable", reason: "fixture is file-only" },
    networkError: { state: "not-applicable", reason: "no browser transport" },
  },
  limits: DEFAULT_RUNTIME_CAPTURE_LIMITS,
  truncation: [],
  reports: [],
  events: [],
  devtools: [],
  snapshots: [],
  instances: [],
  network: [],
  errors: [],
  relations: [],
};

describe("runtime capture contract", () => {
  it("keeps safe defaults below hard ceilings", () => {
    expect(DEFAULT_RUNTIME_CAPTURE_LIMITS.maxBytes).toBeLessThanOrEqual(
      HARD_RUNTIME_CAPTURE_LIMITS.maxBytes,
    );
    expect(DEFAULT_RUNTIME_CAPTURE_LIMITS.maxReports).toBe(HARD_RUNTIME_CAPTURE_LIMITS.maxReports);
  });

  it("validates the bounded external handoff schema", async () => {
    await validatePayload("runtime-capture.schema.json", envelope, "capture fixture");
  });

  it("rejects an unknown capture contract version", async () => {
    await expect(
      validatePayload(
        "runtime-capture.schema.json",
        { ...envelope, contractVersion: 2 },
        "future capture",
      ),
    ).rejects.toThrow("Schema validation failed");
  });
});
