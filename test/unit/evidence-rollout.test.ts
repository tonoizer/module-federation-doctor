import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LEGACY_ENV,
  RELEASE_GATES,
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
});
