#!/usr/bin/env node
/**
 * Assert a supported compatibility-matrix cell wrote Doctor facts and
 * CI report surfaces (JSON + SARIF). Optionally assert a captured terminal log.
 *
 * Usage:
 *   node scripts/verify-compatibility-cell.mjs <example-dir> <bundler-id> [terminal-log]
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const [, , exampleDir, bundlerId, terminalLogArg] = process.argv;
if (!exampleDir || !bundlerId) {
  process.stderr.write(
    "Usage: node scripts/verify-compatibility-cell.mjs <example-dir> <bundler-id> [terminal-log]\n",
  );
  process.exit(2);
}

const doctorDir = path.resolve(exampleDir, ".mf/doctor");
const projectPath = path.join(doctorDir, "project.json");
const reportPath = path.join(doctorDir, "report.json");
const sarifPath = path.join(doctorDir, "results.sarif");

for (const file of [projectPath, reportPath, sarifPath]) {
  try {
    await fs.access(file);
  } catch {
    throw new Error(`Missing Doctor artifact for ${bundlerId}: ${file}`);
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

assert.equal(sarif.version, "2.1.0");
assert.ok(Array.isArray(sarif.runs) && sarif.runs.length > 0, "SARIF runs required");

const terminalLog = terminalLogArg;
if (terminalLog) {
  const log = await fs.readFile(path.resolve(terminalLog), "utf8");
  assert.ok(log.trim().length > 0, `terminal log empty: ${terminalLog}`);
  assert.match(
    log,
    /Module Federation Doctor|doctor\/|findings|mfdoctor/i,
    `terminal log missing Doctor output: ${terminalLog}`,
  );
}

const capabilities = project.capabilities ?? {};
process.stdout.write(
  [
    `compatibility-cell ok bundler=${bundlerId} project=${project.project.name}`,
    `  artifacts=project.json,report.json,results.sarif${terminalLog ? ",terminal" : ""}`,
    `  summary=errors:${report.summary.errors},warnings:${report.summary.warnings},findings:${report.findings.length}`,
    `  capabilities=${JSON.stringify(capabilities)}`,
    "",
  ].join("\n"),
);
