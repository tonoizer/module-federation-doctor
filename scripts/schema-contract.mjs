import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = path.join(root, "schemas");

/**
 * Public v1 schema contracts shipped via package.json exports.
 * Titles, export paths, and top-level `required` must stay in sync with
 * `schemas/*.schema.json` or pack:check / unit tests fail.
 */
export const SCHEMA_CONTRACTS = [
  {
    file: "project.schema.json",
    export: "./schemas/project.schema.json",
    title: "Module Federation Doctor project facts",
    required: [
      "schemaVersion",
      "project",
      "bundler",
      "capabilities",
      "dependencies",
      "imports",
      "artifacts",
    ],
    kind: "artifact",
  },
  {
    file: "report.schema.json",
    export: "./schemas/report.schema.json",
    title: "Module Federation Doctor report",
    required: ["schemaVersion", "capabilities", "summary", "findings"],
    kind: "artifact",
  },
  {
    file: "baseline.schema.json",
    export: "./schemas/baseline.schema.json",
    title: "Module Federation Doctor fingerprint baseline",
    required: ["schemaVersion", "entries"],
    kind: "artifact",
  },
  {
    file: "probe.schema.json",
    export: "./schemas/probe.schema.json",
    title: "Module Federation Doctor manifest probe result",
    required: ["schemaVersion", "manifest"],
    kind: "artifact",
  },
  {
    file: "runtime-trace.schema.json",
    export: "./schemas/runtime-trace.schema.json",
    title: "Module Federation Doctor runtime trace correlation summary",
    required: ["schemaVersion", "traces", "projects", "findings"],
    kind: "artifact",
  },
  {
    file: "ui.schema.json",
    export: "./schemas/ui.schema.json",
    title: "Module Federation Doctor UI payload",
    required: ["schemaVersion", "report", "projects", "graphs"],
    kind: "programmatic",
    note: "Programmatic graph payload from buildUiPayload; not a persisted CLI artifact. Related: HTML UI retirement (#59 / #131).",
  },
];

let ajv;
const validators = new Map();

async function loadSchema(fileName) {
  const text = await fs.readFile(path.join(schemasDir, fileName), "utf8");
  return JSON.parse(text);
}

function createAjv() {
  const instance = new Ajv2020({
    allErrors: true,
    strict: true,
    validateSchema: false,
  });
  addFormats(instance);
  return instance;
}

async function validatorFor(fileName) {
  if (!validators.has(fileName)) {
    if (!ajv) ajv = createAjv();
    const schema = await loadSchema(fileName);
    validators.set(fileName, ajv.compile(schema));
  }
  return validators.get(fileName);
}

export async function validatePayload(fileName, payload, label = fileName) {
  const validate = await validatorFor(fileName);
  if (validate(payload)) return;
  const details = (validate.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
    .join("\n");
  throw new Error(`Schema validation failed for ${label}:\n${details}`);
}

export async function assertPackageExportsMatchSchemas() {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const exports = packageJson.exports ?? {};
  const schemaFiles = (await fs.readdir(schemasDir))
    .filter((file) => file.endsWith(".schema.json"))
    .sort();
  assert.deepEqual(
    schemaFiles,
    SCHEMA_CONTRACTS.map((contract) => contract.file).sort(),
    "schemas/ directory and SCHEMA_CONTRACTS must list the same files",
  );
  for (const contract of SCHEMA_CONTRACTS) {
    assert.equal(
      exports[contract.export],
      contract.export,
      `package.json must export ${contract.export}`,
    );
    const schema = await loadSchema(contract.file);
    assert.equal(schema.title, contract.title, `${contract.file} title drift`);
    assert.equal(
      schema.properties?.schemaVersion?.const,
      1,
      `${contract.file} schemaVersion must be 1`,
    );
    assert.deepEqual(
      [...(schema.required ?? [])].sort(),
      [...contract.required].sort(),
      `${contract.file} required fields drift`,
    );
  }
}

/** Representative on-disk fixtures for pack:check (no Doctor runtime required). */
export async function validateFixturePayloads() {
  const projectFixtures = [
    "examples/showcase/federation/version-conflict/host.project.json",
    "examples/showcase/runtime/green/host.project.json",
    "fixtures/workspaces/clean/host/.mf/doctor/project.json",
  ];
  for (const relativePath of projectFixtures) {
    const payload = JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
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

export async function runSchemaContractChecks() {
  await assertPackageExportsMatchSchemas();
  await validateFixturePayloads();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runSchemaContractChecks();
  process.stdout.write("Schema contract checks passed.\n");
}
