import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import {
  analyze,
  AnalysisContentCache,
  RELEASE_GATES,
  createEvidenceRolloutController,
  readEvidenceFile,
  stableSerialize,
} from "../dist/index.js";

const repository = path.resolve(import.meta.dirname, "..");
const baselinePath = path.join(repository, "benchmarks/analysis-cost-baseline.json");
const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : undefined;

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

function assertBaseline(value) {
  if (value?.schemaVersion !== 1 || !value.fixtures || !Array.isArray(value.modes))
    throw new Error("Invalid analysis-cost baseline schema");
  if (value.modes.join(",") !== "legacy,shadow,v2-compat")
    throw new Error("Analysis benchmark must cover legacy, shadow, and v2-compat modes");
  for (const [name, fixture] of Object.entries(value.fixtures)) {
    for (const key of [
      "root",
      "maxFiles",
      "maxSourceBytes",
      "maxArtifacts",
      "maxEvidenceNodes",
      "maxSerializedBytes",
      "maxWallTimeMs",
      "maxRssBytes",
    ]) {
      if (typeof fixture[key] !== (key === "root" ? "string" : "number"))
        throw new Error(`Invalid ${key} limit for ${name}`);
    }
  }
}

assertBaseline(baseline);
const results = [];
const failures = [];

for (const [fixtureName, fixture] of Object.entries(baseline.fixtures)) {
  for (const mode of baseline.modes) {
    const rollout = controllerFor(mode);
    const rolloutMode = rollout.modeFor("federation-workspace");
    if (rolloutMode !== mode)
      throw new Error(`Rollout gate selected ${rolloutMode}, expected ${mode}`);
    const cache = new AnalysisContentCache({ maxEntries: 64, maxBytes: 4 * 1024 * 1024 });
    const options = {
      root: path.join(repository, fixture.root),
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
      const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
      runs.push({
        elapsedMs,
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
      evidenceReader: await evidenceReaderMeasurement(options.root, mode, fixture),
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
    if (run.cache.secondRunHits < 1)
      failures.push(`${fixtureName}/${mode}: bounded parsed-input cache did not produce a hit`);
    if (second.budget?.exceeded?.length)
      failures.push(`${fixtureName}/${mode}: configured analysis budget was exceeded`);
    if (run.evidenceReader.status !== "read")
      failures.push(`${fixtureName}/${mode}: evidence reader did not complete`);
    if (run.evidenceReader.budget?.exceeded?.length)
      failures.push(`${fixtureName}/${mode}: evidence analysis budget was exceeded`);
  }
}

const report = {
  schemaVersion: 1,
  node: process.version,
  generatedAt: new Date().toISOString(),
  results,
  failures,
};
if (outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
