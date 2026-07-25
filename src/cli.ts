#!/usr/bin/env node

import fs from "node:fs/promises";
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
import { analyze, analyzeFederation } from "./engine.js";
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

interface Parsed {
  command: "check" | "federation" | "probe" | "runtime" | "rules" | "baseline" | "help";
  baselineAction?: "generate" | "update" | "prune";
  root?: string;
  url?: string;
  trace?: string;
  patterns: string[];
  ci: boolean;
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

CI tip: CI mode is auto-detected from CI / provider env vars (GitHub Actions,
GitLab, Circle, Jenkins, …). No mode: "ci" needed in plugin config. Pass --ci
or mode: "ci" to force it; mode: "development" to opt out. Findings are always
collected in full before the build fails.

Baselines: use fingerprint baselines for incremental adoption. Suppressed
findings still appear in reports but do not fail policy unless
baseline.failOnSuppressed is set. Baselines are tracked debt — shrink them.`;
}

export function parseArgs(argv: string[]): Parsed {
  const command = argv[0];
  if (
    command !== "check" &&
    command !== "federation" &&
    command !== "probe" &&
    command !== "runtime" &&
    command !== "rules" &&
    command !== "baseline"
  )
    return { command: "help", patterns: [], ci: false };
  const parsed: Parsed = { command, patterns: [], ci: false };
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
    else if (value === "--remote-entry" && command === "probe") parsed.remoteEntry = true;
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
    else if (command === "federation") parsed.patterns.push(value ?? "");
    else if (command === "runtime") {
      if (!parsed.trace && value) parsed.trace = value;
      else if (value) parsed.patterns.push(value);
    } else if (command === "probe" && !parsed.url && value) parsed.url = value;
    else if (command === "rules" && !parsed.ruleId && value) parsed.ruleId = value;
    else if (command === "baseline" && !parsed.reportPath && value) parsed.reportPath = value;
    else if (!parsed.root && value) parsed.root = value;
    else throw new Error(`Unexpected argument: ${value}`);
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
    supportedBundlers: ["vite", "rspack", "rsbuild", "webpack"],
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

async function loadReportFindings(reportPath: string): Promise<DoctorFinding[]> {
  const raw = JSON.parse(await fs.readFile(reportPath, "utf8")) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Report file must be a JSON object.");
  const report = raw as DoctorReport;
  if (!Array.isArray(report.findings)) throw new Error('Report file requires a "findings" array.');
  return report.findings;
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
  if (parsed.command === "federation") {
    if (parsed.patterns.length === 0) {
      process.stderr.write("federation needs at least one project.json glob.\n");
      return 2;
    }
    try {
      const files = await fg(parsed.patterns, { absolute: true, onlyFiles: true });
      if (files.length === 0) throw new Error("No project reports matched.");
      const formats = parsed.formats;
      const outputDirectory = path.resolve(process.cwd(), ".mf/doctor");
      const config = await configAt(process.cwd());
      const baseline = parsed.baseline ?? baselineFromConfig(config);
      const result = await analyzeFederation(files, {
        ...(formats ? { formats, outputDirectory } : {}),
        ...(baseline ? { baseline } : {}),
        root: process.cwd(),
      });
      if (!formats)
        process.stdout.write(
          stableStringify({ schemaVersion: 1, findings: result.findings }, 2) + "\n",
        );
      return result.exitCode;
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
      });
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
