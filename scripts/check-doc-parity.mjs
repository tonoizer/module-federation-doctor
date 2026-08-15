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
const versions = [...new Set([...versionsConfig.historical, currentVersion])];

function sourceRoot(version, language) {
  if (version === currentVersion) {
    return path.join(
      docsApp,
      language === "en" ? "docs" : "locales",
      ...(language === "en" ? [] : [language]),
    );
  }
  return path.join(docsApp, "versions", version, language);
}

async function markdownFiles(root) {
  return new Set(
    await fg("**/*.{md,mdx}", {
      cwd: root,
      onlyFiles: true,
      ignore: ["public/**"],
    }),
  );
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

let failed = false;
for (const version of versions) {
  const englishRoot = sourceRoot(version, "en");
  const germanRoot = sourceRoot(version, "de");
  const english = await markdownFiles(englishRoot).catch(() => null);
  const german = await markdownFiles(germanRoot).catch(() => null);
  if (!english || !german) {
    process.stderr.write(`Missing documentation source for ${version} (en/de)\n`);
    failed = true;
    continue;
  }

  for (const missing of sorted([...english].filter((file) => !german.has(file)))) {
    process.stderr.write(`German parity missing: ${version}/${missing}\n`);
    failed = true;
  }
  for (const extra of sorted([...german].filter((file) => !english.has(file)))) {
    process.stderr.write(`German parity has no English source: ${version}/${extra}\n`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
else console.log(`Documentation parity checked for ${versions.length} snapshot(s).`);
