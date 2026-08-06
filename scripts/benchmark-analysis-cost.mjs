import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import {
  analyze,
  analyzeFederation,
  AnalysisContentCache,
  discoverWorkspaceProjectsWithBudget,
  RELEASE_GATES,
  createEvidenceRolloutController,
  readEvidenceFile,
  stableSerialize,
} from "../dist/index.js";
import {
  assertRegressionContract,
  compareRegressionContract,
  normalizeAnalysisRow,
  normalizeWorkspaceResult,
  REQUIRED_ANALYSIS_FIXTURES,
  REQUIRED_MODES,
  REQUIRED_WORKSPACE_FIXTURES,
} from "./analysis-regression-contract.mjs";

const repository = path.resolve(import.meta.dirname, "..");
const repositoryRealPath = await fs.realpath(repository);
const baselinePath = path.join(repository, "benchmarks/analysis-cost-baseline.json");
const expectedRelativePath = "benchmarks/analysis-cost-expected.json";
const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0 && !process.argv[outputIndex + 1])
  throw new Error("--output requires a repository-relative destination");
const outputRelativePath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
const updateExpected = process.argv.includes("--update-golden");

function isWithin(base, candidate) {
  const relative = path.relative(base, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function assertRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.split(/[\\/]+/).includes("..")
  )
    throw new Error(`${label} must be a non-empty repository-relative path without traversal`);
}

async function realpathInside(candidate, base, label) {
  let resolved;
  try {
    resolved = await fs.realpath(candidate);
  } catch (error) {
    throw new Error(
      `${label} cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!isWithin(base, resolved)) throw new Error(`${label} resolves outside its allowed root`);
  return resolved;
}

async function validateOutputDestination(relativePath, label) {
  assertRelativePath(relativePath, label);
  const destination = path.resolve(repository, relativePath);
  if (!isWithin(repositoryRealPath, destination))
    throw new Error(`${label} escapes the repository`);
  let cursor = destination;
  while (true) {
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor)
        throw new Error(`${label} has no existing repository parent`, { cause: error });
      cursor = parent;
      continue;
    }
    if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${cursor}`);
    if (cursor !== destination && !stat.isDirectory())
      throw new Error(`${label} parent is not a directory: ${cursor}`);
    await realpathInside(cursor, repositoryRealPath, label);
    if (cursor === destination && stat.isDirectory())
      throw new Error(`${label} must identify a file, not a directory`);
    return destination;
  }
}

async function writeValidatedJson(relativePath, label, value) {
  const destination = await validateOutputDestination(relativePath, label);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await validateOutputDestination(relativePath, label);
  await fs.writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
}

async function validateSafeTree(root, rootRealPath, fixture, label) {
  const pending = [root];
  let files = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = (await fs.readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${candidate}`);
      await realpathInside(candidate, rootRealPath, label);
      if (stat.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      if (!stat.isFile()) throw new Error(`${label} contains a non-regular file: ${candidate}`);
      files += 1;
      bytes += stat.size;
      if (files > fixture.maxFiles)
        throw new Error(`${label} exceeds maxFiles ${fixture.maxFiles}`);
      if (bytes > fixture.maxSourceBytes)
        throw new Error(`${label} exceeds maxSourceBytes ${fixture.maxSourceBytes}`);
    }
  }
  return { files, bytes };
}

async function validateRootFixture(name, fixture, workspace = false) {
  assertRelativePath(fixture.root, `${name}.root`);
  const root = path.resolve(repository, fixture.root);
  if (!isWithin(repositoryRealPath, root)) throw new Error(`${name}.root escapes the repository`);
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink()) throw new Error(`${name}.root must not be a symbolic link`);
  if (!rootStat.isDirectory()) throw new Error(`${name}.root must be a directory`);
  const rootRealPath = await realpathInside(root, repositoryRealPath, `${name}.root`);
  await validateSafeTree(root, rootRealPath, fixture, `${name}.root`);
  for (const file of fixture.files ?? []) {
    assertRelativePath(file, `${name}.files`);
    const candidate = path.resolve(root, file);
    if (!isWithin(root, candidate))
      throw new Error(`${name}.files escapes its fixture root: ${file}`);
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error(`${name}.files contains a symbolic link: ${file}`);
    if (!stat.isFile()) throw new Error(`${name}.files must contain regular files: ${file}`);
    await realpathInside(candidate, rootRealPath, `${name}.files/${file}`);
  }
  if (workspace && fixture.files.length < 2)
    throw new Error(`${name} must contain at least two projects`);
  return { root, rootRealPath };
}

function assertLimit(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
}

async function assertBaseline(value) {
  if (value?.schemaVersion !== 1 || !value.fixtures || !Array.isArray(value.modes))
    throw new Error("Invalid analysis-cost baseline schema");
  if (
    stableSerialize(Object.keys(value.fixtures).sort()) !==
    stableSerialize([...REQUIRED_ANALYSIS_FIXTURES].sort())
  )
    throw new Error(`Baseline fixtures must be exactly: ${REQUIRED_ANALYSIS_FIXTURES.join(", ")}`);
  if (stableSerialize(value.modes) !== stableSerialize(REQUIRED_MODES))
    throw new Error(`Analysis benchmark modes must be exactly: ${REQUIRED_MODES.join(", ")}`);
  const fixtureRoots = new Map();
  for (const name of REQUIRED_ANALYSIS_FIXTURES) {
    const fixture = value.fixtures[name];
    for (const key of [
      "maxFiles",
      "maxSourceBytes",
      "maxArtifacts",
      "maxEvidenceNodes",
      "maxSerializedBytes",
      "maxWallTimeMs",
      "maxRssBytes",
    ])
      assertLimit(fixture[key], `fixtures.${name}.${key}`);
    fixtureRoots.set(name, await validateRootFixture(`fixtures.${name}`, fixture));
  }
  if (!value.workspaces || typeof value.workspaces !== "object" || Array.isArray(value.workspaces))
    throw new Error("Analysis benchmark must define workspace fixtures");
  if (
    stableSerialize(Object.keys(value.workspaces).sort()) !==
    stableSerialize(REQUIRED_WORKSPACE_FIXTURES)
  )
    throw new Error(
      `Workspace fixtures must be exactly: ${REQUIRED_WORKSPACE_FIXTURES.join(", ")}`,
    );
  const workspaceRoots = new Map();
  for (const name of REQUIRED_WORKSPACE_FIXTURES) {
    const fixture = value.workspaces[name];
    if (!Array.isArray(fixture.files)) throw new Error(`workspaces.${name}.files must be an array`);
    for (const key of [
      "maxFiles",
      "maxSourceBytes",
      "maxSerializedBytes",
      "maxWallTimeMs",
      "maxRssBytes",
    ])
      assertLimit(fixture[key], `workspaces.${name}.${key}`);
    workspaceRoots.set(name, await validateRootFixture(`workspaces.${name}`, fixture, true));
  }
  return { fixtureRoots, workspaceRoots };
}

function controllerFor(mode) {
  if (mode === "legacy") return createEvidenceRolloutController({ defaultMode: "legacy" });
  const shadow = createEvidenceRolloutController({
    defaultMode: "shadow",
    scopes: { "federation-workspace": "shadow" },
  });
  if (mode === "shadow") return shadow;
  return shadow.promoteToCompat(
    "federation-workspace",
    Object.fromEntries(RELEASE_GATES.map((gate) => [gate, true])),
  );
}

async function evidenceReaderMeasurement(root, mode, fixture) {
  const file = path.join(root, ".mf", "doctor", "project.json");
  try {
    await fs.stat(file);
  } catch {
    return { mode, status: "not-present", seam: "readEvidenceFile" };
  }
  const started = performance.now();
  try {
    const result = await readEvidenceFile(file, {
      analysisBudgets: {
        maxEvidenceNodes: fixture.maxEvidenceNodes,
        maxSerializedBytes: fixture.maxSerializedBytes,
        maxWallTimeMs: fixture.maxWallTimeMs,
      },
    });
    return {
      mode,
      status: "read",
      seam: "readEvidenceFile",
      kind: result.kind,
      sourceVersion: result.sourceVersion,
      budget: result.analysis,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    };
  } catch (error) {
    return {
      mode,
      status: "failed",
      seam: "readEvidenceFile",
      failureCode: error?.failureCode ?? "read-failed",
      budget: error?.report,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    };
  }
}

async function runWorkspaceFixture(fixtureName, fixture, rootInfo, failures) {
  const configuredFiles = fixture.files
    .map((file) => path.normalize(path.resolve(rootInfo.root, file)))
    .sort();
  const runs = [];
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const started = performance.now();
    const discovery = await discoverWorkspaceProjectsWithBudget({
      cwd: repository,
      roots: [fixture.root],
      analysisBudgets: {
        maxFiles: fixture.maxFiles,
        maxSerializedBytes: fixture.maxSerializedBytes,
        maxWallTimeMs: fixture.maxWallTimeMs,
      },
    });
    const discoveredFiles = discovery.files.map((file) => path.normalize(file)).sort();
    if (stableSerialize(discoveredFiles) !== stableSerialize(configuredFiles))
      failures.push(`${fixtureName}: workspace discovery differs from committed files`);
    const result = await analyzeFederation(discovery.files, {
      analysis: discovery.budget,
      formats: [],
      quiet: true,
      failOn: "error",
    });
    runs.push({
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      rssBytes: process.memoryUsage().rss,
      budget: discovery.budget,
      semantic: normalizeWorkspaceResult(fixtureName, result, rootInfo.realRootPath),
    });
  }
  const first = runs[0];
  const second = runs[1];
  const stable = stableSerialize(first.semantic) === stableSerialize(second.semantic);
  if (!stable) failures.push(`${fixtureName}: repeated workspace analysis changed semantic output`);
  if (second.elapsedMs > fixture.maxWallTimeMs)
    failures.push(`${fixtureName}: wall time exceeded ${fixture.maxWallTimeMs}ms`);
  if (second.rssBytes > fixture.maxRssBytes)
    failures.push(`${fixtureName}: RSS exceeded ${fixture.maxRssBytes} bytes`);
  for (const run of runs)
    if (run.budget.exceeded.length > 0)
      failures.push(`${fixtureName}: workspace budget was exceeded`);
  return {
    semantic: first.semantic,
    detail: {
      fixture: fixtureName,
      runs: runs.map(({ elapsedMs, rssBytes, budget }) => ({ elapsedMs, rssBytes, budget })),
      parity: { stable },
      limits: fixture,
    },
  };
}

const { fixtureRoots, workspaceRoots } = await assertBaseline(baseline);
const expectedPath = await validateOutputDestination(expectedRelativePath, "golden expectation");
const outputPath = outputRelativePath
  ? await validateOutputDestination(outputRelativePath, "--output destination")
  : undefined;
const results = [];
const workspaceResults = [];
const workspaceSemanticResults = [];
const failures = [];

for (const fixtureName of REQUIRED_ANALYSIS_FIXTURES) {
  const fixture = baseline.fixtures[fixtureName];
  const rootInfo = fixtureRoots.get(fixtureName);
  for (const mode of REQUIRED_MODES) {
    const rollout = controllerFor(mode);
    const rolloutMode = rollout.modeFor("federation-workspace");
    if (rolloutMode !== mode)
      throw new Error(`Rollout gate selected ${rolloutMode}, expected ${mode}`);
    const cache = new AnalysisContentCache({ maxEntries: 64, maxBytes: 4 * 1024 * 1024 });
    const options = {
      root: rootInfo.root,
      bundler: "unknown",
      mode: "ci",
      include: ["src/**/*.{ts,tsx,js,jsx,mts,mjs}"],
      output: { formats: [] },
      analysisCache: cache,
      analysisBudgets: {
        maxFiles: fixture.maxFiles,
        maxSourceBytes: fixture.maxSourceBytes,
        maxArtifacts: fixture.maxArtifacts,
        maxEvidenceNodes: fixture.maxEvidenceNodes,
        maxSerializedBytes: fixture.maxSerializedBytes,
        maxWallTimeMs: fixture.maxWallTimeMs,
      },
    };
    const runs = [];
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const started = performance.now();
      const result = await analyze(options);
      runs.push({
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        rssBytes: process.memoryUsage().rss,
        exitCode: result.exitCode,
        digest: stableSerialize({ facts: result.facts, report: result.report }),
        findings: result.report.findings.map((finding) => finding.fingerprint),
        budget: result.facts.analysis,
        cache: { ...cache.stats },
      });
    }
    const first = runs[0];
    const second = runs[1];
    const stable = first.digest === second.digest;
    const findingParity = stable && first.findings.join(",") === second.findings.join(",");
    const run = {
      fixture: fixtureName,
      mode,
      rollout: {
        scope: "federation-workspace",
        requestedMode: mode,
        selectedMode: rolloutMode,
        promotedBy: mode === "v2-compat" ? "all-release-gates" : "not-promoted",
      },
      collector: { name: "v1", evidenceReaderMode: "separate-seam" },
      evidenceReader: await evidenceReaderMeasurement(rootInfo.root, mode, fixture),
      runs,
      cache: {
        firstRunHits: first.cache.hits,
        firstRunMisses: first.cache.misses,
        secondRunHits: second.cache.hits - first.cache.hits,
        secondRunMisses: second.cache.misses - first.cache.misses,
      },
      parity: { stable, findingParity, exitCodeStable: first.exitCode === second.exitCode },
      limits: fixture,
    };
    results.push(run);
    if (!stable || !findingParity || !run.parity.exitCodeStable)
      failures.push(`${fixtureName}/${mode}: repeated analysis changed v1 output`);
    if (second.elapsedMs > fixture.maxWallTimeMs)
      failures.push(`${fixtureName}/${mode}: wall time exceeded ${fixture.maxWallTimeMs}ms`);
    if (second.rssBytes > fixture.maxRssBytes)
      failures.push(`${fixtureName}/${mode}: RSS exceeded ${fixture.maxRssBytes} bytes`);
    if (second.budget?.exceeded?.length)
      failures.push(`${fixtureName}/${mode}: configured analysis budget was exceeded`);
    if (run.cache.secondRunHits < 1)
      failures.push(`${fixtureName}/${mode}: bounded parsed-input cache did not produce a hit`);
    if (run.evidenceReader.status !== "read")
      failures.push(`${fixtureName}/${mode}: evidence reader did not complete`);
    if (run.evidenceReader.budget?.exceeded?.length)
      failures.push(`${fixtureName}/${mode}: evidence analysis budget was exceeded`);
  }
}

for (const fixtureName of REQUIRED_WORKSPACE_FIXTURES) {
  const fixture = baseline.workspaces[fixtureName];
  const result = await runWorkspaceFixture(
    fixtureName,
    fixture,
    workspaceRoots.get(fixtureName),
    failures,
  );
  workspaceSemanticResults.push(result.semantic);
  workspaceResults.push(result.detail);
}

const semantic = {
  schemaVersion: 1,
  analysis: results.map((row) =>
    normalizeAnalysisRow(row, fixtureRoots.get(row.fixture).realRootPath),
  ),
  workspaces: workspaceSemanticResults,
};
assertRegressionContract(semantic, "generated semantic contract");
let expected;
try {
  expected = JSON.parse(await fs.readFile(expectedPath, "utf8"));
} catch (error) {
  if (!updateExpected || error?.code !== "ENOENT") throw error;
}
if (updateExpected) {
  await writeValidatedJson(expectedRelativePath, "golden expectation", semantic);
  expected = semantic;
}
if (!expected) {
  failures.push(`semantic expectations are missing: ${expectedRelativePath}`);
} else {
  assertRegressionContract(expected, "committed semantic contract");
  failures.push(
    ...compareRegressionContract(expected, semantic).map((diff) => `semantic drift: ${diff}`),
  );
}

const report = {
  schemaVersion: 1,
  node: process.version,
  generatedAt: new Date().toISOString(),
  semantic,
  results,
  workspaceResults,
  failures,
};
if (outputPath) {
  await writeValidatedJson(outputRelativePath, "--output destination", report);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
