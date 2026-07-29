import { mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const [inputDir, expectedDir] = process.argv.slice(2);
if (!inputDir || !expectedDir) {
  throw new Error(
    "Usage: node scripts/check-runtime-observability-replay.mjs <raw-dir> <expected-dir>",
  );
}

const provenance = JSON.parse(await readFile(path.join(expectedDir, "provenance.json"), "utf8"));
const outputDir = await mkdtemp(path.join(os.tmpdir(), "mfdoctor-replay-"));
await execFileAsync(process.execPath, [
  path.join(import.meta.dirname, "capture-runtime-observability-fixtures.mjs"),
  inputDir,
  outputDir,
]);

for (const item of provenance.cases) {
  const expected = await readFile(path.join(expectedDir, item.fixture));
  const replayed = await readFile(path.join(outputDir, item.fixture));
  if (!expected.equals(replayed)) {
    throw new Error(`Replay bytes differ for ${item.fixture}`);
  }
  const digest = crypto.createHash("sha256").update(replayed).digest("hex");
  if (digest !== item.sanitizedSha256) {
    throw new Error(`Replay digest differs for ${item.fixture}: ${digest}`);
  }
}
