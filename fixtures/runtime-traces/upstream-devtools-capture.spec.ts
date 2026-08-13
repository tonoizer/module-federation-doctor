import { afterEach, describe, it, rs } from "@rstest/core";
import fs from "node:fs";
import path from "node:path";
import { readObservabilitySnapshot } from "../src/utils/chrome/observability";

const output = process.env.DOCTOR_CAPTURE_DIR;
if (!output) throw new Error("DOCTOR_CAPTURE_DIR is required");
fs.mkdirSync(output, { recursive: true });

describe("MFDoctor DevTools fixture capture", () => {
  afterEach(() => {
    rs.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
    Reflect.deleteProperty(window, "__FEDERATION__");
    window.targetTab = undefined as any;
    window.localStorage.clear();
  });

  it("serializes the pinned readObservabilitySnapshot partial report", async () => {
    window.targetTab = { id: 8080 } as chrome.tabs.Tab;
    Reflect.set(window, "__FEDERATION__", {
      __OBSERVABILITY__: {
        runtime_host: {
          getReports: () => [
            {
              traceId: "trace-unknown-version",
              status: "pending",
              startedAt: 1,
              updatedAt: 2,
              duration: 1,
              events: [],
            },
          ],
        },
      },
    } as any);

    const executeScript = rs.fn(async ({ func, args }) => [{ result: func(...args) }]);
    rs.stubGlobal("chrome", { scripting: { executeScript } });

    const snapshot = await readObservabilitySnapshot();
    fs.writeFileSync(
      path.join(output, "upstream-devtools-partial.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  });
});
