import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist/cli.js");

const cases = [
  {
    dir: "examples/showcase/name-required",
    ruleId: "config/name-required",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/expose-key-invalid",
    ruleId: "config/expose-key-invalid",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/eager-without-singleton",
    ruleId: "shared/eager-without-singleton",
    expectedExit: 0,
  },
];

let failed = false;

for (const item of cases) {
  const result = spawnSync(
    process.execPath,
    [cli, "check", path.join(root, item.dir), "--ci", "--format", "terminal"],
    { encoding: "utf8", cwd: root },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const exitCode = result.status ?? 1;
  const hasRule = output.includes(item.ruleId);
  const ok = exitCode === item.expectedExit && hasRule;
  process.stdout.write(
    `${ok ? "ok" : "FAIL"} ${item.dir} → ${item.ruleId} (exit ${exitCode}, expected ${item.expectedExit})\n`,
  );
  if (!ok) {
    failed = true;
    process.stdout.write(output);
  }
}

process.exit(failed ? 1 : 0);
