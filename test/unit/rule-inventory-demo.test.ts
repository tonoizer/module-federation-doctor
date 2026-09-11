import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RULE_DEMO_COVERAGE,
  assertInventoryDemoCoverage,
  emitCatalogRuleIds,
  inventoryDemoCoverageErrors,
  ruleInventory,
  showcaseCatalogRuleIds,
} from "../../src/rule-inventory.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function catalogSources() {
  return {
    showcaseCatalogSource: await fs.readFile(path.join(root, "scripts/demo-showcase.mjs"), "utf8"),
    emitCatalogSource: [
      await fs.readFile(path.join(root, "scripts/demo-standalone-findings.mjs"), "utf8"),
      await fs.readFile(path.join(root, "fixtures/adapters/cases.json"), "utf8"),
    ].join("\n"),
  };
}

describe("rule inventory demo coverage (BL-10)", () => {
  it("tags every built-in as showcase, unit, or emit", () => {
    expect(RULE_DEMO_COVERAGE).toEqual(["showcase", "unit", "emit"]);
    expect(ruleInventory.length).toBeGreaterThan(0);
    expect(ruleInventory.every((entry) => RULE_DEMO_COVERAGE.includes(entry.demo))).toBe(true);
  });

  it("matches demo-showcase and standalone-findings catalogs", async () => {
    const catalogs = await catalogSources();
    expect(() => assertInventoryDemoCoverage(ruleInventory, catalogs)).not.toThrow();
    expect(showcaseCatalogRuleIds(catalogs.showcaseCatalogSource)).toEqual(
      ruleInventory
        .filter((entry) => entry.demo === "showcase")
        .map((entry) => entry.id)
        .sort(),
    );
    expect(emitCatalogRuleIds(catalogs.emitCatalogSource)).toContain(
      "config/remote-manifest-recommended",
    );
    expect(
      emitCatalogRuleIds(
        await fs.readFile(path.join(root, "fixtures/adapters/cases.json"), "utf8"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "config/remote-manifest-recommended",
        "shared/eager-without-singleton",
        "shared/version-unsatisfied",
      ]),
    );
    expect(
      ruleInventory.find((entry) => entry.id === "config/remote-manifest-recommended")?.demo,
    ).toBe("emit");
  });

  it("fails inventory:check when a new rule has no demo tag", async () => {
    const catalogs = await catalogSources();
    const errors = inventoryDemoCoverageErrors(
      [...ruleInventory, { id: "config/brand-new-rule" }],
      catalogs,
    );
    expect(errors.some((error) => /missing demo tag/.test(error))).toBe(true);
    expect(errors.join("\n")).toContain("config/brand-new-rule");
    expect(() => assertInventoryDemoCoverage([{ id: "config/brand-new-rule" }], catalogs)).toThrow(
      /missing demo tag/,
    );
  });

  it("fails when a showcase tag has no demo-showcase leaf", async () => {
    const catalogs = await catalogSources();
    expect(() =>
      assertInventoryDemoCoverage([{ id: "artifact/dts-disabled", demo: "showcase" }], catalogs),
    ).toThrow(/missing demo-showcase leaf/);
  });

  it("wires the demo gate into inventory:check", async () => {
    const generator = await fs.readFile(
      path.join(root, "scripts/generate-rule-inventory.mjs"),
      "utf8",
    );
    expect(generator).toContain("assertInventoryDemoCoverage");
    expect(generator).toContain("demo: entry.demo");
    expect(generator).toContain("scripts/demo-showcase.mjs");
    expect(generator).toContain("scripts/demo-standalone-findings.mjs");
    expect(generator).toContain("fixtures/adapters/cases.json");
  });
});

describe("emitCatalogRuleIds", () => {
  it("extracts string ids from unquoted ruleIds arrays", () => {
    expect(emitCatalogRuleIds(`ruleIds: ["config/a", "shared/b"]`)).toEqual([
      "config/a",
      "shared/b",
    ]);
    expect(emitCatalogRuleIds(`ruleIds:["compact"]`)).toEqual(["compact"]);
    expect(emitCatalogRuleIds(`ruleIds : [ "spaced" ]`)).toEqual(["spaced"]);
  });

  it("extracts string ids from quoted ruleIds keys", () => {
    expect(emitCatalogRuleIds(`"ruleIds": ["config/a"]`)).toEqual(["config/a"]);
    expect(
      emitCatalogRuleIds(`{
      "ruleIds": [
        "config/remote-manifest-recommended",
        "shared/eager-without-singleton"
      ]
    }`),
    ).toEqual(["config/remote-manifest-recommended", "shared/eager-without-singleton"]);
  });

  it("collects unique sorted ids from multiple blocks", () => {
    expect(
      emitCatalogRuleIds(`
        ruleIds: ["shared/b", "config/a"]
        "ruleIds": ["config/a", "runtime/c"]
      `),
    ).toEqual(["config/a", "runtime/c", "shared/b"]);
  });

  it("ignores empty arrays", () => {
    expect(emitCatalogRuleIds(`ruleIds: []`)).toEqual([]);
    expect(emitCatalogRuleIds(`"ruleIds": []`)).toEqual([]);
    expect(emitCatalogRuleIds(`ruleIds: [] "ruleIds": []`)).toEqual([]);
    expect(emitCatalogRuleIds(`ruleIds: [""]`)).toEqual([]);
  });

  it("closes each block at the first ] without nested quote or array parsing", () => {
    expect(emitCatalogRuleIds(`ruleIds: [["inner"], "outer"]`)).toEqual(["inner"]);
    expect(emitCatalogRuleIds(`ruleIds: ["plain-id"]`)).toEqual(["plain-id"]);
  });

  it("terminates quickly on pathological ruleIds:[ repetition", () => {
    const started = Date.now();
    const source = `${"ruleIds:[".repeat(20_000)}${'"ruleIds":['.repeat(20_000)}`;
    expect(emitCatalogRuleIds(source)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
