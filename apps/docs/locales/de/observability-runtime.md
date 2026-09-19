---
title: Observability latest.json → mfdoctor runtime
description: Module-Federation-Observability-latest.json offline in mfdoctor runtime einlesen, kein In-Browser-Agent.
---

<!-- mfdoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche mfdoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Observability latest.json → mfdoctor runtime

Module Federation Observability writes runtime reports such as
`.mf/observability/latest.json`. mfdoctor consumes that file through the
**offline** CLI, not by injecting a doctor agent into the browser.

```text
Observability Plugin  →  .mf/observability/latest.json  →  mfdoctor runtime
```

## Beispiel

After Observability has written a report (Node/SSR `fileOutput`, browser export,
collector, or `onReport` handoff), correlate it with local mfdoctor project
facts:

```bash
mfdoctor check --format json
mfdoctor runtime ./.mf/observability/latest.json ".mf/doctor/**/project.json"
```

Minimal form when project facts already live under `.mf/doctor/**/project.json`:

```bash
mfdoctor runtime ./.mf/observability/latest.json
```

Or set `runtimeTrace` in `mfdoctor.config` and omit the path on the command
line. Supported report formats are **terminal**, **JSON**, and **SARIF** only,
there is no HTML report or `--ui` dashboard.

## Erwartete Eingaben

| Input                                                                  | Role                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `.mf/observability/latest.json` (or another Observability export path) | Runtime report from the official Observability Plugin |
| `.mf/doctor/**/project.json` (default glob)                            | Build/check project facts from mfdoctor               |

`mfdoctor runtime` accepts:

- one Observability report object;
- an array of reports;
- a `{"report": ...}` or `{"reports": [...]}` envelope.

Current upstream Observability 2.5.3 reports and the legacy mfdoctor v1 shape
are supported. Partial reports import as partial evidence; missing fields never
count as a pass. Unknown future shapes and Observability **build** reports
(`.mf/observability/build-report.json` / `build-info.json`) are rejected, those
are build telemetry, not runtime traces.

Prefer `latest.json` for the latest complete runtime report. Use
`events.jsonl` only when you need event ordering or multiple traces; it is not
the default `mfdoctor runtime` input.

## Kein In-Browser-Agent

Analysis stays **post-build / CLI**:

- Do **not** inject mfdoctor into the page or client bundle.
- Do **not** look for an HTML doctor UI or `--ui` flag.
- mfdoctor never fetches URLs found in a report, never opens a browser, and
  never executes report contents.
- An in-browser mfdoctor runtime agent is **not planned**
  ([#33](https://github.com/tonoizer/module-federation-doctor/issues/33)).

For live loading failures, use the official
[Observability Plugin](https://module-federation.io/plugin/plugins/observability-plugin)
(or its export/collector path), then run `mfdoctor runtime` on the saved JSON.

## Optionaler CI-Schritt

In CI, after a job that produces both Observability output and mfdoctor
`project.json` files:

```bash
mfdoctor runtime ./.mf/observability/latest.json ".mf/doctor/**/project.json" --format terminal,json
```

Exit codes match the rest of the CLI: `0` pass, `1` policy fail, `2` analysis
incomplete. Invalid or missing opt-in traces do not break ordinary
`mfdoctor check`; they simply omit runtime correlation.

## Verwandte Seiten

- [CLI: correlate a runtime trace](./cli.md#correlate-a-runtime-trace)
- [Runtime and manifests](./runtime-manifests.md#observability)
- [External runtime capture contract](./runtime-capture.md), validated capture
  envelopes and adapters
- [Limitations](./limitations.md#permanent-guarantees--non-goals), no client
  injection, no in-browser agent
