import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function createReleaseFiles({ outputDir, packagePath, tag, commit }) {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  if (!tag || tag.startsWith("v")) throw new Error(`Release tag must be plain semver: ${tag}`);
  if (tag !== packageJson.version) {
    throw new Error(`Release tag ${tag} does not match package ${packageJson.version}`);
  }

  const files = (await readdir(outputDir)).filter((file) => file.endsWith(".tgz"));
  if (files.length !== 1) throw new Error(`Expected one package tarball, found ${files.length}`);

  const packageFile = files[0];
  const packageBytes = await readFile(path.join(outputDir, packageFile));
  const sha256 = createHash("sha256").update(packageBytes).digest("hex");
  const manifest = {
    name: packageJson.name,
    version: packageJson.version,
    tag,
    commit: commit || null,
    packageFile,
    sha256,
  };

  await writeFile(path.join(outputDir, "SHA256SUMS"), `${sha256}  ${packageFile}\n`);
  await writeFile(
    path.join(outputDir, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputDir = path.resolve(process.argv[2] ?? "release-files");
  const packagePath = path.resolve("package.json");
  const manifest = await createReleaseFiles({
    outputDir,
    packagePath,
    tag: process.env.RELEASE_TAG,
    commit: process.env.GITHUB_SHA,
  });
  console.log(`Generated release files for ${manifest.name}@${manifest.version}`);
}
