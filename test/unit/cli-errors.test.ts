import { describe, expect, it } from "vitest";
import {
  formatCliError,
  nearestMatch,
  unknownCommandError,
  unknownFormatError,
  unknownOptionError,
} from "../../src/cli-errors.js";

describe("cli error remediations", () => {
  it("suggests the nearest command and keeps the original message", () => {
    const error = unknownCommandError("chek");
    const text = formatCliError(error);
    expect(error.message).toBe("Unknown command: chek");
    expect(error.code).toBe("usage-error");
    expect(text).toContain("error: usage-error");
    expect(text).toContain("Did you mean: check");
    expect(text).toContain("fix:");
    expect(text).toContain("next: mfdoctor check --help");
    expect(text).toContain("Usage:");
    expect(text).not.toContain("CI tip:");
  });

  it("calls out retired --ui as a non-goal", () => {
    const text = formatCliError(unknownOptionError("check", "--ui"));
    expect(text).toContain("Unknown option: --ui");
    expect(text).toContain("non-goal");
    expect(text).toContain("mfdoctor check --help");
  });

  it("lists supported report formats", () => {
    const text = formatCliError(unknownFormatError("html"));
    expect(text).toContain("Unknown output format: html");
    expect(text).toContain("terminal, json, sarif");
  });

  it("matches close command, option, and rule ids", () => {
    expect(nearestMatch("chek", ["check", "compare", "workspace"])).toBe("check");
    expect(nearestMatch("--format", ["--ci", "--format", "--no-write"])).toBe("--format");
    expect(nearestMatch("config/name-requird", ["config/name-required", "shared/unused"])).toBe(
      "config/name-required",
    );
    expect(nearestMatch("zzzz", ["check", "workspace"])).toBeUndefined();
  });
});
