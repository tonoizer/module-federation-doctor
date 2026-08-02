import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDriftLedgerEntry, compareV1Outputs } from "../dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) =>
  JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const golden = await readJson("fixtures/evidence-parity/golden.json");
const ledger = await readJson("fixtures/evidence-parity/drift-ledger.json");

if (golden.version !== 1 || !Array.isArray(golden.cases))
  throw new Error("invalid parity golden corpus");
if (ledger.version !== 1 || !Array.isArray(ledger.entries)) throw new Error("invalid drift ledger");
const entries = new Map();
for (const entry of ledger.entries) {
  assertDriftLedgerEntry(entry);
  if (entries.has(entry.id)) throw new Error(`duplicate drift ledger entry: ${entry.id}`);
  entries.set(entry.id, entry);
}

for (const testCase of golden.cases) {
  const result = compareV1Outputs(testCase.legacy, testCase.projected);
  if (result.equal !== testCase.expected.equal)
    throw new Error(`parity expectation changed: ${testCase.id}`);
  if (result.equal) continue;
  const className = testCase.expected.class;
  const ledgerId = testCase.expected.ledgerId;
  if (!className || !ledgerId) throw new Error(`unclassified drift: ${testCase.id}`);
  const entry = entries.get(ledgerId);
  if (!entry || entry.class !== className || entry.fixture !== testCase.id) {
    throw new Error(`invalid drift classification: ${testCase.id}`);
  }
}

process.stdout.write(
  `Evidence parity passed (${golden.cases.length} golden cases, ${entries.size} ledger entries).\n`,
);
