import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schemasDir = path.join(root, "schemas");

/** Schemas that are programmatic contracts (not persisted CLI artifacts). */
const PROGRAMMATIC_SCHEMA_FILES = new Set(["ui.schema.json"]);

export type SchemaKind = "artifact" | "programmatic";

export type SchemaContract = {
  file: string;
  export: string;
  kind: SchemaKind;
};

type JsonSchemaDocument = {
  title?: string;
  required?: string[];
  properties?: {
    schemaVersion?: { const?: unknown };
    protocol?: { $ref?: string };
  };
  $defs?: {
    protocol?: { properties?: { schemaVersion?: { const?: unknown } } };
  };
};

type SchemaAjv = InstanceType<typeof Ajv2020>;

let ajv: SchemaAjv | undefined;
const validators = new Map<string, ValidateFunction>();
const validatorPromises = new Map<string, Promise<ValidateFunction>>();

async function loadSchema(fileName: string): Promise<JsonSchemaDocument> {
  const text = await fs.readFile(path.join(schemasDir, fileName), "utf8");
  return JSON.parse(text) as JsonSchemaDocument;
}

function createAjv(): SchemaAjv {
  const instance = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateSchema: true,
  });
  addFormats(instance);
  return instance;
}

async function validatorFor(fileName: string): Promise<ValidateFunction> {
  let validate = validators.get(fileName);
  if (!validate) {
    let pending = validatorPromises.get(fileName);
    if (!pending) {
      pending = (async () => {
        if (!ajv) ajv = createAjv();
        const schema = await loadSchema(fileName);
        return ajv!.compile(schema);
      })();
      validatorPromises.set(fileName, pending);
    }
    validate = await pending;
    validators.set(fileName, validate);
  }
  return validate;
}

/** Discover shipped schemas; kind is the only non-schema metadata we keep. */
export async function listSchemaContracts(): Promise<SchemaContract[]> {
  const files = (await fs.readdir(schemasDir))
    .filter((file) => file.endsWith(".schema.json"))
    .sort();
  return files.map((file) => ({
    file,
    export: `./schemas/${file}`,
    kind: PROGRAMMATIC_SCHEMA_FILES.has(file) ? "programmatic" : "artifact",
  }));
}

export async function validatePayload(
  fileName: string,
  payload: unknown,
  label = fileName,
): Promise<void> {
  const validate = await validatorFor(fileName);
  if (validate(payload)) return;
  const details = (validate.errors ?? [])
    .map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
    .join("\n");
  throw new Error(`Schema validation failed for ${label}:\n${details}`);
}

/**
 * Bidirectional sync: every `schemas/*.schema.json` is exported, and every
 * `package.json#exports` schema path maps to a real file. Shape / required
 * fields are owned by the JSON Schema + AJV (and emitter unit tests).
 */
export async function assertPackageExportsMatchSchemas(): Promise<void> {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as {
    exports?: Record<string, unknown>;
  };
  const exportsMap = packageJson.exports ?? {};
  const contracts = await listSchemaContracts();
  const schemaFiles = contracts.map((contract) => contract.file);

  const exportedSchemaFiles = Object.keys(exportsMap)
    .filter((key) => key.startsWith("./schemas/") && key.endsWith(".schema.json"))
    .map((key) => key.slice("./schemas/".length))
    .sort();
  assert.deepEqual(
    exportedSchemaFiles,
    [...schemaFiles].sort(),
    "package.json#exports schema paths must match schemas/ directory",
  );

  for (const contract of contracts) {
    assert.equal(
      exportsMap[contract.export],
      contract.export,
      `package.json must export ${contract.export}`,
    );
    const schema = await loadSchema(contract.file);
    assert.equal(typeof schema.title, "string", `${contract.file} must declare a title`);
    assert.ok((schema.title ?? "").length > 0, `${contract.file} title must be non-empty`);
    const schemaVersion =
      schema.properties?.schemaVersion?.const ??
      schema.$defs?.protocol?.properties?.schemaVersion?.const;
    assert.ok(
      schemaVersion === 1 || schemaVersion === 2,
      `${contract.file} must declare a supported schema version`,
    );
  }
}

/** Representative on-disk fixtures for pack:check (no Doctor runtime required). */
export async function validateFixturePayloads(): Promise<void> {
  const evidence: unknown = JSON.parse(
    await fs.readFile(path.join(root, "examples/evidence/v2-conflict.json"), "utf8"),
  );
  await validatePayload("evidence.schema.json", evidence, "examples/evidence/v2-conflict.json");

  const projectFixtures = [
    "examples/showcase/federation/version-conflict/host.project.json",
    "examples/showcase/runtime/green/host.project.json",
    "fixtures/workspaces/clean/host/.mf/doctor/project.json",
  ];
  for (const relativePath of projectFixtures) {
    const payload: unknown = JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
    await validatePayload("project.schema.json", payload, relativePath);
  }

  await validatePayload(
    "report.schema.json",
    {
      schemaVersion: 1,
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      summary: { projects: 1, info: 0, warnings: 1, errors: 0 },
      findings: [
        {
          schemaVersion: 1,
          ruleId: "shared/version-conflict",
          severity: "warning",
          message: "shared react versions diverge",
          project: "host",
          evidence: { package: "react" },
          fingerprint: "fp-demo",
        },
      ],
    },
    "representative report",
  );

  await validatePayload(
    "baseline.schema.json",
    {
      schemaVersion: 1,
      entries: [
        {
          fingerprint: "fp-demo",
          ruleId: "config/name-required",
          project: "host",
        },
      ],
    },
    "representative baseline",
  );

  await validatePayload(
    "probe.schema.json",
    {
      schemaVersion: 1,
      manifest: {
        url: "https://cdn.example.com/mf-manifest.json",
        status: 200,
        bytes: 128,
        name: "checkout",
        exposes: 1,
        shared: 1,
        remotes: 0,
        remoteEntry: "https://cdn.example.com/remoteEntry.js",
      },
      remoteEntry: {
        url: "https://cdn.example.com/remoteEntry.js",
        status: 200,
        contentType: "text/javascript",
        contentLength: 42,
      },
    },
    "representative probe",
  );

  await validatePayload(
    "runtime-trace.schema.json",
    {
      schemaVersion: 1,
      traces: 1,
      projects: 1,
      findings: 0,
    },
    "representative runtime-trace summary",
  );

  await validatePayload(
    "runtime-capture.schema.json",
    {
      schemaVersion: 1,
      contractVersion: 1,
      collector: { name: "schema-check", version: "1" },
      transport: "file",
      captureId: "capture-schema-check",
      capabilities: {
        observations: [
          {
            capabilityKind: "reports",
            state: "unavailable",
            reason: "file fixture",
            source: "observability",
            scope: "none",
            priority: 1,
            sourceSchemaVersion: "1",
          },
        ],
      },
      limits: {
        maxBytes: 5242880,
        maxReports: 100,
        maxEvents: 5000,
        maxSnapshots: 500,
        maxInstances: 100,
        maxNetworkRecords: 2000,
        maxErrors: 200,
        maxStringLength: 4096,
        maxDiagnosisStringLength: 16384,
        maxDepth: 12,
        maxObjectKeys: 100,
      },
      truncation: [],
      reports: [],
      events: [],
      devtools: [],
      snapshots: [],
      instances: [],
      network: [],
      errors: [],
      relations: [],
    },
    "representative runtime capture",
  );

  await validatePayload(
    "ui.schema.json",
    {
      schemaVersion: 1,
      report: { schemaVersion: 1 },
      projects: [{ schemaVersion: 1 }],
      graphs: {
        remotes: { nodes: [], edges: [] },
        shared: { nodes: [], edges: [] },
        orchestration: {
          nodes: [{ id: "project:host", label: "host", kind: "project" }],
          edges: [],
        },
      },
    },
    "representative ui payload",
  );
}

export async function runSchemaContractChecks(): Promise<void> {
  await assertPackageExportsMatchSchemas();
  await validateFixturePayloads();
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  await runSchemaContractChecks();
  process.stdout.write("Schema contract checks passed.\n");
}
