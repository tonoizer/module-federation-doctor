#!/usr/bin/env node
/**
 * Run the complete local E2E gate on a free, shared port range.
 *
 * A fixed port can be occupied by another local app or an SSH tunnel. The
 * selected offset is passed to the example builds and Playwright so the
 * generated remote URLs always agree with the preview servers.
 */
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runPowerShell(script) {
  for (const command of ["powershell.exe", "pwsh.exe", "powershell"]) {
    try {
      const { stdout } = await execFileAsync(
        command,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", timeout: 1_000 },
      );
      return stdout.trim() || null;
    } catch {
      // Try the next PowerShell executable name when available.
    }
  }
  return null;
}

async function readProcessStartIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32")
    return runPowerShell(`(Get-Process -Id ${String(pid)}).StartTime.ToUniversalTime().Ticks`);

  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 1_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readProcessCommand(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32")
    return runPowerShell(
      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${String(pid)}').CommandLine`,
    );

  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 1_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function hasOwnedServerIdentity({ pid, startedAt }) {
  if (startedAt) {
    const currentStartIdentity = await readProcessStartIdentity(pid);
    if (!currentStartIdentity || currentStartIdentity !== startedAt) return false;
    const command = await readProcessCommand(pid);
    return Boolean(command?.includes("run-e2e-server.mjs"));
  }
  const command = await readProcessCommand(pid);
  return Boolean(command?.includes("run-e2e-server.mjs"));
}

const processStartIdentity = await readProcessStartIdentity(process.pid);
const root = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const BASE_PORTS = [3001, 3002, 3003, 3004, 3005, 3006, 5173, 3011, 3012, 5183];
const MAX_OFFSET = 20_000;
const PORT_LOCK_PREFIX = path.join(os.tmpdir(), "mfdoctor-e2e-port");
const SERVER_REGISTRY_PREFIX = "mfdoctor-e2e-";
const WORKSPACE_LOCK_PATH = path.join(
  os.tmpdir(),
  `mfdoctor-e2e-workspace-${createHash("sha256").update(root).digest("hex")}.lock`,
);
const LOCK_INIT_GRACE_MS = 30_000;
const WORKSPACE_LOCK_POLL_MS = 250;
const MAX_GATE_ATTEMPTS = 3;
const PROCESS_GROUP_WAIT_MS = 5_000;
const PROCESS_GROUP_POLL_MS = 50;
let activeChild;
let interruptedSignal;
let interruptCount = 0;
let activeServerRegistryPath;
const serverCleanupPromises = new Set();

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

async function readRegisteredServerGroups(registryPath = activeServerRegistryPath) {
  if (!registryPath) return [];

  let entries;
  try {
    entries = await fs.readdir(registryPath);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const groups = [];
  for (const entry of entries) {
    try {
      const record = JSON.parse(await fs.readFile(path.join(registryPath, entry), "utf8"));
      const pid = Number(record.pid);
      const group = Number(record.group);
      const startedAt =
        typeof record.startedAt === "string" && record.startedAt ? record.startedAt : undefined;
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(group) && group > 0)
        groups.push({ group, pid, startedAt });
    } catch {
      // A server may be writing its registry record while this snapshot is read.
    }
  }
  return groups;
}

async function terminateRegisteredServer(
  { group, pid, startedAt },
  force,
  requireOwnership = false,
) {
  if (requireOwnership && !(await hasOwnedServerIdentity({ pid, startedAt }))) return;

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", resolve);
      killer.once("close", resolve);
    });
  }

  if (!processGroupExists(group)) return Promise.resolve();
  try {
    process.kill(-group, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // The group may have exited between the liveness check and the signal.
  }
  return Promise.resolve();
}

async function cleanupRegisteredServerGroups(
  force = false,
  registryPath = activeServerRegistryPath,
  requireOwnership = false,
) {
  if (!registryPath) return;

  if (process.platform === "win32") {
    await Promise.all(
      (await readRegisteredServerGroups(registryPath)).map((server) =>
        terminateRegisteredServer(server, true, requireOwnership),
      ),
    );
    return;
  }

  const contactedGroups = new Set();
  const waitUntil = Date.now() + PROCESS_GROUP_WAIT_MS;
  while (true) {
    const liveServers = (await readRegisteredServerGroups(registryPath)).filter((server) =>
      processGroupExists(server.group),
    );
    for (const server of liveServers) {
      if (contactedGroups.has(server.group)) continue;
      contactedGroups.add(server.group);
      await terminateRegisteredServer(server, force, requireOwnership);
    }

    if (force || liveServers.length === 0 || Date.now() >= waitUntil) break;
    await new Promise((resolve) => setTimeout(resolve, PROCESS_GROUP_POLL_MS));
  }

  if (force) return;
  const remainingServers = (await readRegisteredServerGroups(registryPath)).filter((server) =>
    processGroupExists(server.group),
  );
  await Promise.all(
    remainingServers.map((server) => terminateRegisteredServer(server, true, requireOwnership)),
  );
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function registryOwnerPid(name) {
  const match = new RegExp(`^${SERVER_REGISTRY_PREFIX}(\\d+)-.*\\.servers$`).exec(name);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function cleanupStaleServerRegistries() {
  let entries;
  try {
    entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith(SERVER_REGISTRY_PREFIX) ||
      !entry.name.endsWith(".servers")
    )
      continue;
    let ownerPid = registryOwnerPid(entry.name);
    let ownerStartIdentity;
    try {
      const owner = JSON.parse(
        await fs.readFile(path.join(os.tmpdir(), entry.name, ".owner.json"), "utf8"),
      );
      const recordedPid = Number(owner.pid);
      if (Number.isInteger(recordedPid) && recordedPid > 0) ownerPid = recordedPid;
      ownerStartIdentity =
        typeof owner.startedAt === "string" && owner.startedAt ? owner.startedAt : undefined;
    } catch {
      // Registries from older runner versions only encode the owner PID in the directory name.
    }
    if (!ownerPid) continue;
    if (processExists(ownerPid)) {
      if (!ownerStartIdentity) continue;
      const currentStartIdentity = await readProcessStartIdentity(ownerPid);
      if (!currentStartIdentity || currentStartIdentity === ownerStartIdentity) continue;
    }

    const registryPath = path.join(os.tmpdir(), entry.name);
    const liveServers = (await readRegisteredServerGroups(registryPath)).filter((server) =>
      processGroupExists(server.group),
    );
    const ownership = await Promise.all(liveServers.map(hasOwnedServerIdentity));
    if (ownership.some((owned) => !owned)) {
      process.stderr.write(`E2E stale server registry retained: ${entry.name}\n`);
      continue;
    }
    await cleanupRegisteredServerGroups(false, registryPath, true);
    await fs.rm(registryPath, { force: true, recursive: true });
  }
}

function scheduleServerCleanup(force = false) {
  if (!activeServerRegistryPath) return;
  const cleanup = cleanupRegisteredServerGroups(force).catch((error) => {
    process.stderr.write(
      `E2E server cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });
  serverCleanupPromises.add(cleanup);
  cleanup.then(
    () => serverCleanupPromises.delete(cleanup),
    () => serverCleanupPromises.delete(cleanup),
  );
}

async function waitForScheduledServerCleanup() {
  while (serverCleanupPromises.size > 0) await Promise.all(serverCleanupPromises);
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

const interruptSignals =
  process.platform === "win32" ? ["SIGINT", "SIGTERM"] : ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of interruptSignals) {
  process.on(signal, () => {
    interruptCount += 1;
    interruptedSignal ??= signal;
    process.exitCode = signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143;
    terminateActiveChild(signal, interruptCount > 1);
    scheduleServerCleanup(interruptCount > 1);
  });
}

function assertNotInterrupted() {
  if (interruptedSignal) throw new Error(`E2E run interrupted by ${interruptedSignal}`);
}

async function reclaimStaleLock(lockPath) {
  let stat;
  try {
    stat = await fs.stat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }

  if (Date.now() - stat.mtimeMs < LOCK_INIT_GRACE_MS) return false;

  let ownerPid;
  let ownerStartIdentity;
  let ownerKind;
  try {
    const contents = (await fs.readFile(lockPath, "utf8")).trim();
    try {
      const owner = JSON.parse(contents);
      ownerPid = Number(owner.pid);
      ownerStartIdentity =
        typeof owner.startedAt === "string" && owner.startedAt ? owner.startedAt : undefined;
      ownerKind = typeof owner.kind === "string" ? owner.kind : undefined;
    } catch {
      ownerPid = Number(contents);
    }
  } catch {
    ownerPid = Number.NaN;
  }

  if (Number.isInteger(ownerPid) && ownerPid > 0) {
    if (processExists(ownerPid)) {
      if (!ownerStartIdentity) return false;
      const currentStartIdentity = await readProcessStartIdentity(ownerPid);
      if (!currentStartIdentity) return false;
      if (currentStartIdentity === ownerStartIdentity) {
        if (ownerKind !== "run-e2e") return false;
        const command = await readProcessCommand(ownerPid);
        if (!command || command.includes("run-e2e.mjs")) return false;
      }
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

async function tryAcquireLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({
          kind: "run-e2e",
          pid: process.pid,
          startedAt: processStartIdentity,
        })}\n`,
      );
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
      if (await reclaimStaleLock(lockPath)) continue;
      return null;
    }
  }

  return null;
}

function portLockPath(port) {
  return `${PORT_LOCK_PREFIX}-${port}.lock`;
}

async function tryAcquirePortLocks(offset) {
  const ports = BASE_PORTS.map((port) => port + offset).sort((a, b) => a - b);
  const releases = [];

  for (const port of ports) {
    const release = await tryAcquireLock(portLockPath(port));
    if (release) {
      releases.push(release);
      continue;
    }

    await Promise.all(releases.toReversed().map((releasePort) => releasePort()));
    return null;
  }

  return async () => {
    await Promise.all(releases.toReversed().map((releasePort) => releasePort()));
  };
}

async function acquireWorkspaceLock() {
  while (true) {
    assertNotInterrupted();
    const release = await tryAcquireLock(WORKSPACE_LOCK_PATH);
    if (release) return release;
    await new Promise((resolve) => setTimeout(resolve, WORKSPACE_LOCK_POLL_MS));
  }
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
    const release = await tryAcquirePortLocks(offset);
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
  throw new Error(`Could not find ten free E2E ports within offset range 0-${MAX_OFFSET}`);
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
      scheduleServerCleanup();
      await waitForScheduledServerCleanup();
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
  return /EADDRINUSE|address already in use|is already used|port .* in use/i.test(
    error?.output ?? "",
  );
}

const requestedOffset = process.env.MFDOCTOR_E2E_PORT_OFFSET;
const forwardedArgs = process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2);
const playwrightArgs = ["exec", "playwright", "test", ...forwardedArgs];
let releaseWorkspace;
try {
  await cleanupStaleServerRegistries();
  releaseWorkspace = await acquireWorkspaceLock();
  for (let attempt = 0; attempt < MAX_GATE_ATTEMPTS; attempt += 1) {
    const { offset, release } = await chooseOffset();
    const serverRegistryPath = path.join(
      os.tmpdir(),
      `${SERVER_REGISTRY_PREFIX}${process.pid}-${offset}-${randomUUID()}.servers`,
    );
    try {
      await fs.rm(serverRegistryPath, { force: true, recursive: true });
      await fs.mkdir(serverRegistryPath, { recursive: true });
      await fs.writeFile(
        path.join(serverRegistryPath, ".owner.json"),
        `${JSON.stringify({ pid: process.pid, startedAt: processStartIdentity })}\n`,
      );
      activeServerRegistryPath = serverRegistryPath;
      const environment = {
        ...process.env,
        MFDOCTOR_E2E_PORT_OFFSET: String(offset),
        MFDOCTOR_E2E_SERVER_REGISTRY: serverRegistryPath,
      };
      const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

      process.stdout.write(
        `Using E2E port offset ${offset}: ${BASE_PORTS.map((port) => port + offset).join(", ")}\n`,
      );
      await run("build package", pnpm, ["build"], environment);
      await run(
        "clean E2E Doctor artifacts",
        process.execPath,
        ["scripts/clean-e2e-artifacts.mjs"],
        environment,
      );
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
      process.stdout.write("FULL_E2E_GATE_OK\n");
      process.stdout.write("GIGA_SMOKE_OK\n");
      break;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      if (!interruptedSignal) process.exitCode = 1;
      break;
    } finally {
      try {
        scheduleServerCleanup();
        await waitForScheduledServerCleanup();
        await fs.rm(serverRegistryPath, { force: true, recursive: true });
        activeServerRegistryPath = undefined;
      } finally {
        await release();
      }
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  if (!interruptedSignal) process.exitCode = 1;
} finally {
  await releaseWorkspace?.();
}
