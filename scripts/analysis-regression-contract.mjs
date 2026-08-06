function sortedStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string"))].sort();
}

function normalizeBudget(budget) {
  if (!budget) return undefined;
  return {
    status: budget.status,
    usage: budget.usage,
    exceeded: budget.exceeded ?? [],
  };
}

function normalizeFinding(finding) {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    project: finding.project,
    fingerprint: finding.fingerprint,
    ...(finding.detailsSchema ? { detailsSchema: finding.detailsSchema } : {}),
  };
}

export function normalizeReport(report) {
  return {
    schemaVersion: report?.schemaVersion,
    capabilities: report?.capabilities,
    summary: {
      projects: report?.summary?.projects,
      info: report?.summary?.info,
      warnings: report?.summary?.warnings,
      errors: report?.summary?.errors,
      ...(report?.summary?.suppressed !== undefined
        ? { suppressed: report.summary.suppressed }
        : {}),
      ...(report?.summary?.score !== undefined ? { score: report.summary.score } : {}),
      ...(report?.summary?.scoreLabel !== undefined
        ? { scoreLabel: report.summary.scoreLabel }
        : {}),
    },
    findings: (report?.findings ?? [])
      .map(normalizeFinding)
      .sort((left, right) =>
        `${left.ruleId}:${left.project}:${left.fingerprint}`.localeCompare(
          `${right.ruleId}:${right.project}:${right.fingerprint}`,
        ),
      ),
  };
}

function normalizeArtifacts(artifacts) {
  if (!artifacts) return undefined;
  const manifest = artifacts.manifest
    ? {
        name: artifacts.manifest.name,
        path: artifacts.manifest.path?.replaceAll("\\", "/"),
        valid: artifacts.manifest.valid,
        exposes: sortedStrings(artifacts.manifest.exposes),
        remotes: sortedStrings(artifacts.manifest.remotes),
        shared: sortedStrings(artifacts.manifest.shared),
      }
    : undefined;
  return {
    ...(manifest ? { manifest } : {}),
    records: (artifacts.records ?? [])
      .map((record) => ({
        kind: record.kind,
        path: record.path?.replaceAll("\\", "/"),
        source: record.source,
        state: record.state,
        valid: record.valid,
      }))
      .sort((left, right) =>
        `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`),
      ),
    emittedAssets: sortedStrings(artifacts.emittedAssets),
  };
}

export function normalizeAnalysisRun(run, evidenceReader) {
  const serialized = JSON.parse(run.digest);
  const facts = serialized.facts;
  return {
    exitCode: run.exitCode,
    report: normalizeReport(serialized.report),
    facts: {
      schemaVersion: facts.schemaVersion,
      project: {
        name: facts.project?.name,
        root: facts.project?.root,
      },
      capabilities: facts.capabilities,
      analysis: normalizeBudget(facts.analysis),
      imports: {
        sourceFiles: sortedStrings(facts.imports?.sourceFiles),
        specifiers: sortedStrings(facts.imports?.specifiers),
        packages: sortedStrings(facts.imports?.packages),
        remotes: sortedStrings(facts.imports?.remotes),
      },
      artifacts: normalizeArtifacts(facts.artifacts),
    },
    evidenceReader: {
      status: evidenceReader.status,
      kind: evidenceReader.kind,
      sourceVersion: evidenceReader.sourceVersion,
      budget: normalizeBudget(evidenceReader.budget),
    },
  };
}

export function normalizeAnalysisRow(row) {
  return {
    fixture: row.fixture,
    mode: row.mode,
    rollout: {
      requestedMode: row.rollout.requestedMode,
      selectedMode: row.rollout.selectedMode,
      promotedBy: row.rollout.promotedBy,
    },
    collector: row.collector,
    result: normalizeAnalysisRun(row.runs[0], row.evidenceReader),
  };
}

export function normalizeWorkspaceResult(fixture, result) {
  return {
    fixture,
    result: {
      exitCode: result.exitCode,
      projects: result.projects
        .map((project) => ({
          name: project.project.name,
          bundler: project.bundler.name,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      report: normalizeReport(result.report),
    },
  };
}

function display(value) {
  return JSON.stringify(value);
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

function compareRows(expectedRows, actualRows, group, diffs) {
  const expectedById = new Map(
    expectedRows.map((row) => [row.fixture + (row.mode ? `/${row.mode}` : ""), row]),
  );
  const actualById = new Map(
    actualRows.map((row) => [row.fixture + (row.mode ? `/${row.mode}` : ""), row]),
  );
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
}

export function compareRegressionContract(expected, actual) {
  const diffs = [];
  if (expected?.schemaVersion !== actual?.schemaVersion)
    diffs.push(
      `schemaVersion: expected ${display(expected?.schemaVersion)}, received ${display(actual?.schemaVersion)}`,
    );
  compareRows(expected?.analysis ?? [], actual?.analysis ?? [], "analysis", diffs);
  compareRows(expected?.workspaces ?? [], actual?.workspaces ?? [], "workspace", diffs);
  return diffs;
}
