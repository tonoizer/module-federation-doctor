import { spawnSync } from "node:child_process";

export function runDemoCommand(command, args, root) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: root,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    exitCode: result.status ?? 1,
  };
}
