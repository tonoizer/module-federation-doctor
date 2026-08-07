import path from "node:path";

export const REQUIRED_ANALYSIS_FIXTURES = ["small", "medium", "large"];
export const REQUIRED_MODES = ["legacy", "shadow", "v2-compat"];
export const REQUIRED_WORKSPACE_FIXTURES = ["clean", "conflict"];

const VOLATILE_KEY = /^(generatedAt|timestamp|startedAt|finishedAt|sessionId|traceId)$/i;
const PATH_KEY = /(?:path|root|directory|directories|file|files|filename|filenames)$/i;

function sortedStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string"))].sort();
}

function normalizePath(value, root, key) {
  const text = value.replaceAll("\\", "/");
  if (text.includes("://")) return text;
  const segments = text.split("/");
  if (segments.includes(".."))
    throw new Error(`Golden contract path ${key} contains traversal: ${value}`);
  const posixAbsolute = path.posix.isAbsolute(value);
  const windowsAbsolute = path.win32.isAbsolute(value);
  const hostIsWindows = path.sep === "\\";
  if ((windowsAbsolute && !hostIsWindows) || (posixAbsolute && hostIsWindows))
    throw new Error(`Golden contract path ${key} uses a foreign absolute path style: ${value}`);
  const absolute = posixAbsolute || windowsAbsolute;
  if (!absolute) return text;
  const pathApi = windowsAbsolute ? path.win32 : path.posix;
  const resolvedRoot = pathApi.resolve(root);
  const resolved = pathApi.resolve(value);
  const relative = pathApi.relative(resolvedRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative))
    throw new Error(`Golden contract path ${key} escapes its fixture root: ${value}`);
  return relative.replaceAll(pathApi.sep, "/") || ".";
}

function normalizeValue(value, root, key = "") {
  if (value === undefined) return undefined;
  if (VOLATILE_KEY.test(key)) return "[VOLATILE]";
  if (typeof value === "string")
    return PATH_KEY.test(key) ? normalizePath(value, root, key) : value;
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, root, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((childKey) => [childKey, normalizeValue(value[childKey], root, childKey)]),
    );
  }
  return value;
}

function normalizeBudget(budget, root) {
  if (!budget) return undefined;
  return normalizeValue(
    {
      status: budget.status,
      usage: budget.usage,
      exceeded: budget.exceeded ?? [],
    },
    root,
  );
}

function normalizeAnalysisBudget(budget, root) {
  if (!budget) return undefined;
  // Raw serialized bytes reflect the checkout's line-ending policy (for
  // example, CRLF on Windows versus LF on Linux), not analyzer semantics.
  // Keep the runtime measurement in the product report, but exclude it from
  // the cross-platform golden contract alongside sourceBytes.
  const usage = Object.fromEntries(
    Object.entries(budget.usage ?? {}).filter(
      ([key]) => key !== "sourceBytes" && key !== "serializedBytes",
    ),
  );
  return normalizeValue({ ...budget, usage }, root);
}

function normalizeFinding(finding, root) {
  return {
    schemaVersion: finding.schemaVersion,
    ruleId: finding.ruleId,
    severity: finding.severity,
    message: finding.message,
    project: finding.project,
    fingerprint: finding.fingerprint,
    location: normalizeValue(finding.location, root, "location"),
    documentation: finding.documentation,
    suggestion: finding.suggestion,
    detailsSchema: finding.detailsSchema,
    details: normalizeValue(finding.details ?? null, root, "details"),
    evidence: normalizeValue(finding.evidence ?? null, root, "evidence"),
    suppressed: finding.suppressed,
    suppressionReason: finding.suppressionReason,
  };
}

export function normalizeReport(report, root) {
  return {
    schemaVersion: report?.schemaVersion,
    capabilities: normalizeValue(report?.capabilities, root, "capabilities"),
    summary: normalizeValue(report?.summary, root, "summary"),
    findings: (report?.findings ?? [])
      .map((finding) => normalizeFinding(finding, root))
      .sort((left, right) =>
        `${left.ruleId}:${left.project}:${left.fingerprint}`.localeCompare(
          `${right.ruleId}:${right.project}:${right.fingerprint}`,
        ),
      ),
  };
}

function normalizeArtifacts(artifacts, root) {
  if (!artifacts) return undefined;
  const manifest = artifacts.manifest
    ? normalizeValue(
        {
          name: artifacts.manifest.name,
          path: artifacts.manifest.path,
          valid: artifacts.manifest.valid,
          exposes: sortedStrings(artifacts.manifest.exposes),
          remotes: sortedStrings(artifacts.manifest.remotes),
          shared: sortedStrings(artifacts.manifest.shared),
        },
        root,
      )
    : undefined;
  return normalizeValue(
    {
      ...(manifest ? { manifest } : {}),
      records: (artifacts.records ?? [])
        .map((record) => ({
          kind: record.kind,
          path: record.path,
          source: record.source,
          state: record.state,
          valid: record.valid,
        }))
        .sort((left, right) =>
          `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`),
        ),
      emittedAssets: sortedStrings(artifacts.emittedAssets),
    },
    root,
  );
}

export function normalizeAnalysisRun(run, evidenceReader, root) {
  const serialized = JSON.parse(run.digest);
  const facts = serialized.facts;
  return {
    exitCode: run.exitCode,
    report: normalizeReport(serialized.report, root),
    facts: normalizeValue(
      {
        schemaVersion: facts.schemaVersion,
        project: facts.project,
        bundler: facts.bundler,
        capabilities: facts.capabilities,
        config: facts.config,
        moduleFederation: facts.moduleFederation,
        dependencies: facts.dependencies,
        imports: facts.imports,
        analysis: normalizeAnalysisBudget(facts.analysis, root),
        artifacts: normalizeArtifacts(facts.artifacts, root),
      },
      root,
    ),
    evidenceReader: {
      status: evidenceReader.status,
      kind: evidenceReader.kind,
      sourceVersion: evidenceReader.sourceVersion,
      budget: normalizeBudget(evidenceReader.budget, root),
    },
  };
}

export function normalizeAnalysisRow(row, root) {
  return {
    fixture: row.fixture,
    mode: row.mode,
    rollout: {
      requestedMode: row.rollout.requestedMode,
      selectedMode: row.rollout.selectedMode,
      promotedBy: row.rollout.promotedBy,
    },
    collector: row.collector,
    result: normalizeAnalysisRun(row.runs[0], row.evidenceReader, root),
  };
}

export function normalizeWorkspaceResult(fixture, result, root) {
  return {
    fixture,
    result: {
      exitCode: result.exitCode,
      projects: result.projects
        .map((project) =>
          normalizeValue(
            {
              schemaVersion: project.schemaVersion,
              project: project.project,
              bundler: project.bundler,
              capabilities: project.capabilities,
              config: project.config,
              moduleFederation: project.moduleFederation,
              dependencies: project.dependencies,
              imports: project.imports,
              artifacts: project.artifacts,
            },
            root,
          ),
        )
        .sort((left, right) => left.project.name.localeCompare(right.project.name)),
      report: normalizeReport(result.report, root),
    },
  };
}

function display(value) {
  return JSON.stringify(value);
}

function assertObject(value, location) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${location} must be an object`);
}

function assertReport(report, location) {
  assertObject(report, location);
  if (report.schemaVersion !== 1) throw new Error(`${location}.schemaVersion must be 1`);
  assertObject(report.capabilities, `${location}.capabilities`);
  assertObject(report.summary, `${location}.summary`);
  if (!Array.isArray(report.findings)) throw new Error(`${location}.findings must be an array`);
  for (const [index, finding] of report.findings.entries()) {
    assertObject(finding, `${location}.findings[${index}]`);
    if (finding.schemaVersion !== 1)
      throw new Error(`${location}.findings[${index}].schemaVersion must be 1`);
    for (const key of ["ruleId", "severity", "message", "project", "fingerprint"])
      if (typeof finding[key] !== "string")
        throw new Error(`${location}.findings[${index}].${key} must be a string`);
    for (const key of ["documentation", "suggestion", "detailsSchema", "suppressionReason"])
      if (key in finding && finding[key] !== undefined && typeof finding[key] !== "string")
        throw new Error(`${location}.findings[${index}].${key} must be a string`);
    if ("location" in finding && finding.location !== undefined) {
      assertObject(finding.location, `${location}.findings[${index}].location`);
      if (typeof finding.location.path !== "string")
        throw new Error(`${location}.findings[${index}].location.path must be a string`);
      for (const key of ["line", "column"])
        if (key in finding.location && !Number.isSafeInteger(finding.location[key]))
          throw new Error(`${location}.findings[${index}].location.${key} must be an integer`);
    }
    if (!("details" in finding))
      throw new Error(`${location}.findings[${index}].details is required`);
    if (!("evidence" in finding))
      throw new Error(`${location}.findings[${index}].evidence is required`);
    if (finding.details !== null)
      assertObject(finding.details, `${location}.findings[${index}].details`);
    assertObject(finding.evidence, `${location}.findings[${index}].evidence`);
    if (
      "suppressed" in finding &&
      finding.suppressed !== undefined &&
      typeof finding.suppressed !== "boolean"
    )
      throw new Error(`${location}.findings[${index}].suppressed must be a boolean`);
  }
}

function assertRows(value, group, requiredIds, shape) {
  if (!Array.isArray(value)) throw new Error(`${group} must be an array`);
  const ids = value.map((row) => {
    assertObject(row, `${group} row`);
    if (typeof row.fixture !== "string") throw new Error(`${group} row fixture must be a string`);
    if (shape === "analysis" && typeof row.mode !== "string")
      throw new Error(`${group}/${row.fixture} mode must be a string`);
    const id = `${row.fixture}${shape === "analysis" ? `/${row.mode}` : ""}`;
    return id;
  });
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) throw new Error(`${group} has duplicate row: ${duplicates[0]}`);
  const expected = [...requiredIds].sort();
  const actual = [...ids].sort();
  for (const id of actual) {
    if (!expected.includes(id)) throw new Error(`${group} contains unexpected row: ${id}`);
  }
  for (const id of expected) {
    if (!ids.includes(id)) throw new Error(`${group} is missing required row: ${id}`);
  }
  if (actual.length !== expected.length)
    throw new Error(
      `${group} must contain exactly ${expected.length} rows, received ${actual.length}`,
    );
  for (const row of value) {
    assertObject(
      row.result,
      `${group}/${row.fixture}${shape === "analysis" ? `/${row.mode}` : ""}.result`,
    );
    if (typeof row.result.exitCode !== "number")
      throw new Error(`${group}/${row.fixture} result.exitCode must be a number`);
    assertReport(row.result.report, `${group}/${row.fixture}.result.report`);
    if (shape === "analysis") {
      assertObject(row.result.facts, `${group}/${row.fixture}/${row.mode}.result.facts`);
      assertObject(
        row.result.evidenceReader,
        `${group}/${row.fixture}/${row.mode}.result.evidenceReader`,
      );
    } else if (!Array.isArray(row.result.projects)) {
      throw new Error(`${group}/${row.fixture}.result.projects must be an array`);
    }
  }
}

export function assertRegressionContract(value, label = "contract") {
  assertObject(value, label);
  if (value.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  const analysisIds = REQUIRED_ANALYSIS_FIXTURES.flatMap((fixture) =>
    REQUIRED_MODES.map((mode) => `${fixture}/${mode}`),
  );
  assertRows(value.analysis, `${label}.analysis`, analysisIds, "analysis");
  assertRows(value.workspaces, `${label}.workspaces`, REQUIRED_WORKSPACE_FIXTURES, "workspace");
  return value;
}

function collectDiffs(expected, actual, location, diffs) {
  if (Object.is(expected, actual)) return;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      diffs.push(`${location}: expected ${display(expected)}, received ${display(actual)}`);
      return;
    }
    if (expected.length !== actual.length)
      diffs.push(`${location}: expected ${expected.length} entries, received ${actual.length}`);
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1)
      collectDiffs(expected[index], actual[index], `${location}[${index}]`, diffs);
    return;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort())
      collectDiffs(expected[key], actual[key], `${location}.${key}`, diffs);
    return;
  }
  diffs.push(`${location}: expected ${display(expected)}, received ${display(actual)}`);
}

function compareRows(expectedRows, actualRows, group) {
  const diffs = [];
  const expectedById = new Map();
  const actualById = new Map();
  for (const row of expectedRows) {
    const id = `${row.fixture}${row.mode ? `/${row.mode}` : ""}`;
    if (expectedById.has(id)) diffs.push(`${group}/${id}: duplicate expected row`);
    expectedById.set(id, row);
  }
  for (const row of actualRows) {
    const id = `${row.fixture}${row.mode ? `/${row.mode}` : ""}`;
    if (actualById.has(id)) diffs.push(`${group}/${id}: duplicate actual row`);
    actualById.set(id, row);
  }
  const ids = new Set([...expectedById.keys(), ...actualById.keys()]);
  for (const id of [...ids].sort()) {
    const expected = expectedById.get(id);
    const actual = actualById.get(id);
    if (!expected) {
      diffs.push(`${group}/${id}: unexpected benchmark row`);
      continue;
    }
    if (!actual) {
      diffs.push(`${group}/${id}: expected benchmark row is missing`);
      continue;
    }
    collectDiffs(expected, actual, `${group}/${id}`, diffs);
  }
  return diffs;
}

export function compareRegressionContract(expected, actual) {
  assertRegressionContract(expected, "expected contract");
  assertRegressionContract(actual, "actual contract");
  return [
    ...(expected.schemaVersion !== actual.schemaVersion
      ? [
          `schemaVersion: expected ${display(expected.schemaVersion)}, received ${display(actual.schemaVersion)}`,
        ]
      : []),
    ...compareRows(expected.analysis, actual.analysis, "analysis"),
    ...compareRows(expected.workspaces, actual.workspaces, "workspace"),
  ];
}
