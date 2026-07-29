// Copy this file to packages/observability-plugin/__tests__/doctor-capture.spec.ts
// in the pinned module-federation/core checkout before running the provenance
// capture command. It calls the real upstream createObservability harness.
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "@rstest/core";
import { createObservability } from "../src";

const output = process.env.DOCTOR_CAPTURE_DIR;
if (!output) throw new Error("DOCTOR_CAPTURE_DIR is required");
fs.mkdirSync(output, { recursive: true });

const origin = { version: "2.5.0", options: { name: "host" } };

function start(observability: ReturnType<typeof createObservability>): void {
  observability.plugin.beforeRequest?.({ id: "remote/Button", options: {}, origin } as any);
}

async function loaded(observability: ReturnType<typeof createObservability>): Promise<void> {
  await observability.plugin.onLoad?.({
    id: "remote/Button",
    pkgNameOrAlias: "remote",
    expose: "./Button",
    remote: { name: "remote", entry: "http://localhost:3001/mf-manifest.json" },
    options: {},
    origin,
    exposeModule: {},
    moduleInstance: {},
  } as any);
}

describe("Doctor fixture capture", () => {
  it("serializes upstream loadRemote success", async () => {
    const observability = createObservability({ level: "verbose" });
    start(observability);
    await loaded(observability);
    fs.writeFileSync(
      path.join(output, "upstream-component-success.json"),
      `${JSON.stringify(observability.getLatestReport(), null, 2)}\n`,
    );
  });

  it("serializes upstream snapshot failure", () => {
    Reflect.set(globalThis, "__FEDERATION__", {
      moduleInfo: {
        "remote:http://localhost:3001/mf-manifest.json?token=secret#hash": {
          publicPath: "https://cdn.example.com/remote/?v=20260508#hash",
          getPublicPath: 'return "https://cdn.example.com/remote/?v=20260508#hash";',
          remoteEntry: "https://cdn.example.com/remote/remoteEntry.js?v=20260508#hash",
          globalName: "remote_global",
          modules: [{ moduleName: "Button", assets: { js: ["large.js"] } }],
          shared: [{ sharedName: "react", assets: { js: ["large.js"] } }],
        },
        unrelated: {
          publicPath: "https://cdn.example.com/unrelated/",
          modules: [{ moduleName: "Unused", assets: { js: ["unused.js"] } }],
          shared: [{ sharedName: "react", assets: { js: ["unused.js"] } }],
        },
      },
    });
    const observability = createObservability({ level: "verbose", console: false });
    start(observability);
    observability.plugin.errorLoadRemote?.({
      id: "remote/Button",
      error: new Error("[ Federation Runtime ]: Failed to get remote snapshot. #RUNTIME-007"),
      from: "runtime",
      lifecycle: "onLoad",
      expose: "./Button",
      remote: { name: "remote", entry: "http://localhost:3001/mf-manifest.json" },
      origin,
    } as any);
    fs.writeFileSync(
      path.join(output, "upstream-snapshot-failure.json"),
      `${JSON.stringify(observability.getLatestReport(), null, 2)}\n`,
    );
  });
});
