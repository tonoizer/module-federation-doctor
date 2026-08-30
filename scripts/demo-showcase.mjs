import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist/cli.js");

function portableGlob(relativePath) {
  return path.join(root, relativePath).replaceAll("\\", "/");
}

/** @type {Array<{ dir?: string; pattern?: string; ruleId?: string; forbiddenRuleIds?: string[]; expectNoFindings?: boolean; expectedExit: number; command?: "check" | "federation" | "runtime" }>} */
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
    dir: "examples/showcase/config/async-boundary-missing",
    ruleId: "config/async-boundary-missing",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/config/async-boundary-missing-ok",
    expectNoFindings: true,
    forbiddenRuleIds: ["config/async-boundary-missing"],
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/config/remote-http-insecure",
    ruleId: "config/remote-http-insecure",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/config/implementation-local",
    expectNoFindings: true,
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/config/implementation-suspicious-suppressed",
    expectNoFindings: true,
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/config/remote-localhost-in-production",
    ruleId: "config/remote-localhost-in-production",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/config/remote-alias-prefix-collision",
    ruleId: "config/remote-alias-prefix-collision",
    expectedExit: 1,
  },
  {
    dir: "examples/showcase/config/dts-output-dir-mismatch",
    ruleId: "config/dts-output-dir-mismatch",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/config/rsbuild-mf-api-generation",
    ruleId: "config/rsbuild-mf-api-generation",
    expectedExit: 1,
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
    dir: "examples/showcase/shared/singleton-risk-suppressed",
    expectNoFindings: true,
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/unused",
    ruleId: "shared/unused",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/unused-unresolved",
    ruleId: "doctor/partial-analysis",
    forbiddenRuleIds: ["shared/unused"],
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/candidate",
    ruleId: "shared/candidate",
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/candidate-suppressed",
    expectNoFindings: true,
    expectedExit: 0,
  },
  {
    dir: "examples/showcase/shared/deep-import-bypass",
    ruleId: "shared/deep-import-bypass",
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
    pattern: "examples/showcase/federation/share-strategy-mismatch/*.project.json",
    ruleId: "federation/share-strategy-mismatch",
    expectedExit: 0,
  },
  {
    command: "federation",
    pattern: "examples/showcase/federation/circular-remote-graph/*.project.json",
    ruleId: "federation/circular-remote-graph",
    expectedExit: 0,
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
  {
    command: "federation",
    pattern: "examples/showcase/federation/host-gaps/*.project.json",
    ruleId: "federation/host-gaps",
    expectedExit: 0,
  },
  {
    command: "federation",
    pattern: "examples/showcase/federation/ghost-shares/*.project.json",
    ruleId: "federation/ghost-shares",
    expectedExit: 0,
  },
  {
    command: "runtime",
    dir: "examples/showcase/runtime/green",
    expectNoFindings: true,
    expectedExit: 0,
  },
  {
    command: "runtime",
    dir: "examples/showcase/runtime/shared-mismatch",
    ruleId: "runtime/shared-mismatch",
    expectedExit: 1,
  },
];

let failed = false;

for (const item of cases) {
  const command = item.command ?? "check";
  /** @type {string[]} */
  let args;
  if (command === "federation") {
    args = [cli, "federation", portableGlob(item.pattern), "--format", "terminal"];
  } else if (command === "runtime") {
    args = [
      cli,
      "runtime",
      portableGlob(path.join(item.dir, "trace.json")),
      portableGlob(path.join(item.dir, "*.project.json")),
      "--format",
      "terminal",
    ];
  } else {
    args = [cli, "check", path.join(root, item.dir), "--ci", "--format", "terminal"];
  }
  const label = item.dir ?? item.pattern;
  const result = spawnSync(process.execPath, args, { encoding: "utf8", cwd: root });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const exitCode = result.status ?? 1;
  const hasExpectation = item.expectNoFindings
    ? !output.includes("MFDoctor") && !/\b(error|warning|info)\b/.test(output)
    : Boolean(item.ruleId && output.includes(item.ruleId));
  const forbidsOk = !(item.forbiddenRuleIds ?? []).some((id) => output.includes(id));
  const ok = exitCode === item.expectedExit && hasExpectation && forbidsOk;
  const expectation = item.expectNoFindings ? "quiet success (no findings)" : item.ruleId;
  process.stdout.write(
    `${ok ? "ok" : "FAIL"} ${label} → ${expectation} (exit ${exitCode}, expected ${item.expectedExit})\n`,
  );
  if (!ok) {
    failed = true;
    process.stdout.write(output);
  }
}

process.exit(failed ? 1 : 0);
