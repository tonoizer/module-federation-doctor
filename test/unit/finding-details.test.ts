import { describe, expect, it } from "vitest";
import {
  FINDING_DETAILS_SCHEMAS,
  TYPED_DETAILS_RULE_IDS,
  findingDetails,
  isKnownFindingDetailsSchema,
  readFindingDetails,
} from "../../src/finding-details.js";
import { fingerprint } from "../../src/utils.js";
import { validatePayload } from "../helpers/schema-contract.js";
import type { DoctorFinding } from "../../src/types.js";

function finding(
  partial: Pick<DoctorFinding, "ruleId" | "project" | "evidence"> & Partial<DoctorFinding>,
): DoctorFinding {
  const base = {
    schemaVersion: 1 as const,
    ruleId: partial.ruleId,
    severity: partial.severity ?? ("warning" as const),
    message: partial.message ?? "demo",
    project: partial.project,
    evidence: partial.evidence,
    ...(partial.location ? { location: partial.location } : {}),
  };
  return {
    ...base,
    fingerprint: fingerprint(base),
    ...(partial.detailsSchema ? { detailsSchema: partial.detailsSchema } : {}),
    ...(partial.details ? { details: partial.details } : {}),
  };
}

describe("typed finding details (#136)", () => {
  it("keeps fingerprints stable when detailsSchema/details are added", () => {
    const evidence = { package: "react", evidenceSources: [] as string[] };
    const without = finding({
      ruleId: "shared/unused",
      project: "host",
      evidence,
    });
    const withDetails = finding({
      ruleId: "shared/unused",
      project: "host",
      evidence,
      detailsSchema: FINDING_DETAILS_SCHEMAS.SHARED_UNUSED,
      details: { package: "react", evidenceSources: [] },
    });
    expect(withDetails.fingerprint).toBe(without.fingerprint);
    expect(withDetails.detailsSchema).toBe("shared.unused.v1");
    expect(withDetails.details).toEqual({ package: "react", evidenceSources: [] });
  });

  it("does not change fingerprint when detailsSchema is absent from evidence", () => {
    const left = fingerprint({
      ruleId: "shared/unused",
      project: "host",
      evidence: { package: "react" },
    });
    const right = fingerprint({
      ruleId: "shared/unused",
      project: "host",
      evidence: { package: "react" },
    });
    expect(left).toBe(right);
    // Contrapositive: putting schema version into evidence WOULD churn fingerprints
    const poisoned = fingerprint({
      ruleId: "shared/unused",
      project: "host",
      evidence: { package: "react", detailsSchema: "shared.unused.v1" },
    });
    expect(poisoned).not.toBe(left);
  });

  it("validates reports with and without typed details", async () => {
    const bare = {
      schemaVersion: 1 as const,
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: true,
        stats: true,
        emittedAssets: true,
        installedVersions: true,
      },
      summary: { projects: 1, info: 0, warnings: 1, errors: 0 },
      findings: [
        {
          schemaVersion: 1,
          ruleId: "shared/unused",
          severity: "warning",
          message: "unused",
          project: "host",
          evidence: { package: "lodash" },
          fingerprint: "fp-bare",
        },
      ],
    };
    await validatePayload("report.schema.json", bare, "report without details");

    const typed = {
      ...bare,
      findings: [
        {
          ...bare.findings[0],
          fingerprint: "fp-typed",
          detailsSchema: FINDING_DETAILS_SCHEMAS.SHARED_UNUSED,
          details: { package: "lodash" },
        },
      ],
    };
    await validatePayload("report.schema.json", typed, "report with details");
  });

  it("readFindingDetails tolerates missing and unknown schemas", () => {
    expect(readFindingDetails({})).toBeUndefined();
    expect(readFindingDetails({ detailsSchema: "x" })).toBeUndefined();
    expect(readFindingDetails({ details: { a: 1 } })).toBeUndefined();
    expect(
      readFindingDetails({
        detailsSchema: "future.unknown.v9",
        details: { ok: true },
      }),
    ).toEqual({
      detailsSchema: "future.unknown.v9",
      details: { ok: true },
    });
    expect(isKnownFindingDetailsSchema("future.unknown.v9")).toBe(false);
    expect(isKnownFindingDetailsSchema(FINDING_DETAILS_SCHEMAS.ARTIFACT)).toBe(true);
  });

  it("exports a stable first-batch inventory and helper", () => {
    expect(TYPED_DETAILS_RULE_IDS).toContain("doctor/partial-analysis");
    expect(TYPED_DETAILS_RULE_IDS).toContain("shared/unused");
    expect(TYPED_DETAILS_RULE_IDS).toContain("config/remote-entry-invalid");
    expect(
      findingDetails(FINDING_DETAILS_SCHEMAS.DOCTOR_PARTIAL_ANALYSIS, { missing: ["manifest"] }),
    ).toEqual({
      detailsSchema: "doctor.partial-analysis.v1",
      details: { missing: ["manifest"] },
    });
  });

  it("golden snippets match first-batch shapes", async () => {
    const goldens = [
      {
        ruleId: "shared/unused",
        detailsSchema: FINDING_DETAILS_SCHEMAS.SHARED_UNUSED,
        details: {
          package: "react",
          evidenceSources: ["static"],
          dynamicPackages: [],
          importDepth: "shallow",
        },
      },
      {
        ruleId: "shared/singleton-risk",
        detailsSchema: FINDING_DETAILS_SCHEMAS.SHARED_SINGLETON,
        details: { package: "react", kind: "risk" },
      },
      {
        ruleId: "config/remote-entry-invalid",
        detailsSchema: FINDING_DETAILS_SCHEMAS.REMOTES_CONFIG,
        details: { remote: "checkout", entry: "bad" },
      },
      {
        ruleId: "artifact/remote-entry-missing",
        detailsSchema: FINDING_DETAILS_SCHEMAS.ARTIFACT,
        details: { expected: "remoteEntry.js" },
      },
      {
        ruleId: "doctor/partial-analysis",
        detailsSchema: FINDING_DETAILS_SCHEMAS.DOCTOR_PARTIAL_ANALYSIS,
        details: { missing: ["manifest", "stats"] },
      },
    ];

    for (const golden of goldens) {
      const report = {
        schemaVersion: 1,
        capabilities: {
          config: true,
          sourceImports: true,
          manifest: false,
          stats: false,
          emittedAssets: true,
          installedVersions: true,
        },
        summary: { projects: 1, info: 0, warnings: 1, errors: 0 },
        findings: [
          {
            schemaVersion: 1,
            ruleId: golden.ruleId,
            severity: "warning",
            message: "golden",
            project: "host",
            evidence: { ...golden.details },
            fingerprint: `fp-${golden.ruleId}`,
            detailsSchema: golden.detailsSchema,
            details: golden.details,
          },
        ],
      };
      await validatePayload("report.schema.json", report, golden.ruleId);
      const typed = readFindingDetails(report.findings[0]!);
      expect(typed?.detailsSchema).toBe(golden.detailsSchema);
      expect(typed?.details).toEqual(golden.details);
    }
  });

  it("emits typed details from built-in rules without changing fingerprints", async () => {
    const { analyze } = await import("../../src/engine.js");
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-details-"));
    try {
      await fs.mkdir(path.join(root, "src"));
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "fixture",
          dependencies: { react: "19.1.1", "@module-federation/vite": "2.8.0" },
        }),
      );
      await fs.writeFile(path.join(root, "src/index.ts"), 'import "react";\n');
      const result = await analyze({
        root,
        bundler: "vite",
        mode: "ci",
        output: { formats: [] },
        moduleFederation: {
          name: "host",
          remotes: { shop: { name: "shop", entry: "not-a-valid-entry" } },
          shared: {
            react: { singleton: false, eager: true },
            lodash: { singleton: true },
          },
        },
        rules: {
          "config/plugin-package-mismatch": "off",
          "artifact/remote-entry-missing": "off",
          "artifact/types-missing": "off",
        },
      });

      const unused = result.report.findings.find((item) => item.ruleId === "shared/unused");
      expect(unused?.detailsSchema).toBe(FINDING_DETAILS_SCHEMAS.SHARED_UNUSED);
      expect(unused?.details).toMatchObject({ package: "lodash" });
      expect(unused?.evidence).not.toHaveProperty("detailsSchema");
      expect(
        fingerprint({
          ruleId: unused!.ruleId,
          project: unused!.project,
          evidence: unused!.evidence,
          ...(unused!.location ? { location: unused!.location } : {}),
        }),
      ).toBe(unused!.fingerprint);

      const invalidRemote = result.report.findings.find(
        (item) => item.ruleId === "config/remote-entry-invalid",
      );
      expect(invalidRemote?.detailsSchema).toBe(FINDING_DETAILS_SCHEMAS.REMOTES_CONFIG);
      expect(invalidRemote?.details).toMatchObject({ remote: "shop" });

      const singleton = result.report.findings.find(
        (item) => item.ruleId === "shared/singleton-risk",
      );
      expect(singleton?.detailsSchema).toBe(FINDING_DETAILS_SCHEMAS.SHARED_SINGLETON);
      expect(singleton?.details).toMatchObject({ package: "react", kind: "risk" });

      const partial = result.report.findings.find(
        (item) => item.ruleId === "doctor/partial-analysis",
      );
      expect(partial?.detailsSchema).toBe(FINDING_DETAILS_SCHEMAS.DOCTOR_PARTIAL_ANALYSIS);
      expect(Array.isArray(partial?.details?.missing)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
