import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HARD_RUNTIME_CAPTURE_LIMITS,
  validateRuntimeCaptureEnvelope,
} from "../../src/runtime-capture-contract.js";
import {
  captureRuntimeBrowserExport,
  importRuntimeCaptureFallback,
  importRuntimeCaptureNetworkFallback,
} from "../../src/runtime-capture-transports.js";
import * as captureEntry from "../../src/capture.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function source(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function lineCount(relativePath: string): number {
  return source(relativePath).split("\n").length;
}

describe("runtime capture file-import vs unused transports", () => {
  it("keeps the mfdoctor runtime file-import path on the smaller contract module", () => {
    const runtimeTrace = source("src/runtime-trace.ts");
    expect(runtimeTrace).toMatch(/from "\.\/runtime-capture-contract\.js"/);
    expect(runtimeTrace).not.toMatch(/from "\.\/capture\.js"/);
    expect(runtimeTrace).not.toMatch(/from "\.\/runtime-capture-file\.js"/);
    expect(runtimeTrace).not.toMatch(/from "\.\/runtime-capture-transports\.js"/);

    const contract = source("src/runtime-capture-contract.ts");
    expect(contract).not.toMatch(/captureRuntimeBrowserExport/);
    expect(contract).not.toMatch(/importRuntimeCaptureFallback/);
    expect(contract).not.toMatch(/importRuntimeCaptureNetworkFallback/);
    expect(contract).not.toMatch(/evaluate\(|page\.evaluate|addScriptTag|injectScript/);
    expect(lineCount("src/runtime-capture-contract.ts")).toBeLessThan(1300);
    expect(lineCount("src/runtime-capture-contract.ts")).toBeLessThan(
      lineCount("src/runtime-capture-transports.ts"),
    );
    expect(typeof validateRuntimeCaptureEnvelope).toBe("function");
    expect(HARD_RUNTIME_CAPTURE_LIMITS.maxBytes).toBeGreaterThan(0);
  });

  it("isolates unused transports with tests and does not inject an in-browser doctor", async () => {
    const transports = source("src/runtime-capture-transports.ts");
    expect(transports).not.toMatch(/evaluate\(|page\.evaluate|addScriptTag|injectScript/);
    expect(typeof captureRuntimeBrowserExport).toBe("function");
    expect(typeof importRuntimeCaptureFallback).toBe("function");
    expect(typeof importRuntimeCaptureNetworkFallback).toBe("function");

    const fallback = importRuntimeCaptureFallback(
      {
        runtimeVersion: "2.5.0",
        moduleInfo: { totalCount: 0, entries: [] },
        instances: [],
      },
      { captureId: "split-fallback" },
    );
    validateRuntimeCaptureEnvelope(fallback);
    expect(fallback.transport).toBe("browser-debug");

    const network = importRuntimeCaptureNetworkFallback(
      { errors: [{ code: "RUNTIME-007", message: "remote entry failed" }] },
      { captureId: "split-network" },
    );
    validateRuntimeCaptureEnvelope(network);
    expect(network.errors).toHaveLength(1);
  });

  it("keeps the public capture entry as a re-export barrel", () => {
    expect(lineCount("src/capture.ts")).toBeLessThan(120);
    expect(typeof captureEntry.validateRuntimeCaptureEnvelope).toBe("function");
    expect(typeof captureEntry.loadRuntimeCaptureExportFile).toBe("function");
    expect(typeof captureEntry.captureRuntimeBrowserExport).toBe("function");
    expect(typeof captureEntry.importRuntimeCaptureFallback).toBe("function");
    expect(typeof captureEntry.importRuntimeCaptureNetworkFallback).toBe("function");
  });
});
