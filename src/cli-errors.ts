import { CLI_OPERATIONS } from "./capabilities.js";
import { EvidenceReaderError } from "./evidence-reader.js";
import { ProbeError } from "./probe.js";
import { RuntimeTraceError } from "./runtime-trace.js";
import type { DoctorFinding } from "./types.js";

/** Capabilities `errorCodes` keys that CLI stderr can raise before a report exists. */
export type CliErrorCode =
  | "usage-error"
  | "io-error"
  | "invalid-report"
  | "invalid-project-facts"
  | "finding-not-found"
  | "rule-not-found"
  | "network-error"
  | "invalid-manifest"
  | "ssrf-blocked";

const COMMAND_NAMES = Object.keys(CLI_OPERATIONS).sort();
const OUTPUT_FORMATS = ["terminal", "json", "sarif"] as const;
const MAX_HINT_IDS = 8;

const FOCUSED_USAGE: Record<string, string> = {
  baseline: `  mfdoctor baseline generate [.mf/doctor/report.json] [--out mfdoctor.baseline.json]
  mfdoctor baseline update [.mf/doctor/report.json]
  mfdoctor baseline prune [.mf/doctor/report.json]`,
  capabilities: `  mfdoctor capabilities
  mfdoctor capabilities --format json`,
  check: `  mfdoctor check [root]
  mfdoctor check --ci --format terminal,json,sarif
  mfdoctor check --require-complete --output - --no-write`,
  compare: `  mfdoctor compare <manifest-url> [manifest-url...]
  mfdoctor compare https://a.example/mf-manifest.json https://b.example/mf-manifest.json --format json`,
  federation: `  mfdoctor federation --workspace [root...]
  mfdoctor federation ".mf/doctor/**/project.json"
  mfdoctor federation --workspace --require-complete`,
  help: `  mfdoctor --help
  mfdoctor <command> --help`,
  probe: `  mfdoctor probe <manifest-url>
  mfdoctor probe https://host.example/mf-manifest.json --remote-entry`,
  prompt: `  mfdoctor prompt [.mf/doctor/report.json]
  mfdoctor prompt --finding <fingerprint|ruleId> .mf/doctor/report.json`,
  rules: `  mfdoctor rules
  mfdoctor rules <rule-id>`,
  runtime: `  mfdoctor runtime <trace.json>
  mfdoctor runtime ./trace.json ".mf/doctor/**/project.json" --format json`,
  workspace: `  mfdoctor workspace [root...]
  mfdoctor workspace [root...] --glob "**/.mf/doctor/project.json"
  mfdoctor workspace [root...] --require-complete`,
};

export interface CliErrorInit {
  code: CliErrorCode;
  message: string;
  fix: string;
  next?: string;
  usage?: string;
  hint?: string;
  exitCode?: 1 | 2;
}

/** Structured CLI failure with a capabilities error code and concrete remediation. */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: 1 | 2;
  readonly fix: string;
  readonly next?: string;
  readonly usage?: string;
  readonly hint?: string;

  constructor(init: CliErrorInit) {
    super(init.message);
    this.name = "CliError";
    this.code = init.code;
    this.exitCode = init.exitCode ?? 2;
    this.fix = init.fix;
    if (init.next) this.next = init.next;
    if (init.usage) this.usage = init.usage;
    if (init.hint) this.hint = init.hint;
  }
}

export function commandNames(): string[] {
  return COMMAND_NAMES;
}

/** Compact usage block for one command, or the command list when unknown. */
export function commandUsage(command?: string): string {
  if (command && FOCUSED_USAGE[command]) return FOCUSED_USAGE[command];
  return `  mfdoctor <command>\n\nCommands: ${COMMAND_NAMES.join(", ")}`;
}

export function usageError(
  message: string,
  options: { command?: string; fix?: string; next?: string; hint?: string } = {},
): CliError {
  const command = options.command;
  const usage = commandUsage(command);
  return new CliError({
    code: "usage-error",
    message,
    fix:
      options.fix ??
      (command
        ? `Correct the ${command} arguments or options, or run \`mfdoctor ${command} --help\`.`
        : "Use a documented command. Run `mfdoctor --help` or `mfdoctor capabilities`."),
    next: options.next ?? (command ? `mfdoctor ${command} --help` : "mfdoctor --help"),
    usage,
    ...(options.hint ? { hint: options.hint } : {}),
  });
}

export function unknownCommandError(command: string): CliError {
  const suggestion = nearestMatch(command, COMMAND_NAMES);
  return usageError(`Unknown command: ${command}`, {
    fix: suggestion
      ? `Replace \`${command}\` with \`${suggestion}\`. Run \`mfdoctor --help\` or \`mfdoctor capabilities\` for the command list.`
      : "Use a documented command. Run `mfdoctor --help` or `mfdoctor capabilities` for the command list.",
    next: suggestion ? `mfdoctor ${suggestion} --help` : "mfdoctor --help",
    ...(suggestion ? { hint: `Did you mean: ${suggestion}` } : {}),
  });
}

export function unknownOptionError(command: string, option: string): CliError {
  const known = optionNames(command);
  const suggestion = nearestMatch(option, known);
  if (option === "--ui" || option === "--watch") {
    return usageError(`Unknown option: ${option}`, {
      command,
      fix: `\`${option}\` is a documented non-goal (no HTML dashboard, no \`check --watch\`). Use \`--format terminal,json,sarif\` and \`mfdoctor capabilities\` for supported options.`,
      next: `mfdoctor ${command} --help`,
    });
  }
  if (option === "--require-complete") {
    return usageError(`Unknown option: ${option}`, {
      command,
      fix: "`--require-complete` applies only to `check`, `workspace`, and `federation`. Drop the flag for this command.",
      next: `mfdoctor ${command} --help`,
    });
  }
  return usageError(`Unknown option: ${option}`, {
    command,
    fix: suggestion
      ? `Replace \`${option}\` with \`${suggestion}\`. Run \`mfdoctor ${command} --help\` or \`mfdoctor capabilities\` for supported options.`
      : `Use a documented option for \`${command}\`. Run \`mfdoctor ${command} --help\` or \`mfdoctor capabilities\`.`,
    next: `mfdoctor ${command} --help`,
    ...(suggestion ? { hint: `Did you mean: ${suggestion}` } : {}),
  });
}

export function unknownFormatError(value: string): CliError {
  return usageError(`Unknown output format: ${value}`, {
    fix: `Pass a comma-separated list of ${OUTPUT_FORMATS.join(", ")}. Example: \`--format terminal,json,sarif\`.`,
    next: "mfdoctor check --format json --output - --no-write",
  });
}

export function missingFindingError(selector: string, findings: DoctorFinding[]): CliError {
  const ids = uniqueIds(
    findings.map((finding) => finding.ruleId),
    MAX_HINT_IDS,
  );
  const hint =
    ids.length > 0
      ? `Available rule ids: ${ids.join(", ")}${ids.length >= MAX_HINT_IDS ? ", ..." : ""}`
      : "The report has no findings to prompt.";
  return new CliError({
    code: "finding-not-found",
    message: `No finding matched --finding ${selector}`,
    hint,
    fix:
      ids.length > 0
        ? `Use a fingerprint or rule id from the saved report. Omit --finding to print the top prompts, or pick one of: ${ids.join(", ")}.`
        : "Re-run `mfdoctor check` if you expected findings, then call `mfdoctor prompt` without --finding.",
    next:
      ids.length > 0 ? `mfdoctor prompt --finding ${ids[0]}` : "mfdoctor prompt",
    usage: commandUsage("prompt"),
  });
}

export function unknownRuleError(ruleId: string, catalogIds: readonly string[]): CliError {
  const suggestion = nearestMatch(ruleId, catalogIds);
  return new CliError({
    code: "rule-not-found",
    message: `Unknown rule: ${ruleId}`,
    ...(suggestion ? { hint: `Did you mean: ${suggestion}` } : {}),
    fix: suggestion
      ? `Replace \`${ruleId}\` with \`${suggestion}\`. Run \`mfdoctor rules\` for the built-in catalog.`
      : "Run `mfdoctor rules` for the built-in catalog. Rule ids look like `config/name-required`.",
    next: suggestion ? `mfdoctor rules ${suggestion}` : "mfdoctor rules",
    usage: commandUsage("rules"),
  });
}

export function noProjectReportsError(
  command: "workspace" | "federation" | "runtime",
  options: { strict?: boolean } = {},
): CliError {
  const next =
    command === "runtime"
      ? "mfdoctor runtime ./trace.json .mf/doctor/**/project.json"
      : command === "federation"
        ? "mfdoctor federation --workspace"
        : "mfdoctor workspace";
  return new CliError({
    code: "invalid-project-facts",
    message: "No project reports matched.",
    exitCode: options.strict ? 1 : 2,
    fix: "Rebuild each federated app with a mfdoctor adapter so `.mf/doctor/project.json` exists, then rerun. For federation, pass an explicit glob such as `.mf/doctor/**/project.json` or use `--workspace`. Incomplete evidence is not a pass.",
    next,
    usage: commandUsage(command),
  });
}

export function missingBaselineError(outPath: string): CliError {
  return new CliError({
    code: "io-error",
    message: `No baseline file at ${outPath}. Run baseline generate first.`,
    fix: `Create a fingerprint baseline with \`mfdoctor baseline generate [.mf/doctor/report.json] --out ${outPath}\`, then retry prune/update.`,
    next: `mfdoctor baseline generate --out ${outPath}`,
    usage: commandUsage("baseline"),
  });
}

/** Format a structured CLI error for stderr (stable keys: error / fix / next / Usage). */
export function formatCliError(error: CliError): string {
  const lines = [`error: ${error.code}`, error.message];
  if (error.hint) lines.push(error.hint);
  lines.push("", `fix: ${error.fix}`);
  if (error.next) lines.push(`next: ${error.next}`);
  if (error.usage) {
    lines.push("", "Usage:", error.usage);
  }
  return `${lines.join("\n")}\n`;
}

export function writeCliError(
  error: unknown,
  stream: NodeJS.WritableStream = process.stderr,
): number {
  const cli = error instanceof CliError ? error : classifyThrownError(error);
  stream.write(formatCliError(cli));
  return cli.exitCode;
}

export function classifyThrownError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof EvidenceReaderError) return classifyEvidenceError(error);
  if (error instanceof ProbeError) return classifyProbeError(error);
  if (error instanceof RuntimeTraceError) return classifyRuntimeTraceError(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as NodeJS.ErrnoException).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ENOENT" || /no such file|ENOENT/i.test(message)) {
    return new CliError({
      code: "io-error",
      message,
      fix: "Create the missing file or pass the correct path. Saved reports default to `.mf/doctor/report.json`; project facts live at `.mf/doctor/project.json` after a mfdoctor adapter build.",
      next: "mfdoctor check --format json --output - --no-write",
    });
  }
  if (code === "EACCES" || /permission denied/i.test(message)) {
    return new CliError({
      code: "io-error",
      message,
      fix: "Fix file permissions so mfdoctor can read the path, then retry. Do not point `--diagnostics-dir` outside the project root.",
      next: "mfdoctor check",
    });
  }
  if (/--diagnostics-dir must stay inside/i.test(message) || /diagnostics-prompts/i.test(message)) {
    return usageError(message, { command: "check" });
  }
  return new CliError({
    code: "io-error",
    message,
    fix: "Inspect the error, then retry. For a versioned contract of commands and error codes, run `mfdoctor capabilities`.",
    next: "mfdoctor --help",
  });
}

function classifyEvidenceError(error: EvidenceReaderError): CliError {
  const invalidDocument =
    error.failureCode === "malformed-json" ||
    error.failureCode === "schema-invalid" ||
    error.failureCode === "unsupported-version" ||
    error.failureCode === "integrity-invalid" ||
    error.failureCode === "wrong-document-kind";
  const code: CliErrorCode = invalidDocument ? "invalid-report" : "io-error";
  const fix = invalidDocument
    ? "Pass a schema-valid mfdoctor report (`report.json` from `mfdoctor check` / adapter emit), not `project.json` or another JSON document. Re-run `mfdoctor check --format json` to write a fresh report."
    : "Ensure the report path exists and is readable. Default path: `.mf/doctor/report.json` after a check or adapter build.";
  return new CliError({
    code,
    message: error.message,
    fix,
    next: "mfdoctor check --format json",
    usage: commandUsage("prompt"),
  });
}

function classifyProbeError(error: ProbeError): CliError {
  const message = error.message;
  if (
    /embedded credentials|Only HTTPS|private|link-local|metadata|loopback|not allowed/i.test(
      message,
    )
  ) {
    return new CliError({
      code: "ssrf-blocked",
      message,
      fix: "Use an https URL without embedded credentials. HTTP is allowed only for loopback initial URLs. Private, link-local, and metadata hosts require an explicit local exception in library callers, not the CLI.",
      next: "mfdoctor probe https://host.example/mf-manifest.json",
      usage: commandUsage("probe"),
    });
  }
  if (
    /Manifest must|Manifest has no|Manifest remote|not valid JSON|not a JSON object/i.test(message)
  ) {
    return new CliError({
      code: "invalid-manifest",
      message,
      fix: "Point probe/compare at a Module Federation `mf-manifest.json` (JSON object with name or id). Do not pass remoteEntry JavaScript or an HTML page.",
      next: "mfdoctor probe https://host.example/mf-manifest.json",
      usage: commandUsage("probe"),
    });
  }
  if (/timeoutMs must|maxBytes must|Invalid URL/i.test(message)) {
    return usageError(message, {
      command: "probe",
      fix: "Pass a valid manifest URL. `--timeout` is 1–120000 ms and `--max-bytes` is 1–20971520.",
    });
  }
  return new CliError({
    code: "network-error",
    message,
    fix: "Retry after confirming the URL is reachable over HTTPS. Increase `--timeout` / `--max-bytes` only if the manifest is large or slow. Probe never downloads or executes remote JavaScript.",
    next: "mfdoctor probe https://host.example/mf-manifest.json",
    usage: commandUsage("probe"),
  });
}

function classifyRuntimeTraceError(error: RuntimeTraceError): CliError {
  const missingProjects = /No project reports matched/i.test(error.message);
  if (missingProjects) return noProjectReportsError("runtime");
  const notFound = error.failureCode === "not-found";
  return new CliError({
    code: notFound ? "io-error" : "invalid-report",
    message: error.message,
    fix: notFound
      ? "Pass a readable Observability/runtime trace JSON path as the first argument, or set `DoctorOptions.runtimeTrace` in mfdoctor.config."
      : "Supply a schema-valid runtime trace (not a doctor report). See `mfdoctor capabilities` runtime prerequisites.",
    next: "mfdoctor runtime ./trace.json .mf/doctor/**/project.json",
    usage: commandUsage("runtime"),
  });
}

function optionNames(command: string): string[] {
  const operation = CLI_OPERATIONS[command as keyof typeof CLI_OPERATIONS];
  if (!operation) return [];
  const names = operation.options.flatMap((option) => [option.name, ...(option.aliases ?? [])]);
  names.push("--help", "-h");
  return names;
}

function uniqueIds(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
    if (ids.length >= limit) break;
  }
  return ids;
}

/** Small Levenshtein nearest-match for command, option, and rule ids. */
export function nearestMatch(input: string, candidates: readonly string[]): string | undefined {
  const needle = input.toLowerCase();
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const haystack = candidate.toLowerCase();
    if (haystack === needle) return candidate;
    const distance = levenshtein(needle, haystack);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (!best) return undefined;
  const max = Math.max(1, Math.min(3, Math.floor(needle.length / 2)));
  return bestDistance <= max ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + cost);
      previous = current;
    }
  }
  return row[b.length]!;
}
