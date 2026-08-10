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

type CloseoutReleaseGate = {
  status: "green" | "red" | "yellow";
  evidence: readonly string[];
};

type CloseoutEvidence = {
  inventory: {
    ruleCount: number;
    migratedCount: number;
    compatibilityExceptionCount: number;
  };
  releaseGates: Record<string, CloseoutReleaseGate>;
};

const EXPECTED_RELEASE_GATES = [
  "dependency",
  "schema",
  "parity",
  "matrix",
  "migration",
  "security",
  "performance",
  "stability",
  "rollback",
  "docs",
] as const;

function isCloseoutReleaseGate(value: unknown): value is CloseoutReleaseGate {
  if (!value || typeof value !== "object") return false;
  const gate = value as Record<string, unknown>;
  return (
    (gate.status === "green" || gate.status === "red" || gate.status === "yellow") &&
    Array.isArray(gate.evidence) &&
    gate.evidence.every((entry) => typeof entry === "string")
  );
}

function isCloseoutEvidence(value: unknown): value is CloseoutEvidence {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const inventory = record.inventory;
  if (!inventory || typeof inventory !== "object") return false;
  const releaseGates = record.releaseGates;
  if (!releaseGates || typeof releaseGates !== "object") return false;
  return Object.values(releaseGates).every(isCloseoutReleaseGate);
}

function evidenceEntryPath(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed.includes("/") && !trimmed.includes("\\")) return null;
  const pathPart = trimmed.split(/\s+/)[0] ?? "";
  return pathPart.length > 0 ? pathPart : null;
}

async function evidencePathExists(entry: string): Promise<boolean> {
  const pathPart = evidenceEntryPath(entry);
  if (!pathPart) return true;
  try {
    await fs.access(path.join(root, pathPart));
    return true;
  } catch {
    return false;
  }
}

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
    const parsed: unknown = JSON.parse(
      await fs.readFile(
        path.join(root, "fixtures/evidence-rollout/v1-rules-closeout-evidence.json"),
        "utf8",
      ),
    );
    expect(isCloseoutEvidence(parsed)).toBe(true);
    if (!isCloseoutEvidence(parsed)) return;

    const evidence = parsed;
    expect(evidence.inventory.ruleCount).toBe(ruleInventoryIds.length);
    expect(evidence.inventory.migratedCount).toBe(ALL_MIGRATED_RULE_IDS.length);
    expect(evidence.inventory.compatibilityExceptionCount).toBe(0);

    expect(Object.keys(evidence.releaseGates).sort()).toEqual([...EXPECTED_RELEASE_GATES].sort());
    for (const gateName of EXPECTED_RELEASE_GATES) {
      const gate = evidence.releaseGates[gateName];
      expect(gate, `missing release gate: ${gateName}`).toBeDefined();
      if (!gate) continue;
      expect(gate.status, `${gateName} gate status`).toBe("green");
      expect(gate.evidence.length, `${gateName} gate evidence`).toBeGreaterThan(0);
      for (const entry of gate.evidence) {
        expect(await evidencePathExists(entry), `${gateName} evidence path: ${entry}`).toBe(true);
      }
    }
  });
});
