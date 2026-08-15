import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** Release links are derived from the root package so docs cannot drift on a version bump. */
export const docsRelease = Object.freeze({
  version,
  npmUrl: `https://www.npmjs.com/package/@tonoizer/mfdoctor/v/${version}`,
  releaseUrl: `https://github.com/tonoizer/module-federation-doctor/releases/tag/${version}`,
});
