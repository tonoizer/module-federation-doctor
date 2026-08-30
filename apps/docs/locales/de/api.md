---
title: Öffentliche API-Oberfläche
description: Generierter Katalog der öffentlichen Einstiegspunkte und JSON-Schemas des Pakets.
---

<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Öffentliche API-Oberfläche

This catalog is generated from the package export map. It is intentionally an
entry-point reference rather than a hand-maintained symbol list, so a new or
removed public export fails the documentation build until this page is
regenerated.

## Laufzeit-Einstiegspunkte

| Import                       | Published runtime target | Purpose                                                                                      |
| ---------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `@tonoizer/mfdoctor`         | `./dist/index.js`        | Core analysis, policy, baselines, evidence, runtime correlation, and graph payloads.         |
| `@tonoizer/mfdoctor/capture` | `./dist/capture.js`      | Validate, adapt, and atomically write bounded offline runtime exports and fallback metadata. |
| `@tonoizer/mfdoctor/modern`  | `./dist/modern.js`       | Modern.js adapter integration.                                                               |
| `@tonoizer/mfdoctor/nuxt`    | `./dist/nuxt.js`         | Nuxt adapter integration.                                                                    |
| `@tonoizer/mfdoctor/policy`  | `./dist/policy.js`       | Named policy packs and policy helpers.                                                       |
| `@tonoizer/mfdoctor/rsbuild` | `./dist/rsbuild.js`      | Rsbuild adapter integration.                                                                 |
| `@tonoizer/mfdoctor/rspack`  | `./dist/rspack.js`       | Rspack adapter integration.                                                                  |
| `@tonoizer/mfdoctor/rules`   | `./dist/rules.js`        | Custom rule definitions and built-in rule metadata.                                          |
| `@tonoizer/mfdoctor/vite`    | `./dist/vite.js`         | Vite adapter integration.                                                                    |
| `@tonoizer/mfdoctor/webpack` | `./dist/webpack.js`      | Webpack adapter integration.                                                                 |

## JSON-Schema-Einstiegspunkte

| Import                                                                | Published path                                     | Purpose                      |
| --------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------- |
| `@tonoizer/mfdoctor/schemas/baseline.schema.json`                     | `schemas/baseline.schema.json`                     | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/build-artifact-deployment.schema.json`    | `schemas/build-artifact-deployment.schema.json`    | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/capabilities.schema.json`                 | `schemas/capabilities.schema.json`                 | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/compare.schema.json`                      | `schemas/compare.schema.json`                      | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/config.schema.json`                       | `schemas/config.schema.json`                       | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/evidence.schema.json`                     | `schemas/evidence.schema.json`                     | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/finding-lineage.schema.json`              | `schemas/finding-lineage.schema.json`              | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/governance-waiver.schema.json`            | `schemas/governance-waiver.schema.json`            | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/identity-correlation.schema.json`         | `schemas/identity-correlation.schema.json`         | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/identity-governance.schema.json`          | `schemas/identity-governance.schema.json`          | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/identity.schema.json`                     | `schemas/identity.schema.json`                     | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/probe.schema.json`                        | `schemas/probe.schema.json`                        | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/project.schema.json`                      | `schemas/project.schema.json`                      | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/report.schema.json`                       | `schemas/report.schema.json`                       | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/rule-inventory.schema.json`               | `schemas/rule-inventory.schema.json`               | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/runtime-capture.schema.json`              | `schemas/runtime-capture.schema.json`              | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/runtime-identity-correlation.schema.json` | `schemas/runtime-identity-correlation.schema.json` | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/runtime-trace.schema.json`                | `schemas/runtime-trace.schema.json`                | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/semantic-graph.schema.json`               | `schemas/semantic-graph.schema.json`               | Public JSON Schema contract. |
| `@tonoizer/mfdoctor/schemas/ui.schema.json`                           | `schemas/ui.schema.json`                           | Public JSON Schema contract. |

The package's declaration files are published alongside the runtime targets.
Use the [CLI capabilities contract](./cli.md#discover-cli-capabilities) for
machine-readable command, format, exit-code, and schema discovery.
