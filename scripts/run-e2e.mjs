#!/usr/bin/env node
/**
 * Run the complete local E2E gate on a free, shared port range.
 *
 * A fixed port can be occupied by another local app or an SSH tunnel. The
 * selected offset is passed to the example builds and Playwright so the
 * generated remote URLs always agree with the preview servers.
 */
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_PORTS = [3001, 3002, 5173, 3011, 3012, 5183];
const MAX_OFFSET = 20_000;
const LOCK_PREFIX = path.join(os.tmpdir(), "mfdoctor-e2e");
const LOCK_INIT_GRACE_MS = 30_000;
const MAX_GATE_ATTEMPTS = 3;
let interruptedSignal;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interruptedSignal = signal;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  });
}

function assertNotInterrupted() {
  if (interruptedSignal) throw new Error(`E2E run interrupted by ${interruptedSignal}`);
}

async function reclaimStaleOffsetLock(lockPath) {
  let stat;
  try {
    stat = await fs.stat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }

  if (Date.now() - stat.mtimeMs < LOCK_INIT_GRACE_MS) return false;

  let ownerPid;
  try {
    ownerPid = Number((await fs.readFile(lockPath, "utf8")).trim());
  } catch {
    ownerPid = Number.NaN;
  }

  if (Number.isInteger(ownerPid) && ownerPid > 0) {
    try {
      process.kill(ownerPid, 0);
      return false;
    } catch (error) {
      if (error?.code !== "ESRCH") return false;
    }
  }

  const quarantinePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    await fs.rename(lockPath, quarantinePath);
  } catch (error) {
    return error?.code === "ENOENT";
  }
  await fs.rm(quarantinePath, { force: true });
  return true;
}

async function tryAcquireOffsetLock(offset) {
  const lockPath = `${LOCK_PREFIX}-${offset}.lock`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`);
      return async () => {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      await handle?.close();
      if (error?.code !== "EEXIST") {
        if (handle) await fs.rm(lockPath, { force: true });
        throw error;
      }
      if (await reclaimStaleOffsetLock(lockPath)) continue;
      return null;
    }
  }

  return null;
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function portsAvailable(offset) {
  const available = await Promise.all(BASE_PORTS.map((port) => canListen(port + offset)));
  return available.every(Boolean);
}

async function chooseOffset() {
  const claimOffset = async (offset) => {
    const release = await tryAcquireOffsetLock(offset);
    if (!release) return null;
    if (await portsAvailable(offset)) return release;
    await release();
    return null;
  };

  const requested = process.env.MFDOCTOR_E2E_PORT_OFFSET;
  if (requested !== undefined) {
    const offset = Number(requested);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET)
      throw new Error(`MFDOCTOR_E2E_PORT_OFFSET must be an integer between 0 and ${MAX_OFFSET}`);
    const release = await claimOffset(offset);
    if (!release)
      throw new Error(`MFDOCTOR_E2E_PORT_OFFSET=${offset} still contains a busy E2E port`);
    return { offset, release };
  }

  for (let offset = 0; offset <= MAX_OFFSET; offset += 100) {
    const release = await claimOffset(offset);
    if (release) return { offset, release };
  }
  throw new Error(`Could not find six free E2E ports within offset range 0-${MAX_OFFSET}`);
}

function run(label, command, args, env, { captureOutput = false } = {}) {
  assertNotInterrupted();
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    env,
    ...(captureOutput ? { encoding: "utf8" } : {}),
  });
  const output = captureOutput ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
  if (captureOutput) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
  if (result.error) {
    result.error.output = output;
    throw result.error;
  }
  assertNotInterrupted();
  if (result.status !== 0) {
    const error = new Error(`${label} failed with exit code ${result.status ?? 1}`);
    error.output = output;
    throw error;
  }
}

function isPortConflict(error) {
  return /EADDRINUSE|address already in use|port .* in use/i.test(error?.output ?? "");
}

const requestedOffset = process.env.MFDOCTOR_E2E_PORT_OFFSET;
for (let attempt = 0; attempt < MAX_GATE_ATTEMPTS; attempt += 1) {
  const { offset, release } = await chooseOffset();
  try {
    const environment = {
      ...process.env,
      MFDOCTOR_E2E_PORT_OFFSET: String(offset),
    };
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

    process.stdout.write(
      `Using E2E port offset ${offset}: ${BASE_PORTS.map((port) => port + offset).join(", ")}\n`,
    );
    run("build package", pnpm, ["build"], environment);
    run(
      "run federation matrix and cross-app gate",
      process.execPath,
      ["scripts/giga-smoke.mjs"],
      environment,
    );

    if (!(await portsAvailable(offset))) {
      if (requestedOffset !== undefined || attempt === MAX_GATE_ATTEMPTS - 1)
        throw new Error(`E2E port range ${offset} became busy before Playwright started`);
      process.stderr.write("E2E port range became busy; retrying with another range\n");
      continue;
    }
    assertNotInterrupted();

    try {
      run("run Playwright runtime smoke", pnpm, ["exec", "playwright", "test"], environment, {
        captureOutput: true,
      });
    } catch (error) {
      if (
        requestedOffset === undefined &&
        attempt < MAX_GATE_ATTEMPTS - 1 &&
        isPortConflict(error)
      ) {
        process.stderr.write("Playwright hit a port conflict; retrying with another range\n");
        continue;
      }
      throw error;
    }
    break;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (!interruptedSignal) process.exitCode = 1;
    break;
  } finally {
    await release();
  }
}
