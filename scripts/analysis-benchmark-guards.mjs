const GLOB_META = /[*?[\]{}()!]/;
const ARTIFACT_ROOTS = new Set(["artifact", "artifacts", "build", "dist"]);
const ARTIFACT_KINDS = new Map([
  ["mf-manifest.json", "manifest"],
  ["mf-stats.json", "stats"],
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
