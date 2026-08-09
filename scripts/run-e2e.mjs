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
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_PORTS = [3001, 3002, 5173, 3011, 3012, 5183];
const MAX_OFFSET = 20_000;
const LOCK_PREFIX = path.join(os.tmpdir(), "mfdoctor-e2e");
const LOCK_INIT_GRACE_MS = 30_000;
const MAX_GATE_ATTEMPTS = 3;
const PROCESS_GROUP_WAIT_MS = 5_000;
const PROCESS_GROUP_POLL_MS = 50;
let activeChild;
let interruptedSignal;
let interruptCount = 0;

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForProcessGroupExit(pid) {
  if (process.platform === "win32") return;

  const waitUntil = Date.now() + PROCESS_GROUP_WAIT_MS;
  while (processGroupExists(pid) && Date.now() < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, PROCESS_GROUP_POLL_MS));
  }
  if (!processGroupExists(pid)) return;

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    return;
  }
  const forceWaitUntil = Date.now() + PROCESS_GROUP_WAIT_MS;
  while (processGroupExists(pid) && Date.now() < forceWaitUntil) {
    await new Promise((resolve) => setTimeout(resolve, PROCESS_GROUP_POLL_MS));
  }
}

function terminateActiveChild(signal, force = false) {
  const child = activeChild;
  if (!child?.pid) return;

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-child.pid, force ? "SIGKILL" : signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The child may have exited between the signal and cleanup.
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interruptCount += 1;
    interruptedSignal ??= signal;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    terminateActiveChild(signal, interruptCount > 1);
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

async function run(label, command, args, env, { captureOutput = false } = {}) {
  assertNotInterrupted();
  process.stdout.write(`\n▶ ${label}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32" && command.endsWith(".cmd"),
      detached: process.platform !== "win32",
      env,
      windowsHide: process.platform === "win32",
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const output = () => `${stdout}${stderr}`;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (activeChild === child) activeChild = undefined;
      if (error) reject(error);
      else resolve();
    };

    if (captureOutput) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        process.stderr.write(chunk);
      });
    }

    child.once("error", (error) => {
      error.output = output();
      finish(error);
    });
    child.once("close", async (code, signal) => {
      await waitForProcessGroupExit(child.pid);
      if (interruptedSignal) {
        const error = new Error(`E2E run interrupted by ${interruptedSignal}`);
        error.output = output();
        finish(error);
        return;
      }
      if (code !== 0) {
        const detail = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
        const error = new Error(`${label} failed with ${detail}`);
        error.output = output();
        finish(error);
        return;
      }
      finish();
    });
  });
}

function isPortConflict(error) {
  return /EADDRINUSE|address already in use|port .* in use/i.test(error?.output ?? "");
}

const requestedOffset = process.env.MFDOCTOR_E2E_PORT_OFFSET;
const forwardedArgs = process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2);
const playwrightArgs = ["exec", "playwright", "test", ...forwardedArgs];
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
    await run("build package", pnpm, ["build"], environment);
    await run(
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
      await run("run Playwright runtime smoke", pnpm, playwrightArgs, environment, {
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
