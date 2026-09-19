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

export type CliOperationArgumentType = "path" | "glob" | "url" | "string" | "enum";
export type CliOperationOptionType =
  | "boolean"
  | "integer"
  | "string"
  | "enum"
  | "path"
  | "glob"
  | "url";

export interface CliOperationArgument {
  name: string;
  type: CliOperationArgumentType;
  required: boolean;
  repeatable?: boolean;
  minimumCount?: number;
  values?: readonly string[];
  description: string;
}

export interface CliOperationOption {
  name: string;
  aliases?: readonly string[];
  type: CliOperationOptionType;
  required?: boolean;
  repeatable?: boolean;
  values?: readonly string[];
  minimum?: number;
  maximum?: number;
  description: string;
}

export interface CliOperationNetwork {
  mode: "offline" | "network";
  userInitiated: boolean;
  behavior: string;
}

export interface CliOperationError {
  exitCode: 0 | 1 | 2;
  description: string;
}

export interface CliOperationContract {
  description: string;
  formats?: readonly OutputFormat[];
  arguments: readonly CliOperationArgument[];
  options: readonly CliOperationOption[];
  prerequisites: readonly string[];
  network: CliOperationNetwork;
  writtenArtifacts: readonly string[];
  errorCodes: Readonly<Record<string, CliOperationError>>;
}

export interface CliOperationsContract {
  schemaVersion: 1;
  commands: Readonly<Record<string, CliOperationContract>>;
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
  operations: CliOperationsContract;
  bundlerMatrix: CliBundlerMatrix;
}

const OFFLINE_NETWORK: CliOperationNetwork = {
  mode: "offline",
  userInitiated: false,
  behavior: "Reads local files only; does not fetch URLs or contact a remote service.",
};

const EXPLICIT_NETWORK: CliOperationNetwork = {
  mode: "network",
  userInitiated: true,
  behavior:
    "Performs network I/O only when this explicit command is invoked, subject to HTTPS, SSRF, redirect, credential, timeout, and size guards.",
};

const USAGE_ERROR: CliOperationError = {
  exitCode: 2,
  description: "Arguments or options are missing or invalid.",
};
const IO_ERROR: CliOperationError = {
  exitCode: 2,
  description: "A required local file or output artifact could not be read or written.",
};
const POLICY_FAIL: CliOperationError = {
  exitCode: 1,
  description:
    "The operation completed and its unsuppressed policy findings fail the selected threshold.",
};
const ANALYSIS_INCOMPLETE: CliOperationError = {
  exitCode: 2,
  description: "The operation completed with incomplete evidence; this is not a policy pass.",
};
const INVALID_REPORT: CliOperationError = {
  exitCode: 2,
  description: "The supplied report is not a valid mfdoctor report document.",
};
const INVALID_PROJECT_FACTS: CliOperationError = {
  exitCode: 2,
  description:
    "A project-facts input is missing, invalid, or belongs to an incompatible federation group.",
};
const FINDING_NOT_FOUND: CliOperationError = {
  exitCode: 2,
  description: "No finding matched the requested rule id or fingerprint.",
};
const RULE_NOT_FOUND: CliOperationError = {
  exitCode: 2,
  description: "The requested rule id is not in the built-in rule catalog.",
};
const NETWORK_ERROR: CliOperationError = {
  exitCode: 2,
  description: "A guarded manifest request failed or returned an unusable response.",
};
const INVALID_MANIFEST: CliOperationError = {
  exitCode: 2,
  description: "A fetched manifest is not a supported Module Federation manifest document.",
};
const SSRF_BLOCKED: CliOperationError = {
  exitCode: 2,
  description: "The requested URL was rejected by the network safety policy.",
};

const ANALYSIS_OPTIONS = [
  {
    name: "--ci",
    type: "boolean",
    description: "Use CI analysis and failure defaults.",
  },
  {
    name: "--verbose",
    type: "boolean",
    description: "Print the legacy success line when there are no findings.",
  },
  {
    name: "--no-score",
    type: "boolean",
    description: "Omit the terminal health score.",
  },
  {
    name: "--no-prompt",
    type: "boolean",
    description: "Suppress terminal agent prompts.",
  },
  {
    name: "--prompt",
    type: "boolean",
    description: "Force terminal agent prompts on.",
  },
  {
    name: "--diagnostics-dir",
    type: "path",
    description: "Write bounded agent diagnostics inside the project root.",
  },
  {
    name: "--diagnostics-prompts",
    type: "integer",
    minimum: 1,
    maximum: 25,
    description: "Select 1–25 prompt files for a diagnostics dump; terminal output stays top-3.",
  },
  {
    name: "--format",
    type: "enum",
    values: ["terminal", "json", "sarif"],
    description: "Select one or more comma-separated output formats.",
  },
  {
    name: "--output",
    type: "string",
    values: ["-"],
    description: "Use - to emit JSON on stdout.",
  },
  {
    name: "--no-write",
    type: "boolean",
    description: "Skip report artifacts on disk while retaining stdout output behavior.",
  },
] satisfies readonly CliOperationOption[];

const REQUIRE_COMPLETE_OPTION = {
  name: "--require-complete",
  type: "boolean",
  description: "Turn incomplete evidence into a policy failure.",
} satisfies CliOperationOption;

const FEDERATION_OPTIONS = [
  {
    name: "--workspace",
    type: "boolean",
    description: "Discover project facts below the supplied roots.",
  },
  {
    name: "--glob",
    type: "glob",
    description: "Override workspace project-facts discovery with a glob.",
  },
  {
    name: "--group",
    type: "string",
    description: "Select one federation group when a repository contains multiple graphs.",
  },
] satisfies readonly CliOperationOption[];

const MANIFEST_NETWORK_OPTIONS = [
  {
    name: "--timeout",
    type: "integer",
    description: "Set the guarded request timeout in milliseconds.",
  },
  {
    name: "--max-bytes",
    type: "integer",
    description: "Set the guarded response-size limit in bytes.",
  },
  {
    name: "--remote-entry",
    type: "boolean",
    description: "Also make the explicitly requested remoteEntry check.",
  },
] satisfies readonly CliOperationOption[];

const COMPARE_OPTIONS = [
  ...MANIFEST_NETWORK_OPTIONS,
  {
    name: "--format",
    type: "enum",
    values: ["terminal", "json", "sarif"],
    description: "Select one or more comma-separated output formats.",
  },
] satisfies readonly CliOperationOption[];

const REPORT_BASELINE_OPTION: CliOperationOption = {
  name: "--baseline",
  type: "path",
  description: "Apply a fingerprint baseline to the analysis findings.",
};

const DIAGNOSTICS_ARTIFACTS = [
  "<diagnostics-dir>/report.json",
  "<diagnostics-dir>/verification-plan.json",
  "<diagnostics-dir>/prompts/*.md",
  "<diagnostics-dir>/summary.md",
] as const;

const ANALYSIS_ERROR_CODES = {
  "policy-fail": POLICY_FAIL,
  "analysis-incomplete": ANALYSIS_INCOMPLETE,
  "usage-error": USAGE_ERROR,
  "io-error": IO_ERROR,
} as const;

/**
 * The single operation source of truth used to derive `commands` discovery
 * metadata. Keep this aligned with the intentionally small parser/help
 * surface in `src/cli.ts`; tests validate the public names and key options.
 */
export const CLI_OPERATIONS = {
  baseline: {
    description: "Generate, update, or prune a finding fingerprint baseline.",
    arguments: [
      {
        name: "action",
        type: "enum",
        required: true,
        values: ["generate", "update", "prune"],
        description: "Baseline operation to perform.",
      },
      {
        name: "report-path",
        type: "path",
        required: false,
        description: "Saved mfdoctor report; defaults to .mf/doctor/report.json.",
      },
    ],
    options: [
      {
        name: "--out",
        aliases: ["-o"],
        type: "path",
        description: "Baseline output path; defaults to mfdoctor.baseline.json.",
      },
    ],
    prerequisites: ["A schema-valid saved mfdoctor report is required."],
    network: OFFLINE_NETWORK,
    writtenArtifacts: ["<out>"],
    errorCodes: {
      "usage-error": USAGE_ERROR,
      "invalid-report": INVALID_REPORT,
      "io-error": IO_ERROR,
    },
  },
  capabilities: {
    description: "Print this machine-readable CLI discovery contract.",
    formats: ["json"],
    arguments: [],
    options: [
      {
        name: "--format",
        type: "enum",
        values: ["json"],
        description: "The capabilities contract is JSON only.",
      },
    ],
    prerequisites: ["None; project configuration is not loaded."],
    network: OFFLINE_NETWORK,
    writtenArtifacts: [],
    errorCodes: { "usage-error": USAGE_ERROR, "io-error": IO_ERROR },
  },
  check: {
    description:
      "Analyze one project and apply its finding policy; --require-complete turns incomplete evidence into a policy failure.",
    formats: ["terminal", "json", "sarif"],
    arguments: [
      {
        name: "root",
        type: "path",
        required: false,
        description: "Project directory; defaults to the current working directory.",
      },
    ],
    options: [...ANALYSIS_OPTIONS, REQUIRE_COMPLETE_OPTION, REPORT_BASELINE_OPTION],
    prerequisites: [
      "A readable project directory and its local mfdoctor/module-federation configuration.",
      "A build is not required for static analysis, but emitted-artifact claims require adapter facts.",
    ],
    network: OFFLINE_NETWORK,
    writtenArtifacts: [
      ".mf/doctor/project.json (unless --no-write)",
      ".mf/doctor/report.json (when JSON output is written)",
      ".mf/doctor/results.sarif (when SARIF output is written)",
      ...DIAGNOSTICS_ARTIFACTS,
    ],
    errorCodes: ANALYSIS_ERROR_CODES,
  },
  compare: {
    description:
      "Diff deployed MF manifests for name, exposes, shared, publicPath, and remoteEntry.",
    formats: ["terminal", "json", "sarif"],
    arguments: [
      {
        name: "manifest-url",
        type: "url",
        required: true,
        repeatable: true,
        minimumCount: 1,
        description: "Baseline manifest URL followed by zero or more candidate manifest URLs.",
      },
    ],
    options: COMPARE_OPTIONS,
    prerequisites: ["At least one deployed manifest URL supplied by the user."],
    network: EXPLICIT_NETWORK,
    writtenArtifacts: [
      ".mf/doctor/compare.json (when JSON output is selected)",
      ".mf/doctor/compare.sarif (when SARIF output is selected)",
    ],
    errorCodes: {
      "policy-fail": POLICY_FAIL,
      "usage-error": USAGE_ERROR,
      "network-error": NETWORK_ERROR,
      "invalid-manifest": INVALID_MANIFEST,
      "ssrf-blocked": SSRF_BLOCKED,
      "io-error": IO_ERROR,
    },
  },
  federation: {
    description:
      "Analyze explicit project facts or a discovered workspace; --require-complete turns incomplete evidence into a policy failure.",
    formats: ["terminal", "json", "sarif"],
    arguments: [
      {
        name: "project-glob",
        type: "glob",
        required: false,
        repeatable: true,
        description: "Saved project-facts glob(s); use --workspace for root discovery.",
      },
    ],
    options: [
      ...ANALYSIS_OPTIONS,
      ...FEDERATION_OPTIONS,
      REQUIRE_COMPLETE_OPTION,
      REPORT_BASELINE_OPTION,
    ],
    prerequisites: [
      "Explicit schema-valid .mf/doctor/project.json inputs, or roots containing adapter-emitted project facts with --workspace.",
      "All projects intended for a federation graph must be included; missing evidence yields incomplete analysis.",
    ],
    network: OFFLINE_NETWORK,
    writtenArtifacts: [
      ".mf/doctor/report.json (when JSON output is written)",
      ".mf/doctor/results.sarif (when SARIF output is written)",
      ...DIAGNOSTICS_ARTIFACTS,
    ],
    errorCodes: {
      ...ANALYSIS_ERROR_CODES,
      "invalid-project-facts": INVALID_PROJECT_FACTS,
    },
  },
  help: {
    description: "Print CLI usage and command guidance.",
    arguments: [],
    options: [],
    prerequisites: ["None; help is local and does not load project configuration."],
    network: OFFLINE_NETWORK,
    writtenArtifacts: [],
    errorCodes: {},
  },
  probe: {
    description: "Validate a deployed manifest and optionally its remote entry.",
    arguments: [
      {
        name: "manifest-url",
        type: "url",
        required: true,
        description: "Deployed manifest URL supplied by the user.",
      },
    ],
    options: MANIFEST_NETWORK_OPTIONS,
    prerequisites: ["One deployed manifest URL supplied by the user."],
    network: EXPLICIT_NETWORK,
    writtenArtifacts: [],
    errorCodes: {
      "usage-error": USAGE_ERROR,
      "network-error": NETWORK_ERROR,
      "invalid-manifest": INVALID_MANIFEST,
      "ssrf-blocked": SSRF_BLOCKED,
      "io-error": IO_ERROR,
    },
  },
  prompt: {
    description: "Print offline fix prompts from a saved report.",
    arguments: [
      {
        name: "report-path",
        type: "path",
        required: false,
        description: "Saved mfdoctor report; defaults to .mf/doctor/report.json.",
      },
    ],
    options: [
      {
        name: "--finding",
        type: "string",
        description: "Select a finding by fingerprint or rule id.",
      },
    ],
    prerequisites: ["A schema-valid saved mfdoctor report is required."],
    network: OFFLINE_NETWORK,
    writtenArtifacts: [],
    errorCodes: {
      "usage-error": USAGE_ERROR,
      "invalid-report": INVALID_REPORT,
      "finding-not-found": FINDING_NOT_FOUND,
      "io-error": IO_ERROR,
    },
  },
  rules: {
    description: "Print built-in rule metadata or one rule.",
    arguments: [
      {
        name: "rule-id",
        type: "string",
        required: false,
        description: "Optional built-in rule id.",
      },
    ],
    options: [],
    prerequisites: ["None; rule metadata is shipped locally."],
    network: OFFLINE_NETWORK,
    writtenArtifacts: [],
    errorCodes: { "rule-not-found": RULE_NOT_FOUND },
  },
  runtime: {
    description: "Correlate a runtime trace with local project facts.",
    formats: ["terminal", "json", "sarif"],
    arguments: [
      {
        name: "trace-path",
        type: "path",
        required: true,
        description: "User-supplied Observability/runtime trace JSON path.",
      },
      {
        name: "project-glob",
        type: "glob",
        required: false,
        repeatable: true,
        description: "Saved project-facts glob(s); defaults to .mf/doctor/**/project.json.",
      },
    ],
    options: ANALYSIS_OPTIONS.filter((option) => option.name !== "--ci"),
    prerequisites: [
      "A readable user-supplied runtime trace and matching local .mf/doctor/project.json files.",
      "Runtime analysis is correlation only; it never fetches URLs from the trace.",
    ],
    network: OFFLINE_NETWORK,
    writtenArtifacts: [
      ".mf/doctor/report.json (when JSON output is written)",
      ".mf/doctor/results.sarif (when SARIF output is written)",
      ...DIAGNOSTICS_ARTIFACTS,
    ],
    errorCodes: {
      ...ANALYSIS_ERROR_CODES,
      "invalid-report": INVALID_REPORT,
      "invalid-project-facts": INVALID_PROJECT_FACTS,
    },
  },
  workspace: {
    description:
      "Discover project facts and gate a federation workspace; --require-complete turns incomplete evidence into a policy failure.",
    formats: ["terminal", "json", "sarif"],
    arguments: [
      {
        name: "root",
        type: "path",
        required: false,
        repeatable: true,
        description: "Workspace root(s); defaults to the current working directory.",
      },
    ],
    options: [
      ...ANALYSIS_OPTIONS,
      ...FEDERATION_OPTIONS,
      REQUIRE_COMPLETE_OPTION,
      REPORT_BASELINE_OPTION,
    ],
    prerequisites: [
      "Workspace roots containing adapter-emitted .mf/doctor/project.json files.",
      "Every intended federation project must be discoverable; omitted or partial facts keep the gate incomplete.",
    ],
    network: OFFLINE_NETWORK,
    writtenArtifacts: [
      ".mf/doctor/report.json (when JSON output is written)",
      ".mf/doctor/results.sarif (when SARIF output is written)",
      ...DIAGNOSTICS_ARTIFACTS,
    ],
    errorCodes: {
      ...ANALYSIS_ERROR_CODES,
      "invalid-project-facts": INVALID_PROJECT_FACTS,
    },
  },
} satisfies Readonly<Record<string, CliOperationContract>>;

function commandDiscoveryFromOperations(
  operations: Readonly<Record<string, CliOperationContract>>,
): Record<string, { description: string; network: boolean; formats?: OutputFormat[] }> {
  return Object.fromEntries(
    Object.entries(operations).map(([name, operation]) => [
      name,
      {
        description: operation.description,
        network: operation.network.mode === "network",
        ...(operation.formats ? { formats: [...operation.formats] } : {}),
      },
    ]),
  );
}

const DISCOVERY_CONTRACT = {
  schemaVersion: 1,
  commands: commandDiscoveryFromOperations(CLI_OPERATIONS),
  formats: ["terminal", "json", "sarif"] as OutputFormat[],
  schemaVersions: {
    baseline: 1,
    capabilities: 1,
    config: 1,
    evidence: 2,
    identity: 1,
    compare: 1,
    probe: 1,
    project: 1,
    report: 1,
    "rule-inventory": 1,
    "runtime-capture": 1,
    "runtime-trace": 1,
    operations: 1,
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
      "--no-write",
      "--output",
      "--require-complete",
    ],
    commands: {
      discover: "mfdoctor capabilities",
      check: "mfdoctor check --ci --format json,sarif --diagnostics-dir .mf/doctor/diagnostics",
      prompt: "mfdoctor prompt --finding <ruleId> .mf/doctor/report.json",
      "stdout-json": "mfdoctor check --output - --no-write",
    },
  },
  schemas: {
    baseline: "./schemas/baseline.schema.json",
    capabilities: "./schemas/capabilities.schema.json",
    config: "./schemas/config.schema.json",
    evidence: "./schemas/evidence.schema.json",
    identity: "./schemas/identity.schema.json",
    compare: "./schemas/compare.schema.json",
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
    "In-browser mfdoctor runtime agent or client-bundle injection",
    "MCP server schema or tool surface",
    "General --fix autofix for arbitrary findings",
    "No network command (including compare and probe) unless explicitly requested",
    "Unsolicited suppressions or auto-waiving findings",
    "Scraping private Module Federation plugin internals",
    "Runtime-only Module Federation without a bundler MF build plugin",
  ],
  completeness: {
    check:
      "One-project offline analysis of config, imports, and on-disk artifacts; weaker without emit/manifest facts.",
    emit: "Post-emit adapter facts (manifest, stats, emitted assets) when mfdoctor runs in the bundler after build.",
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
    networkCommands: Object.entries(CLI_OPERATIONS)
      .filter(([, operation]) => operation.network.mode === "network")
      .map(([name]) => name),
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
  operations: {
    schemaVersion: 1,
    commands: CLI_OPERATIONS,
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
    throw new Error("mfdoctor package metadata is missing a valid name or version.");
  const bundlerMatrix = deriveBundlerMatrix(await loadCompatibilityMatrix());
  return {
    ...DISCOVERY_CONTRACT,
    package: { name: PACKAGE_NAME, version: packageJson.version },
    bundlerMatrix,
  };
}
