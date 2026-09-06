import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitePlus = process.platform === "win32" ? "vp.cmd" : "vp";
const vitePlusArgs = ["run"];

const adapterCases = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/adapters/cases.json"), "utf8"),
);

/** @type {Array<{ filter: string; dir: string; bundler: string; ruleIds: string[]; incompleteReasons?: string[] }>} */
const cells = adapterCases.emit ?? [];
if (cells.length === 0) {
  process.stdout.write("FAIL fixtures/adapters/cases.json missing emit cells\n");
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: root,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    exitCode: result.status ?? 1,
  };
}

function assertRules(label, ruleIds, findings) {
  const missing = ruleIds.filter((ruleId) => !findings.includes(ruleId));
  const ok = missing.length === 0;
  process.stdout.write(`${ok ? "ok" : "FAIL"} ${label}\n`);
  if (!ok) {
    process.stdout.write(`  missing: ${missing.join(", ")}\n`);
    process.stdout.write(`  found: ${findings.join(", ") || "(none)"}\n`);
  }
  return ok;
}

let failed = false;

for (const cell of cells) {
  const build = run(vitePlus, [...vitePlusArgs, "--filter", cell.filter, "build"]);
  if (build.exitCode !== 0) {
    process.stdout.write(`FAIL build ${cell.dir}\n${build.output}`);
    failed = true;
    continue;
  }
  process.stdout.write(`ok build ${cell.dir}\n`);

  const reportPath = path.join(root, cell.dir, ".mf/doctor/report.json");
  if (!fs.existsSync(reportPath)) {
    process.stdout.write(`FAIL ${cell.dir} missing ${reportPath}\n`);
    failed = true;
    continue;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const findings = (report.findings ?? []).map((finding) => finding.ruleId);
  if (!assertRules(cell.dir, cell.ruleIds, findings)) failed = true;

  const projectPath = path.join(root, cell.dir, ".mf/doctor/project.json");
  if (!fs.existsSync(projectPath)) {
    process.stdout.write(`FAIL ${cell.dir} missing ${projectPath}\n`);
    failed = true;
    continue;
  }
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  const recorded = project.bundler?.name;
  if (recorded !== cell.bundler) {
    process.stdout.write(`FAIL ${cell.dir} bundler ${recorded ?? "(none)"} !== ${cell.bundler}\n`);
    failed = true;
  }
  const expectedIncomplete = cell.incompleteReasons ?? [];
  if (expectedIncomplete.length > 0) {
    const incomplete = report.status?.incompleteReasons ?? [];
    const missingIncomplete = expectedIncomplete.filter((reason) => !incomplete.includes(reason));
    if (missingIncomplete.length > 0) {
      process.stdout.write(
        `FAIL ${cell.dir} missing incompleteReasons ${missingIncomplete.join(", ")} (${incomplete.join(", ") || "none"})\n`,
      );
      failed = true;
    }
  }
}

process.exit(failed ? 1 : 0);
