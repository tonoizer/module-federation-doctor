import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist/cli.js");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageManagerArgs = [];

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

function assertRules(label, ruleIds, haystack, expectedExit, exitCode) {
  const missing = ruleIds.filter((ruleId) => !haystack.includes(ruleId));
  const ok = exitCode === expectedExit && missing.length === 0;
  process.stdout.write(
    `${ok ? "ok" : "FAIL"} ${label} (exit ${exitCode}, expected ${expectedExit})\n`,
  );
  if (!ok) {
    if (missing.length > 0) process.stdout.write(`  missing: ${missing.join(", ")}\n`);
    process.stdout.write(haystack.slice(0, 4000) + (haystack.length > 4000 ? "\n…\n" : ""));
  }
  return ok;
}

const build = run(packageManager, [
  ...packageManagerArgs,
  "--filter",
  "./examples/mixed-federation-issues/**",
  "build",
]);
if (build.exitCode !== 0) {
  process.stdout.write(`FAIL build mixed-federation-issues\n${build.output}`);
  process.exit(1);
}
process.stdout.write("ok build examples/mixed-federation-issues\n");

const packages = [
  {
    label: "examples/mixed-federation-issues/host-vite",
    dir: "examples/mixed-federation-issues/host-vite",
    ruleIds: ["config/remote-manifest-recommended", "reliability/version-first-offline-remotes"],
  },
  {
    label: "examples/mixed-federation-issues/remote-rspack",
    dir: "examples/mixed-federation-issues/remote-rspack",
    ruleIds: ["shared/version-unsatisfied", "shared/singleton-risk"],
  },
];

let failed = false;
for (const item of packages) {
  const reportPath = path.join(root, item.dir, ".mf/doctor/report.json");
  const report = fs.readFileSync(reportPath, "utf8");
  const findings = JSON.parse(report).findings.map((finding) => finding.ruleId);
  if (!assertRules(item.label, item.ruleIds, findings.join("\n"), 0, 0)) failed = true;
}

const projectFiles = [
  "examples/mixed-federation-issues/host-vite/.mf/doctor/project.json",
  "examples/mixed-federation-issues/remote-rspack/.mf/doctor/project.json",
  "examples/mixed-federation-issues/remote-rsbuild/.mf/doctor/project.json",
];
const federation = run(process.execPath, [
  cli,
  "federation",
  ...projectFiles,
  "--format",
  "terminal",
]);
if (
  !assertRules(
    "examples/mixed-federation-issues federation",
    ["federation/version-conflict", "federation/share-scope-mismatch", "shared/singleton-mismatch"],
    federation.output,
    1,
    federation.exitCode,
  )
)
  failed = true;

process.exit(failed ? 1 : 0);
