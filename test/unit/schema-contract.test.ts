import { createServer, type RequestListener, type Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPackageExportsMatchSchemas,
  listSchemaContracts,
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
  it("keeps package exports aligned with shipped schemas", async () => {
    await assertPackageExportsMatchSchemas();
    const contracts = await listSchemaContracts();
    expect(contracts.map((contract) => contract.file)).toEqual([
      "baseline.schema.json",
      "capabilities.schema.json",
      "config.schema.json",
      "evidence.schema.json",
      "identity-correlation.schema.json",
      "identity-governance.schema.json",
      "identity.schema.json",
      "probe.schema.json",
      "project.schema.json",
      "report.schema.json",
      "rule-inventory.schema.json",
      "runtime-capture.schema.json",
      "runtime-identity-correlation.schema.json",
      "runtime-trace.schema.json",
      "ui.schema.json",
    ]);
    expect(contracts.find((contract) => contract.file === "ui.schema.json")?.kind).toBe(
      "programmatic",
    );
  });

  it("validates an identity contract", async () => {
    const identity = {
      schemaVersion: 1,
      kind: "application",
      key: "mfid:v1:application:0123456789abcdef01234567",
      parentKey: "mfid:v1:organization:0123456789abcdef01234567",
      organizationId: "acme",
      applicationId: "checkout",
      aliases: ["checkout"],
      completeness: "complete",
      confidence: "strong",
      provenance: { source: "config", evidenceIds: ["config-1"] },
    };
    await validatePayload("identity.schema.json", identity, "identity");
    await expect(
      validatePayload("identity.schema.json", { ...identity, kind: "container" }, "wrong kind"),
    ).rejects.toThrow("Schema validation failed");
    await expect(
      validatePayload("identity.schema.json", { ...identity, unexpected: true }, "extra field"),
    ).rejects.toThrow("Schema validation failed");
    for (const organizationId of [
      "/Users/alice/app",
      "file:///tmp/app",
      "https://user:pass@example.com/app",
      "https://example.com/app?token=secret",
      "2026-07-29T12:00:00Z",
      "process-123",
      "session-abc",
      "pROCESS-123",
      "SESSION-abc",
    ]) {
      await expect(
        validatePayload(
          "identity.schema.json",
          { ...identity, organizationId },
          "unsafe organizationId",
        ),
      ).rejects.toThrow("Schema validation failed");
    }
    await validatePayload(
      "identity.schema.json",
      { ...identity, organizationId: "2026-07-29-build" },
      "stable date-prefixed organizationId",
    );
    await expect(
      validatePayload(
        "identity.schema.json",
        { ...identity, containerName: "wrong-kind" },
        "wrong kind field",
      ),
    ).rejects.toThrow("Schema validation failed");
    await expect(
      validatePayload(
        "identity.schema.json",
        { ...identity, artifactKind: "remote-entry" },
        "foreign artifact field",
      ),
    ).rejects.toThrow("Schema validation failed");
    await expect(
      validatePayload(
        "identity.schema.json",
        { ...identity, aliases: ["prefixHTTPS://credentials"] },
        "unsafe alias",
      ),
    ).rejects.toThrow("Schema validation failed");
    const adapterTarget = {
      ...identity,
      kind: "adapter-target",
      key: "mfid:v1:adapter-target:0123456789abcdef01234567",
      parentKey: "mfid:v1:container:0123456789abcdef01234567",
      containerName: "shop",
      adapter: "vite",
      bundler: "vite",
      target: "browser",
      bundlerVersion: "8",
      mode: "production",
      buildEnvironment: "prod",
    };
    await validatePayload("identity.schema.json", adapterTarget, "adapter optional fields");
    await expect(
      validatePayload(
        "identity.schema.json",
        { ...identity, bundlerVersion: "wrong-kind" },
        "wrong optional field",
      ),
    ).rejects.toThrow("Schema validation failed");
  });

  it("validates additive identity correlation contracts", async () => {
    const edge = {
      schemaVersion: 1,
      id: "mfedge:v1:0123456789abcdef01234567",
      kind: "producer",
      fromKey: "mfid:v1:application:0123456789abcdef01234567",
      toKey: "mfid:v1:container:0123456789abcdef01234567",
      scope: { target: "browser" },
      outcome: "exact",
      completeness: "complete",
      evidenceIds: ["config-1"],
    };
    const correlation = {
      schemaVersion: 1,
      subjectKey: "mfid:v1:application:0123456789abcdef01234567",
      subjectKind: "application",
      outcome: "ambiguous",
      candidateKeys: ["mfid:v1:application:fedcba9876543210fedcba98"],
      candidates: [
        {
          identityKey: "mfid:v1:application:fedcba9876543210fedcba98",
          kind: "application",
          outcome: "strong",
          matchedDimensions: ["parentKey"],
          missingDimensions: ["applicationId"],
          conflicts: [],
        },
      ],
      matchedDimensions: [],
      missingDimensions: ["applicationId"],
      conflicts: [],
      reason: "multiple candidates share the strongest available evidence",
      truncated: false,
    };
    const coverage = {
      schemaVersion: 1,
      scope: { target: "browser" },
      expectedKinds: ["producer", "consumer"],
      observedKinds: ["producer"],
      missingKinds: ["consumer"],
      weakKinds: [],
      unresolvedKinds: [],
      observedEdges: 1,
      state: "partial",
      reason:
        "some capability evidence is missing, weak, ambiguous, or incomplete in the requested scope",
    };
    await validatePayload("identity-correlation.schema.json", edge, "identity edge");
    await validatePayload("identity-correlation.schema.json", correlation, "identity correlation");
    await validatePayload("identity-correlation.schema.json", coverage, "identity coverage");
    await expect(
      validatePayload(
        "identity-correlation.schema.json",
        { ...edge, unexpected: true },
        "extra field",
      ),
    ).rejects.toThrow("Schema validation failed");
  });

  it("validates additive identity governance contracts", async () => {
    const rule = {
      schemaVersion: 1,
      id: "owner-checkout",
      responsibility: "consumer",
      owner: "team/checkout",
      selector: {
        identityKey: "mfid:v1:application:0123456789abcdef01234567",
      },
      priority: 0,
      evidenceIds: ["governance-1"],
      completeness: "complete",
    };
    const resolution = {
      schemaVersion: 1,
      subjectKey: "mfid:v1:application:0123456789abcdef01234567",
      subjectKind: "application",
      outcome: "resolved",
      owners: ["team/checkout"],
      responsibilities: ["consumer"],
      candidateRuleIds: ["owner-checkout"],
      matchedRuleIds: ["owner-checkout"],
      evidenceIds: ["governance-1"],
      completeness: "complete",
      incompleteRuleIds: [],
      missing: [],
      conflicts: [],
      reason: "one highest-precedence governance responsibility resolved",
    };
    await validatePayload("identity-governance.schema.json", rule, "governance rule");
    await validatePayload("identity-governance.schema.json", resolution, "governance resolution");
    await expect(
      validatePayload(
        "identity-governance.schema.json",
        { ...rule, owner: "https://example.com/team" },
        "unsafe owner",
      ),
    ).rejects.toThrow("Schema validation failed");
  });

  it("validates runtime identity projections", async () => {
    const projection = {
      schemaVersion: 1,
      captureId: "capture-schema-check",
      deploymentKey: "mfid:v1:deployment:0123456789abcdef01234567",
      scope: {
        target: "browser",
        realm: "iframe",
        environmentKey: "mfid:v1:environment:fedcba9876543210fedcba98",
      },
      realm: {
        schemaVersion: 1,
        kind: "runtime-realm",
        key: "mfid:v1:runtime-realm:0123456789abcdef01234567",
        aliases: [],
        completeness: "complete",
        confidence: "exact",
        provenance: { source: "runtime", evidenceIds: [] },
        parentKey: "mfid:v1:deployment:0123456789abcdef01234567",
        deploymentKey: "mfid:v1:deployment:0123456789abcdef01234567",
        realm: "iframe",
        realmId: "frame-1",
      },
      instance: {
        schemaVersion: 1,
        kind: "runtime-instance",
        key: "mfid:v1:runtime-instance:fedcba9876543210fedcba98",
        aliases: [],
        completeness: "complete",
        confidence: "exact",
        provenance: { source: "runtime", evidenceIds: [] },
        parentKey: "mfid:v1:runtime-realm:0123456789abcdef01234567",
        realmKey: "mfid:v1:runtime-realm:0123456789abcdef01234567",
        runtimeInstanceId: "instance-1",
        runtimePackage: "@module-federation/runtime",
        runtimeVersion: "2.5.3",
        occurrenceId: "instance-1",
      },
      outcome: "exact",
      completeness: "complete",
      confidence: "exact",
      missing: [],
      reason: "explicit deployment, realm, instance, package, and version evidence projected",
    };
    await validatePayload(
      "runtime-identity-correlation.schema.json",
      projection,
      "runtime identity projection",
    );
    await expect(
      validatePayload(
        "runtime-identity-correlation.schema.json",
        { ...projection, instance: { ...projection.instance, unexpected: true } },
        "runtime identity extra field",
      ),
    ).rejects.toThrow("Schema validation failed");
  });

  it("validates showcase and fixture project.json artifacts", async () => {
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
