#!/usr/bin/env node
/**
 * One-command production/build/runtime contract gate for the local MF matrix.
 *
 * The upstream repositories are represented by small, reviewed fixtures in
 * this repository. The provenance and compatibility files record which
 * upstream surfaces each fixture mirrors, so CI does not need to clone moving
 * repositories.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provenancePath = path.join(root, "fixtures/upstream-compatibility.json");
const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
const packageManager = process.platform === "win32" ? "corepack.cmd" : "corepack";
const packageManagerArgs = ["pnpm"];

function run(label, command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    env: { ...process.env, CI: "true", MFDOCTOR_QUIET: "1", ...extraEnv },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
  const exitCode = result.status ?? 1;
  process.stdout.write(`${exitCode === 0 ? "ok" : "FAIL"} ${label} (exit ${exitCode})\n`);
  if (exitCode !== 0) process.stdout.write(`${output.slice(-8000)}\n`);
  return { output, exitCode };
}

function runRequired(label, command, args) {
  const result = run(label, command, args);
  assert.equal(result.exitCode, 0, `${label} failed`);
  return result;
}

function reportFor(relativeDir) {
  const reportPath = path.join(root, relativeDir, ".mf/doctor/report.json");
  assert.ok(fs.existsSync(reportPath), `missing Doctor report: ${relativeDir}`);
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

function assertReport(relativeDir, { expectedRules = [], forbiddenRules = [], errors = 0 } = {}) {
  const report = reportFor(relativeDir);
  const ruleIds = report.findings.map((finding) => finding.ruleId);
  assert.equal(report.summary.errors, errors, `${relativeDir}: unexpected error count`);
  for (const ruleId of expectedRules) {
    assert.ok(ruleIds.includes(ruleId), `${relativeDir}: missing expected ${ruleId}`);
  }
  for (const ruleId of forbiddenRules) {
    assert.ok(!ruleIds.includes(ruleId), `${relativeDir}: unexpected ${ruleId}`);
  }
  process.stdout.write(
    `ok report ${relativeDir} (errors:${report.summary.errors}, warnings:${report.summary.warnings}, findings:${ruleIds.length})\n`,
  );
  return report;
}

for (const source of provenance.upstreamSources) {
  for (const fixture of source.localFixtures) {
    assert.ok(fs.existsSync(path.join(root, fixture)), `missing local fixture ${fixture}`);
  }
}
process.stdout.write(
  `ok provenance ${provenance.upstreamSources.length} upstream surfaces mirrored\n`,
);

runRequired("production build: mixed green", packageManager, [
  ...packageManagerArgs,
  "--filter",
  "./examples/mixed-federation/**",
  "build",
]);
for (const dir of [
  "examples/mixed-federation/host-vite",
  "examples/mixed-federation/remote-rspack",
  "examples/mixed-federation/remote-rsbuild",
]) {
  assertReport(dir, { errors: 0, forbiddenRules: ["doctor/partial-analysis"] });
}

runRequired("production build: intentional findings", packageManager, [
  ...packageManagerArgs,
  "--filter",
  "./examples/mixed-federation-issues/**",
  "build",
]);
assertReport("examples/mixed-federation-issues/host-vite", {
  expectedRules: [
    "config/remote-manifest-recommended",
    "reliability/version-first-offline-remotes",
  ],
});
assertReport("examples/mixed-federation-issues/remote-rspack", {
  expectedRules: ["shared/version-unsatisfied", "shared/singleton-risk"],
  errors: 2,
});

runRequired("production build: nested graph", packageManager, [
  ...packageManagerArgs,
  "--filter",
  "./examples/nested-federation/**",
  "build",
]);
for (const dir of [
  "examples/nested-federation/host-vite",
  "examples/nested-federation/remote-vite",
  "examples/nested-federation/remote-rsbuild",
  "examples/nested-federation/remote-rspack",
  "examples/nested-federation/remote-webpack",
]) {
  assertReport(dir, { errors: 0 });
}
runRequired("workspace gate: nested graph", process.execPath, [
  "dist/cli.js",
  "workspace",
  "examples/nested-federation",
  "--format",
  "terminal,json",
]);

runRequired("production build: compatibility cells", packageManager, [
  ...packageManagerArgs,
  "--filter",
  "./examples/compatibility/**",
  "build",
]);
for (const dir of ["examples/compatibility/webpack", "examples/compatibility/modern"]) {
  assertReport(dir, { errors: 0 });
}
runRequired("compatibility matrix contract", process.execPath, [
  "scripts/verify-compatibility-matrix.mjs",
]);

runRequired("standalone findings catalog", "node", ["scripts/demo-standalone-findings.mjs"]);
runRequired("CLI showcase catalog", "node", ["scripts/demo-showcase.mjs"]);
runRequired("cross-app negative gate", "node", ["scripts/demo-mixed-issues.mjs"]);

const greenProjects = [
  "examples/mixed-federation/host-vite/.mf/doctor/project.json",
  "examples/mixed-federation/remote-rspack/.mf/doctor/project.json",
  "examples/mixed-federation/remote-rsbuild/.mf/doctor/project.json",
];
const greenFederation = run(
  "cross-app green gate",
  process.execPath,
  ["dist/cli.js", "federation", ...greenProjects, "--format", "terminal"],
  { MFDOCTOR_QUIET: "0" },
);
assert.equal(greenFederation.exitCode, 0, "green cross-app federation gate failed");
assert.ok(
  greenFederation.output.includes("no findings"),
  "green cross-app gate did not report a clean result",
);
process.stdout.write("ok cross-app green gate\n");

process.stdout.write("GIGA_SMOKE_OK\n");
