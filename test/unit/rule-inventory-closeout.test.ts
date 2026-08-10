import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  ALL_MIGRATED_RULE_IDS,
  RULE_COMPATIBILITY_EXCEPTIONS,
  ruleInventory,
  ruleInventoryIds,
} from "../../src/rule-inventory.js";
import {
  migratedEvidenceRuleIds,
  migratedRuntimeEvidenceRuleIds,
} from "../../src/evidence-rule-bridge.js";
import { migratedFederationEvidenceRuleIds } from "../../src/evidence-federation-bridge.js";
import { federationRuleMeta, builtInRules, runtimeRuleMeta } from "../../src/rules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("V1 rule inventory closeout (#232)", () => {
  it("lists every current built-in without silent legacy leftovers", () => {
    const runtimeIds = [
      ...builtInRules.map((rule) => rule.meta.id),
      ...federationRuleMeta.map((rule) => rule.id),
      ...runtimeRuleMeta.map((rule) => rule.id),
    ].sort();
    expect([...ruleInventoryIds].sort()).toEqual(runtimeIds);
    expect(ruleInventory.filter((entry) => entry.status === "legacy")).toEqual([]);
    expect(RULE_COMPATIBILITY_EXCEPTIONS).toHaveLength(0);
    expect([...ALL_MIGRATED_RULE_IDS].sort()).toEqual([...ruleInventoryIds].sort());
  });

  it("wires every migrated built-in through an evidence bridge", () => {
    const bridgeIds = new Set([
      ...migratedEvidenceRuleIds,
      ...migratedRuntimeEvidenceRuleIds,
      ...migratedFederationEvidenceRuleIds,
    ]);
    expect([...bridgeIds].sort()).toEqual([...ALL_MIGRATED_RULE_IDS].sort());
  });

  it("matches the generated inventory fixture and schema", async () => {
    const fixture = JSON.parse(
      await fs.readFile(path.join(root, "fixtures/rule-inventory/v1.json"), "utf8"),
    );
    const schema = JSON.parse(
      await fs.readFile(path.join(root, "schemas/rule-inventory.schema.json"), "utf8"),
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(fixture)).toBe(true);
    expect(fixture.ruleCount).toBe(ruleInventoryIds.length);
    expect(fixture.migratedCount).toBe(ALL_MIGRATED_RULE_IDS.length);
    expect(fixture.rules.map((entry: { id: string }) => entry.id).sort()).toEqual(
      [...ruleInventoryIds].sort(),
    );
  });

  it("records release evidence for the rules closeout gate", async () => {
    const evidence = JSON.parse(
      await fs.readFile(
        path.join(root, "fixtures/evidence-rollout/v1-rules-closeout-evidence.json"),
        "utf8",
      ),
    );
    expect(evidence.inventory.ruleCount).toBe(ruleInventoryIds.length);
    expect(evidence.inventory.migratedCount).toBe(ALL_MIGRATED_RULE_IDS.length);
    expect(evidence.inventory.compatibilityExceptionCount).toBe(0);
    expect(Object.values(evidence.releaseGates).every((gate) => gate.status === "green")).toBe(
      true,
    );
  });
});
