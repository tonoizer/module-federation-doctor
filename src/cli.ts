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
import { discoverWorkspaceProjects } from "./workspace.js";

interface Parsed {
  command: "check" | "federation" | "workspace" | "probe" | "runtime" | "rules" | "help";
  root?: string;
  url?: string;
  trace?: string;
  patterns: string[];
  roots: string[];
  globs: string[];
  workspace: boolean;
  ci: boolean;
  formats?: OutputFormat[];
  timeoutMs?: number;
  maxBytes?: number;
  remoteEntry?: boolean;
  ruleId?: string;
}

const outputFormats = new Set<OutputFormat>(["terminal", "json", "sarif"]);
const DEFAULT_RUNTIME_PROJECTS = ".mf/doctor/**/project.json";

function help(): string {
  return `mfdoctor

Usage:
  mfdoctor check [root]
  mfdoctor check --ci
  mfdoctor check --format terminal,json,sarif
  mfdoctor workspace [root...]
  mfdoctor workspace [root...] --glob "**/.mf/doctor/project.json"
  mfdoctor federation --workspace [root...]
  mfdoctor federation --workspace [root...] --format terminal,json,sarif
  mfdoctor federation ".mf/doctor/**/project.json"
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
collected in full before the build fails.`;
}

export function parseArgs(argv: string[]): Parsed {
  const command = argv[0];
  if (
    command !== "check" &&
    command !== "federation" &&
    command !== "workspace" &&
    command !== "probe" &&
    command !== "runtime" &&
    command !== "rules"
  )
    return { command: "help", patterns: [], roots: [], globs: [], workspace: false, ci: false };
  const parsed: Parsed = {
    command,
    patterns: [],
    roots: [],
    globs: [],
    workspace: command === "workspace",
    ci: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--ci") parsed.ci = true;
    else if (value === "--workspace" && (command === "federation" || command === "workspace")) {
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
    } else if (value?.startsWith("-")) throw new Error(`Unknown option: ${value}`);
    else if (command === "federation" || command === "workspace") {
      if (parsed.workspace) parsed.roots.push(value ?? "");
      else parsed.patterns.push(value ?? "");
    } else if (command === "runtime") {
      if (!parsed.trace && value) parsed.trace = value;
      else if (value) parsed.patterns.push(value);
    } else if (command === "probe" && !parsed.url && value) parsed.url = value;
    else if (command === "rules" && !parsed.ruleId && value) parsed.ruleId = value;
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
    supportedBundlers: ["vite", "rspack", "rsbuild", "webpack"],
    documentation: `/rules/${rule.id}`,
    category: rule.category,
    impact: rule.impact,
    fix: rule.fix,
    sources: rule.sources,
  };
}

async function runFederationAnalysis(
  files: string[],
  formats: OutputFormat[] | undefined,
): Promise<number> {
  if (files.length === 0) {
    process.stderr.write("No project reports matched.\n");
    return 2;
  }
  const outputDirectory = path.resolve(process.cwd(), ".mf/doctor");
  const result = await analyzeFederation(files, formats ? { formats, outputDirectory } : {});
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
      if (parsed.workspace) {
        if (parsed.patterns.length > 0) {
          process.stderr.write(
            "workspace mode takes roots and optional --glob overrides, not positional federation globs.\n",
          );
          return 2;
        }
        const files = await discoverWorkspaceProjects({
          roots: parsed.roots,
          ...(parsed.globs.length > 0 ? { globs: parsed.globs } : {}),
        });
        return await runFederationAnalysis(files, parsed.formats);
      }
      if (parsed.patterns.length === 0) {
        process.stderr.write(
          'federation needs --workspace or at least one project.json glob (for example ".mf/doctor/**/project.json").\n',
        );
        return 2;
      }
      const files = await fg(parsed.patterns, { absolute: true, onlyFiles: true });
      return await runFederationAnalysis(files, parsed.formats);
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
    const result = await analyze(options);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main();
