import fs from "node:fs/promises";
import type { OutputFormat } from "./types.js";

const PACKAGE_NAME = "@tonoizer/mfdoctor";
const COMPATIBILITY_MATRIX_SOURCE = "./fixtures/compatibility-matrix.json";

export type BundlerMatrixStatus = "supported" | "partial";

export interface CompatibilityMatrixBundler {
  id: string;
  status: BundlerMatrixStatus;
  adapter: string;
}

export interface CompatibilityMatrixLocalCiCell {
  id: string;
  bundler: string;
  fixture: string;
  coverage?: string[];
  expectedErrors?: number;
}

export interface CompatibilityMatrixDocument {
  schemaVersion: number;
  bundlers: CompatibilityMatrixBundler[];
  localCi: CompatibilityMatrixLocalCiCell[];
}

export interface CliBundlerMatrix {
  source: typeof COMPATIBILITY_MATRIX_SOURCE;
  supported: string[];
  partial: string[];
  bundlers: CompatibilityMatrixBundler[];
  localCi: Array<{
    id: string;
    bundler: string;
    fixture: string;
    coverage?: string[];
  }>;
}

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
  nonGoals: string[];
  completeness: {
    check: string;
    emit: string;
    workspace: string;
    probe: string;
    runtime: string;
  };
  githubAction: {
    name: string;
    uses: string;
    pinToTag: string;
  };
  networkPolicy: {
    offlineByDefault: boolean;
    networkCommands: string[];
    probe: {
      httpsRequired: boolean;
      httpAllowedForLoopbackInitialUrl: boolean;
      ssrfProtection: boolean;
      blockPrivateLinkLocalMetadataHosts: boolean;
      maxRedirects: number;
      defaultTimeoutMs: number;
      defaultMaxBytes: number;
      neverExecutesRemoteEntry: boolean;
      rejectEmbeddedCredentials: boolean;
    };
  };
  bundlerMatrix: CliBundlerMatrix;
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
    flags: ["--ci", "--diagnostics-dir", "--format", "--no-prompt", "--no-score"],
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
  nonGoals: [
    "HTML report UI or interactive web dashboard",
    "In-browser MFDoctor runtime agent or client-bundle injection",
    "MCP server schema or tool surface",
    "General --fix autofix for arbitrary findings",
    "Unsolicited network probe (probe is explicit-only)",
    "Unsolicited suppressions or auto-waiving findings",
    "Scraping private Module Federation plugin internals",
    "Runtime-only Module Federation without a bundler MF build plugin",
  ],
  completeness: {
    check:
      "One-project offline analysis of config, imports, and on-disk artifacts; weaker without emit/manifest facts.",
    emit: "Post-emit adapter facts (manifest, stats, emitted assets) when MFDoctor runs in the bundler after build.",
    workspace:
      "Cross-project federation gate over discovered .mf/doctor/project.json facts; does not invent missing emit evidence.",
    probe:
      "Explicit deployed-manifest validation and optional remoteEntry HEAD; never downloads or executes remote JS.",
    runtime:
      "Offline correlation of a user-supplied Observability export with local project facts; never fetches URLs from the trace.",
  },
  githubAction: {
    name: "workspace-federation-gate",
    uses: "tonoizer/module-federation-doctor/.github/actions/workspace-federation-gate",
    pinToTag:
      "Pin uses: to a release tag (for example @v1.1.0). Do not pin to @main for production workflows.",
  },
  networkPolicy: {
    offlineByDefault: true,
    networkCommands: ["probe"],
    probe: {
      httpsRequired: true,
      httpAllowedForLoopbackInitialUrl: true,
      ssrfProtection: true,
      blockPrivateLinkLocalMetadataHosts: true,
      maxRedirects: 5,
      defaultTimeoutMs: 10_000,
      defaultMaxBytes: 2 * 1024 * 1024,
      neverExecutesRemoteEntry: true,
      rejectEmbeddedCredentials: true,
    },
  },
} satisfies Omit<CliCapabilities, "package" | "bundlerMatrix">;

type PackageJson = { name?: unknown; version?: unknown };

/** Derive the agent-facing bundler matrix from the checked-in compatibility contract. */
export function deriveBundlerMatrix(matrix: CompatibilityMatrixDocument): CliBundlerMatrix {
  if (!Array.isArray(matrix.bundlers) || matrix.bundlers.length === 0)
    throw new Error("Compatibility matrix is missing bundlers status entries.");
  if (!Array.isArray(matrix.localCi))
    throw new Error("Compatibility matrix is missing localCi cells.");

  const known = new Set(matrix.bundlers.map((entry) => entry.id));
  for (const cell of matrix.localCi) {
    if (!known.has(cell.bundler))
      throw new Error(
        `Compatibility matrix localCi cell "${cell.id}" uses unknown bundler "${cell.bundler}".`,
      );
  }

  const supported = matrix.bundlers
    .filter((entry) => entry.status === "supported")
    .map((entry) => entry.id);
  const partial = matrix.bundlers
    .filter((entry) => entry.status === "partial")
    .map((entry) => entry.id);

  return {
    source: COMPATIBILITY_MATRIX_SOURCE,
    supported,
    partial,
    bundlers: matrix.bundlers.map((entry) => ({
      id: entry.id,
      status: entry.status,
      adapter: entry.adapter,
    })),
    localCi: matrix.localCi.map((cell) => ({
      id: cell.id,
      bundler: cell.bundler,
      fixture: cell.fixture,
      ...(cell.coverage ? { coverage: cell.coverage } : {}),
    })),
  };
}

async function loadCompatibilityMatrix(): Promise<CompatibilityMatrixDocument> {
  const raw = JSON.parse(
    await fs.readFile(
      new URL(`../${COMPATIBILITY_MATRIX_SOURCE.slice(2)}`, import.meta.url),
      "utf8",
    ),
  ) as CompatibilityMatrixDocument;
  return raw;
}

/** Read the shipped package metadata so discovery never drifts from the release version. */
export async function loadCliCapabilities(): Promise<CliCapabilities> {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageJson;
  if (packageJson.name !== PACKAGE_NAME || typeof packageJson.version !== "string")
    throw new Error("MFDoctor package metadata is missing a valid name or version.");
  const bundlerMatrix = deriveBundlerMatrix(await loadCompatibilityMatrix());
  return {
    ...DISCOVERY_CONTRACT,
    package: { name: PACKAGE_NAME, version: packageJson.version },
    bundlerMatrix,
  };
}
