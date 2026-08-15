import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const check = process.argv.includes("--check");
const repository = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await fs.readFile(path.join(repository, "package.json"), "utf8"));
const output = path.join(repository, "apps/docs/docs/api.md");

const purposes = {
  ".": "Core analysis, policy, baselines, evidence, runtime correlation, and graph payloads.",
  "./capture":
    "Validate, adapt, and atomically write bounded offline runtime exports and fallback metadata.",
  "./modern": "Modern.js adapter integration.",
  "./nuxt": "Nuxt adapter integration.",
  "./policy": "Named policy packs and policy helpers.",
  "./rules": "Custom rule definitions and built-in rule metadata.",
  "./rsbuild": "Rsbuild adapter integration.",
  "./rspack": "Rspack adapter integration.",
  "./vite": "Vite adapter integration.",
  "./webpack": "Webpack adapter integration.",
};

const entries = Object.entries(packageJson.exports ?? {});
assert(entries.length > 0, "package.json must expose at least one public entry point");

const runtimeEntries = entries
  .filter(([key]) => key !== "./package.json" && !key.startsWith("./schemas/"))
  .sort(([left], [right]) => left.localeCompare(right));
const schemaEntries = entries
  .filter(([key]) => key.startsWith("./schemas/") && key.endsWith(".schema.json"))
  .sort(([left], [right]) => left.localeCompare(right));

assert(
  runtimeEntries.some(([key]) => key === "."),
  "the core package entry must be documented",
);
assert(schemaEntries.length > 0, "at least one public JSON schema must be documented");

function displayName(key) {
  return key === "." ? packageJson.name : `${packageJson.name}/${key.slice(2)}`;
}

function importTarget(value) {
  if (typeof value === "string") return value;
  return value?.import ?? value?.default ?? "(conditional export)";
}

const runtimeRows = runtimeEntries
  .map(([key, value]) => {
    const target = importTarget(value);
    const purpose = purposes[key] ?? "Public package entry point.";
    return `| \`${displayName(key)}\` | \`${target}\` | ${purpose} |`;
  })
  .join("\n");
const schemaRows = schemaEntries
  .map(
    ([key]) => `| \`${displayName(key)}\` | \`${key.slice(2)}\` | Public JSON Schema contract. |`,
  )
  .join("\n");

const content = `---
title: Public API surface
description: Generated catalog of the package's public entry points and JSON schemas.
---

# Public API surface

This catalog is generated from the package export map. It is intentionally an
entry-point reference rather than a hand-maintained symbol list, so a new or
removed public export fails the documentation build until this page is
regenerated.

## Runtime entry points

| Import | Published runtime target | Purpose |
| --- | --- | --- |
${runtimeRows}

## JSON Schema entry points

| Import | Published path | Purpose |
| --- | --- | --- |
${schemaRows}

The package's declaration files are published alongside the runtime targets.
Use the [CLI capabilities contract](./cli.md#discover-cli-capabilities) for
machine-readable command, format, exit-code, and schema discovery.
`;

const current = await fs.readFile(output, "utf8").catch(() => "");
if (check) {
  if (current !== content) {
    process.stderr.write(`Generated API doc drift: ${path.relative(repository, output)}\n`);
    process.exitCode = 1;
  }
} else {
  await fs.writeFile(output, content);
}
