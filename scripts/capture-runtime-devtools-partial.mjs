import { cp, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const [upstreamDir, rawDir] = process.argv.slice(2);
if (!upstreamDir || !rawDir) {
  throw new Error(
    "Usage: node scripts/capture-runtime-devtools-partial.mjs <upstream-core-dir> <raw-dir>",
  );
}

const repoDir = path.resolve(import.meta.dirname, "..");
const captureTest = path.join(
  upstreamDir,
  "packages/chrome-devtools/__tests__/doctor-capture.spec.ts",
);
const packageDir = path.join(upstreamDir, "packages/chrome-devtools");
await mkdir(rawDir, { recursive: true });
await cp(
  path.join(repoDir, "fixtures/runtime-traces/upstream-devtools-capture.spec.ts"),
  captureTest,
);
// This command runs inside a separate pinned upstream checkout, not the
// MFDoctor workspace. Keep its package-manager invocation intact.
await execFileAsync(
  "pnpm",
  ["exec", "rstest", "-c", "rstest.config.ts", "--include", "__tests__/doctor-capture.spec.ts"],
  {
    cwd: packageDir,
    env: { ...process.env, DOCTOR_CAPTURE_DIR: rawDir },
    maxBuffer: 10 * 1024 * 1024,
  },
);
