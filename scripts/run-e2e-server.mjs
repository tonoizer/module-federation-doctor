#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const separator = process.argv.indexOf("--");
const command = process.argv[separator + 1];
const args = process.argv.slice(separator + 2);
if (separator < 0 || !command) {
  process.stderr.write(
    `Usage: ${path.basename(fileURLToPath(import.meta.url))} -- <command> [args...]\n`,
  );
  process.exit(2);
}

const registryPath = process.env.MFDOCTOR_E2E_SERVER_REGISTRY;
if (registryPath) {
  await fs.mkdir(registryPath, { recursive: true });
  await fs.writeFile(
    path.join(registryPath, `${process.pid}.json`),
    `${JSON.stringify({ group: process.ppid, pid: process.pid })}\n`,
  );
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: process.platform === "win32" && command.endsWith(".cmd"),
  stdio: "inherit",
});

const exitCode = await new Promise((resolve) => {
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    resolve(1);
  });
  child.once("exit", (code, signal) => {
    if (code !== null) {
      resolve(code);
      return;
    }
    resolve(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
});

process.exitCode = exitCode;
