import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import {
  applyBaseline,
  loadBaseline,
  policyFails,
  resolveBaselineOptions,
  summarizeFindings,
  type ResolvedBaselineOptions,
} from "./baseline.js";
import { addBuildFacts, collectProjectFacts, type BuildDiagnostics } from "./collect.js";
import { resolveOptions } from "./config.js";
import { builtInRules, federationRuleMeta } from "./rules.js";
import { DEFAULT_ALWAYS_SHARED } from "./shared-policy.js";
import { buildFederationModel, findFederationCycleGroups } from "./federation-model.js";
import type {
  AnalysisResult,
  DoctorFinding,
  DoctorOptions,
  DoctorReport,
  DoctorRule,
  FederationAnalysisResult,
  OutputFormat,
  ProjectFacts,
  ResolvedDoctorOptions,
  RuleSetting,
  Severity,
} from "./types.js";
import { deepFreeze, fingerprint, redact, sortFindings } from "./utils.js";
import { writeFederationReports, writeReports } from "./reporters.js";
import { buildUiPayload, reportFromFindings } from "./ui-graph.js";

function parseSetting(setting: RuleSetting | undefined, fallback: Severity) {
  if (!setting) return { severity: fallback, options: {} };
  if (setting === "off") return undefined;
  if (Array.isArray(setting)) return { severity: setting[0], options: setting[1] };
  return { severity: setting as Severity, options: {} };
}

async function runRule(
  rule: DoctorRule,
  facts: ProjectFacts,
  setting: RuleSetting | undefined,
  root: string,
  sharedPolicy?: ResolvedDoctorOptions["sharedPolicy"],
): Promise<DoctorFinding[]> {
  const resolved = parseSetting(setting, rule.meta.defaultSeverity);
  if (!resolved || !rule.meta.supportedBundlers.includes(facts.bundler.name)) return [];
  const findings: DoctorFinding[] = [];
  const add = (
    value: Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">,
  ) => {
    const evidence = redact(value.evidence, root) as Record<string, unknown>;
    const location = value.location
      ? { ...value.location, path: redact(value.location.path, root) as string }
      : undefined;
    const base = {
      schemaVersion: 1 as const,
      ruleId: rule.meta.id,
      severity: resolved.severity,
      message: redact(value.message, root) as string,
      project: facts.project.name,
      evidence,
      documentation: rule.meta.documentation,
      ...(location ? { location } : {}),
      ...(value.suggestion ? { suggestion: redact(value.suggestion, root) as string } : {}),
    };
    findings.push({ ...base, fingerprint: fingerprint(base) });
  };
  try {
    const returned = await rule.check({
      facts: deepFreeze(structuredClone(facts)),
      options: deepFreeze(resolved.options),
      ...(sharedPolicy ? { sharedPolicy: deepFreeze(sharedPolicy) } : {}),
      report: add,
    });
    if (Array.isArray(returned)) for (const finding of returned) add(finding);
  } catch (error) {
    // Keep every other rule's findings; never abort the suite on the first rule failure.
    const base = {
      schemaVersion: 1 as const,
      ruleId: rule.meta.id,
      severity: "error" as const,
      message: `Rule "${rule.meta.id}" failed during analysis: ${
        error instanceof Error ? error.message : String(error)
      }`,
      project: facts.project.name,
      evidence: { ruleId: rule.meta.id },
      documentation: rule.meta.documentation,
      suggestion: "Fix or disable this rule, then re-run Doctor to collect the full report.",
    };
    findings.push({ ...base, fingerprint: fingerprint(base) });
  }
  return findings;
}

function reportFor(facts: ProjectFacts, findings: DoctorFinding[]): DoctorReport {
  const summary = summarizeFindings(findings);
  return {
    schemaVersion: 1,
    capabilities: facts.capabilities,
    summary: {
      projects: 1,
      info: summary.info,
      warnings: summary.warnings,
      errors: summary.errors,
      ...(summary.suppressed > 0 ? { suppressed: summary.suppressed } : {}),
    },
    findings,
  };
}

async function withBaseline(
  findings: DoctorFinding[],
  baseline: ResolvedBaselineOptions | undefined,
): Promise<{ findings: DoctorFinding[]; failOnSuppressed: boolean }> {
  if (!baseline) return { findings, failOnSuppressed: false };
  const file = await loadBaseline(baseline.path);
  const applied = applyBaseline(findings, file, { reportStale: baseline.reportStale });
  return {
    findings: sortFindings(applied.findings),
    failOnSuppressed: baseline.failOnSuppressed,
  };
}

async function runAnalysis(
  options: DoctorOptions = {},
  emittedAssets?: string[],
  diagnostics?: BuildDiagnostics,
): Promise<AnalysisResult> {
  const resolved = await resolveOptions(options);
  try {
    const facts = await collectProjectFacts(resolved);
    if (emittedAssets) await addBuildFacts(facts, emittedAssets, resolved.root, diagnostics);
    const rawFindings = sortFindings(
      (
        await Promise.all(
          [...builtInRules, ...resolved.extends].map((rule) =>
            runRule(
              rule,
              facts,
              resolved.rules[rule.meta.id],
              resolved.root,
              resolved.sharedPolicy,
            ),
          ),
        )
      ).flat(),
    );
    const { findings, failOnSuppressed } = await withBaseline(rawFindings, resolved.baseline);
    // Write the full report before any caller decides to fail the build.
    // Terminal showcase is the single print path (adapters must not re-print).
    const report = reportFor(facts, findings);
    const safeFacts = redact(facts, resolved.root) as ProjectFacts;
    await writeReports(safeFacts, report, resolved.output.directory, resolved.output.formats, {
      quiet: resolved.quiet,
      printLog: resolved.printLog,
    });
    return {
      facts: safeFacts,
      report,
      exitCode: policyFails(findings, resolved.failOn, failOnSuppressed) ? 1 : 0,
    };
  } catch (error) {
    if (resolved.output.formats.includes("terminal"))
      process.stderr.write(
        `Module Federation Doctor could not complete: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    const emptyFacts = await collectProjectFacts({ ...resolved, include: [] });
    return { facts: emptyFacts, report: reportFor(emptyFacts, []), exitCode: 2 };
  }
}

export async function analyze(options: DoctorOptions = {}): Promise<AnalysisResult> {
  return runAnalysis(options);
}

export async function analyzeBuild(
  options: DoctorOptions,
  emittedAssets: string[],
  diagnostics?: BuildDiagnostics,
): Promise<AnalysisResult> {
  return runAnalysis(options, emittedAssets, diagnostics);
}

function pushFederationFinding(
  findings: DoctorFinding[],
  rules: Record<string, RuleSetting> | undefined,
  ruleId: (typeof federationRuleMeta)[number]["id"],
  project: string,
  message: string,
  evidence: Record<string, unknown>,
): void {
  const meta = federationRuleMeta.find((rule) => rule.id === ruleId);
  const resolved = parseSetting(rules?.[ruleId], meta?.severity ?? "warning");
  if (!resolved || !meta) return;
  const base = {
    schemaVersion: 1 as const,
    ruleId,
    severity: resolved.severity,
    project,
    message,
    evidence,
    documentation: `/rules/${ruleId}`,
    suggestion: meta.fix,
  };
  findings.push({ ...base, fingerprint: fingerprint(base) });
}

export async function analyzeFederation(
  files: string[],
  options: {
    outputDirectory?: string;
    formats?: OutputFormat[];
    failOn?: "never" | "warning" | "error";
    baseline?: string | { path: string; failOnSuppressed?: boolean; reportStale?: boolean };
    root?: string;
    quiet?: boolean;
    printLog?: { success?: boolean };
    /** Severity / off map (supports `rules: { "federation/ghost-shares": "off" }`). */
    rules?: Record<string, RuleSetting>;
    /** Packages excluded from host-gap / ghost-share heuristics. */
    alwaysShared?: string[];
  } = {},
): Promise<FederationAnalysisResult> {
  const projects = (
    await Promise.all(
      files
        .sort()
        .map(
          async (file) => JSON.parse(await fs.readFile(path.resolve(file), "utf8")) as ProjectFacts,
        ),
    )
  ).sort((a, b) => a.project.name.localeCompare(b.project.name));
  const findings: DoctorFinding[] = [];
  const rules = options.rules;
  const alwaysShared = new Set<string>([...DEFAULT_ALWAYS_SHARED, ...(options.alwaysShared ?? [])]);
  const federation = buildFederationModel(projects);
  for (const [name, owners] of federation.federationNames)
    if (owners.length > 1)
      pushFederationFinding(
        findings,
        rules,
        "federation/name-conflict",
        owners[0]?.projectName ?? "federation",
        `Module Federation name "${name}" is used by more than one project.`,
        { name, projects: owners.map((owner) => owner.projectName).sort() },
      );

  const strategyOwners = new Map<string, string[]>();
  for (const node of federation.projects) {
    if (!node.project.moduleFederation) continue;
    strategyOwners.set(node.shareStrategy, [
      ...(strategyOwners.get(node.shareStrategy) ?? []),
      node.projectName,
    ]);
  }
  if (strategyOwners.size > 1)
    pushFederationFinding(
      findings,
      rules,
      "federation/share-strategy-mismatch",
      [...strategyOwners.values()][0]?.[0] ?? "federation",
      "Federation projects disagree on `shareStrategy`.",
      {
        strategies: Object.fromEntries(
          [...strategyOwners.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([strategy, owners]) => [strategy, [...owners].sort()]),
        ),
      },
    );

  for (const group of findFederationCycleGroups(federation)) {
    if (group.riskEdges.length === 0) continue;
    const first = group.members[0];
    if (!first) continue;
    pushFederationFinding(
      findings,
      rules,
      "federation/circular-remote-graph",
      first.projectName,
      `Remote graph has a cycle with eager \`version-first\` startup risk: ${group.members
        .map((member) => member.federationName ?? member.projectName)
        .join(" -> ")}.`,
      {
        projects: group.members.map((member) => member.projectName),
        members: group.members.map((member) => ({
          project: member.projectName,
          federationName: member.federationName,
          shareStrategy: member.shareStrategy,
          asyncStartup: member.asyncStartup,
        })),
        edges: group.edges.map((edge) => ({
          from: edge.fromFederationName,
          to: edge.targetFederationName,
          project: edge.fromProject,
          remote: edge.remoteName,
          alias: edge.alias,
          entry: edge.entry,
        })),
        riskMembers: group.riskMembers.map((member) => ({
          project: member.projectName,
          federationName: member.federationName,
          shareStrategy: member.shareStrategy,
          asyncStartup: member.asyncStartup,
        })),
      },
    );
  }

  const externalRuntimeConsumers = projects.filter(
    (project) => project.moduleFederation?.experiments?.externalRuntime,
  );
  const runtimeProviders = projects.filter(
    (project) => project.moduleFederation?.experiments?.provideExternalRuntime,
  );
  if (externalRuntimeConsumers.length > 0 && runtimeProviders.length === 0)
    pushFederationFinding(
      findings,
      rules,
      "federation/external-runtime-provider-missing",
      externalRuntimeConsumers[0]?.project.name ?? "federation",
      "Projects externalize the Module Federation runtime, but no project provides it.",
      {
        consumers: externalRuntimeConsumers.map((project) => project.project.name).sort(),
      },
    );

  const packages = new Set(
    projects.flatMap((project) => Object.keys(project.moduleFederation?.shared ?? {})),
  );
  for (const name of [...packages].sort()) {
    const entries = projects
      .map((project) => ({ project, shared: project.moduleFederation?.shared[name] }))
      .filter((entry) => entry.shared);
    const scopes = new Set(
      entries.map((entry) => JSON.stringify(entry.shared?.shareScope ?? ["default"])),
    );
    if (scopes.size > 1)
      pushFederationFinding(
        findings,
        rules,
        "federation/share-scope-mismatch",
        entries[0]?.project.project.name ?? "federation",
        `"${name}" uses different share scopes.`,
        { package: name, scopes: [...scopes].sort().map((scope) => JSON.parse(scope)) },
      );
    const singleton = new Set(entries.map((entry) => entry.shared?.singleton));
    if (singleton.size > 1)
      pushFederationFinding(
        findings,
        rules,
        "shared/singleton-mismatch",
        entries[0]?.project.project.name ?? "federation",
        `"${name}" has inconsistent singleton settings.`,
        { package: name },
      );
    const versions = entries
      .map((entry) => ({
        project: entry.project.project.name,
        version: entry.project.dependencies.installed[name],
        range: entry.shared?.requiredVersion,
      }))
      .filter((entry) => entry.version);
    if (
      versions.some((left) =>
        versions.some(
          (right) =>
            left.version &&
            typeof right.range === "string" &&
            semver.valid(left.version) &&
            semver.validRange(right.range) &&
            !semver.satisfies(left.version, right.range),
        ),
      )
    )
      pushFederationFinding(
        findings,
        rules,
        "federation/version-conflict",
        versions[0]?.project ?? "federation",
        `"${name}" versions do not satisfy all consumer ranges.`,
        { package: name, versions },
      );
    const consumersWithoutFallback = entries.filter((entry) => entry.shared?.import === false);
    const providers = entries.filter((entry) => entry.shared?.import !== false);
    if (consumersWithoutFallback.length > 0 && providers.length === 0)
      pushFederationFinding(
        findings,
        rules,
        "federation/missing-provider",
        entries[0]?.project.project.name ?? "federation",
        `"${name}" has no provider or local fallback.`,
        {
          package: name,
          consumers: consumersWithoutFallback.map((entry) => entry.project.project.name).sort(),
        },
      );
  }

  // Cross-project usage vs shared declarations (MFDOCTOR-122 / shared-inspector).
  if (projects.length > 1) {
    const sharedByPkg = new Map<string, Set<string>>();
    const usedByPkg = new Map<string, Set<string>>();
    for (const project of projects) {
      const mfName = project.project.name;
      for (const pkg of Object.keys(project.moduleFederation?.shared ?? {})) {
        if (!sharedByPkg.has(pkg)) sharedByPkg.set(pkg, new Set());
        sharedByPkg.get(pkg)!.add(mfName);
      }
      for (const pkg of project.imports.packages ?? []) {
        if (!usedByPkg.has(pkg)) usedByPkg.set(pkg, new Set());
        usedByPkg.get(pkg)!.add(mfName);
      }
    }

    for (const [pkg, usedByMfs] of [...usedByPkg.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (usedByMfs.size < 2) continue;
      if (alwaysShared.has(pkg)) continue;
      const sharedByMfs = sharedByPkg.get(pkg);
      if (sharedByMfs && sharedByMfs.size > 0) continue;
      // Workspace protocol deps are monorepo source links, not federation share gaps.
      const isWorkspacePackage = projects.some((project) => {
        const range = project.dependencies.declared[pkg];
        return typeof range === "string" && range.startsWith("workspace:");
      });
      if (isWorkspacePackage) continue;
      pushFederationFinding(
        findings,
        rules,
        "federation/host-gaps",
        [...usedByMfs].sort()[0] ?? "federation",
        `"${pkg}" is imported by ${usedByMfs.size} projects but is not in any shared config.`,
        { package: pkg, missingIn: [...usedByMfs].sort() },
      );
    }

    for (const [pkg, sharedByMfs] of [...sharedByPkg.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (alwaysShared.has(pkg)) continue;
      if (sharedByMfs.size !== 1) continue;
      const soloMf = [...sharedByMfs][0]!;
      const usedByMfs = usedByPkg.get(pkg) ?? new Set<string>();
      const usedUnsharedBy = [...usedByMfs]
        .filter((mf) => mf !== soloMf && !sharedByPkg.get(pkg)?.has(mf))
        .sort();
      const otherMfsUseIt = [...usedByMfs].some((mf) => mf !== soloMf);
      if (!otherMfsUseIt || usedUnsharedBy.length > 0) {
        pushFederationFinding(
          findings,
          rules,
          "federation/ghost-shares",
          soloMf,
          otherMfsUseIt
            ? `"${pkg}" is shared only by "${soloMf}" while other projects import it without sharing.`
            : `"${pkg}" is shared only by "${soloMf}" and unused elsewhere in the federation graph.`,
          {
            package: pkg,
            sharedBy: soloMf,
            usedUnsharedBy,
          },
        );
      }
    }
  }

  const root = path.resolve(options.root ?? process.cwd());
  const baselineOptions = resolveBaselineOptions(options.baseline, root);
  const { findings: baselined, failOnSuppressed } = await withBaseline(
    sortFindings(findings),
    baselineOptions,
  );
  const report = reportFromFindings(projects, baselined);
  const ui = buildUiPayload(projects, report);
  const formats = options.formats ?? [];
  if (options.outputDirectory && formats.length > 0)
    await writeFederationReports(projects, report, options.outputDirectory, formats, {
      ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
      ...(options.printLog !== undefined ? { printLog: options.printLog } : {}),
    });
  const failOn = options.failOn ?? "error";
  return {
    projects,
    findings: baselined,
    report,
    ui,
    exitCode: policyFails(baselined, failOn, failOnSuppressed) ? 1 : 0,
  };
}
