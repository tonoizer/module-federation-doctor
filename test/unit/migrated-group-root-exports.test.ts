import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as inventory from "../../src/rule-inventory.js";
import * as root from "../../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const migratedGroupNames = [
  "MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS",
  "MIGRATED_GROUP1_CONFIG_RULE_IDS",
  "MIGRATED_GROUP2_RULE_IDS",
  "MIGRATED_GROUP3_RULE_IDS",
  "MIGRATED_GROUP4_RULE_IDS",
  "MIGRATED_GROUP5_RULE_IDS",
  "MIGRATED_GROUP6_RULE_IDS",
] as const;

describe("migrated-group root exports", () => {
  it("does not re-export MIGRATED_GROUP* from the public root entry", () => {
    for (const name of migratedGroupNames) {
      expect(root, name).not.toHaveProperty(name);
    }
    const indexSource = readFileSync(join(repoRoot, "src/index.ts"), "utf8");
    expect(indexSource).not.toMatch(/MIGRATED_GROUP\d/);
  });

  it("keeps group id arrays on src/rule-inventory.ts for bridges and tests", () => {
    for (const name of migratedGroupNames) {
      const ids = inventory[name];
      expect(Array.isArray(ids), name).toBe(true);
      expect(ids.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps evidence bridges importing group ids from rule-inventory.js", () => {
    const ruleBridge = readFileSync(join(repoRoot, "src/evidence-rule-bridge.ts"), "utf8");
    const federationBridge = readFileSync(
      join(repoRoot, "src/evidence-federation-bridge.ts"),
      "utf8",
    );
    expect(ruleBridge).toMatch(/from "\.\/rule-inventory\.js"/);
    expect(federationBridge).toMatch(/from "\.\/rule-inventory\.js"/);
    expect(ruleBridge).toContain("MIGRATED_GROUP1_CONFIG_RULE_IDS");
    expect(federationBridge).toContain("MIGRATED_GROUP4_RULE_IDS");
    expect(ruleBridge).not.toMatch(/from "\.\/index\.js"/);
    expect(federationBridge).not.toMatch(/from "\.\/index\.js"/);
  });
});
