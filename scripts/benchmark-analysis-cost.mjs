import fs from "node:fs/promises";
import os from "node:os";
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
import {
  assertLiteralFixturePath,
  highWaterRssBytes,
  sourceFilesFromFixtureFiles,
} from "./analysis-benchmark-guards.mjs";

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

async function createSafeAnalysisOutput(fixtureName, mode) {
  const tempRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(
    path.join(tempRoot, `mfdoctor-analysis-${fixtureName}-${mode}-`),
  );
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`Analysis output is not a regular temporary directory: ${directory}`);
  const realPath = await fs.realpath(directory);
  if (!isWithin(tempRoot, realPath))
    throw new Error(`Analysis output escapes the OS temporary directory: ${directory}`);
  return { directory, realPath, tempRoot };
}

async function validateSafeAnalysisOutput(output, fixtureName, mode) {
  const stat = await fs.lstat(output.directory);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`Analysis output was replaced for ${fixtureName}/${mode}`);
  const realPath = await fs.realpath(output.directory);
  if (realPath !== output.realPath || !isWithin(output.tempRoot, realPath))
    throw new Error(
      `Analysis output escaped its validated temporary directory for ${fixtureName}/${mode}`,
    );
  const projectPath = path.join(output.directory, "project.json");
  const projectStat = await fs.lstat(projectPath);
  if (projectStat.isSymbolicLink() || !projectStat.isFile())
    throw new Error(
      `Analysis output project.json is not a regular file for ${fixtureName}/${mode}`,
    );
  await fs.realpath(projectPath);
}

async function removeSafeAnalysisOutput(output) {
  let stat;
  try {
    stat = await fs.lstat(output.directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return;
  const realPath = await fs.realpath(output.directory);
  if (realPath !== output.realPath || !isWithin(output.tempRoot, realPath)) return;
  await fs.rm(output.directory, { recursive: true, force: true });
}

async function validateFixtureFiles(root, rootRealPath, fixture, label, sourceBytesLimit) {
  if (!Array.isArray(fixture.files) || fixture.files.length === 0)
    throw new Error(`${label}.files must list the committed fixture files`);
  const seen = new Set();
  let bytes = 0;
  for (const file of fixture.files) {
    assertLiteralFixturePath(file, `${label}.files`);
    assertRelativePath(file, `${label}.files`);
    if (seen.has(file)) throw new Error(`${label}.files contains a duplicate: ${file}`);
    seen.add(file);
    const candidate = path.resolve(root, file);
    if (!isWithin(root, candidate))
      throw new Error(`${label}.files escapes its fixture root: ${file}`);
    let parent = root;
    const relativeParent = path.dirname(file);
    if (relativeParent !== ".") parent = path.resolve(root, relativeParent);
    while (true) {
      const parentStat = await fs.lstat(parent);
      if (parentStat.isSymbolicLink())
        throw new Error(`${label}.files contains a symbolic link: ${file}`);
      if (!parentStat.isDirectory())
        throw new Error(`${label}.files parent must be a directory: ${file}`);
      await realpathInside(parent, rootRealPath, `${label}.files/${file}`);
      if (parent === root) break;
      parent = path.dirname(parent);
    }
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error(`${label}.files contains a symbolic link: ${file}`);
    if (!stat.isFile()) throw new Error(`${label}.files must contain regular files: ${file}`);
    await realpathInside(candidate, rootRealPath, `${label}.files/${file}`);
    bytes += stat.size;
    if (seen.size > fixture.maxFiles)
      throw new Error(`${label} exceeds maxFiles ${fixture.maxFiles}`);
    if (sourceBytesLimit !== undefined && bytes > sourceBytesLimit)
      throw new Error(`${label} exceeds maxSourceBytes ${sourceBytesLimit}`);
  }
  return { files: seen.size, bytes };
}

async function validateRootFixture(name, fixture, workspace = false) {
  assertRelativePath(fixture.root, `${name}.root`);
  const root = path.resolve(repository, fixture.root);
  if (!isWithin(repositoryRealPath, root)) throw new Error(`${name}.root escapes the repository`);
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink()) throw new Error(`${name}.root must not be a symbolic link`);
  if (!rootStat.isDirectory()) throw new Error(`${name}.root must be a directory`);
  const rootRealPath = await realpathInside(root, repositoryRealPath, `${name}.root`);
  const metrics = await validateFixtureFiles(
    root,
    rootRealPath,
    fixture,
    name,
    workspace ? undefined : fixture.maxSourceBytes,
  );
  if (workspace && metrics.files < 2) throw new Error(`${name} must contain at least two projects`);
  return { root, rootRealPath, metrics };
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
    if (Object.hasOwn(fixture, "maxSourceBytes"))
      throw new Error(`workspaces.${name}.maxSourceBytes is not supported`);
    for (const key of ["maxFiles", "maxSerializedBytes", "maxWallTimeMs", "maxRssBytes"])
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

async function evidenceReaderMeasurement(outputDirectory, mode, fixture) {
  const file = path.join(outputDirectory, "project.json");
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
      globs: fixture.files,
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
      peakRssBytes: highWaterRssBytes(),
      budget: discovery.budget,
      semantic: normalizeWorkspaceResult(fixtureName, result, rootInfo.realRootPath),
    });
  }
  const first = runs[0];
  const second = runs[1];
  const stable = stableSerialize(first.semantic) === stableSerialize(second.semantic);
  if (!stable) failures.push(`${fixtureName}: repeated workspace analysis changed semantic output`);
  for (const [index, run] of runs.entries()) {
    const label = `${fixtureName} run ${index + 1}`;
    if (run.elapsedMs > fixture.maxWallTimeMs)
      failures.push(`${label}: wall time exceeded ${fixture.maxWallTimeMs}ms`);
    if (run.peakRssBytes > fixture.maxRssBytes)
      failures.push(`${label}: RSS exceeded ${fixture.maxRssBytes} bytes`);
    if (run.budget.exceeded.length > 0) failures.push(`${label}: workspace budget was exceeded`);
  }
  return {
    semantic: first.semantic,
    detail: {
      fixture: fixtureName,
      runs: runs.map(({ elapsedMs, peakRssBytes, budget }) => ({
        elapsedMs,
        peakRssBytes,
        budget,
      })),
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
  const sourceFiles = sourceFilesFromFixtureFiles(fixture.files, `fixtures.${fixtureName}.files`);
  for (const mode of REQUIRED_MODES) {
    const rollout = controllerFor(mode);
    const rolloutMode = rollout.modeFor("federation-workspace");
    if (rolloutMode !== mode)
      throw new Error(`Rollout gate selected ${rolloutMode}, expected ${mode}`);
    const cache = new AnalysisContentCache({ maxEntries: 64, maxBytes: 4 * 1024 * 1024 });
    const runs = [];
    let evidenceReader;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const output = await createSafeAnalysisOutput(fixtureName, mode);
      try {
        const options = {
          root: rootInfo.root,
          bundler: "unknown",
          mode: "ci",
          include: sourceFiles,
          output: { directory: output.directory, formats: [] },
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
        const started = performance.now();
        const result = await analyze(options);
        await validateSafeAnalysisOutput(output, fixtureName, mode);
        if (iteration === 1)
          evidenceReader = await evidenceReaderMeasurement(output.realPath, mode, fixture);
        runs.push({
          elapsedMs: Math.round((performance.now() - started) * 100) / 100,
          peakRssBytes: highWaterRssBytes(),
          exitCode: result.exitCode,
          digest: stableSerialize({ facts: result.facts, report: result.report }),
          findings: result.report.findings.map((finding) => finding.fingerprint),
          budget: result.facts.analysis,
          cache: { ...cache.stats },
        });
      } finally {
        await removeSafeAnalysisOutput(output);
      }
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
      evidenceReader,
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
    for (const [index, currentRun] of runs.entries()) {
      const label = `${fixtureName}/${mode} run ${index + 1}`;
      if (currentRun.elapsedMs > fixture.maxWallTimeMs)
        failures.push(`${label}: wall time exceeded ${fixture.maxWallTimeMs}ms`);
      if (currentRun.peakRssBytes > fixture.maxRssBytes)
        failures.push(`${label}: RSS exceeded ${fixture.maxRssBytes} bytes`);
      if (currentRun.budget?.exceeded?.length)
        failures.push(`${label}: configured analysis budget was exceeded`);
    }
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
