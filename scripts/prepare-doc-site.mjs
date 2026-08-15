import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const repository = path.resolve(import.meta.dirname, "..");
const docsApp = path.join(repository, "apps", "docs");
const packageJson = JSON.parse(await fs.readFile(path.join(repository, "package.json"), "utf8"));
const versionsConfig = JSON.parse(
  await fs.readFile(path.join(docsApp, "docs-versions.json"), "utf8"),
);
const currentVersion = packageJson.version;
if (
  typeof currentVersion !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(currentVersion)
) {
  throw new Error(`Invalid package version for documentation: ${currentVersion}`);
}

const historicalVersions = versionsConfig.historical;
if (
  !Array.isArray(historicalVersions) ||
  historicalVersions.some((version) => typeof version !== "string")
) {
  throw new Error("apps/docs/docs-versions.json must contain string historical versions");
}

const versions = [...new Set([...historicalVersions, currentVersion])];
const useVersions = versions.length > 1;
const sourceEnglish = path.join(docsApp, "docs");
const sourceGerman = path.join(docsApp, "locales", "de");
const generated = path.join(docsApp, ".generated");
const publicDir = path.join(sourceEnglish, "public");

async function ensureDirectory(directory, label) {
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Missing ${label}: ${directory}`);
}

await ensureDirectory(sourceEnglish, "canonical English documentation");
await ensureDirectory(sourceGerman, "German documentation");
await fs.rm(generated, { recursive: true, force: true });
await fs.mkdir(generated, { recursive: true });

async function resolveMarkdownTarget(sourceRoot, sourcePath, rawTarget) {
  const [rawPath] = rawTarget.split("#", 1);
  if (!rawPath || rawPath.startsWith("/") || /^(?:https?:|mailto:)/.test(rawPath)) return null;
  const candidate = path.resolve(path.dirname(sourcePath), rawPath);
  if (candidate !== sourceRoot && !candidate.startsWith(`${sourceRoot}${path.sep}`)) return null;
  const candidates = path.extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.md`, `${candidate}.mdx`, path.join(candidate, "index.md")];
  for (const file of candidates) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) return file;
  }
  return null;
}

async function rewriteMarkdownLinks(content, sourceRoot, sourcePath, generatedRoot, generatedPath) {
  const lines = content.split("\n");
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const matches = [...line.matchAll(/\]\(([^)]+)\)/g)];
    if (matches.length === 0) continue;
    let rewritten = line;
    for (const match of matches.toReversed()) {
      const target = match[1];
      const targetPath = await resolveMarkdownTarget(sourceRoot, sourcePath, target);
      if (!targetPath) continue;
      const relativeTarget = path
        .relative(
          path.dirname(generatedPath),
          path.join(generatedRoot, path.relative(sourceRoot, targetPath)),
        )
        .split(path.sep)
        .join("/");
      const normalizedTarget = relativeTarget.startsWith(".")
        ? relativeTarget
        : `./${relativeTarget}`;
      const hash = target.includes("#") ? `#${target.split("#").slice(1).join("#")}` : "";
      const replacement = `](${normalizedTarget}${hash})`;
      rewritten = `${rewritten.slice(0, match.index + 2)}${replacement.slice(2)}${rewritten.slice(match.index + match[0].length)}`;
    }
    lines[index] = rewritten;
  }
  return lines.join("\n");
}

async function copyTree(source, destination, label) {
  await ensureDirectory(source, label);
  const sourcePublic = path.join(source, "public");
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    filter: (entry) => entry !== sourcePublic && !entry.startsWith(`${sourcePublic}${path.sep}`),
  });
  const markdownFiles = await fg("**/*.{md,mdx}", { cwd: source, onlyFiles: true });
  for (const relativePath of markdownFiles) {
    const sourcePath = path.join(source, relativePath);
    const generatedPath = path.join(destination, relativePath);
    const content = await fs.readFile(sourcePath, "utf8");
    const rewritten = await rewriteMarkdownLinks(
      content,
      source,
      sourcePath,
      destination,
      generatedPath,
    );
    await fs.writeFile(generatedPath, rewritten);
  }
}

for (const language of ["en", "de"]) {
  for (const version of versions) {
    const isCurrent = version === currentVersion;
    const source = isCurrent
      ? language === "en"
        ? sourceEnglish
        : sourceGerman
      : path.join(docsApp, "versions", version, language);
    const destination = useVersions
      ? path.join(generated, version, language)
      : path.join(generated, language);
    await copyTree(source, destination, `${version} ${language} documentation`);
  }
}

if (await fs.stat(publicDir).catch(() => null)) {
  await fs.cp(publicDir, path.join(generated, "public"), {
    recursive: true,
    force: true,
  });
}

const manifest = {
  currentVersion,
  versions,
  languages: ["en", "de"],
  defaultLanguage: "en",
  defaultVersion: currentVersion,
  versioned: useVersions,
};
await fs.writeFile(
  path.join(generated, "docs-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  `Prepared ${manifest.languages.length} language routes across ${manifest.versions.length} documentation snapshot(s).`,
);
