import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validatePayload } from "../helpers/schema-contract.js";
import { discoverWorkspaceProjects } from "../../src/workspace.js";
import type { ProjectFacts } from "../../src/types.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = path.join(repository, "fixtures");

async function readJson<T>(relativePath: string): Promise<T> {
  const text = await fs.readFile(path.join(repository, relativePath), "utf8");
  return JSON.parse(text) as T;
}

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.join(repository, relativePath), "utf8");
}

describe("mf-toolkit fixtures (offline, #145)", () => {
  it("loads mf-bridge-entry host/remote project facts without network", async () => {
    const host = await readJson<ProjectFacts>(
      "fixtures/mf-bridge-entry/host/.mf/doctor/project.json",
    );
    const remote = await readJson<ProjectFacts>(
      "fixtures/mf-bridge-entry/remote/.mf/doctor/project.json",
    );

    await validatePayload(
      "project.schema.json",
      host,
      "fixtures/mf-bridge-entry/host/.mf/doctor/project.json",
    );
    await validatePayload(
      "project.schema.json",
      remote,
      "fixtures/mf-bridge-entry/remote/.mf/doctor/project.json",
    );

    expect(remote.moduleFederation?.exposes?.["./entry"]).toBe("./src/entry.ts");
    expect(host.moduleFederation?.remotes?.remote?.entry).toContain("mf-manifest.json");

    const entrySource = await readText("fixtures/mf-bridge-entry/remote/src/entry.ts");
    expect(entrySource).toMatch(/export function createMFEntry/);
    expect(entrySource).toMatch(/export function defineMFEntry/);
    expect(entrySource).toMatch(/export const register/);

    const hostSource = await readText("fixtures/mf-bridge-entry/host/src/HostSlot.tsx");
    expect(hostSource).toMatch(/register=\{\(\) => import\(["']remote\/entry["']\)/);
  });

  it("loads mf-ssr-fragment remotes in fragment URL mode (not remoteEntry.js)", async () => {
    const host = await readJson<ProjectFacts>(
      "fixtures/mf-ssr-fragment/host/.mf/doctor/project.json",
    );
    await validatePayload(
      "project.schema.json",
      host,
      "fixtures/mf-ssr-fragment/host/.mf/doctor/project.json",
    );

    const remotes = host.moduleFederation?.remotes ?? {};
    expect(remotes.checkout?.entry).toBe("https://checkout.example.com/api/fragments/checkout");
    expect(remotes.checkout?.entry).not.toMatch(/remoteEntry\.js/);
    // Do not invent MF remote `type`; fragment URL/path is the recognition signal.
    expect(remotes.checkout?.type).toBeUndefined();
    expect(remotes.checkoutRelative?.entry).toBe("/api/fragments/checkout");
    expect(remotes.checkoutRelative?.type).toBeUndefined();
    expect(host.imports.remotes?.slice().sort()).toEqual(["checkout", "checkoutRelative"]);

    const remoteFacts = await readJson<ProjectFacts>(
      "fixtures/mf-ssr-fragment/remote/.mf/doctor/project.json",
    );
    expect(remoteFacts.moduleFederation?.exposes?.["./fragment"]).toBe("./src/fragment-route.ts");

    const slot = await readText("fixtures/mf-ssr-fragment/host/src/CheckoutSlot.tsx");
    expect(slot).toMatch(/CHECKOUT_FRAGMENT_URL/);
    expect(slot).toMatch(/url=\{CHECKOUT_FRAGMENT_URL\}/);
  });

  it("loads shared-inspector-mf2 shared-array evidence without network", async () => {
    const project = await readJson<ProjectFacts>(
      "fixtures/shared-inspector-mf2/.mf/doctor/project.json",
    );
    await validatePayload(
      "project.schema.json",
      project,
      "fixtures/shared-inspector-mf2/.mf/doctor/project.json",
    );

    const manifest = project.artifacts.manifest as {
      path?: string;
      valid?: boolean;
      shared?: Array<{ name: string; assets?: string[]; from?: string }>;
    };
    expect(manifest.path).toBe("shell.mf-manifest.json");
    expect(manifest.valid).toBe(true);
    expect(Array.isArray(manifest.shared)).toBe(true);
    expect(manifest.shared?.map((entry) => entry.name).sort()).toEqual([
      "react",
      "react-dom",
      "zustand",
    ]);
    // Doctor-normalized ArtifactManifest does not retain MF2 `from`.
    expect(manifest.shared?.every((entry) => entry.from === undefined)).toBe(true);
    expect(manifest.shared?.every((entry) => Array.isArray(entry.assets))).toBe(true);

    const shell = await readJson<{ shared: unknown[]; name: string }>(
      "fixtures/shared-inspector-mf2/shell.mf-manifest.json",
    );
    const checkout = await readJson<{ shared: unknown[]; name: string }>(
      "fixtures/shared-inspector-mf2/checkout.mf-manifest.json",
    );
    const inherited = await readJson<{
      shared: Array<{ name: string; from?: string }>;
    }>("fixtures/shared-inspector-mf2/inherited-shared.mf-manifest.json");

    expect(shell.name).toBe("shell");
    expect(Array.isArray(shell.shared)).toBe(true);
    expect(checkout.name).toBe("checkout");
    expect(Array.isArray(checkout.shared)).toBe(true);
    expect(inherited.shared.some((entry) => entry.from === "host")).toBe(true);
    expect(inherited.shared.some((entry) => entry.from === "remote-a")).toBe(true);
  });

  it("discovers toolkit golden trees via workspace project.json globs", async () => {
    const bridge = await discoverWorkspaceProjects({
      cwd: repository,
      roots: ["fixtures/mf-bridge-entry"],
    });
    expect(bridge).toHaveLength(2);

    const ssr = await discoverWorkspaceProjects({
      cwd: repository,
      roots: ["fixtures/mf-ssr-fragment"],
    });
    expect(ssr).toHaveLength(2);

    const inspector = await discoverWorkspaceProjects({
      cwd: repository,
      roots: ["fixtures/shared-inspector-mf2"],
    });
    expect(inspector).toHaveLength(1);
  });

  it("keeps classic component expose fixtures analyzable (negative control)", async () => {
    const classic = await readJson<ProjectFacts>(
      "fixtures/workspaces/clean/remote/.mf/doctor/project.json",
    );
    await validatePayload(
      "project.schema.json",
      classic,
      "fixtures/workspaces/clean/remote/.mf/doctor/project.json",
    );

    expect(classic.moduleFederation?.exposes?.["./Widget"]).toBe("./src/Widget.tsx");
    expect(classic.moduleFederation?.exposes?.["./entry"]).toBeUndefined();

    // Toolkit fixtures must not replace the classic baseline path.
    const classicRoot = path.join(fixtures, "workspaces/clean/remote");
    await expect(fs.stat(classicRoot)).resolves.toBeTruthy();
  });
});
