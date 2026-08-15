#!/usr/bin/env node
/**
 * Validate the checked-in compatibility contract after production cells have
 * built. The matrix separates reproducible local CI cells from upstream
 * validation records that intentionally do not require moving repositories in CI.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrix = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/compatibility-matrix.json"), "utf8"),
);
const ids = [...matrix.localCi, ...matrix.unitContracts, ...matrix.upstreamValidation].map(
  (cell) => cell.id,
);
assert.equal(new Set(ids).size, ids.length, "compatibility matrix ids must be unique");

for (const cell of matrix.localCi) {
  const fixture = path.join(root, cell.fixture);
  assert.ok(fs.existsSync(fixture), `${cell.id}: missing fixture ${cell.fixture}`);
  for (const artifact of ["project.json", "report.json", "results.sarif"]) {
    const artifactPath = path.join(fixture, ".mf/doctor", artifact);
    assert.ok(fs.existsSync(artifactPath), `${cell.id}: missing ${artifactPath}`);
  }
  const project = JSON.parse(
    fs.readFileSync(path.join(fixture, ".mf/doctor/project.json"), "utf8"),
  );
  const report = JSON.parse(fs.readFileSync(path.join(fixture, ".mf/doctor/report.json"), "utf8"));
  const sarif = JSON.parse(fs.readFileSync(path.join(fixture, ".mf/doctor/results.sarif"), "utf8"));
  assert.equal(project.bundler?.name, cell.bundler, `${cell.id}: bundler identity mismatch`);
  assert.equal(report.summary?.errors, cell.expectedErrors, `${cell.id}: error budget changed`);
  assert.equal(sarif.version, "2.1.0", `${cell.id}: SARIF version changed`);
  assert.ok(Array.isArray(sarif.runs) && sarif.runs.length > 0, `${cell.id}: SARIF run missing`);
  process.stdout.write(
    `ok local ${cell.id} (${cell.bundler}, errors:${report.summary.errors}, findings:${report.findings.length})\n`,
  );
}

for (const cell of matrix.unitContracts) {
  assert.ok(fs.existsSync(path.join(root, cell.test)), `${cell.id}: missing test ${cell.test}`);
  assert.equal(cell.status, "validated", `${cell.id}: unit contract is not validated`);
}

const vitePlus = process.platform === "win32" ? "vp.cmd" : "vp";
for (const test of new Set(matrix.unitContracts.map((cell) => cell.test))) {
  const result = spawnSync(vitePlus, ["exec", "vitest", "run", test], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, CI: "true" },
  });
  assert.equal(
    result.status,
    0,
    `unit contract failed: ${test}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
  process.stdout.write(`ok unit execution ${test}\n`);
}

for (const cell of matrix.upstreamValidation) {
  assert.match(cell.repository, /^[^/]+\/[^/]+$/);
  assert.match(cell.ref, /^[0-9a-f]{7,40}$/);
  assert.ok(cell.variant.length > 0);
  assert.ok(["validated", "baseline-blocked", "planned"].includes(cell.status));
  assert.equal(typeof cell.doctorErrors, "number");
  if (cell.status !== "planned")
    assert.equal(cell.doctorErrors, 0, `${cell.id}: recorded MFDoctor errors must be zero`);
  process.stdout.write(
    `ok upstream ${cell.id} (${cell.repository}@${cell.ref}, ${cell.status}, MFDoctor errors:${cell.doctorErrors})\n`,
  );
}

process.stdout.write(
  `COMPATIBILITY_MATRIX_OK local=${matrix.localCi.length} unit=${matrix.unitContracts.length} upstream=${matrix.upstreamValidation.length}\n`,
);
