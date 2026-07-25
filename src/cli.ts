#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import { loadConfig } from "unconfig";
import { analyze, analyzeFederation } from "./engine.js";
import { probeManifest } from "./probe.js";
import { analyzeRuntime, RuntimeTraceError } from "./runtime-trace.js";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "./rules.js";
import type { DoctorOptions, ModuleFederationConfigLike, OutputFormat, RuleMeta } from "./types.js";
import { stableStringify } from "./utils.js";
import { DEFAULT_UI_PORT, serveUiUntilClosed } from "./ui-server.js";
import { resolveOptions } from "./config.js";

interface Parsed {
  command: "check" | "federation" | "probe" | "runtime" | "rules" | "help";
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
  ui: boolean;
  uiPort?: number;
}

const outputFormats = new Set<OutputFormat>(["terminal", "json", "sarif", "html"]);
const DEFAULT_RUNTIME_PROJECTS = ".mf/doctor/**/project.json";

function help(): string {
  return `mfdoctor

Usage:
  mfdoctor check [root]
  mfdoctor check --ci
  mfdoctor check --format terminal,json,sarif,html
  mfdoctor check --ui
  mfdoctor check --ui --ui-port 51205
  mfdoctor federation ".mf/doctor/**/project.json"
  mfdoctor federation ".mf/doctor/**/project.json" --ui
  mfdoctor runtime ./trace.json
  mfdoctor runtime ./trace.json ".mf/doctor/**/project.json" --format terminal,json
  mfdoctor rules [rule-id]
  mfdoctor probe https://host.example/mf-manifest.json
  mfdoctor probe http://localhost:3001/mf-manifest.json --remote-entry`;
}

function shouldHoldUi(): boolean {
  return process.env.MFDOCTOR_UI_NO_HOLD !== "1" && process.env.VITEST !== "true";
}

function withHtml(formats: OutputFormat[] | undefined): OutputFormat[] {
  const base = formats ? [...formats] : [];
  if (!base.includes("html")) base.push("html");
  return base;
}

export function parseArgs(argv: string[]): Parsed {
  const command = argv[0];
  if (
    command !== "check" &&
    command !== "federation" &&
    command !== "probe" &&
    command !== "runtime" &&
    command !== "rules"
  )
    return { command: "help", patterns: [], ci: false, ui: false };
  const parsed: Parsed = { command, patterns: [], ci: false, ui: false };
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--ci") parsed.ci = true;
    else if (value === "--ui") parsed.ui = true;
    else if (value === "--ui-port") {
      const next = argv[index + 1];
      if (!next) throw new Error("--ui-port needs an integer value.");
      const port = Number(next);
      if (!Number.isSafeInteger(port) || port <= 0 || port > 65535)
        throw new Error("--ui-port needs an integer port between 1 and 65535.");
      parsed.uiPort = port;
      index += 1;
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
    } else if (value?.startsWith("-")) throw new Error(`Unknown option: ${value}`);
    else if (command === "federation") parsed.patterns.push(value ?? "");
    else if (command === "runtime") {
      if (!parsed.trace && value) parsed.trace = value;
      else if (value) parsed.patterns.push(value);
    } else if (command === "probe" && !parsed.url && value) parsed.url = value;
    else if (command === "rules" && !parsed.ruleId && value) parsed.ruleId = value;
    else if (!parsed.root && value) parsed.root = value;
    else throw new Error(`Unexpected argument: ${value}`);
  }
  if (parsed.ui && (command === "probe" || command === "rules"))
    throw new Error(`--ui is only supported for check, federation, and runtime.`);
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

async function maybeServeUi(directory: string, parsed: Parsed): Promise<void> {
  if (!parsed.ui || !shouldHoldUi()) return;
  await serveUiUntilClosed({
    directory,
    port: parsed.uiPort ?? DEFAULT_UI_PORT,
    open: true,
  });
}

function toRuleMeta(
  rule: (typeof federationRuleMeta)[number] | (typeof runtimeRuleMeta)[number],
): RuleMeta {
  return {
    id: rule.id,
    defaultSeverity: rule.severity,
    supportedBundlers: ["vite", "rspack", "rsbuild"],
    documentation: `/rules/${rule.id}`,
    category: rule.category,
    impact: rule.impact,
    fix: rule.fix,
    sources: rule.sources,
  };
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
      const formats = parsed.ui ? withHtml(parsed.formats ?? ["terminal", "json"]) : parsed.formats;
      const outputDirectory = path.resolve(process.cwd(), ".mf/doctor");
      const result = await analyzeFederation(files, formats ? { formats, outputDirectory } : {});
      if (!formats)
        process.stdout.write(
          stableStringify({ schemaVersion: 1, findings: result.findings }, 2) + "\n",
        );
      await maybeServeUi(outputDirectory, parsed);
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
      const formats = parsed.ui ? withHtml(parsed.formats ?? ["terminal", "json"]) : parsed.formats;
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
      await maybeServeUi(outputDirectory, parsed);
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
    const formats = parsed.ui ? withHtml(parsed.formats ?? config.output?.formats) : parsed.formats;
    if (formats) options.output = { ...config.output, formats };
    const result = await analyze(options);
    const directory = resolveOptions(options).output.directory;
    await maybeServeUi(directory, parsed);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main();
