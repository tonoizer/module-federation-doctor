import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyBaseline,
  entryMatchesFinding,
  generateBaseline,
  loadBaseline,
  parseBaseline,
  policyFails,
  pruneBaseline,
  resolveBaselineOptions,
  updateBaseline,
  writeBaselineFile,
} from "../../src/baseline.js";
import { analyze } from "../../src/engine.js";
import type { DoctorFinding } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function finding(
  partial: Pick<DoctorFinding, "fingerprint" | "ruleId" | "project" | "severity"> &
    Partial<DoctorFinding>,
): DoctorFinding {
  return {
    schemaVersion: 1,
    message: partial.message ?? "finding",
    evidence: partial.evidence ?? {},
    ...partial,
  };
}

describe("baseline matching", () => {
  it("matches by fingerprint and optional ruleId/project", () => {
    const target = finding({
      fingerprint: "fp-1",
      ruleId: "config/name-required",
      project: "host",
      severity: "error",
    });
    expect(entryMatchesFinding({ fingerprint: "fp-1" }, target)).toBe(true);
    expect(
      entryMatchesFinding({ fingerprint: "fp-1", ruleId: "config/name-required" }, target),
    ).toBe(true);
    expect(entryMatchesFinding({ fingerprint: "fp-1", project: "host" }, target)).toBe(true);
    expect(
      entryMatchesFinding(
        { fingerprint: "fp-1", ruleId: "config/name-required", project: "other" },
        target,
      ),
    ).toBe(false);
    expect(entryMatchesFinding({ fingerprint: "fp-other" }, target)).toBe(false);
  });

  it("marks matched findings suppressed and reports stale entries", () => {
    const findings = [
      finding({
        fingerprint: "keep",
        ruleId: "config/name-required",
        project: "host",
        severity: "error",
      }),
      finding({
        fingerprint: "new",
        ruleId: "shared/singleton-mismatch",
        project: "host",
        severity: "warning",
      }),
    ];
    const applied = applyBaseline(findings, {
      schemaVersion: 1,
      entries: [
        {
          fingerprint: "keep",
          ruleId: "config/name-required",
          project: "host",
          reason: "legacy debt",
        },
        { fingerprint: "gone", ruleId: "artifact/remote-entry-missing", project: "host" },
      ],
    });
    expect(applied.matched).toBe(1);
    expect(applied.stale).toHaveLength(1);
    expect(applied.stale[0]?.fingerprint).toBe("gone");
    expect(applied.findings.find((item) => item.fingerprint === "keep")).toMatchObject({
      suppressed: true,
      suppressionReason: "legacy debt",
    });
    expect(applied.findings.find((item) => item.fingerprint === "new")?.suppressed).toBeUndefined();
    expect(applied.findings.some((item) => item.ruleId === "doctor/stale-baseline")).toBe(true);
  });

  it("can skip stale reporting", () => {
    const applied = applyBaseline(
      [
        finding({
          fingerprint: "keep",
          ruleId: "config/name-required",
          project: "host",
          severity: "error",
        }),
      ],
      {
        schemaVersion: 1,
        entries: [{ fingerprint: "keep" }, { fingerprint: "stale" }],
      },
      { reportStale: false },
    );
    expect(applied.stale).toHaveLength(1);
    expect(applied.findings.every((item) => item.ruleId !== "doctor/stale-baseline")).toBe(true);
  });
});

describe("baseline generate/update/prune", () => {
  it("generates sorted unique entries from findings", () => {
    const baseline = generateBaseline([
      finding({
        fingerprint: "b",
        ruleId: "shared/singleton-mismatch",
        project: "remote",
        severity: "warning",
      }),
      finding({
        fingerprint: "a",
        ruleId: "config/name-required",
        project: "host",
        severity: "error",
      }),
      finding({
        fingerprint: "a",
        ruleId: "config/name-required",
        project: "host",
        severity: "error",
      }),
      finding({
        fingerprint: "stale-fp",
        ruleId: "doctor/stale-baseline",
        project: "baseline",
        severity: "info",
      }),
    ]);
    expect(baseline).toEqual({
      schemaVersion: 1,
      entries: [
        { fingerprint: "a", ruleId: "config/name-required", project: "host" },
        { fingerprint: "b", ruleId: "shared/singleton-mismatch", project: "remote" },
      ],
    });
  });

  it("updates by adding new fingerprints without removing stale ones", () => {
    const existing = parseBaseline({
      schemaVersion: 1,
      entries: [{ fingerprint: "old", ruleId: "config/name-required", project: "host" }],
    });
    const updated = updateBaseline(existing, [
      finding({
        fingerprint: "old",
        ruleId: "config/name-required",
        project: "host",
        severity: "error",
      }),
      finding({
        fingerprint: "new",
        ruleId: "shared/singleton-mismatch",
        project: "host",
        severity: "warning",
      }),
    ]);
    expect(updated.entries.map((entry) => entry.fingerprint).sort()).toEqual(["new", "old"]);
  });

  it("prunes entries that no longer match findings", () => {
    const existing = parseBaseline({
      schemaVersion: 1,
      entries: [
        { fingerprint: "keep", ruleId: "config/name-required", project: "host" },
        { fingerprint: "gone", ruleId: "shared/singleton-mismatch", project: "host" },
      ],
    });
    const pruned = pruneBaseline(existing, [
      finding({
        fingerprint: "keep",
        ruleId: "config/name-required",
        project: "host",
        severity: "error",
      }),
    ]);
    expect(pruned.entries).toEqual([
      { fingerprint: "keep", ruleId: "config/name-required", project: "host" },
    ]);
  });
});

describe("baseline exit codes", () => {
  it("excludes suppressed findings from policy by default", () => {
    const findings = [
      finding({
        fingerprint: "fp",
        ruleId: "config/name-required",
        project: "host",
        severity: "error",
        suppressed: true,
      }),
    ];
    expect(policyFails(findings, "error")).toBe(false);
    expect(policyFails(findings, "error", true)).toBe(true);
    expect(policyFails(findings, "never")).toBe(false);
  });

  it("still fails when an unsuppressed error remains", () => {
    const findings = [
      finding({
        fingerprint: "a",
        ruleId: "config/name-required",
        project: "host",
        severity: "error",
        suppressed: true,
      }),
      finding({
        fingerprint: "b",
        ruleId: "shared/singleton-mismatch",
        project: "host",
        severity: "error",
      }),
    ];
    expect(policyFails(findings, "error")).toBe(true);
  });

  it("analyze exits 0 when CI errors are fully baselined", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-baseline-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"baseline-exit"}');
    const first = await analyze({
      root,
      mode: "ci",
      output: { formats: ["json"] },
      moduleFederation: { name: "" },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(first.exitCode).toBe(1);
    const baselinePath = path.join(root, "mfdoctor.baseline.json");
    await writeBaselineFile(baselinePath, generateBaseline(first.report.findings));
    const second = await analyze({
      root,
      mode: "ci",
      output: { formats: ["json"] },
      moduleFederation: { name: "" },
      baseline: baselinePath,
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(second.exitCode).toBe(0);
    expect(second.report.findings.some((item) => item.suppressed)).toBe(true);
    expect(second.report.summary.suppressed).toBeGreaterThan(0);
  });
});

describe("baseline file IO and config", () => {
  it("loads and validates baseline files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-baseline-io-"));
    roots.push(root);
    const file = path.join(root, "mfdoctor.baseline.json");
    await writeBaselineFile(file, {
      schemaVersion: 1,
      entries: [{ fingerprint: "abc", ruleId: "config/name-required" }],
    });
    await expect(loadBaseline(file)).resolves.toEqual({
      schemaVersion: 1,
      entries: [{ fingerprint: "abc", ruleId: "config/name-required" }],
    });
    expect(() => parseBaseline({ schemaVersion: 2, entries: [] })).toThrow(
      "Unsupported baseline schemaVersion",
    );
    expect(() =>
      parseBaseline({
        schemaVersion: 1,
        entries: [{ fingerprint: "x" }, { fingerprint: "x" }],
      }),
    ).toThrow("Duplicate baseline entry");
  });

  it("resolves baseline options against root", () => {
    expect(resolveBaselineOptions("./mfdoctor.baseline.json", "/app")).toEqual({
      path: path.resolve("/app", "./mfdoctor.baseline.json"),
      failOnSuppressed: false,
      reportStale: true,
    });
    expect(
      resolveBaselineOptions(
        { path: "base.json", failOnSuppressed: true, reportStale: false },
        "/app",
      ),
    ).toEqual({
      path: path.resolve("/app", "base.json"),
      failOnSuppressed: true,
      reportStale: false,
    });
  });
});
