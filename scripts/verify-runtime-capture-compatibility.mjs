import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const matrix = JSON.parse(
  await fs.readFile(path.join(root, "fixtures/runtime-capture-compatibility.json"), "utf8"),
);
const capture = await import(path.join(root, "dist/capture.js"));

assert.equal(matrix.schemaVersion, 1, "runtime capture compatibility schema must be v1");
assert.ok(Array.isArray(matrix.fileCases), "runtime capture file cases are required");

for (const testCase of matrix.fileCases) {
  const raw = JSON.parse(await fs.readFile(path.join(root, testCase.input), "utf8"));
  const input = testCase.wrapper === "node-file" ? { transport: "node-file", data: raw } : raw;
  assert.equal(
    capture.detectRuntimeCaptureExport(input),
    testCase.expectedKind,
    `${testCase.id}: detected export kind`,
  );
  const envelope = await capture.importRuntimeCaptureExport(input);
  assert.equal(envelope.transport, testCase.expectedTransport, `${testCase.id}: transport`);
  capture.validateRuntimeCaptureEnvelope(envelope);
  const serialized = JSON.stringify(envelope);
  for (const forbidden of testCase.forbiddenOutput ?? [])
    assert.ok(!serialized.includes(forbidden), `${testCase.id}: output leaked ${forbidden}`);
}

const preview = capture.importRuntimeCaptureFallback(
  {
    runtimeVersion: "2.6.0-canary.1",
    moduleInfo: {
      totalCount: 1,
      entries: [{ name: "remote", publicPath: "https://cdn.example.test/remote/" }],
    },
    instances: [{ name: "host", remoteNames: ["remote"], shareScopes: ["default"] }],
  },
  { captureId: "compat-preview" },
);
capture.validateRuntimeCaptureEnvelope(preview);
assert.equal(preview.snapshots.length, 1, "preview-runtime: snapshot projection");
assert.ok(
  ["unknown", "unavailable"].includes(
    preview.capabilities.observations.find((item) => item.capabilityKind === "shared-lifecycle")
      ?.state,
  ),
  "preview-runtime: shared lifecycle must remain unproven",
);

const disabled = capture.importRuntimeCaptureFallback(
  {
    disableSnapshot: true,
    moduleInfo: { entries: [{ name: "remote" }] },
  },
  { captureId: "compat-disabled" },
);
capture.validateRuntimeCaptureEnvelope(disabled);
assert.equal(disabled.snapshots.length, 0, "disabled-snapshot: no snapshot records");
assert.equal(
  disabled.capabilities.observations.find((item) => item.capabilityKind === "snapshot")?.state,
  "not-applicable",
  "disabled-snapshot: capability state",
);

const observabilityFixture = JSON.parse(
  await fs.readFile(path.join(root, "fixtures/runtime-traces/current-2.5.3.json"), "utf8"),
);
const browserCapture = async (realmId, reader) =>
  capture.captureRuntimeBrowserExport(
    {
      attach: async () => ({
        scope: {
          sessionId: `compat-${realmId}`,
          targetId: `target-${realmId}`,
          navigationId: "navigation-1",
          realmId,
          sourceScope: realmId,
        },
        readObservabilityExport: reader,
        close: () => undefined,
      }),
      launch: async () => {
        throw new Error("compatibility matrix uses attach only");
      },
    },
    {
      mode: "attach",
      target: { id: `target-${realmId}` },
      userApproved: true,
    },
  );

const frame = await browserCapture("frame-2", () => observabilityFixture);
assert.equal(frame.reports[0]?.identity.realmId, "frame-2", "browser-frame: realm identity");
const worker = await browserCapture("worker-0", () => observabilityFixture);
assert.equal(worker.reports[0]?.identity.realmId, "worker-0", "browser-worker: realm identity");

console.log(
  `Runtime capture compatibility checked ${matrix.fileCases.length + matrix.projectionCases.length} cases.`,
);
