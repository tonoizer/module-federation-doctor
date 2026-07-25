import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist/cli.js");

/** @type {Array<{ dir?: string; pattern?: string; ruleId: string; expectedExit: number; command?: "check" | "federation" }>} */
const cases = [
  {
    dir: "examples/showcase/config/expose-key-invalid",
    ruleId: "config/expose-key-invalid",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/config/expose-path-missing",
    ruleId: "config/expose-path-missing",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/config/remote-entry-invalid",
    ruleId: "config/remote-entry-invalid",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/config/filename-invalid",
    ruleId: "config/filename-invalid",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/config/share-scope-undeclared",
    ruleId: "config/share-scope-undeclared",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/config/remote-http-insecure",
    ruleId: "config/remote-http-insecure",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/eager-without-singleton",
    ruleId: "shared/eager-without-singleton",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/version-unsatisfied",
    ruleId: "shared/version-unsatisfied",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/shared/singleton-risk",
    ruleId: "shared/singleton-risk",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/unused",
    ruleId: "shared/unused",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/candidate",
    ruleId: "shared/candidate",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/reliability/version-first-offline-remotes",
    ruleId: "reliability/version-first-offline-remotes",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/reliability/shared-import-false",
    ruleId: "reliability/shared-import-false",
    expectedExit: 0,
  },
  {
    command: "federation",
    pattern: "examples/showcase/federation/version-conflict/*.project.json",
    ruleId: "federation/version-conflict",
    expectedExit: 1,
  },
  {
    command: "federation",
    pattern: "examples/showcase/federation/share-scope-mismatch/*.project.json",
    ruleId: "federation/share-scope-mismatch",
    expectedExit: 1,
  },
  {
    command: "federation",
    pattern: "examples/showcase/federation/singleton-mismatch/*.project.json",
    ruleId: "shared/singleton-mismatch",
    expectedExit: 0,
  },
  {
    command: "federation",
    pattern: "examples/showcase/federation/name-conflict/*.project.json",
    ruleId: "federation/name-conflict",
    expectedExit: 1,
  },
  {
    command: "federation",
    pattern: "examples/showcase/federation/missing-provider/*.project.json",
    ruleId: "federation/missing-provider",
    expectedExit: 1,
  },
];

let failed = false;

for (const item of cases) {
  const command = item.command ?? "check";
  const args =
    command === "federation"
      ? [cli, "federation", path.join(root, item.pattern), "--format", "terminal"]
      : [cli, "check", path.join(root, item.dir), "--ci", "--format", "terminal"];
  const label = item.dir ?? item.pattern;
  const result = spawnSync(process.execPath, args, { encoding: "utf8", cwd: root });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const exitCode = result.status ?? 1;
  const hasRule = output.includes(item.ruleId);
  const ok = exitCode === item.expectedExit && hasRule;
  process.stdout.write(
    `${ok ? "ok" : "FAIL"} ${label} → ${item.ruleId} (exit ${exitCode}, expected ${item.expectedExit})\n`,
  );
  if (!ok) {
    failed = true;
    process.stdout.write(output);
  }
}

process.exit(failed ? 1 : 0);
