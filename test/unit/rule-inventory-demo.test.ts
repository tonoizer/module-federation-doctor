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
    emitCatalogSource: await fs.readFile(
      path.join(root, "scripts/demo-standalone-findings.mjs"),
      "utf8",
    ),
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
  });
});
