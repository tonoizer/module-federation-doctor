import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProjectFacts } from "../../src/collect.js";
import { resolveOptions } from "../../src/config.js";
import { writeReports } from "../../src/reporters.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function collect(moduleFederation?: Record<string, unknown>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-canonical-bridge-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"canonical-fixture"}');
  return collectProjectFacts(
    await resolveOptions({
      root,
      bundler: "webpack",
      bundlerVersion: "5.99.0",
      mode: "development",
      include: [],
      ...(moduleFederation ? { moduleFederation } : {}),
    }),
  );
}

describe("canonical declared config bridge", () => {
  it("keeps a lossless declared view beside legacy normalized facts", async () => {
    const facts = await collect({
      exposes: { "./card": { import: ["./card", "./fallback"] } },
      remotes: { cart: { external: ["cart@one", "cart@two"], type: "script" } },
      shared: { react: { singleton: false, import: false } },
      runtimePlugins: [["./plugin", { enabled: true }]],
    });

    expect(facts.canonicalConfig?.contract).toMatchObject({
      adapter: { name: "webpack", version: "5.99.0", packId: "unknown" },
      bundler: { name: "webpack", version: "5.99.0" },
      target: "unknown",
    });
    expect(facts.canonicalConfig?.declared.collections.exposes[0]?.value.value).toEqual({
      import: ["./card", "./fallback"],
    });
    expect(facts.canonicalConfig?.declared.collections.remotes[0]?.value.value).toEqual({
      external: ["cart@one", "cart@two"],
      type: "script",
    });
    expect(
      facts.canonicalConfig?.declared.fields.find((field) => field.key === "runtimePlugins")?.value
        .value,
    ).toEqual([["./plugin", { enabled: true }]]);
    expect(facts.moduleFederation?.remotes.cart?.entry).toBe("cart@one");
    expect(facts.moduleFederation?.shared.react?.singleton).toBe(false);
  });

  it("does not invent a declaration when no config was supplied", async () => {
    const facts = await collect();
    expect(facts.moduleFederation).toBeUndefined();
    expect(facts.canonicalConfig).toBeUndefined();
  });

  it("keeps the additive bridge out of persisted v1 project facts", async () => {
    const facts = await collect({ name: "persisted" });
    const directory = path.join(roots[roots.length - 1]!, ".mf", "doctor");
    await writeReports(
      facts,
      {
        schemaVersion: 1,
        capabilities: facts.capabilities,
        summary: { projects: 1, info: 0, warnings: 0, errors: 0 },
        findings: [],
      },
      directory,
      [],
    );
    const persisted = JSON.parse(await fs.readFile(path.join(directory, "project.json"), "utf8"));
    expect(persisted.canonicalConfig).toBeUndefined();
    expect(persisted.moduleFederation).toEqual(facts.moduleFederation);
  });
});
