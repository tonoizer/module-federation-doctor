import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = process.platform === "win32" ? "corepack.cmd" : "corepack";
const packageManagerArgs = ["pnpm"];

/** @type {Array<{ label: string; filter: string; dir: string; ruleIds: string[] }>} */
const cells = [
  {
    label: "examples/standalone-findings/vite",
    filter: "@mfdoctor-standalone/vite",
    dir: "examples/standalone-findings/vite",
    ruleIds: [
      "config/remote-http-insecure",
      "config/remote-manifest-recommended",
      "reliability/version-first-offline-remotes",
    ],
  },
  {
    label: "examples/standalone-findings/webpack",
    filter: "@mfdoctor-standalone/webpack",
    dir: "examples/standalone-findings/webpack",
    ruleIds: ["shared/version-unsatisfied", "shared/singleton-risk"],
  },
  {
    label: "examples/standalone-findings/rspack",
    filter: "@mfdoctor-standalone/rspack",
    dir: "examples/standalone-findings/rspack",
    ruleIds: ["shared/version-unsatisfied", "shared/singleton-risk"],
  },
  {
    label: "examples/standalone-findings/rsbuild",
    filter: "@mfdoctor-standalone/rsbuild",
    dir: "examples/standalone-findings/rsbuild",
    ruleIds: ["shared/eager-without-singleton", "shared/singleton-risk"],
  },
];

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
  const build = run(packageManager, [...packageManagerArgs, "--filter", cell.filter, "build"]);
  if (build.exitCode !== 0) {
    process.stdout.write(`FAIL build ${cell.label}\n${build.output}`);
    failed = true;
    continue;
  }
  process.stdout.write(`ok build ${cell.label}\n`);

  const reportPath = path.join(root, cell.dir, ".mf/doctor/report.json");
  if (!fs.existsSync(reportPath)) {
    process.stdout.write(`FAIL ${cell.label} missing ${reportPath}\n`);
    failed = true;
    continue;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const findings = (report.findings ?? []).map((finding) => finding.ruleId);
  if (!assertRules(cell.label, cell.ruleIds, findings)) failed = true;
}

process.exit(failed ? 1 : 0);
