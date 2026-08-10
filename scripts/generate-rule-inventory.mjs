import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_MIGRATED_RULE_IDS,
  RULE_COMPATIBILITY_EXCEPTIONS,
  ruleInventory,
  ruleInventoryIds,
} from "../dist/index.js";

const check = process.argv.includes("--check");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repository, "fixtures/rule-inventory/v1.json");

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

const content = `${JSON.stringify(document, null, 2)}\n`;

if (check) {
  const current = await fs.readFile(outputPath, "utf8").catch(() => "");
  if (current !== content) {
    process.stderr.write(
      `Generated rule inventory drift: ${path.relative(repository, outputPath)}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Rule inventory is up to date (${document.ruleCount} rules).\n`);
  }
} else {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content);
  process.stdout.write(
    `Wrote ${path.relative(repository, outputPath)} (${document.ruleCount} rules).\n`,
  );
}
