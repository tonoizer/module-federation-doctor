import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LEGACY_ENV,
  RELEASE_GATES,
  ROLLOUT_SCOPES,
  RolloutGateError,
  createEvidenceRolloutController,
} from "../../src/evidence-rollout.js";

const greenGates = Object.fromEntries(RELEASE_GATES.map((gate) => [gate, true]));

describe("evidence rollout controller", () => {
  it("keeps every scope on legacy by default", () => {
    const controller = createEvidenceRolloutController();

    expect(Object.values(controller.modes()).every((mode) => mode === "legacy")).toBe(true);
    expect(controller.emergencyLegacy).toBe(false);
  });

  it("supports independent scoped modes without mutating the source", () => {
    const controller = createEvidenceRolloutController({
      defaultMode: "shadow",
      scopes: { rules: "v2-preview", "runtime-reports": "shadow" },
    });

    const next = controller.withModes({ rules: "shadow" });
    expect(controller.modeFor("rules")).toBe("v2-preview");
    expect(next.modeFor("rules")).toBe("shadow");
    expect(next.modeFor("config")).toBe("shadow");
    expect(next.modeFor("governance")).toBe("shadow");
  });

  it("requires every release gate before v2-compat promotion", () => {
    const controller = createEvidenceRolloutController({ scopes: { config: "shadow" } });

    expect(() => controller.promoteToCompat("config", { dependency: true })).toThrow(
      RolloutGateError,
    );
    try {
      controller.promoteToCompat("config", { dependency: true });
    } catch (error) {
      expect(error).toMatchObject({ scope: "config", missingGates: RELEASE_GATES.slice(1) });
    }

    expect(controller.promoteToCompat("config", greenGates).modeFor("config")).toBe("v2-compat");
  });

  it("requires shadow as the promotion starting point", () => {
    const controller = createEvidenceRolloutController({ scopes: { config: "legacy" } });

    expect(() => controller.promoteToCompat("config", greenGates)).toThrow(
      /must be in shadow mode/,
    );
  });

  it("does not let generic configuration bypass compat gates", () => {
    expect(() => createEvidenceRolloutController({ scopes: { config: "v2-compat" } })).toThrow(
      /only be entered through promoteToCompat/,
    );
    const controller = createEvidenceRolloutController({ scopes: { config: "shadow" } });
    expect(() => controller.withModes({ config: "v2-compat" })).toThrow(
      /only be entered through promoteToCompat/,
    );
  });

  it("rejects unknown scopes from JavaScript callers", () => {
    const controller = createEvidenceRolloutController();

    expect(() => controller.modeFor("confg" as never)).toThrow(/Unknown evidence rollout scope/);
    expect(() => createEvidenceRolloutController({ scopes: { confg: "shadow" } as never })).toThrow(
      /Unknown rollout scope key/,
    );
    expect(() => controller.withModes({ confg: "shadow" } as never)).toThrow(
      /Unknown rollout scope key/,
    );
    expect(() => controller.promoteToCompat("confg" as never, greenGates)).toThrow(
      /Unknown evidence rollout scope/,
    );
  });

  it("forces all scopes back to legacy with the emergency switch", () => {
    const controller = createEvidenceRolloutController({
      defaultMode: "shadow",
      scopes: { config: "v2-preview", rules: "shadow" },
      env: { [EVIDENCE_LEGACY_ENV]: "1" },
    });

    expect(controller.emergencyLegacy).toBe(true);
    expect(Object.values(controller.modes()).every((mode) => mode === "legacy")).toBe(true);
  });

  it("freezes public collections and keeps mutation attempts out of validation", () => {
    expect(Object.isFrozen(ROLLOUT_SCOPES)).toBe(true);
    expect(Object.isFrozen(RELEASE_GATES)).toBe(true);
    try {
      (ROLLOUT_SCOPES as unknown as string[]).push("unknown");
    } catch {
      // Frozen arrays throw in strict mode.
    }
    try {
      (RELEASE_GATES as unknown as string[]).pop();
    } catch {
      // Frozen arrays throw in strict mode.
    }
    expect(ROLLOUT_SCOPES).toHaveLength(7);
    expect(RELEASE_GATES).toHaveLength(10);
    expect(() =>
      createEvidenceRolloutController({ scopes: { unknown: "shadow" } as never }),
    ).toThrow(/Unknown rollout scope key/);
    expect(
      createEvidenceRolloutController({ scopes: { config: "shadow" } }).modeFor("config"),
    ).toBe("shadow");
  });

  it("freezes controller state and keeps rollback precedence immutable", () => {
    const controller = createEvidenceRolloutController({ defaultMode: "shadow" });
    expect(Object.isFrozen(controller)).toBe(true);
    try {
      (controller as { defaultMode: string }).defaultMode = "v2-compat";
    } catch {
      // Frozen controller properties throw in strict mode.
    }
    expect(controller.defaultMode).toBe("shadow");

    const emergency = createEvidenceRolloutController({
      defaultMode: "shadow",
      scopes: { config: "shadow" },
      env: { [EVIDENCE_LEGACY_ENV]: "1" },
    });
    try {
      (emergency as { emergencyLegacy: boolean }).emergencyLegacy = false;
    } catch {
      // Frozen controller properties throw in strict mode.
    }
    expect(emergency.modeFor("config")).toBe("legacy");

    const output = controller.modes() as Record<string, string>;
    expect(Object.isFrozen(output)).toBe(true);
    try {
      output.config = "v2-compat";
    } catch {
      // Frozen mode views throw in strict mode.
    }
    expect(controller.modeFor("config")).toBe("shadow");
  });

  it("snapshots stateful scope and gate proxies exactly once", () => {
    let scopeReads = 0;
    let scopeValue: string = "shadow";
    const scopedModes = new Proxy(
      { config: "shadow" },
      {
        get(target, key) {
          if (key === "config") {
            scopeReads += 1;
            const result = scopeValue;
            scopeValue = "v2-compat";
            return result;
          }
          return Reflect.get(target, key);
        },
      },
    );
    const controller = createEvidenceRolloutController({ scopes: scopedModes as never });
    expect(scopeReads).toBe(1);
    expect(controller.modeFor("config")).toBe("shadow");

    const gateReads = new Map<string, number>();
    const statefulGates = new Proxy(greenGates, {
      get(target, key) {
        if (typeof key === "string" && RELEASE_GATES.includes(key as never)) {
          const reads = (gateReads.get(key) ?? 0) + 1;
          gateReads.set(key, reads);
          return reads === 1;
        }
        return Reflect.get(target, key);
      },
    });
    const promoted = controller.promoteToCompat("config", statefulGates as never);
    expect(promoted.modeFor("config")).toBe("v2-compat");
    expect([...gateReads.values()]).toEqual(RELEASE_GATES.map(() => 1));
  });

  it("ignores inherited scope keys and rejects arrays and polluted own keys", () => {
    const inherited = Object.create({ config: "shadow" }) as Record<string, string>;
    expect(createEvidenceRolloutController({ scopes: inherited }).modeFor("config")).toBe("legacy");
    expect(() => createEvidenceRolloutController({ scopes: ["shadow"] as never })).toThrow(
      /non-array object/,
    );
    expect(() =>
      createEvidenceRolloutController({ scopes: { ["__proto__"]: "shadow" } as never }),
    ).toThrow(/Unknown rollout scope key/);
    const controller = createEvidenceRolloutController();
    expect(() => controller.withModes(["shadow"] as never)).toThrow(/non-array object/);
  });
});
