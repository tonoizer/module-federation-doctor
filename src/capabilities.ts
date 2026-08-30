import fs from "node:fs/promises";
import type { OutputFormat } from "./types.js";

const PACKAGE_NAME = "@tonoizer/mfdoctor";

export interface CliCapabilities {
  schemaVersion: 1;
  package: {
    name: string;
    version: string;
  };
  commands: Record<
    string,
    {
      description: string;
      network: boolean;
      formats?: OutputFormat[];
    }
  >;
  formats: OutputFormat[];
  schemaVersions: Record<string, number>;
  exitCodes: {
    "0": string;
    "1": string;
    "2": string;
  };
  nonInteractive: {
    flags: string[];
    commands: Record<string, string>;
  };
  schemas: Record<string, string>;
}

const DISCOVERY_CONTRACT = {
  schemaVersion: 1,
  commands: {
    baseline: {
      description: "Generate, update, or prune a finding fingerprint baseline.",
      network: false,
    },
    capabilities: {
      description: "Print this machine-readable CLI discovery contract.",
      network: false,
      formats: ["json"],
    },
    check: {
      description: "Analyze one project and apply its finding policy.",
      network: false,
      formats: ["terminal", "json", "sarif"],
    },
    federation: {
      description: "Analyze explicit project facts or a discovered workspace.",
      network: false,
      formats: ["terminal", "json", "sarif"],
    },
    help: {
      description: "Print CLI usage and command guidance.",
      network: false,
    },
    probe: {
      description: "Validate a deployed manifest and optionally its remote entry.",
      network: true,
    },
    prompt: {
      description: "Print offline fix prompts from a saved report.",
      network: false,
    },
    rules: {
      description: "Print built-in rule metadata or one rule.",
      network: false,
    },
    runtime: {
      description: "Correlate a runtime trace with local project facts.",
      network: false,
      formats: ["terminal", "json", "sarif"],
    },
    workspace: {
      description: "Discover project facts and gate a federation workspace.",
      network: false,
      formats: ["terminal", "json", "sarif"],
    },
  },
  formats: ["terminal", "json", "sarif"] as OutputFormat[],
  schemaVersions: {
    baseline: 1,
    capabilities: 1,
    config: 1,
    evidence: 2,
    identity: 1,
    probe: 1,
    project: 1,
    report: 1,
    "rule-inventory": 1,
    "runtime-capture": 1,
    "runtime-trace": 1,
    ui: 1,
  },
  exitCodes: {
    "0": "success",
    "1": "policy-fail",
    "2": "usage-or-incomplete-analysis",
  },
  nonInteractive: {
    flags: [
      "--ci",
      "--diagnostics-dir",
      "--diagnostics-prompts",
      "--format",
      "--no-prompt",
      "--no-score",
    ],
    commands: {
      discover: "mfdoctor capabilities",
      check: "mfdoctor check --ci --format json,sarif --diagnostics-dir .mf/doctor/diagnostics",
      prompt: "mfdoctor prompt --finding <ruleId> .mf/doctor/report.json",
    },
  },
  schemas: {
    baseline: "./schemas/baseline.schema.json",
    capabilities: "./schemas/capabilities.schema.json",
    config: "./schemas/config.schema.json",
    evidence: "./schemas/evidence.schema.json",
    identity: "./schemas/identity.schema.json",
    probe: "./schemas/probe.schema.json",
    project: "./schemas/project.schema.json",
    report: "./schemas/report.schema.json",
    "rule-inventory": "./schemas/rule-inventory.schema.json",
    "runtime-capture": "./schemas/runtime-capture.schema.json",
    "runtime-trace": "./schemas/runtime-trace.schema.json",
    ui: "./schemas/ui.schema.json",
  },
} satisfies Omit<CliCapabilities, "package">;

type PackageJson = { name?: unknown; version?: unknown };

/** Read the shipped package metadata so discovery never drifts from the release version. */
export async function loadCliCapabilities(): Promise<CliCapabilities> {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageJson;
  if (packageJson.name !== PACKAGE_NAME || typeof packageJson.version !== "string")
    throw new Error("MFDoctor package metadata is missing a valid name or version.");
  return {
    ...DISCOVERY_CONTRACT,
    package: { name: PACKAGE_NAME, version: packageJson.version },
  };
}
