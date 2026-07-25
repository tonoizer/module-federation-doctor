import { createServer, type RequestListener, type Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SCHEMA_CONTRACTS,
  assertPackageExportsMatchSchemas,
  runSchemaContractChecks,
  validatePayload,
} from "../helpers/schema-contract.js";
import { generateBaseline } from "../../src/baseline.js";
import { probeManifest } from "../../src/probe.js";
import { writeReports } from "../../src/reporters.js";
import { analyzeRuntime } from "../../src/runtime-trace.js";
import { buildUiPayload, reportFromFindings } from "../../src/ui-graph.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

function project(
  name: string,
  federation?: NonNullable<ProjectFacts["moduleFederation"]>,
): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name, root: "." },
    bundler: { name: "vite", mode: "production" },
    capabilities: {
      config: true,
      sourceImports: false,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    ...(federation ? { moduleFederation: federation } : {}),
    dependencies: { declared: { react: "^18" }, installed: { react: "18.3.1" } },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: { emittedAssets: [] },
  };
}

async function serve(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address.");
  return `http://127.0.0.1:${address.port}`;
}

describe("published schema contracts", () => {
  it("keeps package exports, titles, and required fields aligned with shipped schemas", async () => {
    await runSchemaContractChecks();
    expect(SCHEMA_CONTRACTS.map((contract) => contract.file)).toEqual([
      "project.schema.json",
      "report.schema.json",
      "baseline.schema.json",
      "probe.schema.json",
      "runtime-trace.schema.json",
      "ui.schema.json",
    ]);
    expect(SCHEMA_CONTRACTS.find((contract) => contract.file === "ui.schema.json")?.kind).toBe(
      "programmatic",
    );
  });

  it("validates showcase and fixture project.json artifacts", async () => {
    await assertPackageExportsMatchSchemas();
    const files = [
      "examples/showcase/federation/version-conflict/host.project.json",
      "examples/showcase/runtime/green/host.project.json",
      "fixtures/workspaces/clean/host/.mf/doctor/project.json",
    ];
    for (const relativePath of files) {
      const payload: unknown = JSON.parse(await fs.readFile(path.resolve(relativePath), "utf8"));
      await validatePayload("project.schema.json", payload, relativePath);
    }
  });

  it("validates writeReports report.json against report.schema.json", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-schema-report-"));
    roots.push(output);
    const facts = project("demo");
    const findings: DoctorFinding[] = [
      {
        schemaVersion: 1,
        ruleId: "config/name-required",
        severity: "error",
        message: "name is required",
        project: "demo",
        evidence: {},
        documentation: "/rules/config/name-required",
        fingerprint: "abc",
      },
    ];
    const report = reportFromFindings([facts], findings);
    await writeReports(facts, report, output, ["json"]);
    const written: unknown = JSON.parse(
      await fs.readFile(path.join(output, "report.json"), "utf8"),
    );
    await validatePayload("report.schema.json", written, "report.json");
    await validatePayload("project.schema.json", facts, "facts");
  });

  it("validates generateBaseline output against baseline.schema.json", async () => {
    const baseline = generateBaseline([
      {
        schemaVersion: 1,
        ruleId: "config/name-required",
        severity: "error",
        message: "name is required",
        project: "host",
        evidence: {},
        fingerprint: "fp-1",
      },
    ]);
    await validatePayload("baseline.schema.json", baseline, "generateBaseline");
  });

  it("validates probeManifest result against probe.schema.json", async () => {
    const origin = await serve((request, response) => {
      if (request.url === "/remoteEntry.js") {
        response.writeHead(200, { "content-type": "text/javascript", "content-length": "42" });
        response.end();
        return;
      }
      const body = JSON.stringify({
        id: "checkout",
        name: "checkout",
        metaData: {
          publicPath: `${origin}/assets/`,
          remoteEntry: { path: "../remoteEntry.js", name: "remoteEntry.js" },
        },
        exposes: [{ name: "./Cart" }],
        shared: [{ name: "react" }],
        remotes: [],
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": body.length,
      });
      response.end(body);
    });

    const result = await probeManifest(`${origin}/mf-manifest.json`, { remoteEntry: true });
    await validatePayload("probe.schema.json", result, "probeManifest");
  });

  it("validates analyzeRuntime summary against runtime-trace.schema.json", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-schema-trace-"));
    roots.push(dir);
    const host = project("host", {
      name: "host",
      exposes: {},
      remotes: {
        checkout: {
          name: "checkout",
          entry: "https://cdn.example.com/checkout/mf-manifest.json",
          shareScope: ["default"],
        },
      },
      shared: {
        react: {
          package: "react",
          singleton: true,
          eager: false,
          requiredVersion: "^19.0.0",
          shareScope: ["default"],
        },
      },
    });
    const projectFile = path.join(dir, "project.json");
    await fs.writeFile(projectFile, `${JSON.stringify(host, null, 2)}\n`);
    const result = await analyzeRuntime({
      tracePath: path.resolve("fixtures/runtime-traces/healthy.json"),
      projectFiles: [projectFile],
      formats: [],
    });
    await validatePayload("runtime-trace.schema.json", result.summary, "analyzeRuntime.summary");
  });

  it("validates buildUiPayload against ui.schema.json (programmatic graph contract)", async () => {
    const host = project("host", {
      name: "host",
      exposes: {},
      remotes: {
        remote: {
          name: "remote",
          entry: "http://localhost:3001/mf-manifest.json",
          shareScope: ["default"],
        },
      },
      shared: {
        react: {
          package: "react",
          singleton: true,
          eager: false,
          shareScope: ["default"],
          requiredVersion: "^18",
        },
      },
      experiments: {
        asyncStartup: false,
        externalRuntime: true,
        provideExternalRuntime: false,
      },
    });
    const remote = project("remote-app", {
      name: "remote",
      exposes: { "./Button": "./src/Button.tsx" },
      remotes: {},
      shared: {
        react: {
          package: "react",
          singleton: true,
          eager: false,
          shareScope: ["default"],
          requiredVersion: "^18",
        },
      },
      experiments: {
        asyncStartup: false,
        externalRuntime: false,
        provideExternalRuntime: true,
      },
    });
    const report = reportFromFindings([host, remote], []);
    const ui = buildUiPayload([host, remote], report);
    await validatePayload("ui.schema.json", ui, "buildUiPayload");
  });
});
