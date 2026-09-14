const GLOB_META = /[*?[\]{}()!]/;
const ARTIFACT_ROOTS = new Set(["artifact", "artifacts", "build", "dist"]);
const ARTIFACT_KINDS = new Map([
  ["mf-manifest.json", "manifest"],
  ["mf-stats.json", "stats"],
]);

export const REQUIRED_BENCHMARK_SCALES = Object.freeze([
  Object.freeze({
    name: "sources-1k",
    kind: "analysis",
    sourceCount: 1_000,
    projectCount: 1,
    instancesPerProject: 1,
  }),
  Object.freeze({
    name: "sources-10k",
    kind: "analysis",
    sourceCount: 10_000,
    projectCount: 1,
    instancesPerProject: 1,
  }),
  Object.freeze({
    name: "workspace-many",
    kind: "workspace",
    sourceCount: 0,
    projectCount: 64,
    instancesPerProject: 8,
  }),
]);

export function assertLiteralFixturePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || GLOB_META.test(value))
    throw new Error(`${label} must contain literal file paths: ${String(value)}`);
  return value;
}

export function sourceFilesFromFixtureFiles(files, label = "fixture.files") {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error(`${label} must list the committed fixture files`);
  const sourceFiles = [];
  for (const file of files) {
    assertLiteralFixturePath(file, label);
    const normalized = file.replaceAll("\\", "/");
    if (normalized === "src" || normalized.startsWith("src/")) sourceFiles.push(file);
  }
  if (sourceFiles.length === 0)
    throw new Error(`${label} must contain at least one literal src file`);
  return Object.freeze([...sourceFiles]);
}

export function artifactNamesFromFixtureFiles(files, label = "fixture.files") {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error(`${label} must list the committed fixture files`);
  const artifactNames = { manifest: [], stats: [] };
  for (const file of files) {
    assertLiteralFixturePath(file, label);
    const normalized = file.replaceAll("\\", "/");
    const [root] = normalized.split("/");
    if (!ARTIFACT_ROOTS.has(root)) continue;
    const kind = ARTIFACT_KINDS.get(normalized.slice(normalized.lastIndexOf("/") + 1));
    if (kind) artifactNames[kind].push(file);
  }
  return Object.freeze({
    manifest: Object.freeze([...artifactNames.manifest]),
    stats: Object.freeze([...artifactNames.stats]),
  });
}

/**
 * Node documents resourceUsage().maxRSS as kilobytes. Convert it to bytes and
 * combine it with the instantaneous RSS sample so every run records a
 * process-safe high-water value in the same unit as maxRssBytes.
 */
export function highWaterRssBytes(
  memoryUsage = process.memoryUsage(),
  resourceUsage = process.resourceUsage(),
) {
  const currentRssBytes =
    typeof memoryUsage?.rss === "number" && Number.isFinite(memoryUsage.rss)
      ? Math.max(0, memoryUsage.rss)
      : 0;
  const maxRssKilobytes = resourceUsage?.maxRSS;
  const resourceMaxRssBytes =
    typeof maxRssKilobytes === "number" && Number.isFinite(maxRssKilobytes) && maxRssKilobytes >= 0
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(maxRssKilobytes * 1024))
      : 0;
  return Math.max(currentRssBytes, resourceMaxRssBytes);
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive safe integer`);
}

/**
 * Validate the checked-in synthetic scale contract. The exact names and
 * cardinalities are intentional so a benchmark cannot silently shrink its
 * workload while retaining the same regression label.
 */
export function assertBenchmarkScaleConfig(value, label = "scales") {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object keyed by benchmark scale name`);
  const expectedByName = new Map(REQUIRED_BENCHMARK_SCALES.map((scale) => [scale.name, scale]));
  const names = Object.keys(value).sort();
  const expectedNames = [...expectedByName.keys()].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames))
    throw new Error(`${label} must define exactly: ${expectedNames.join(", ")}`);
  for (const expected of REQUIRED_BENCHMARK_SCALES) {
    const scenario = value[expected.name];
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario))
      throw new Error(`${label}.${expected.name} must be an object`);
    if (scenario.kind !== expected.kind)
      throw new Error(`${label}.${expected.name}.kind must be ${expected.kind}`);
    for (const key of ["sourceCount", "projectCount", "instancesPerProject"]) {
      if (scenario[key] !== expected[key])
        throw new Error(`${label}.${expected.name}.${key} must be ${expected[key]}`);
    }
    if (expected.kind === "analysis") {
      assertPositiveInteger(scenario.maxSourceBytes, `${label}.${expected.name}.maxSourceBytes`);
    } else if (Object.hasOwn(scenario, "maxSourceBytes")) {
      throw new Error(`${label}.${expected.name}.maxSourceBytes is not supported`);
    }
    for (const key of ["maxFiles", "maxSerializedBytes", "maxWallTimeMs", "maxRssBytes"])
      assertPositiveInteger(scenario[key], `${label}.${expected.name}.${key}`);
    const minimumFiles =
      expected.kind === "analysis" ? expected.sourceCount : expected.projectCount;
    if (scenario.maxFiles < minimumFiles)
      throw new Error(`${label}.${expected.name}.maxFiles must cover its configured workload`);
  }
  return value;
}
