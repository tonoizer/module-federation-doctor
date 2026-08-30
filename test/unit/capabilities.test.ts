import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveBundlerMatrix,
  loadCliCapabilities,
  type CompatibilityMatrixDocument,
} from "../../src/capabilities.js";
import { validatePayload } from "../helpers/schema-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("CLI capabilities discovery contract", () => {
  it("includes agent non-goals, completeness, action, and network policy", async () => {
    const capabilities = await loadCliCapabilities();
    expect(capabilities.nonGoals).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/HTML/i),
        expect.stringMatching(/in-browser/i),
        expect.stringMatching(/MCP/i),
        expect.stringMatching(/--fix/i),
        expect.stringMatching(/Unsolicited network probe/i),
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
      expect.arrayContaining(["modern", "rolldown"]),
    );
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
