import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_MIGRATED_RULE_IDS,
  RULE_COMPATIBILITY_EXCEPTIONS,
  assertInventoryDemoCoverage,
  ruleInventory,
  ruleInventoryIds,
} from "../dist/index.js";

const check = process.argv.includes("--check");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repository, "fixtures/rule-inventory/v1.json");
const vitePlusCli = path.join(repository, "node_modules/vite-plus/bin/vp");

const document = {
  schemaVersion: 1,
  generatedFrom: "src/rule-inventory.ts",
  ruleCount: ruleInventoryIds.length,
  migratedCount: ALL_MIGRATED_RULE_IDS.length,
  compatibilityExceptionCount: RULE_COMPATIBILITY_EXCEPTIONS.length,
  compatibilityExceptions: RULE_COMPATIBILITY_EXCEPTIONS,
  rules: ruleInventory.map((entry) => ({
    id: entry.id,
    version: entry.version,
    group: entry.group,
    status: entry.status,
    demo: entry.demo,
    defaultSeverity: entry.defaultSeverity,
    confidenceCeiling: entry.confidenceCeiling,
    owner: entry.owner,
    remediation: entry.remediation,
    prerequisites: entry.prerequisites,
    applicability: entry.applicability,
    evidenceReads: entry.evidenceReads,
    migrationNote: entry.migrationNote,
  })),
};

try {
  assertInventoryDemoCoverage(document.rules, {
    showcaseCatalogSource: await fs.readFile(
      path.join(repository, "scripts/demo-showcase.mjs"),
      "utf8",
    ),
    emitCatalogSource: await fs.readFile(
      path.join(repository, "scripts/demo-standalone-findings.mjs"),
      "utf8",
    ),
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const demoCounts = document.rules.reduce(
  (counts, entry) => {
    counts[entry.demo] += 1;
    return counts;
  },
  { showcase: 0, unit: 0, emit: 0 },
);
const summary = `${document.ruleCount} rules, ${demoCounts.showcase} showcase, ${demoCounts.emit} emit, ${demoCounts.unit} unit`;

const content = `${JSON.stringify(document, null, 2)}\n`;

async function formatInventory(rawContent) {
  const tempPath = path.join(repository, "fixtures/rule-inventory/.v1.generated.json");
  await fs.mkdir(path.dirname(tempPath), { recursive: true });
  await fs.writeFile(tempPath, rawContent);
  execFileSync(process.execPath, [vitePlusCli, "fmt", tempPath], {
    cwd: repository,
    stdio: "pipe",
  });
  const formatted = await fs.readFile(tempPath, "utf8");
  await fs.unlink(tempPath).catch(() => {});
  return formatted;
}

const formattedContent = await formatInventory(content);

if (check) {
  const current = await fs.readFile(outputPath, "utf8").catch(() => "");
  if (current !== formattedContent) {
    process.stderr.write(
      `Generated rule inventory drift: ${path.relative(repository, outputPath)}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Rule inventory is up to date (${summary}).\n`);
  }
} else {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, formattedContent);
  process.stdout.write(`Wrote ${path.relative(repository, outputPath)} (${summary}).\n`);
}
