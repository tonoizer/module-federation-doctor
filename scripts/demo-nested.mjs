import { runDemoCommand } from "./demo-command.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist/cli.js");
const vitePlus = process.platform === "win32" ? "vp.cmd" : "vp";
const vitePlusArgs = ["run"];

const build = runDemoCommand(
  vitePlus,
  [...vitePlusArgs, "--filter", "./examples/nested-federation/**", "build"],
  root,
);
if (build.exitCode !== 0) {
  process.stdout.write(`FAIL build nested-federation\n${build.output}`);
  process.exit(1);
}
process.stdout.write("ok build examples/nested-federation\n");

const packages = [
  "examples/nested-federation/host-vite",
  "examples/nested-federation/remote-vite",
  "examples/nested-federation/remote-rsbuild",
  "examples/nested-federation/remote-rspack",
  "examples/nested-federation/remote-webpack",
];

let failed = false;
for (const dir of packages) {
  const projectPath = path.join(root, dir, ".mf/doctor/project.json");
  const reportPath = path.join(root, dir, ".mf/doctor/report.json");
  if (!fs.existsSync(projectPath)) {
    process.stdout.write(`FAIL missing project facts: ${dir}\n`);
    failed = true;
    continue;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const errorFindings = (report.findings ?? []).filter((finding) => finding.severity === "error");
  if (errorFindings.length > 0) {
    process.stdout.write(
      `FAIL ${dir} unexpected errors: ${errorFindings.map((f) => f.ruleId).join(", ")}\n`,
    );
    failed = true;
    continue;
  }
  process.stdout.write(`ok ${dir} (clean mfdoctor build)\n`);
}

const workspace = runDemoCommand(
  process.execPath,
  [cli, "workspace", "examples/nested-federation", "--format", "terminal,json"],
  root,
);
process.stdout.write(workspace.output);
if (workspace.exitCode !== 0) {
  process.stdout.write(`FAIL nested-federation workspace gate (exit ${workspace.exitCode})\n`);
  failed = true;
} else {
  process.stdout.write("ok nested-federation workspace gate\n");
}

process.exit(failed ? 1 : 0);
