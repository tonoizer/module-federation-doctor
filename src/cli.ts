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
  resolveDiagnosticsDir,
  writeDiagnosticsDump,
} from "./agent-prompt.js";
import { analyze, analyzeFederation } from "./engine.js";
import { EvidenceReaderError, readEvidenceFile, reportFromEvaluations } from "./evidence-reader.js";
import { probeManifest } from "./probe.js";
import { analyzeRuntime, RuntimeTraceError } from "./runtime-trace.js";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "./rules.js";
import type {
  BaselineOptions,
  DoctorFinding,
  DoctorOptions,
  DoctorReport,
  ModuleFederationConfigLike,
  OutputFormat,
  RuleMeta,
} from "./types.js";
import { stableStringify } from "./utils.js";
import { discoverWorkspaceProjectsWithBudget } from "./workspace.js";

interface Parsed {
  command:
    | "check"
    | "federation"
    | "workspace"
    | "probe"
    | "runtime"
    | "rules"
    | "baseline"
    | "prompt"
    | "help";
  baselineAction?: "generate" | "update" | "prune";
  root?: string;
  url?: string;
  trace?: string;
  patterns: string[];
  roots: string[];
  globs: string[];
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
  finding?: string;
  diagnosticsDir?: string;
  formats?: OutputFormat[];
  timeoutMs?: number;
  maxBytes?: number;
  remoteEntry?: boolean;
  ruleId?: string;
  baseline?: string;
  reportPath?: string;
  outPath?: string;
}

const outputFormats = new Set<OutputFormat>(["terminal", "json", "sarif"]);
const DEFAULT_RUNTIME_PROJECTS = ".mf/doctor/**/project.json";
const DEFAULT_BASELINE_OUT = "mfdoctor.baseline.json";
const DEFAULT_REPORT = ".mf/doctor/report.json";

function help(): string {
  return `mfdoctor

Usage:
  mfdoctor check [root]
  mfdoctor check --ci
  mfdoctor check --format terminal,json,sarif
  mfdoctor check --baseline ./mfdoctor.baseline.json
  mfdoctor check --verbose
  mfdoctor check --no-score
  mfdoctor check --no-prompt
  mfdoctor check --prompt
  mfdoctor check --diagnostics-dir .mf/doctor/diagnostics
  mfdoctor prompt [--finding <fingerprint|ruleId>] [.mf/doctor/report.json]
  mfdoctor workspace [root...]
  mfdoctor workspace [root...] --glob "**/.mf/doctor/project.json"
  mfdoctor federation --workspace [root...]
  mfdoctor federation --workspace [root...] --format terminal,json,sarif
  mfdoctor federation ".mf/doctor/**/project.json"
  mfdoctor federation ".mf/doctor/**/project.json" --baseline ./mfdoctor.baseline.json
  mfdoctor baseline generate [.mf/doctor/report.json] [--out mfdoctor.baseline.json]
  mfdoctor baseline update [.mf/doctor/report.json] [--out mfdoctor.baseline.json]
  mfdoctor baseline prune [.mf/doctor/report.json] [--out mfdoctor.baseline.json]
  mfdoctor runtime ./trace.json
  mfdoctor runtime ./trace.json ".mf/doctor/**/project.json" --format terminal,json
  mfdoctor rules [rule-id]
  mfdoctor probe https://host.example/mf-manifest.json
  mfdoctor probe http://localhost:3001/mf-manifest.json --remote-entry

Workspace: after each app builds with the Doctor plugin, \`workspace\` (or
\`federation --workspace\`) auto-discovers \`.mf/doctor/project.json\` under the
given roots. Pass explicit globs to \`federation\` only when you need a manual
escape hatch. Exit codes: 0 pass, 1 policy fail, 2 analysis incomplete.

CI tip: CI mode is auto-detected from CI / provider env vars (GitHub Actions,
GitLab, Circle, Jenkins, …). No mode: "ci" needed in plugin config. Pass --ci
or mode: "ci" to force it; mode: "development" to opt out. Findings are always
collected in full before the build fails. Clean runs stay quiet by default;
pass --verbose, printLog.success, or MFDOCTOR_QUIET=0 for the old success line.

Score: terminal footer shows Score: N/100 (Great|OK|Needs work) after counts.
Pass --no-score or score: false to hide it (report JSON still includes score).

Agent prompts: after the score, terminal prints up to three copy-paste fix
prompts (severity then impact). Pass --no-prompt / prompt: false to hide.
\`mfdoctor prompt --finding <fingerprint|ruleId>\` reads .mf/doctor/report.json
offline. \`--diagnostics-dir\` writes report.json, prompts/*.md, and summary.md
inside the project root only.

Baselines: use fingerprint baselines for incremental adoption. Suppressed
findings still appear in reports but do not fail policy unless
baseline.failOnSuppressed is set. Baselines are tracked debt — shrink them.`;
}

export function parseArgs(argv: string[]): Parsed {
  const command = argv[0];
  if (
    command !== "check" &&
    command !== "federation" &&
    command !== "workspace" &&
    command !== "probe" &&
    command !== "runtime" &&
    command !== "rules" &&
    command !== "baseline" &&
    command !== "prompt"
  )
    return {
      command: "help",
      patterns: [],
      roots: [],
      globs: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
    };
  const parsed: Parsed = {
    command,
    patterns: [],
    roots: [],
    globs: [],
    workspace: command === "workspace",
    ci: false,
    verbose: false,
    score: true,
    prompt: true,
    forcePrompt: false,
  };
  let index = 1;
  if (command === "baseline") {
    const action = argv[1];
    if (action !== "generate" && action !== "update" && action !== "prune")
      throw new Error("baseline needs a subcommand: generate, update, or prune.");
    parsed.baselineAction = action;
    index = 2;
  }
  for (; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--ci") parsed.ci = true;
    else if (value === "--verbose") parsed.verbose = true;
    else if (value === "--no-score") parsed.score = false;
    else if (value === "--no-prompt") {
      parsed.prompt = false;
      parsed.forcePrompt = false;
    } else if (value === "--prompt") {
      parsed.prompt = true;
      parsed.forcePrompt = true;
    } else if (value === "--finding") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-"))
        throw new Error("--finding needs a fingerprint or rule id.");
      parsed.finding = next;
      index += 1;
    } else if (value?.startsWith("--finding=")) {
      const finding = value.slice("--finding=".length);
      if (!finding) throw new Error("--finding needs a fingerprint or rule id.");
      parsed.finding = finding;
    } else if (value === "--diagnostics-dir") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-"))
        throw new Error("--diagnostics-dir needs a directory path.");
      parsed.diagnosticsDir = next;
      index += 1;
    } else if (value?.startsWith("--diagnostics-dir=")) {
      const dir = value.slice("--diagnostics-dir=".length);
      if (!dir) throw new Error("--diagnostics-dir needs a directory path.");
      parsed.diagnosticsDir = dir;
    } else if (value === "--workspace" && (command === "federation" || command === "workspace")) {
      parsed.workspace = true;
    } else if (value === "--glob" && (command === "federation" || command === "workspace")) {
      const next = argv[index + 1];
      if (!next) throw new Error("--glob needs a pattern.");
      parsed.globs.push(next);
      parsed.workspace = true;
      index += 1;
    } else if (
      value?.startsWith("--glob=") &&
      (command === "federation" || command === "workspace")
    ) {
      const glob = value.slice("--glob=".length);
      if (!glob) throw new Error("--glob needs a pattern.");
      parsed.globs.push(glob);
      parsed.workspace = true;
    } else if (value === "--remote-entry" && command === "probe") parsed.remoteEntry = true;
    else if ((value === "--timeout" || value === "--max-bytes") && command === "probe") {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} needs an integer value.`);
      const parsedNumber = Number(next);
      if (!Number.isSafeInteger(parsedNumber)) throw new Error(`${value} needs an integer value.`);
      if (value === "--timeout") parsed.timeoutMs = parsedNumber;
      else parsed.maxBytes = parsedNumber;
      index += 1;
    } else if (value === "--format") {
      const formats = argv[index + 1];
      if (!formats) throw new Error("--format needs a comma-separated value.");
      parsed.formats = parseFormats(formats);
      index += 1;
    } else if (value?.startsWith("--format=")) {
      parsed.formats = parseFormats(value.slice("--format=".length));
    } else if (value === "--baseline") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) throw new Error("--baseline needs a file path.");
      parsed.baseline = next;
      index += 1;
    } else if (value?.startsWith("--baseline=")) {
      parsed.baseline = value.slice("--baseline=".length);
    } else if (value === "--out" || value === "-o") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) throw new Error(`${value} needs a file path.`);
      parsed.outPath = next;
      index += 1;
    } else if (value?.startsWith("--out=")) {
      parsed.outPath = value.slice("--out=".length);
    } else if (value?.startsWith("-")) throw new Error(`Unknown option: ${value}`);
    else if (command === "federation" || command === "workspace") {
      if (parsed.workspace) parsed.roots.push(value ?? "");
      else parsed.patterns.push(value ?? "");
    } else if (command === "runtime") {
      if (!parsed.trace && value) parsed.trace = value;
      else if (value) parsed.patterns.push(value);
    } else if (command === "probe" && !parsed.url && value) parsed.url = value;
    else if (command === "rules" && !parsed.ruleId && value) parsed.ruleId = value;
    else if (command === "baseline" && !parsed.reportPath && value) parsed.reportPath = value;
    else if (command === "prompt" && !parsed.reportPath && value) parsed.reportPath = value;
    else if (!parsed.root && value) parsed.root = value;
    else throw new Error(`Unexpected argument: ${value}`);
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
  if (formats.length === 0 || invalid.length > 0)
    throw new Error(`Unknown output format: ${invalid[0] ?? value}`);
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

function toRuleMeta(
  rule: (typeof federationRuleMeta)[number] | (typeof runtimeRuleMeta)[number],
): RuleMeta {
  return {
    id: rule.id,
    defaultSeverity: rule.severity,
    supportedBundlers: ["vite", "rspack", "rsbuild", "webpack", "modern"],
    documentation: `/rules/${rule.id}`,
    category: rule.category,
    impact: rule.impact,
    fix: rule.fix,
    sources: rule.sources,
  };
}

function baselineFromConfig(config: DoctorOptions): string | BaselineOptions | undefined {
  return config.baseline;
}

async function loadReport(reportPath: string): Promise<DoctorReport> {
  const document = await readEvidenceFile(reportPath, { fileLabel: reportPath });
  const isReportGraph = document.graph.assertions.some(
    (assertion) => assertion.predicate === "doctor.capabilities",
  );
  if (document.kind === "project-facts" || !isReportGraph)
    throw new EvidenceReaderError(
      {
        fileLabel: reportPath,
        detectedDocumentKind: document.kind === "project-facts" ? document.kind : "evidence-graph",
        sourceVersion: document.sourceVersion,
        failureCode: "wrong-document-kind",
        pointer: "/",
      },
      `${reportPath}: Expected a Doctor report document at /; received ${document.kind}.`,
    );
  try {
    return reportFromEvaluations(document.graph);
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
      if (!target) {
        process.stderr.write(`No finding matched --finding ${parsed.finding}\n`);
        return 2;
      }
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
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

async function runBaseline(parsed: Parsed): Promise<number> {
  const action = parsed.baselineAction;
  if (!action) {
    process.stderr.write("baseline needs a subcommand: generate, update, or prune.\n");
    return 2;
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
        process.stderr.write(`No baseline file at ${outPath}. Run baseline generate first.\n`);
        return 2;
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
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
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
  analysis?: import("./analysis-budgets.js").AnalysisBudgetReport,
  workspaceDiagnostics?: import("./workspace.js").WorkspaceProjectDiagnostic[],
): Promise<number> {
  if (files.length === 0) {
    process.stderr.write("No project reports matched.\n");
    return 2;
  }
  const outputDirectory = path.resolve(process.cwd(), ".mf/doctor");
  // CLI --no-score / --no-prompt win; --prompt force-enables over config.
  const showScore = score !== false && config.score !== false;
  const showPrompt = forcePrompt || (prompt !== false && config.prompt !== false);
  const result = await analyzeFederation(files, {
    ...(formats ? { formats, outputDirectory } : {}),
    ...(baseline ? { baseline } : {}),
    ...(verbose ? { quiet: false, printLog: { success: true } } : {}),
    score: showScore,
    prompt: showPrompt,
    ...(config.rules ? { rules: config.rules } : {}),
    ...(config.alwaysShared ? { alwaysShared: config.alwaysShared } : {}),
    ...(analysis ? { analysis } : {}),
    ...(workspaceDiagnostics?.length ? { workspaceDiagnostics } : {}),
    root: process.cwd(),
  });
  const dumpDir = diagnosticsDir ?? config.diagnosticsDir;
  if (dumpDir) {
    const absolute = resolveDiagnosticsDir(process.cwd(), dumpDir);
    await writeDiagnosticsDump(result.report, absolute);
  }
  if (!formats)
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
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${help()}\n`);
    return 2;
  }
  if (parsed.command === "help") {
    process.stdout.write(help() + "\n");
    return 0;
  }
  if (parsed.command === "baseline") return runBaseline(parsed);
  if (parsed.command === "prompt") return runPrompt(parsed);
  if (parsed.command === "probe") {
    if (!parsed.url) {
      process.stderr.write("probe needs a manifest URL.\n");
      return 2;
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
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }
  if (parsed.command === "rules") {
    const catalog: RuleMeta[] = [
      ...builtInRules.map((rule) => rule.meta),
      ...federationRuleMeta.map(toRuleMeta),
      ...runtimeRuleMeta.map(toRuleMeta),
    ];
    catalog.sort((left, right) => left.id.localeCompare(right.id));
    if (parsed.ruleId) {
      const rule = catalog.find((item) => item.id === parsed.ruleId);
      if (!rule) {
        process.stderr.write(`Unknown rule: ${parsed.ruleId}\n`);
        return 2;
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
          process.stderr.write(
            "workspace mode takes roots and optional --glob overrides, not positional federation globs.\n",
          );
          return 2;
        }
        const discovery = await discoverWorkspaceProjectsWithBudget({
          roots: parsed.roots,
          ...(parsed.globs.length > 0 ? { globs: parsed.globs } : {}),
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
          discovery.budget,
          discovery.diagnostics,
        );
      }
      if (parsed.patterns.length === 0) {
        process.stderr.write(
          'federation needs --workspace or at least one project.json glob (for example ".mf/doctor/**/project.json").\n',
        );
        return 2;
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
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }
  if (parsed.command === "runtime") {
    const root = path.resolve(process.cwd());
    try {
      const config = await configAt(root);
      const tracePath = parsed.trace ?? config.runtimeTrace;
      if (!tracePath) {
        process.stderr.write(
          "runtime needs a trace JSON path or DoctorOptions.runtimeTrace in mfdoctor.config.\n",
        );
        return 2;
      }
      const patterns = parsed.patterns.length > 0 ? parsed.patterns : [DEFAULT_RUNTIME_PROJECTS];
      const files = await fg(patterns, { absolute: true, onlyFiles: true, cwd: root });
      if (files.length === 0) throw new RuntimeTraceError("No project reports matched.");
      const formats = parsed.formats;
      const outputDirectory = path.resolve(root, ".mf/doctor");
      const result = await analyzeRuntime({
        tracePath: path.resolve(root, tracePath),
        projectFiles: files,
        ...(formats ? { formats, outputDirectory } : {}),
        ...(parsed.verbose ? { quiet: false, printLog: { success: true } } : {}),
        score: parsed.score !== false && config.score !== false,
        prompt: parsed.forcePrompt || (parsed.prompt !== false && config.prompt !== false),
      });
      if (parsed.diagnosticsDir || config.diagnosticsDir) {
        const dump = resolveDiagnosticsDir(root, parsed.diagnosticsDir ?? config.diagnosticsDir!);
        await writeDiagnosticsDump(result.report, dump);
      }
      if (!formats)
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
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
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
    if (parsed.diagnosticsDir) options.diagnosticsDir = parsed.diagnosticsDir;
    else if (config.diagnosticsDir) options.diagnosticsDir = config.diagnosticsDir;
    if (parsed.formats) options.output = { ...config.output, formats: parsed.formats };
    if (parsed.baseline) options.baseline = parsed.baseline;
    const result = await analyze(options);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main();
