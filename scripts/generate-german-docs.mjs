import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const write = process.argv.includes("--write");
const check = !write;
const repository = path.resolve(import.meta.dirname, "..");
const docsApp = path.join(repository, "apps", "docs");
const packageJson = JSON.parse(await fs.readFile(path.join(repository, "package.json"), "utf8"));
const versionsConfig = JSON.parse(
  await fs.readFile(path.join(docsApp, "docs-versions.json"), "utf8"),
);
const currentVersion = packageJson.version;
const versions = [...new Set([...versionsConfig.historical, currentVersion])];
const snapshots = versions.map((version) => ({
  version,
  englishRoot:
    version === currentVersion
      ? path.join(docsApp, "docs")
      : path.join(docsApp, "versions", version, "en"),
  germanRoot:
    version === currentVersion
      ? path.join(docsApp, "locales", "de")
      : path.join(docsApp, "versions", version, "de"),
}));

const headingTranslations = new Map([
  ["# Public API surface", "# Öffentliche API-Oberfläche"],
  ["# Documentation lifecycle", "# Lebenszyklus der Dokumentation"],
  ["# Rule reference", "# Regelreferenz"],
  ["## Issue", "## Problem"],
  ["## How to fix it", "## So beheben Sie das Problem"],
  ["## Sources", "## Quellen"],
  ["## Overview", "## Übersicht"],
  ["## Setup", "## Einrichtung"],
  ["## Getting started", "## Erste Schritte"],
  ["## Configuration", "## Konfiguration"],
  ["## Configuration audit", "## Konfigurationsprüfung"],
  ["## Library contracts (1.1.0+)", "## Library contracts (1.1.0+)"],
  ["## Next steps", "## Nächste Schritte"],
  ["## Production readiness", "## Produktionsbereitschaft"],
  ["## Runtime capture", "## Laufzeitaufzeichnung"],
  ["## Runtime entry points", "## Laufzeit-Einstiegspunkte"],
  ["## JSON Schema entry points", "## JSON-Schema-Einstiegspunkte"],
  ["## Language policy", "## Sprachrichtlinie"],
  ["## API reference policy", "## Richtlinie für die API-Referenz"],
  ["## Ownership and update rules", "## Zuständigkeiten und Aktualisierungsregeln"],
  ["## Release-backed version indicator", "## Release-basierter Versionshinweis"],
  ["## Install", "## Installation"],
  ["## Usage", "## Verwendung"],
  ["## Examples", "## Beispiele"],
  ["## Compatibility", "## Kompatibilität"],
  ["## Limitations", "## Einschränkungen"],
  ["## Performance", "## Leistung"],
  ["## Suppressions and allowlists", "## Unterdrückungen und Allow-Listen"],
  ["## What MFDoctor covers", "## Was MFDoctor abdeckt"],
  ["## Run the first check", "## Die erste Prüfung ausführen"],
  ["## Gate all apps", "## Alle Apps absichern"],
  ["## Add an adapter", "## Einen Adapter hinzufügen"],
  ["## Vite-only options", "## Vite-spezifische Optionen"],
  ["## Rolldown and Vite Plus", "## Rolldown und Vite Plus"],
  ["## Manifest asset analysis", "## Analyse von Manifest-Assets"],
  [
    "## Dialect fact matrix (config-only vs plugin-resolved)",
    "## Dialekt-Faktenmatrix (nur Konfiguration vs. Plugin-Auflösung)",
  ],
  ["## Chunk ownership", "## Chunk-Zuordnung"],
  ["## What v1 does not include", "## Was v1 nicht enthält"],
  ["## Policy presets and packs", "## Richtlinien-Voreinstellungen und Pakete"],
  [
    "## Per-rule off and severity override",
    "## Regelweise Deaktivierung und Schweregradüberschreibung",
  ],
  ["## Canonical example: mixed-federation host", "## Kanonisches Beispiel: Mixed-Federation-Host"],
  ["## What each artifact does", "## Aufgabe der einzelnen Artefakte"],
  [
    "## Soak conclusions (adapters vs upstream)",
    "## Ergebnisse des Soak-Tests (Adapter vs. Upstream)",
  ],
  ["## Snapshot flow", "## Snapshot-Ablauf"],
  ["## Report capabilities block", "## Report-Block für Fähigkeiten"],
  ["## Quiet soak / demo config", "## Ruhiger Soak-Test / Demo-Konfiguration"],
  ["## Per-bundler expectations", "## Erwartungen je Bundler"],
  ["## Observability", "## Observability"],
  ["## Deployed probe", "## Bereitgestellten Probe ausführen"],
  ["## Runtime Observability source fixtures", "## Laufzeit-Observability-Quell-Fixtures"],
  ["## External runtime", "## Externe Laufzeit"],
  ["## Runtime entry points", "## Laufzeit-Einstiegspunkte"],
  ["## Runtime capability removal", "## Entfernen von Laufzeitfähigkeiten"],
  ["## Shared-usage policy knobs", "## Richtlinienoptionen für Shared-Nutzung"],
  ["## Shared-usage governance (non-goals)", "## Governance der Shared-Nutzung (keine Ziele)"],
  ["## Shared tree shaking", "## Tree Shaking von Shared-Modulen"],
  ["## Shareable packs", "## Teilbare Pakete"],
  ["## Semantic identity schema", "## Schema der semantischen Identität"],
  ["## Status labels", "## Statusbezeichnungen"],
  ["## Startup strategy", "## Startstrategie"],
  [
    "## Versioned finding details (`detailsSchema` + `details`)",
    "## Versionierte Befunddetails (`detailsSchema` + `details`)",
  ],
  ["## Variant coverage", "## Variantenabdeckung"],
  ["## Runtime capture compatibility", "## Laufzeit-Capture-Kompatibilität"],
  ["## Privacy and package boundary", "## Datenschutz und Paketgrenze"],
  ["## Semantic identity correlation", "## Korrelation semantischer Identitäten"],
  ["## Portable ownership governance", "## Portable Ownership-Governance"],
  ["## Runtime identity projection", "## Laufzeit-Identitätsprojektion"],
  ["## Build/artifact/deployment correlation", "## Build-/Artifact-/Deployment-Korrelation"],
  ["## Finding lineage and offline history", "## Finding-Lineage und Offline-Historie"],
  ["## Governance waivers and audit decisions", "## Governance-Waiver und Audit-Entscheidungen"],
  ["## V1 compatibility bridge", "## V1-Kompatibilitätsbrücke"],
  ["## Semantic graph bridge", "## Semantische-Graph-Brücke"],
  ["## V1 compatibility and rollout", "## V1-Kompatibilität und Einführung"],
  ["## Tooling", "## Werkzeuge"],
  ["## Report surfaces", "## Report-Oberflächen"],
  ["## Public v1 schema contracts", "## Öffentliche v1-Schema-Verträge"],
  [
    "## Programmatic federation graph (`buildUiPayload`)",
    "## Programmatischer Federation-Graph (`buildUiPayload`)",
  ],
  ["## Production policy", "## Produktionsrichtlinie"],
  ["## Probe a deployed manifest", "## Ein bereitgestelltes Manifest prüfen"],
  ["## Print agent fix prompts", "## Agenten-Lösungsprompts ausgeben"],
  ["## Prerequisites and applicability", "## Voraussetzungen und Anwendbarkeit"],
  ["## Policy behavior", "## Richtlinienverhalten"],
  ["## Permanent guarantees / non-goals", "## Dauerhafte Garantien / keine Ziele"],
  ["## Package managers", "## Paketmanager"],
  ["## Override precedence", "## Priorität von Überschreibungen"],
  ["## Output verification", "## Ausgabeprüfung"],
  ["## Outcomes", "## Ergebnisse"],
  ["## Nuxt 3 and Nuxt 4", "## Nuxt 3 und Nuxt 4"],
  ["## Node.js", "## Node.js"],
  ["## Modern.js", "## Modern.js"],
  ["## Inspect the rule catalog", "## Regelkatalog prüfen"],
  ["## Incremental adoption recipe", "## Rezept für die schrittweise Einführung"],
  ["## Important distinctions", "## Wichtige Unterschiede"],
  ["## Health score (`summary.score`)", "## Gesundheitswert (`summary.score`)"],
  ["## GitHub Actions", "## GitHub Actions"],
  ["## Generate and update", "## Generieren und aktualisieren"],
  ["## File format", "## Dateiformat"],
  ["## Failure policy (release blockers)", "## Fehlerpolitik (Release-Blocker)"],
  ["## Evidence protocol v2", "## Evidenzprotokoll v2"],
  ["## Dynamic-import completeness (v1)", "## Vollständigkeit dynamischer Imports (v1)"],
  ["## Discover CLI capabilities", "## CLI-Fähigkeiten ermitteln"],
  ["## Coverage map", "## Abdeckungskarte"],
  ["## Correlate a runtime trace", "## Eine Laufzeitspur korrelieren"],
  ["## Confidence", "## Konfidenz"],
  ["## Common and Core/Rspack/Rsbuild options", "## Gemeinsame und Core/Rspack/Rsbuild-Optionen"],
  ["## Choose the federation scope", "## Federation-Geltungsbereich auswählen"],
  ["## Choose a command", "## Einen Befehl auswählen"],
  ["## Check one project", "## Ein Projekt prüfen"],
  ["## Check a workspace", "## Einen Workspace prüfen"],
  ["## Check a federation", "## Eine Federation prüfen"],
  ["## CI map", "## CI-Übersicht"],
  ["## Bundlers", "## Bundler"],
  ["## Built-in presets", "## Integrierte Voreinstellungen"],
  ["## Asset budgets", "## Asset-Budgets"],
  ["## Apply on check, federation, and plugins", "## Auf check, federation und Plugins anwenden"],
  ["## Analysis depth (partial honesty)", "## Analysetiefe (ehrliche Teilergebnisse)"],
  ["## Analysis budgets", "## Analysebudgets"],
  ["## After the build", "## Nach dem Build"],
  ["## API", "## API"],
  ["### Remotes typing", "### Typisierung von Remotes"],
  ["### Write a diagnostic bundle", "### Ein Diagnose-Bundle schreiben"],
  [
    "### Topology / production governance evidence notes (MFDOCTOR-123)",
    "### Hinweise zur Topologie-/Produktions-Governance-Evidenz (MFDOCTOR-123)",
  ],
  ["### Stable IDs and safe persistence", "### Stabile IDs und sichere Persistenz"],
  ["### Select report formats", "### Report-Formate auswählen"],
  ["### Control terminal output", "### Terminalausgabe steuern"],
  ["### Apply accepted debt", "### Akzeptierte technische Schulden anwenden"],
  [
    "### Agent / CI example (prefer `details`, not message regex)",
    "### Agent-/CI-Beispiel (`details` statt Message-Regex bevorzugen)",
  ],
]);

const frontmatterTranslations = new Map([
  ["Get started", "Erste Schritte"],
  ["Bundler integrations", "Bundler-Integrationen"],
  ["CLI command reference", "CLI-Befehlsreferenz"],
  ["Public API surface", "Öffentliche API-Oberfläche"],
  ["Documentation lifecycle", "Lebenszyklus der Dokumentation"],
  [
    "Install MFDoctor, add the build adapter, and run the first local and workspace checks.",
    "MFDoctor installieren, den Build-Adapter hinzufügen und die ersten lokalen und Workspace-Prüfungen ausführen.",
  ],
  [
    "Add MFDoctor to Vite, Vite Plus, Nuxt, Rspack, Rsbuild, Webpack, or Modern.js.",
    "MFDoctor zu Vite, Vite Plus, Nuxt, Rspack, Rsbuild, Webpack oder Modern.js hinzufügen.",
  ],
  [
    "Run MFDoctor locally and in CI, across a workspace, against runtime traces, or against a deployed manifest.",
    "MFDoctor lokal und in der CI ausführen, für einen Workspace, gegen Laufzeitspuren oder gegen ein bereitgestelltes Manifest.",
  ],
  [
    "Generated catalog of the package's public entry points and JSON schemas.",
    "Generierter Katalog der öffentlichen Einstiegspunkte und JSON-Schemas des Pakets.",
  ],
  [
    "Release, language, and API-reference ownership rules for MFDoctor documentation.",
    "Regeln für Releases, Sprachen und Zuständigkeiten der MFDoctor-Dokumentation.",
  ],
]);

function localizeLine(line) {
  const heading = headingTranslations.get(line.trim());
  if (heading) return line.replace(line.trim(), heading);
  if (line.startsWith("- Category: **")) return line.replace("- Category:", "- Kategorie:");
  if (line.startsWith("- Default severity: **"))
    return line.replace("- Default severity:", "- Standardschweregrad:");
  return line;
}

function localizeFrontmatter(line) {
  const match = line.match(/^(title|description):\s*(.*)$/);
  if (!match) return line;
  return `${match[1]}: ${frontmatterTranslations.get(match[2]) ?? match[2]}`;
}

function renderGerman(relativePath, source) {
  const lines = source.split("\n");
  let inFrontmatter = false;
  let frontmatterEndIndex = -1;
  const localized = lines.map((line, index) => {
    if (index === 0 && line.trim() === "---") {
      inFrontmatter = true;
      return line;
    }
    if (inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      frontmatterEndIndex = index;
      return line;
    }
    if (inFrontmatter) return localizeFrontmatter(line);
    return localizeLine(line);
  });

  const insertion = frontmatterEndIndex >= 0 ? frontmatterEndIndex + 1 : 0;
  const marker = [
    "<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->",
    "",
    "> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.",
    "",
  ];
  const bodyStart = insertion >= 0 ? insertion : 0;
  localized.splice(bodyStart, 0, ...marker);
  return `${localized
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd()}\n`;
}

let drift = false;
let totalPages = 0;
for (const snapshot of snapshots) {
  const { version, englishRoot, germanRoot } = snapshot;
  const englishExists = await fs.stat(englishRoot).catch(() => null);
  if (!englishExists?.isDirectory()) {
    throw new Error(
      `Missing English documentation snapshot: ${path.relative(repository, englishRoot)}`,
    );
  }

  const files = (
    await fg("**/*.{md,mdx}", {
      cwd: englishRoot,
      onlyFiles: true,
      ignore: ["public/**"],
    })
  ).sort();
  totalPages += files.length;
  for (const relativePath of files) {
    const source = await fs.readFile(path.join(englishRoot, relativePath), "utf8");
    const expected = renderGerman(relativePath, source);
    const output = path.join(germanRoot, relativePath);
    const current = await fs.readFile(output, "utf8").catch(() => "");
    if (check) {
      if (!current) {
        process.stderr.write(
          `Generated German doc is missing: ${path.relative(repository, output)}\n`,
        );
        drift = true;
      } else if (!current.includes("<!-- MFDoctor locale: de.")) {
        process.stderr.write(
          `Generated German doc is missing its locale marker: ${path.relative(repository, output)}\n`,
        );
        drift = true;
      }
    } else {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, expected);
    }
  }

  const existing = await fg("**/*.{md,mdx}", {
    cwd: germanRoot,
    onlyFiles: true,
    ignore: ["public/**"],
  });
  for (const extra of existing) {
    if (!files.includes(extra)) {
      process.stderr.write(
        `Generated German doc has no English source for ${version}: ${path.relative(repository, path.join(germanRoot, extra))}\n`,
      );
      drift = true;
    }
  }

  const supportFiles = await fg("**/*", {
    cwd: englishRoot,
    onlyFiles: true,
    ignore: ["public/**", "**/*.{md,mdx}"],
  });
  for (const relativePath of supportFiles) {
    const sourcePath = path.join(englishRoot, relativePath);
    const outputPath = path.join(germanRoot, relativePath);
    const source = await fs.readFile(sourcePath);
    const current = await fs.readFile(outputPath).catch(() => null);
    if (check) {
      if (!current || !source.equals(current)) {
        process.stderr.write(
          `Generated German support file drift: ${path.relative(repository, outputPath)}\n`,
        );
        drift = true;
      }
    } else {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, source);
    }
  }
}

if (drift) process.exitCode = 1;
else if (write)
  console.log(
    `Generated German documentation for ${totalPages} page(s) across ${snapshots.length} snapshot(s).`,
  );
else
  console.log(
    `Validated German documentation for ${totalPages} page(s) across ${snapshots.length} snapshot(s).`,
  );
