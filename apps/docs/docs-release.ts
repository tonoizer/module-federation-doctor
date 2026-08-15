import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import versionsConfig from "./docs-versions.json" with { type: "json" };

const docsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(docsDirectory, "..", "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
) as { version?: unknown };

if (
  typeof packageJson.version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)
)
  throw new Error("The documentation release indicator needs a plain semver package version.");

const version = packageJson.version;

// Keep the historical snapshot list explicit. The current package version is
// added at build time, so the selector appears only after a second released
// snapshot exists (the release workflow bumps the package before publishing).
export const historicalVersions = Object.freeze([...versionsConfig.historical]);
export const maintainedVersions = Object.freeze(
  Array.from(new Set([...historicalVersions, version])),
);

export const multiVersion =
  maintainedVersions.length > 1
    ? Object.freeze({ default: version, versions: maintainedVersions })
    : undefined;

/** Release links are derived from the root package so docs cannot drift on a version bump. */
export const docsRelease = Object.freeze({
  version,
  historicalVersions,
  maintainedVersions,
  multiVersion,
  hasVersionSelector: Boolean(multiVersion),
  npmUrl: `https://www.npmjs.com/package/@tonoizer/mfdoctor/v/${version}`,
  releaseUrl: `https://github.com/tonoizer/module-federation-doctor/releases/tag/${version}`,
});
