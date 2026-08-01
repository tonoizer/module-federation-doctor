import fs from "node:fs/promises";
import path from "node:path";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "../dist/rules.js";

const check = process.argv.includes("--check");
const repository = path.resolve(import.meta.dirname, "..");
const root = path.join(repository, "apps/docs/docs/rules");
const rules = [
  ...builtInRules.map((rule) => Object.assign({ severity: rule.meta.defaultSeverity }, rule.meta)),
  ...federationRuleMeta,
  ...runtimeRuleMeta,
].sort((a, b) => a.id.localeCompare(b.id));
let drift = false;
async function writeGenerated(file, content) {
  if (check) {
    const current = await fs.readFile(file, "utf8").catch(() => "");
    if (current !== content) {
      process.stderr.write(`Generated rule doc drift: ${path.relative(repository, file)}\n`);
      drift = true;
    }
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

for (const rule of rules) {
  const { id, severity, category, impact, fix, sources } = rule;
  const file = path.join(root, `${id}.md`);
  const links = (sources ?? []).map((source) => `- [Official source](${source})`).join("\n");
  const content = `# \`${id}\`\n\n- Category: **${category ?? "tooling"}**\n- Default severity: **${severity}**\n\n## Issue\n\n${impact ?? "Doctor found a configuration or artifact risk."}\n\n## How to fix it\n\n${fix ?? "Review the finding evidence and align the federation configuration."}\n\nSuppress or retarget with \`rules["${id}"]\` set to \`"off"\` or a severity — see [Suppressions and allowlists](../../suppressions.md).\n\n## Sources\n\n${links || "- [Configuration overview](https://module-federation.io/configure/index.html)"}\n`;
  await writeGenerated(file, content);
}

const categories = ["correctness", "reliability", "performance", "security", "tooling"];
const sections = categories
  .map((category) => {
    const rows = rules
      .filter((rule) => (rule.category ?? "tooling") === category)
      .map(
        (rule) => `| [\`${rule.id}\`](./${rule.id}.md) | ${rule.severity} | ${rule.impact ?? ""} |`,
      )
      .join("\n");
    return `## ${category[0].toUpperCase()}${category.slice(1)}\n\n| Rule | Severity | What it protects |\n| --- | --- | --- |\n${rows}`;
  })
  .join("\n\n");
await writeGenerated(
  path.join(root, "index.md"),
  `# Rule reference

Rule pages are generated from package metadata. Each page explains the issue, impact, fix, and upstream evidence.

Browse by folder in the sidebar: Config, Shared, Artifact, Bridge, Reliability, Runtime, Federation, Performance, Security, and Doctor. Printed terminal \`docs:\` links open the same pages.

${sections}
`,
);
if (drift) process.exitCode = 1;
