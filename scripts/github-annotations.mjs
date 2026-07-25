import fs from "node:fs/promises";
import fg from "fast-glob";

const files = await fg("examples/mixed-federation/*/.mf/doctor/report.json");
let errors = 0;
let warnings = 0;
for (const file of files.sort()) {
  const report = JSON.parse(await fs.readFile(file, "utf8"));
  errors += report.summary.errors;
  warnings += report.summary.warnings;
  for (const finding of report.findings) {
    const command = finding.severity === "error" ? "error" : "warning";
    const location = finding.location?.path ? `file=${finding.location.path},` : "";
    process.stdout.write(`::${command} ${location}title=${finding.ruleId}::${finding.message}\n`);
  }
}
process.stdout.write(
  `## Module Federation Doctor\n\n- Errors: ${errors}\n- Warnings: ${warnings}\n`,
);
