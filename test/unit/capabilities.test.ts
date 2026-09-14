import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLI_OPERATIONS,
  deriveBundlerMatrix,
  loadCliCapabilities,
  type CompatibilityMatrixDocument,
} from "../../src/capabilities.js";
import { parseArgs } from "../../src/cli.js";
import { validatePayload } from "../helpers/schema-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("CLI capabilities discovery contract", () => {
  it("publishes a versioned operation contract and derives command discovery from it", async () => {
    const capabilities = await loadCliCapabilities();
    const operationNames = Object.keys(CLI_OPERATIONS).sort();
    expect(capabilities.operations.schemaVersion).toBe(1);
    expect(Object.keys(capabilities.operations.commands).sort()).toEqual(operationNames);
    expect(Object.keys(capabilities.commands).sort()).toEqual(operationNames);

    for (const name of operationNames) {
      const operation = capabilities.operations.commands[name]!;
      expect(capabilities.commands[name]).toMatchObject({
        description: operation.description,
        network: operation.network.mode === "network",
      });
      expect(operation.arguments).toBeDefined();
      expect(operation.options).toBeDefined();
      expect(operation.prerequisites.length).toBeGreaterThan(0);
      expect(operation.writtenArtifacts).toBeDefined();
      expect(operation.errorCodes).toBeDefined();
    }

    expect(capabilities.operations.commands.check).toMatchObject({
      arguments: [expect.objectContaining({ name: "root", required: false })],
      network: { mode: "offline", userInitiated: false },
    });
    expect(capabilities.operations.commands.check?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "--ci" }),
        expect.objectContaining({ name: "--diagnostics-prompts", minimum: 1, maximum: 25 }),
      ]),
    );
    expect(capabilities.operations.commands.probe?.network).toMatchObject({
      mode: "network",
      userInitiated: true,
    });
    expect(capabilities.operations.commands.probe?.errorCodes).toHaveProperty("ssrf-blocked");
    expect(capabilities.operations.commands.compare?.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "--format" })]),
    );
    expect(capabilities.networkPolicy.networkCommands).toEqual(["compare", "probe"]);
    expect(capabilities.operations.commands.runtime?.network.mode).toBe("offline");
    expect(capabilities.operations.commands.runtime?.writtenArtifacts).toContain(
      "<diagnostics-dir>/verification-plan.json",
    );

    // The current parser/help surface remains the source of truth for CLI
    // acceptance; this test keeps the discovered contract from silently
    // drifting away from its documented command names and key option forms.
    expect(parseArgs(["check", "--ci", "--diagnostics-prompts", "4"]).command).toBe("check");
    expect(parseArgs(["workspace", "apps", "--glob", "**/project.json"]).workspace).toBe(true);
    expect(parseArgs(["runtime", "./trace.json"]).trace).toBe("./trace.json");
  });

  it("includes agent non-goals, completeness, action, and network policy", async () => {
    const capabilities = await loadCliCapabilities();
    expect(capabilities.nonGoals).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/HTML/i),
        expect.stringMatching(/in-browser/i),
        expect.stringMatching(/MCP/i),
        expect.stringMatching(/--fix/i),
        expect.stringMatching(
          /No network command.*including.*compare.*probe.*explicitly requested/i,
        ),
        expect.stringMatching(/Unsolicited suppressions/i),
      ]),
    );
    expect(capabilities.completeness).toMatchObject({
      check: expect.stringMatching(/one-project/i),
      emit: expect.stringMatching(/post-emit/i),
      workspace: expect.stringMatching(/cross-project/i),
      probe: expect.stringMatching(/explicit/i),
      runtime: expect.stringMatching(/offline/i),
    });
    expect(capabilities.githubAction).toMatchObject({
      name: "workspace-federation-gate",
      uses: "tonoizer/module-federation-doctor/.github/actions/workspace-federation-gate",
      pinToTag: expect.stringMatching(/release tag/i),
    });
    expect(capabilities.networkPolicy).toMatchObject({
      offlineByDefault: true,
      networkCommands: ["compare", "probe"],
      probe: {
        httpsRequired: true,
        ssrfProtection: true,
        defaultMaxBytes: 2 * 1024 * 1024,
        neverExecutesRemoteEntry: true,
      },
    });
    expect(capabilities.commands).toHaveProperty("compare");
    await validatePayload("capabilities.schema.json", capabilities, "live CLI capabilities");
  });

  it("derives bundlerMatrix from fixtures/compatibility-matrix.json", async () => {
    const matrix = JSON.parse(
      await fs.readFile(path.join(root, "fixtures/compatibility-matrix.json"), "utf8"),
    ) as CompatibilityMatrixDocument;
    const derived = deriveBundlerMatrix(matrix);
    const capabilities = await loadCliCapabilities();

    expect(capabilities.bundlerMatrix).toEqual(derived);
    expect(capabilities.bundlerMatrix.source).toBe("./fixtures/compatibility-matrix.json");
    expect(capabilities.bundlerMatrix.supported).toEqual(
      matrix.bundlers.filter((entry) => entry.status === "supported").map((entry) => entry.id),
    );
    expect(capabilities.bundlerMatrix.partial).toEqual(
      matrix.bundlers.filter((entry) => entry.status === "partial").map((entry) => entry.id),
    );
    expect(capabilities.bundlerMatrix.localCi.map((cell) => cell.id)).toEqual(
      matrix.localCi.map((cell) => cell.id),
    );
    expect(capabilities.bundlerMatrix.supported).toEqual(
      expect.arrayContaining(["vite", "rspack", "rsbuild", "webpack"]),
    );
    expect(capabilities.bundlerMatrix.partial).toEqual(
      expect.arrayContaining(["modern", "rolldown", "nuxt"]),
    );
    expect(capabilities.bundlerMatrix.bundlers).toEqual(
      expect.arrayContaining([
        { id: "nuxt", status: "partial", adapter: "@tonoizer/mfdoctor/nuxt" },
      ]),
    );
    expect(capabilities.bundlerMatrix.supported).not.toContain("nuxt");
  });

  it("rejects localCi cells that invent bundlers outside the matrix", () => {
    expect(() =>
      deriveBundlerMatrix({
        schemaVersion: 1,
        bundlers: [{ id: "vite", status: "supported", adapter: "@tonoizer/mfdoctor/vite" }],
        localCi: [
          {
            id: "mystery",
            bundler: "parcel",
            fixture: "examples/mystery",
          },
        ],
      }),
    ).toThrow(/unknown bundler "parcel"/);
  });
});
