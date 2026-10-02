#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import { loadConfig } from "unconfig";
import {
  generateBaseline,
  loadBaseline,
  parseBaseline,
  pruneBaseline,
  updateBaseline,
  writeBaselineFile,
} from "./baseline.js";
import {
  buildAgentPrompt,
  findPromptTarget,
  formatTopAgentPrompts,
  MAX_DIAGNOSTICS_PROMPT_FINDINGS,
  resolveDiagnosticsDir,
  resolveDiagnosticsPromptLimit,
  resolveDiagnosticsPromptLimitFromEnv,
  writeDiagnosticsDump,
} from "./agent-prompt.js";
import { analyze, analyzeFederation, isAnalysisIncomplete } from "./engine.js";
import { resolvePrompt } from "./config.js";
import {
  EvidenceReaderError,
  readEvidenceFile,
  reportFromEvaluations,
  reportFromV2Evaluations,
} from "./evidence-reader.js";
import { probeManifest } from "./probe.js";
import { compareManifests, formatCompareTerminal, writeCompareReports } from "./compare.js";
import { analyzeRuntime } from "./runtime-trace.js";
import { ruleCatalog } from "./rules.js";
import { loadCliCapabilities } from "./capabilities.js";
import {
  commandUsage,
  missingBaselineError,
  missingFindingError,
  noProjectReportsError,
  unknownCommandError,
  unknownFormatError,
  unknownOptionError,
  unknownRuleError,
  usageError,
  writeCliError,
} from "./cli-errors.js";
import type {
  BaselineOptions,
  DoctorFinding,
  DoctorOptions,
  DoctorReport,
  ModuleFederationConfigLike,
  OutputFormat,
} from "./types.js";
import { stableStringify } from "./utils.js";
import { discoverWorkspaceProjectsWithBudget } from "./workspace.js";

interface Parsed {
  command:
    | "check"
    | "federation"
    | "workspace"
    | "probe"
    | "compare"
    | "runtime"
    | "rules"
    | "baseline"
    | "prompt"
    | "capabilities"
    | "version"
    | "help";
  baselineAction?: "generate" | "update" | "prune";
  root?: string;
  url?: string;
  urls: string[];
  trace?: string;
  patterns: string[];
  roots: string[];
  globs: string[];
  group?: string;
  workspace: boolean;
  ci: boolean;
  /** Print the legacy "no findings" success line (`printLog.success`). */
  verbose: boolean;
  /** When false, omit health score from terminal output. */
  score: boolean;
  /** When false, omit top agent prompts from terminal output. */
  prompt: boolean;
  /** Force printing prompts after check (alias of keeping prompt on). */
  forcePrompt: boolean;
  /** Emit JSON report on stdout (`--output -`). */
  stdoutJson: boolean;
  /** Skip writing report artifacts to disk (`--no-write`). */
  noWrite: boolean;
  /** Treat incomplete analysis as a policy failure (`--require-complete`). */
  requireComplete?: boolean;
  finding?: string;
  diagnosticsDir?: string;
  /** Opt-in dump size for `--diagnostics-dir` (1–25). Terminal top-3 unchanged. */
  diagnosticsPromptLimit?: number;
  formats?: OutputFormat[];
  timeoutMs?: number;
  maxBytes?: number;
  remoteEntry?: boolean;
  ruleId?: string;
  baseline?: string;
  reportPath?: string;
  outPath?: string;
  /** Original command when `mfdoctor <command> --help` was requested. */
  helpCommand?: Parsed["command"];
}

const outputFormats = new Set<OutputFormat>(["terminal", "json", "sarif"]);
const DEFAULT_RUNTIME_PROJECTS = ".mf/doctor/**/project.json";
const DEFAULT_BASELINE_OUT = "mfdoctor.baseline.json";
const DEFAULT_REPORT = ".mf/doctor/report.json";

function help(): string {
  return `mfdoctor

Usage errors print \`error: <code>\`, \`fix:\`, and \`next:\` on stderr (exit 2).
Pass \`mfdoctor <command> --help\` for focused usage, or \`mfdoctor capabilities\`
for the versioned machine-readable contract.

Usage:
  mfdoctor check [root]
  mfdoctor check --ci
  mfdoctor check --format terminal,json,sarif
  mfdoctor check --output -
  mfdoctor check --no-write
  mfdoctor check --baseline ./mfdoctor.baseline.json
  mfdoctor check --verbose
  mfdoctor check --no-score
  mfdoctor check --no-prompt
  mfdoctor check --prompt
  mfdoctor check --require-complete
  mfdoctor check --diagnostics-dir .mf/doctor/diagnostics
  mfdoctor check --diagnostics-dir .mf/doctor/diagnostics --diagnostics-prompts 10
  mfdoctor prompt [--finding <fingerprint|ruleId>] [.mf/doctor/report.json]
  mfdoctor workspace [root...]
  mfdoctor workspace [root...] --glob "**/.mf/doctor/project.json"
  mfdoctor workspace [root...] --group <name>
  mfdoctor workspace [root...] --require-complete
  mfdoctor federation --workspace [root...]
  mfdoctor federation --workspace [root...] --group <name>
  mfdoctor federation --workspace [root...] --format terminal,json,sarif
  mfdoctor federation --workspace [root...] --require-complete
  mfdoctor federation ".mf/doctor/**/project.json"
  mfdoctor federation ".mf/doctor/**/project.json" --baseline ./mfdoctor.baseline.json
  mfdoctor baseline generate [.mf/doctor/report.json] [--out mfdoctor.baseline.json]
  mfdoctor baseline update [.mf/doctor/report.json] [--out mfdoctor.baseline.json]
  mfdoctor baseline prune [.mf/doctor/report.json] [--out mfdoctor.baseline.json]
  mfdoctor runtime ./trace.json
  mfdoctor runtime ./trace.json ".mf/doctor/**/project.json" --format terminal,json
  mfdoctor rules [rule-id]
  mfdoctor capabilities [--format json]
  mfdoctor --version
  mfdoctor -v
  mfdoctor --help
  mfdoctor probe https://host.example/mf-manifest.json
  mfdoctor probe http://localhost:3001/mf-manifest.json --remote-entry
  mfdoctor compare https://a.example/mf-manifest.json https://b.example/mf-manifest.json
  mfdoctor compare https://a.example/mf-manifest.json https://b.example/mf-manifest.json --format json,sarif --remote-entry

Workspace: after each app builds with the mfdoctor plugin, \`workspace\` (or
\`federation --workspace\`) auto-discovers \`.mf/doctor/project.json\` under the
given roots. Pass explicit globs to \`federation\` only when you need a manual
escape hatch. Set \`federationGroup\` in each app's mfdoctor options when one
repository contains multiple independent federation graphs, then select one
with \`--group <name>\`. Projects in different explicit groups are never
compared by federation-wide rules. Exit codes: 0 pass, 1 policy fail, 2
analysis incomplete. Pass --require-complete to check, workspace, or federation
to turn any incomplete evidence into a policy failure (exit 1).

CI tip: CI mode is auto-detected from CI / provider env vars (GitHub Actions,
GitLab, Circle, Jenkins, …). No mode: "ci" needed in plugin config. Pass --ci
or mode: "ci" to force it; mode: "development" to opt out. Findings are always
collected in full before the build fails. Complete successful runs with no
findings stay quiet by default; incomplete reports show their status and next
action. Pass --verbose, printLog.success, or MFDOCTOR_QUIET=0 for the old
success line on complete checks.

Score: terminal footer shows Score: N/100 (Great|OK|Needs work) after counts.
Pass --no-score or score: false to hide it (report JSON still includes score).

Stdout JSON: \`--output -\` prints the report JSON on stdout without agent
prompts on that stream (terminal findings move to stderr). \`--no-write\` skips
report files on disk; with JSON formats it still emits JSON on stdout.

Agent prompts: after the score, terminal prints up to three copy-paste fix
prompts (severity then impact) for local runs. CI hides them by default,
pass --prompt / prompt: true to print, or --diagnostics-dir to dump
prompts/*.md without terminal noise. Pass --no-prompt / prompt: false to
hide locally. \`mfdoctor prompt --finding <fingerprint|ruleId>\` reads
.mf/doctor/report.json offline. \`--diagnostics-dir\` writes report.json,
prompts/*.md, and summary.md inside the project root only (default top-3
prompts). Pass \`--diagnostics-prompts <n>\` (1–${MAX_DIAGNOSTICS_PROMPT_FINDINGS})
or set MFDOCTOR_DIAGNOSTICS_PROMPTS to dump more for agent/CI handoff;
terminal output stays at top-3.

Capabilities: \`mfdoctor capabilities\` prints the versioned JSON contract for
commands, formats, exit codes, noninteractive handoff commands, public schema
paths, non-goals, completeness, GitHub Action identity, network policy, and the
bundler matrix derived from fixtures/compatibility-matrix.json. It does not load
project configuration or access the network.

Compare: \`mfdoctor compare\` diffs one baseline manifest URL against zero or
more candidates using the same HTTPS / SSRF / size guards as \`probe\`. It
never downloads or executes remote JavaScript. Exit 0 = no material diff,
1 = diffs found, 2 = usage or fetch error.

Baselines: use fingerprint baselines for incremental adoption. Suppressed
findings still appear in reports but do not fail policy unless
baseline.failOnSuppressed is set. Baselines are tracked debt, shrink them.`;
}

export function parseArgs(argv: string[]): Parsed {
  const command = argv[0];
  const isVersion = command === "--version" || command === "-v";
  if (!command || command === "--help" || command === "-h" || isVersion)
    return {
      command: isVersion ? "version" : "help",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
      stdoutJson: false,
      noWrite: false,
    };
  if (
    command !== "check" &&
    command !== "federation" &&
    command !== "workspace" &&
    command !== "probe" &&
    command !== "compare" &&
    command !== "runtime" &&
    command !== "rules" &&
    command !== "baseline" &&
    command !== "prompt" &&
    command !== "capabilities" &&
    command !== "help"
  )
    throw unknownCommandError(command);
  const parsed: Parsed = {
    command,
    patterns: [],
    roots: [],
    globs: [],
    urls: [],
    workspace: command === "workspace",
    ci: false,
    verbose: false,
    score: true,
    prompt: true,
    forcePrompt: false,
    stdoutJson: false,
    noWrite: false,
  };
  let index = 1;
  if (command === "baseline") {
    const action = argv[1];
    if (action === "--help" || action === "-h") {
      parsed.command = "help";
      parsed.helpCommand = "baseline";
      return parsed;
    }
    if (action !== "generate" && action !== "update" && action !== "prune")
      throw usageError("baseline needs a subcommand: generate, update, or prune.", {
        command: "baseline",
        fix: "Pass generate, update, or prune. Example: `mfdoctor baseline generate .mf/doctor/report.json --out mfdoctor.baseline.json`.",
      });
    parsed.baselineAction = action;
    index = 2;
  }
  for (; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      parsed.helpCommand = parsed.command;
      parsed.command = "help";
      return parsed;
    } else if (value === "--ci") parsed.ci = true;
    else if (value === "--verbose") parsed.verbose = true;
    else if (value === "--no-score") parsed.score = false;
    else if (value === "--no-prompt") {
      parsed.prompt = false;
      parsed.forcePrompt = false;
    } else if (value === "--prompt") {
      parsed.prompt = true;
      parsed.forcePrompt = true;
    } else if (
      value === "--require-complete" &&
      (command === "check" || command === "federation" || command === "workspace")
    ) {
      parsed.requireComplete = true;
    } else if (value === "--finding") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-"))
        throw usageError("--finding needs a fingerprint or rule id.", { command });
      parsed.finding = next;
      index += 1;
    } else if (value?.startsWith("--finding=")) {
      const finding = value.slice("--finding=".length);
      if (!finding) throw usageError("--finding needs a fingerprint or rule id.", { command });
      parsed.finding = finding;
    } else if (value === "--diagnostics-dir") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-"))
        throw usageError("--diagnostics-dir needs a directory path.", { command });
      parsed.diagnosticsDir = next;
      index += 1;
    } else if (value?.startsWith("--diagnostics-dir=")) {
      const dir = value.slice("--diagnostics-dir=".length);
      if (!dir) throw usageError("--diagnostics-dir needs a directory path.", { command });
      parsed.diagnosticsDir = dir;
    } else if (value === "--diagnostics-prompts") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-"))
        throw usageError(
          `--diagnostics-prompts needs an integer between 1 and ${MAX_DIAGNOSTICS_PROMPT_FINDINGS}.`,
          { command },
        );
      parsed.diagnosticsPromptLimit = resolveDiagnosticsPromptLimit(next);
      index += 1;
    } else if (value?.startsWith("--diagnostics-prompts=")) {
      const raw = value.slice("--diagnostics-prompts=".length);
      if (!raw)
        throw usageError(
          `--diagnostics-prompts needs an integer between 1 and ${MAX_DIAGNOSTICS_PROMPT_FINDINGS}.`,
          { command },
        );
      parsed.diagnosticsPromptLimit = resolveDiagnosticsPromptLimit(raw);
    } else if (value === "--workspace" && (command === "federation" || command === "workspace")) {
      parsed.workspace = true;
    } else if (value === "--glob" && (command === "federation" || command === "workspace")) {
      const next = argv[index + 1];
      if (!next) throw usageError("--glob needs a pattern.", { command });
      parsed.globs.push(next);
      parsed.workspace = true;
      index += 1;
    } else if (
      value?.startsWith("--glob=") &&
      (command === "federation" || command === "workspace")
    ) {
      const glob = value.slice("--glob=".length);
      if (!glob) throw usageError("--glob needs a pattern.", { command });
      parsed.globs.push(glob);
      parsed.workspace = true;
    } else if (value === "--group" && (command === "federation" || command === "workspace")) {
      const next = argv[index + 1];
      if (!next || next.startsWith("-"))
        throw usageError("--group needs a group name.", { command });
      parsed.group = next.trim();
      if (!parsed.group) throw usageError("--group needs a group name.", { command });
      parsed.workspace = true;
      index += 1;
    } else if (
      value?.startsWith("--group=") &&
      (command === "federation" || command === "workspace")
    ) {
      const group = value.slice("--group=".length).trim();
      if (!group) throw usageError("--group needs a group name.", { command });
      parsed.group = group;
      parsed.workspace = true;
    } else if (value === "--remote-entry" && (command === "probe" || command === "compare"))
      parsed.remoteEntry = true;
    else if (
      (value === "--timeout" || value === "--max-bytes") &&
      (command === "probe" || command === "compare")
    ) {
      const next = argv[index + 1];
      if (!next) throw usageError(`${value} needs an integer value.`, { command });
      const parsedNumber = Number(next);
      if (!Number.isSafeInteger(parsedNumber))
        throw usageError(`${value} needs an integer value.`, { command });
      if (value === "--timeout") parsed.timeoutMs = parsedNumber;
      else parsed.maxBytes = parsedNumber;
      index += 1;
    } else if (value === "--format") {
      const formats = argv[index + 1];
      if (!formats) throw usageError("--format needs a comma-separated value.", { command });
      parsed.formats = parseFormats(formats);
      index += 1;
    } else if (value?.startsWith("--format=")) {
      parsed.formats = parseFormats(value.slice("--format=".length));
    } else if (value === "--output") {
      const next = argv[index + 1];
      if (next !== "-")
        throw usageError('--output only supports "-" for stdout JSON.', {
          command,
          fix: "Pass `--output -` to print report JSON on stdout. Combine with `--no-write` to skip disk artifacts.",
        });
      parsed.stdoutJson = true;
      index += 1;
    } else if (value?.startsWith("--output=")) {
      const target = value.slice("--output=".length);
      if (target !== "-")
        throw usageError('--output only supports "-" for stdout JSON.', {
          command,
          fix: "Pass `--output -` to print report JSON on stdout. Combine with `--no-write` to skip disk artifacts.",
        });
      parsed.stdoutJson = true;
    } else if (value === "--no-write") {
      parsed.noWrite = true;
    } else if (value === "--baseline") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-"))
        throw usageError("--baseline needs a file path.", { command });
      parsed.baseline = next;
      index += 1;
    } else if (value?.startsWith("--baseline=")) {
      parsed.baseline = value.slice("--baseline=".length);
    } else if (value === "--out" || value === "-o") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-"))
        throw usageError(`${value} needs a file path.`, { command });
      parsed.outPath = next;
      index += 1;
    } else if (value?.startsWith("--out=")) {
      parsed.outPath = value.slice("--out=".length);
    } else if (value?.startsWith("-")) throw unknownOptionError(command, value);
    else if (command === "federation" || command === "workspace") {
      if (parsed.workspace) parsed.roots.push(value ?? "");
      else parsed.patterns.push(value ?? "");
    } else if (command === "runtime") {
      if (!parsed.trace && value) parsed.trace = value;
      else if (value) parsed.patterns.push(value);
    } else if (command === "probe" && !parsed.url && value) {
      parsed.url = value;
      parsed.urls.push(value);
    } else if (command === "compare" && value) {
      parsed.urls.push(value);
      if (!parsed.url) parsed.url = value;
    } else if (command === "rules" && !parsed.ruleId && value) parsed.ruleId = value;
    else if (command === "baseline" && !parsed.reportPath && value) parsed.reportPath = value;
    else if (command === "prompt" && !parsed.reportPath && value) parsed.reportPath = value;
    else if (!parsed.root && value) parsed.root = value;
    else
      throw usageError(`Unexpected argument: ${value}`, {
        command,
        fix: `Remove the extra argument \`${value}\` or pass it in the documented position. See usage.`,
      });
  }
  if (command === "federation" && parsed.globs.length > 0) parsed.workspace = true;
  // Allow `federation <root> --workspace` by treating early positionals as roots.
  if (parsed.workspace && parsed.patterns.length > 0 && parsed.roots.length === 0) {
    parsed.roots = parsed.patterns;
    parsed.patterns = [];
  }
  return parsed;
}

function parseFormats(value: string): OutputFormat[] {
  const formats = value.split(",").filter(Boolean);
  const invalid = formats.filter((format) => !outputFormats.has(format as OutputFormat));
  if (formats.length === 0 || invalid.length > 0) throw unknownFormatError(invalid[0] ?? value);
  return formats as OutputFormat[];
}

async function configAt(root: string): Promise<DoctorOptions> {
  const doctor = await loadConfig<DoctorOptions>({
    sources: [{ files: "mfdoctor.config" }],
    cwd: root,
  });
  const config = doctor.config ?? {};
  if (config.moduleFederation) return config;
  const federation = await loadConfig<ModuleFederationConfigLike>({
    sources: [{ files: "module-federation.config" }],
    cwd: root,
  });
  return federation.config ? { ...config, moduleFederation: federation.config } : config;
}

function baselineFromConfig(config: DoctorOptions): string | BaselineOptions | undefined {
  return config.baseline;
}

/**
 * Merge CLI prompt flags with config / CI defaults.
 * `--prompt` forces on; `--no-prompt` forces off; otherwise config + CI detection.
 */
function resolveCliPrompt(
  parsed: Pick<Parsed, "prompt" | "forcePrompt" | "ci">,
  config: DoctorOptions,
): boolean {
  const prompt = parsed.forcePrompt ? true : !parsed.prompt ? false : config.prompt;
  const mode = parsed.ci ? "ci" : config.mode;
  return resolvePrompt({
    ...(prompt !== undefined ? { prompt } : {}),
    ...(mode !== undefined ? { mode } : {}),
  });
}

async function loadReport(reportPath: string): Promise<DoctorReport> {
  const document = await readEvidenceFile(reportPath, { fileLabel: reportPath });
  const isReportGraph = document.graph.assertions.some(
    (assertion) => assertion.predicate === "doctor.capabilities",
  );
  if (
    document.kind === "project-facts" ||
    (!isReportGraph &&
      (document.kind !== "evidence-graph" || document.graph.evaluations.length === 0))
  )
    throw new EvidenceReaderError(
      {
        fileLabel: reportPath,
        detectedDocumentKind: document.kind === "project-facts" ? document.kind : "evidence-graph",
        sourceVersion: document.sourceVersion,
        failureCode: "wrong-document-kind",
        pointer: "/",
      },
      `${reportPath}: Expected a mfdoctor report document at /; received ${document.kind}.`,
    );
  try {
    return isReportGraph
      ? reportFromEvaluations(document.graph)
      : reportFromV2Evaluations(document.graph);
  } catch (error) {
    throw new EvidenceReaderError(
      {
        fileLabel: reportPath,
        detectedDocumentKind: document.kind,
        sourceVersion: document.sourceVersion,
        failureCode: "integrity-invalid",
        pointer: "/",
      },
      `${reportPath}: ${error instanceof Error ? error.message : String(error)} at /`,
    );
  }
}

async function loadReportFindings(reportPath: string): Promise<DoctorFinding[]> {
  return (await loadReport(reportPath)).findings;
}

async function runPrompt(parsed: Parsed): Promise<number> {
  const cwd = process.cwd();
  const reportPath = path.resolve(cwd, parsed.reportPath ?? DEFAULT_REPORT);
  try {
    const report = await loadReport(reportPath);
    if (parsed.finding) {
      const target = findPromptTarget(report.findings, parsed.finding);
      if (!target) return writeCliError(missingFindingError(parsed.finding, report.findings));
      process.stdout.write(buildAgentPrompt(target) + "\n");
      return 0;
    }
    const text = formatTopAgentPrompts(report.findings);
    if (!text) {
      process.stdout.write("No agent prompts (no non-suppressed findings).\n");
      return 0;
    }
    process.stdout.write(text + "\n");
    return 0;
  } catch (error) {
    return writeCliError(error);
  }
}

async function runBaseline(parsed: Parsed): Promise<number> {
  const action = parsed.baselineAction;
  if (!action) {
    return writeCliError(
      usageError("baseline needs a subcommand: generate, update, or prune.", {
        command: "baseline",
        fix: "Pass generate, update, or prune. Example: `mfdoctor baseline generate .mf/doctor/report.json`.",
      }),
    );
  }
  const cwd = process.cwd();
  const reportPath = path.resolve(cwd, parsed.reportPath ?? DEFAULT_REPORT);
  const outPath = path.resolve(cwd, parsed.outPath ?? DEFAULT_BASELINE_OUT);
  try {
    const findings = await loadReportFindings(reportPath);
    if (action === "generate") {
      const baseline = generateBaseline(findings);
      await writeBaselineFile(outPath, baseline);
      process.stdout.write(
        `Wrote ${baseline.entries.length} baseline entr${baseline.entries.length === 1 ? "y" : "ies"} to ${outPath}\n`,
      );
      return 0;
    }
    let existing;
    try {
      existing = await loadBaseline(outPath);
    } catch (error) {
      const missing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT";
      if (action === "update" && missing) {
        // First update without a file is equivalent to generate.
        existing = parseBaseline({ schemaVersion: 1, entries: [] });
      } else if (missing) {
        return writeCliError(missingBaselineError(outPath));
      } else {
        throw error;
      }
    }
    const next =
      action === "update" ? updateBaseline(existing, findings) : pruneBaseline(existing, findings);
    await writeBaselineFile(outPath, next);
    process.stdout.write(
      `${action === "update" ? "Updated" : "Pruned"} baseline at ${outPath} (${next.entries.length} entr${next.entries.length === 1 ? "y" : "ies"})\n`,
    );
    return 0;
  } catch (error) {
    return writeCliError(error);
  }
}

async function runCapabilities(parsed: Parsed): Promise<number> {
  if (parsed.formats && (parsed.formats.length !== 1 || parsed.formats[0] !== "json")) {
    return writeCliError(
      usageError("capabilities only supports --format json.", {
        command: "capabilities",
        fix: "Omit --format or pass `--format json`. `mfdoctor capabilities` always prints JSON.",
        next: "mfdoctor capabilities",
      }),
    );
  }
  try {
    process.stdout.write(stableStringify(await loadCliCapabilities(), 2) + "\n");
    return 0;
  } catch (error) {
    return writeCliError(error);
  }
}

async function runVersion(): Promise<number> {
  try {
    const capabilities = await loadCliCapabilities();
    process.stdout.write(`${capabilities.package.version}\n`);
    return 0;
  } catch (error) {
    return writeCliError(error);
  }
}

async function runFederationAnalysis(
  files: string[],
  formats: OutputFormat[] | undefined,
  baseline?: string | BaselineOptions,
  verbose = false,
  config: DoctorOptions = {},
  score = true,
  prompt = true,
  forcePrompt = false,
  diagnosticsDir?: string,
  diagnosticsPromptLimit?: number,
  analysis?: import("./analysis-budgets.js").AnalysisBudgetReport,
  workspaceDiagnostics?: import("./workspace.js").WorkspaceProjectDiagnostic[],
  ci = false,
  stdoutJson = false,
  noWrite = false,
  requireComplete = false,
): Promise<number> {
  const strict = requireComplete || config.requireComplete === true;
  if (files.length === 0 && !workspaceDiagnostics?.length && !isAnalysisIncomplete(analysis)) {
    return writeCliError(noProjectReportsError("federation", { strict }));
  }
  const outputDirectory = path.resolve(process.cwd(), ".mf/doctor");
  // CLI --no-score / --no-prompt win; --prompt force-enables over config / CI default.
  const showScore = score !== false && config.score !== false;
  const showPrompt = resolveCliPrompt({ prompt, forcePrompt, ci }, config);
  const result = await analyzeFederation(files, {
    ...(formats || stdoutJson
      ? {
          formats: formats ?? ["json"],
          outputDirectory,
          ...(noWrite ? { write: false } : {}),
          ...(stdoutJson ? { stdoutJson: true } : {}),
        }
      : {}),
    ...(baseline ? { baseline } : {}),
    ...(config.failOn !== undefined ? { failOn: config.failOn } : {}),
    ...(verbose ? { quiet: false, printLog: { success: true } } : {}),
    score: showScore,
    // Keep stdout JSON free of agent prompts unless --prompt was forced.
    prompt: stdoutJson && !forcePrompt ? false : showPrompt,
    ...(config.rules ? { rules: config.rules } : {}),
    ...(config.alwaysShared ? { alwaysShared: config.alwaysShared } : {}),
    ...(analysis ? { analysis } : {}),
    ...(workspaceDiagnostics?.length ? { workspaceDiagnostics } : {}),
    ...(strict ? { requireComplete: true } : {}),
    root: process.cwd(),
  });
  const dumpDir = diagnosticsDir ?? config.diagnosticsDir;
  if (dumpDir) {
    const absolute = resolveDiagnosticsDir(process.cwd(), dumpDir);
    const limit = resolveDiagnosticsPromptLimitFromEnv(
      diagnosticsPromptLimit ?? config.diagnosticsPromptLimit,
    );
    await writeDiagnosticsDump(result.report, absolute, { limit });
  }
  if (!formats && !stdoutJson)
    process.stdout.write(
      stableStringify({ schemaVersion: 1, findings: result.findings }, 2) + "\n",
    );
  return result.exitCode;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return writeCliError(error);
  }
  if (parsed.command === "version") return runVersion();
  if (parsed.command === "help") {
    const text = parsed.helpCommand
      ? `mfdoctor ${parsed.helpCommand}\n\nUsage:\n${commandUsage(parsed.helpCommand)}`
      : help();
    process.stdout.write(text + "\n");
    return 0;
  }
  if (parsed.command === "baseline") return runBaseline(parsed);
  if (parsed.command === "prompt") return runPrompt(parsed);
  if (parsed.command === "capabilities") return runCapabilities(parsed);
  if (parsed.command === "compare") {
    if (parsed.urls.length === 0) {
      return writeCliError(
        usageError("compare needs at least one manifest URL.", {
          command: "compare",
          fix: "Pass one baseline manifest URL followed by zero or more candidate URLs. Example: `mfdoctor compare https://a.example/mf-manifest.json https://b.example/mf-manifest.json`.",
        }),
      );
    }
    try {
      const result = await compareManifests(parsed.urls, {
        ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
        ...(parsed.maxBytes === undefined ? {} : { maxBytes: parsed.maxBytes }),
        ...(parsed.remoteEntry === undefined ? {} : { remoteEntry: parsed.remoteEntry }),
      });
      const formats = parsed.formats;
      if (formats) {
        const outputDirectory = path.resolve(process.cwd(), ".mf/doctor");
        await writeCompareReports(result, outputDirectory, formats);
      } else {
        process.stdout.write(formatCompareTerminal(result) + "\n");
      }
      return result.equal ? 0 : 1;
    } catch (error) {
      return writeCliError(error);
    }
  }
  if (parsed.command === "probe") {
    if (!parsed.url) {
      return writeCliError(
        usageError("probe needs a manifest URL.", {
          command: "probe",
          fix: "Pass one deployed `mf-manifest.json` URL. Example: `mfdoctor probe https://host.example/mf-manifest.json`.",
        }),
      );
    }
    try {
      const result = await probeManifest(parsed.url, {
        ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
        ...(parsed.maxBytes === undefined ? {} : { maxBytes: parsed.maxBytes }),
        ...(parsed.remoteEntry === undefined ? {} : { remoteEntry: parsed.remoteEntry }),
      });
      process.stdout.write(stableStringify(result, 2) + "\n");
      return result.remoteEntry && result.remoteEntry.status >= 400 ? 1 : 0;
    } catch (error) {
      return writeCliError(error);
    }
  }
  if (parsed.command === "rules") {
    const catalog = ruleCatalog();
    if (parsed.ruleId) {
      const rule = catalog.find((item) => item.id === parsed.ruleId);
      if (!rule) {
        return writeCliError(
          unknownRuleError(
            parsed.ruleId,
            catalog.map((item) => item.id),
          ),
        );
      }
      process.stdout.write(stableStringify(rule, 2) + "\n");
    } else process.stdout.write(stableStringify({ schemaVersion: 1, rules: catalog }, 2) + "\n");
    return 0;
  }
  if (parsed.command === "federation" || parsed.command === "workspace") {
    try {
      const config = await configAt(process.cwd());
      const baseline = parsed.baseline ?? baselineFromConfig(config);
      if (parsed.workspace) {
        if (parsed.patterns.length > 0) {
          return writeCliError(
            usageError(
              "workspace mode takes roots and optional --glob overrides, not positional federation globs.",
              {
                command: parsed.command,
                fix: "Pass directory roots after `workspace` or `federation --workspace`. Use `--glob` only to override project.json discovery, not as extra positionals.",
              },
            ),
          );
        }
        const discovery = await discoverWorkspaceProjectsWithBudget({
          roots: parsed.roots,
          ...(parsed.globs.length > 0 ? { globs: parsed.globs } : {}),
          ...(parsed.group ? { group: parsed.group } : {}),
          ...(config.analysisBudgets ? { analysisBudgets: config.analysisBudgets } : {}),
        });
        return await runFederationAnalysis(
          discovery.files,
          parsed.formats,
          baseline,
          parsed.verbose,
          config,
          parsed.score,
          parsed.prompt,
          parsed.forcePrompt,
          parsed.diagnosticsDir,
          parsed.diagnosticsPromptLimit,
          discovery.budget,
          discovery.diagnostics,
          parsed.ci,
          parsed.stdoutJson,
          parsed.noWrite,
          parsed.requireComplete,
        );
      }
      if (parsed.patterns.length === 0) {
        return writeCliError(
          usageError(
            'federation needs --workspace or at least one project.json glob (for example ".mf/doctor/**/project.json").',
            {
              command: "federation",
              fix: "Prefer `mfdoctor federation --workspace` after adapter emits, or pass an explicit glob to `.mf/doctor/**/project.json`.",
              next: "mfdoctor federation --workspace",
            },
          ),
        );
      }
      const files = await fg(parsed.patterns, { absolute: true, onlyFiles: true });
      return await runFederationAnalysis(
        files,
        parsed.formats,
        baseline,
        parsed.verbose,
        config,
        parsed.score,
        parsed.prompt,
        parsed.forcePrompt,
        parsed.diagnosticsDir,
        parsed.diagnosticsPromptLimit,
        undefined,
        undefined,
        parsed.ci,
        parsed.stdoutJson,
        parsed.noWrite,
        parsed.requireComplete,
      );
    } catch (error) {
      return writeCliError(error);
    }
  }
  if (parsed.command === "runtime") {
    const root = path.resolve(process.cwd());
    try {
      const config = await configAt(root);
      const tracePath = parsed.trace ?? config.runtimeTrace;
      if (!tracePath) {
        return writeCliError(
          usageError(
            "runtime needs a trace JSON path or DoctorOptions.runtimeTrace in mfdoctor.config.",
            {
              command: "runtime",
              fix: "Pass a user-supplied Observability export path: `mfdoctor runtime ./trace.json`. Runtime never fetches URLs from the trace.",
              next: "mfdoctor runtime ./trace.json",
            },
          ),
        );
      }
      const patterns = parsed.patterns.length > 0 ? parsed.patterns : [DEFAULT_RUNTIME_PROJECTS];
      const files = await fg(patterns, { absolute: true, onlyFiles: true, cwd: root });
      if (files.length === 0) throw noProjectReportsError("runtime");
      const formats = parsed.formats;
      const outputDirectory = path.resolve(root, ".mf/doctor");
      const result = await analyzeRuntime({
        tracePath: path.resolve(root, tracePath),
        projectFiles: files,
        ...(formats || parsed.stdoutJson
          ? {
              formats: formats ?? ["json"],
              outputDirectory,
              ...(parsed.noWrite ? { write: false } : {}),
              ...(parsed.stdoutJson ? { stdoutJson: true } : {}),
            }
          : {}),
        ...(parsed.verbose ? { quiet: false, printLog: { success: true } } : {}),
        score: parsed.score !== false && config.score !== false,
        prompt: parsed.stdoutJson && !parsed.forcePrompt ? false : resolveCliPrompt(parsed, config),
      });
      if (parsed.diagnosticsDir || config.diagnosticsDir) {
        const dump = resolveDiagnosticsDir(root, parsed.diagnosticsDir ?? config.diagnosticsDir!);
        const limit = resolveDiagnosticsPromptLimitFromEnv(
          parsed.diagnosticsPromptLimit ?? config.diagnosticsPromptLimit,
        );
        await writeDiagnosticsDump(result.report, dump, { limit });
      }
      if (!formats && !parsed.stdoutJson)
        process.stdout.write(
          stableStringify(
            {
              schemaVersion: 1,
              summary: result.summary,
              findings: result.findings,
              traces: result.traces,
            },
            2,
          ) + "\n",
        );
      return result.exitCode;
    } catch (error) {
      return writeCliError(error);
    }
  }
  const root = path.resolve(parsed.root ?? process.cwd());
  try {
    const config = await configAt(root);
    const options: DoctorOptions = { ...config, root };
    if (parsed.ci) options.mode = "ci";
    if (parsed.verbose) {
      options.quiet = false;
      options.printLog = { ...options.printLog, success: true };
    }
    if (!parsed.score) options.score = false;
    if (!parsed.prompt) options.prompt = false;
    if (parsed.forcePrompt) options.prompt = true;
    if (parsed.requireComplete) options.requireComplete = true;
    if (parsed.diagnosticsDir) options.diagnosticsDir = parsed.diagnosticsDir;
    else if (config.diagnosticsDir) options.diagnosticsDir = config.diagnosticsDir;
    if (parsed.diagnosticsPromptLimit !== undefined)
      options.diagnosticsPromptLimit = parsed.diagnosticsPromptLimit;
    else if (config.diagnosticsPromptLimit !== undefined)
      options.diagnosticsPromptLimit = config.diagnosticsPromptLimit;
    if (parsed.formats || parsed.stdoutJson || parsed.noWrite) {
      options.output = {
        ...config.output,
        ...(parsed.formats ? { formats: parsed.formats } : {}),
        ...(parsed.stdoutJson ? { stdout: true } : {}),
        ...(parsed.noWrite ? { write: false } : {}),
      };
    }
    if (parsed.stdoutJson && !parsed.forcePrompt) options.prompt = false;
    if (parsed.baseline) options.baseline = parsed.baseline;
    const result = await analyze(options);
    return result.exitCode;
  } catch (error) {
    return writeCliError(error);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main();
