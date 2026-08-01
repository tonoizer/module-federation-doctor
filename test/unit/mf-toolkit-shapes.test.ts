import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hasMfBridgeEntryExpose,
  hasMfSsrFragmentRemotes,
  isMf2SharedArrayManifestOnly,
  isMfBridgeEntryProducer,
  isMfSsrFragmentRemoteEntry,
  toolkitRecognitionEnabled,
} from "../../src/mf-toolkit-shapes.js";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, ProjectFacts, RuleContext } from "../../src/types.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readFacts(relativePath: string): Promise<ProjectFacts> {
  const text = await fs.readFile(path.join(repository, relativePath), "utf8");
  return JSON.parse(text) as ProjectFacts;
}

async function runRule(
  id: string,
  facts: ProjectFacts,
  options: Record<string, unknown> = {},
  recognizeMfToolkit?: boolean,
): Promise<
  Array<Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">>
> {
  const findings: Array<
    Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
  > = [];
  const rule = builtInRules.find((item) => item.meta.id === id)!;
  const context: RuleContext = {
    facts,
    options,
    ...(recognizeMfToolkit !== undefined ? { recognizeMfToolkit } : {}),
    report: (finding) => findings.push(finding),
  };
  await rule.check(context);
  return findings;
}

describe("mf-toolkit shape recognition (#127)", () => {
  it("detects mf-bridge ./entry producers from golden fixtures", async () => {
    const remote = await readFacts("fixtures/mf-bridge-entry/remote/.mf/doctor/project.json");
    const classic = await readFacts("fixtures/workspaces/clean/remote/.mf/doctor/project.json");

    expect(hasMfBridgeEntryExpose(remote)).toBe(true);
    expect(isMfBridgeEntryProducer(remote)).toBe(true);
    expect(hasMfBridgeEntryExpose(classic)).toBe(false);
    expect(isMfBridgeEntryProducer(classic)).toBe(false);
  });

  it("detects mf-ssr fragment URL remotes (absolute + relative)", async () => {
    const host = await readFacts("fixtures/mf-ssr-fragment/host/.mf/doctor/project.json");
    expect(hasMfSsrFragmentRemotes(host)).toBe(true);
    expect(isMfSsrFragmentRemoteEntry("/api/fragments/checkout")).toBe(true);
    expect(isMfSsrFragmentRemoteEntry("https://checkout.example.com/api/fragments/checkout")).toBe(
      true,
    );
    expect(isMfSsrFragmentRemoteEntry("https://example.com/remoteEntry.js")).toBe(false);
    expect(isMfSsrFragmentRemoteEntry("https://example.com/mf-manifest.json")).toBe(false);
    expect(isMfSsrFragmentRemoteEntry("bad")).toBe(false);
  });

  it("does not flag fragment relative remotes as config/remote-entry-invalid", async () => {
    const host = await readFacts("fixtures/mf-ssr-fragment/host/.mf/doctor/project.json");
    const findings = await runRule("config/remote-entry-invalid", host);
    expect(findings).toEqual([]);
  });

  it("still flags classic invalid remotes (negative control)", async () => {
    const classic = await readFacts("fixtures/workspaces/clean/remote/.mf/doctor/project.json");
    classic.moduleFederation = {
      ...classic.moduleFederation!,
      remotes: {
        shop: { name: "shop", entry: "bad", shareScope: ["default"] },
      },
    };
    const findings = await runRule("config/remote-entry-invalid", classic);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toMatchObject({ name: "shop", entry: "bad" });
  });

  it("can force classic remote-entry-invalid via recognizeMfToolkit: false", async () => {
    const host = await readFacts("fixtures/mf-ssr-fragment/host/.mf/doctor/project.json");
    const findings = await runRule("config/remote-entry-invalid", host, {}, false);
    expect(findings.some((item) => item.evidence?.name === "checkoutRelative")).toBe(true);
  });

  it("skips DTS guidance for mf-bridge ./entry when dts is disabled", async () => {
    const remote = await readFacts("fixtures/mf-bridge-entry/remote/.mf/doctor/project.json");
    remote.moduleFederation = {
      ...remote.moduleFederation!,
      dts: { enabled: false, options: {} },
    };
    const findings = await runRule("artifact/dts-disabled", remote);
    expect(findings).toEqual([]);

    const classic = await readFacts("fixtures/workspaces/clean/remote/.mf/doctor/project.json");
    classic.moduleFederation = {
      ...classic.moduleFederation!,
      dts: { enabled: false, options: {} },
    };
    // Classic ./Widget still gets DTS guidance.
    const classicFindings = await runRule("artifact/dts-disabled", classic);
    expect(classicFindings).toHaveLength(1);
  });

  it("skips shared/unused on shared-inspector MF2 manifest-only fixtures", async () => {
    const project = await readFacts("fixtures/shared-inspector-mf2/.mf/doctor/project.json");
    expect(isMf2SharedArrayManifestOnly(project)).toBe(true);
    const findings = await runRule("shared/unused", project);
    expect(findings).toEqual([]);
  });

  it("defaults toolkitRecognitionEnabled to signals", () => {
    expect(toolkitRecognitionEnabled({ options: {} }, true)).toBe(true);
    expect(toolkitRecognitionEnabled({ options: {} }, false)).toBe(false);
    expect(toolkitRecognitionEnabled({ options: {}, recognizeMfToolkit: false }, true)).toBe(false);
    expect(toolkitRecognitionEnabled({ options: { recognizeMfToolkit: true } }, false)).toBe(true);
    expect(toolkitRecognitionEnabled({ options: { recognizeMfToolkit: false } }, true)).toBe(false);
  });
});
