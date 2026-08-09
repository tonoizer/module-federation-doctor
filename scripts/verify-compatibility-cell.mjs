#!/usr/bin/env node
/**
 * Assert a supported compatibility-matrix cell wrote Doctor facts and
 * CI report surfaces (JSON + SARIF). Optionally assert a captured terminal log.
 *
 * Usage:
 *   node scripts/verify-compatibility-cell.mjs <example-dir> <cell-id> [terminal-log]
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , exampleDir, cellId, terminalLogArg] = process.argv;
if (!exampleDir || !cellId) {
  process.stderr.write(
    "Usage: node scripts/verify-compatibility-cell.mjs <example-dir> <cell-id> [terminal-log]\n",
  );
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = path.join(root, "fixtures/compatibility-matrix.json");
const matrix = JSON.parse(await fs.readFile(matrixPath, "utf8"));
const matrixCell = matrix.localCi.find((cell) => cell.id === cellId);
assert.ok(matrixCell, `unknown compatibility-matrix cell: ${cellId}`);
const bundlerId = matrixCell?.bundler ?? cellId;

const doctorDir = path.resolve(exampleDir, ".mf/doctor");
const projectPath = path.join(doctorDir, "project.json");
const reportPath = path.join(doctorDir, "report.json");
const sarifPath = path.join(doctorDir, "results.sarif");

for (const file of [projectPath, reportPath, sarifPath]) {
  try {
    await fs.access(file);
  } catch {
    throw new Error(`Missing Doctor artifact for ${cellId}: ${file}`);
  }
}

const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
const sarif = JSON.parse(await fs.readFile(sarifPath, "utf8"));

assert.equal(typeof project.project?.name, "string");
assert.ok(project.project.name.length > 0, "project.name must be non-empty");
assert.equal(typeof project.bundler?.name, "string");
assert.equal(
  project.bundler.name,
  bundlerId,
  `expected bundler.name=${bundlerId}, got ${project.bundler.name}`,
);

assert.ok(report.summary, "report.summary required");
assert.equal(typeof report.summary.errors, "number");
assert.equal(typeof report.summary.warnings, "number");
assert.ok(Array.isArray(report.findings), "report.findings must be an array");
assert.equal(
  report.summary.errors,
  matrixCell.expectedErrors,
  `${cellId}: expected error budget changed`,
);

assert.equal(sarif.version, "2.1.0");
assert.ok(Array.isArray(sarif.runs) && sarif.runs.length > 0, "SARIF runs required");

const terminalLog = terminalLogArg;
if (terminalLog) {
  const log = await fs.readFile(path.resolve(terminalLog), "utf8");
  assert.ok(log.trim().length > 0, `terminal log empty: ${terminalLog}`);
  // Quiet success (#46): clean builds may omit the Doctor findings block.
  // Still require some Doctor-related signal in the captured build log, or
  // accept quiet success when the report itself has zero findings.
  const hasDoctorSignal = /Module Federation Doctor|doctor\/|findings|mfdoctor/i.test(log);
  const quietClean = report.findings.length === 0;
  assert.ok(hasDoctorSignal || quietClean, `terminal log missing Doctor output: ${terminalLog}`);
}

const capabilities = project.capabilities ?? {};

function projectInstances(value) {
  if (Array.isArray(value.federationInstances)) return value.federationInstances;
  return value.moduleFederation ? [value] : [];
}

function ownsAsset(assets, expected) {
  return assets.some((asset) => asset === expected || asset.endsWith(`/${expected}`));
}

function assertRuntimeContract(cell, value) {
  if (!cell.runtime) return;

  const instances = projectInstances(value);
  assert.equal(
    instances.length,
    cell.runtime.instances.length,
    `${cell.id}: runtime instance count changed`,
  );
  const identities = instances.map((instance) => instance.moduleFederation?.name);
  assert.equal(
    new Set(identities).size,
    identities.length,
    `${cell.id}: duplicate instance identity`,
  );

  for (const expected of cell.runtime.instances) {
    const instance = instances.find(
      (candidate) => candidate.moduleFederation?.name === expected.identity,
    );
    assert.ok(instance, `${cell.id}: missing runtime instance ${expected.identity}`);
    const assets = Array.isArray(instance.artifacts?.emittedAssets)
      ? instance.artifacts.emittedAssets.map(String)
      : [];
    assert.ok(ownsAsset(assets, expected.fileName), `${cell.id}: missing ${expected.fileName}`);
    const manifestIdentity = instance.artifacts?.manifest?.name ?? instance.artifacts?.manifest?.id;
    assert.equal(manifestIdentity, expected.identity, `${cell.id}: manifest identity changed`);
    if (expected.artifactFiles?.some((file) => file.endsWith("mf-stats.json"))) {
      const statsIdentity =
        instance.artifacts?.stats?.data?.name ?? instance.artifacts?.stats?.data?.id;
      assert.equal(statsIdentity, expected.identity, `${cell.id}: stats identity changed`);
    }
    for (const artifactFile of expected.artifactFiles ?? [])
      assert.ok(ownsAsset(assets, artifactFile), `${cell.id}: missing ${artifactFile}`);

    for (const other of cell.runtime.instances) {
      if (other === expected) continue;
      assert.ok(!ownsAsset(assets, other.fileName), `${cell.id}: cross-owned ${other.fileName}`);
      for (const artifactFile of other.artifactFiles ?? [])
        assert.ok(!ownsAsset(assets, artifactFile), `${cell.id}: cross-owned ${artifactFile}`);
    }
  }
}

assertRuntimeContract(matrixCell, project);
process.stdout.write(
  [
    `compatibility-cell ok cell=${cellId} bundler=${bundlerId} project=${project.project.name}`,
    `  artifacts=project.json,report.json,results.sarif${terminalLog ? ",terminal" : ""}`,
    `  summary=errors:${report.summary.errors},warnings:${report.summary.warnings},findings:${report.findings.length}`,
    `  capabilities=${JSON.stringify(capabilities)}`,
    "",
  ].join("\n"),
);
