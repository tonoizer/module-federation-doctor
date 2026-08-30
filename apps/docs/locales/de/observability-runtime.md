---
title: Observability latest.json → mfdoctor runtime
description: Module-Federation-Observability-latest.json offline in mfdoctor runtime einlesen — kein In-Browser-Agent.
---

<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Observability latest.json → mfdoctor runtime

Module Federation Observability schreibt Laufzeitberichte wie
`.mf/observability/latest.json`. MFDoctor liest diese Datei über die
**offline**-CLI ein — nicht durch Injizieren eines Doctor-Agenten in den
Browser.

```text
Observability Plugin  →  .mf/observability/latest.json  →  mfdoctor runtime
```

## Beispiel

Nachdem Observability einen Bericht geschrieben hat (Node/SSR `fileOutput`,
Browser-Export, Collector oder `onReport`-Übergabe), korrelieren Sie ihn mit
lokalen MFDoctor-Projektdaten:

```bash
mfdoctor check --format json
mfdoctor runtime ./.mf/observability/latest.json ".mf/doctor/**/project.json"
```

Minimale Form, wenn Projektdaten bereits unter `.mf/doctor/**/project.json`
liegen:

```bash
mfdoctor runtime ./.mf/observability/latest.json
```

Oder setzen Sie `runtimeTrace` in `mfdoctor.config` und lassen Sie den Pfad auf
der Kommandozeile weg. Unterstützte Report-Formate sind nur **terminal**,
**JSON** und **SARIF** — es gibt keinen HTML-Report und kein `--ui`-Dashboard.

## Erwartete Eingaben

| Eingabe                                                                     | Rolle                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `.mf/observability/latest.json` (oder ein anderer Observability-Exportpfad) | Laufzeitbericht vom offiziellen Observability Plugin |
| `.mf/doctor/**/project.json` (Standard-Glob)                                | Build-/Check-Projektdaten von MFDoctor               |

`mfdoctor runtime` akzeptiert:

- ein Observability-Report-Objekt;
- ein Array von Reports;
- eine `{"report": ...}`- oder `{"reports": [...]}`-Hülle.

Aktuelle Upstream-Observability-2.5.3-Reports und die Legacy-MFDoctor-v1-Form
werden unterstützt. Teilweise Reports werden als teilweise Evidenz importiert;
fehlende Felder gelten nie als bestanden. Unbekannte zukünftige Formen und
Observability-**Build**-Reports (`.mf/observability/build-report.json` /
`build-info.json`) werden abgelehnt — das ist Build-Telemetrie, keine
Laufzeitspuren.

Bevorzugen Sie `latest.json` für den neuesten vollständigen Laufzeitbericht.
Nutzen Sie `events.jsonl` nur, wenn Sie Ereignisreihenfolge oder mehrere Spuren
brauchen; das ist nicht die Standard-Eingabe für `mfdoctor runtime`.

## Kein In-Browser-Agent

Die Analyse bleibt **nach dem Build / in der CLI**:

- Injizieren Sie MFDoctor **nicht** in die Seite oder das Client-Bundle.
- Suchen Sie **nicht** nach einer HTML-Doctor-UI oder einem `--ui`-Flag.
- MFDoctor lädt niemals URLs aus einem Report, öffnet keinen Browser und führt
  Report-Inhalte nicht aus.
- Ein In-Browser-MFDoctor-Laufzeitagent ist **nicht geplant**
  ([#33](https://github.com/tonoizer/module-federation-doctor/issues/33)).

Bei Live-Ladefehlern nutzen Sie das offizielle
[Observability Plugin](https://module-federation.io/plugin/plugins/observability-plugin)
(oder dessen Export-/Collector-Pfad) und führen Sie anschließend
`mfdoctor runtime` auf dem gespeicherten JSON aus.

## Optionaler CI-Schritt

In der CI, nachdem ein Job sowohl Observability-Ausgabe als auch MFDoctor-
`project.json`-Dateien erzeugt hat:

```bash
mfdoctor runtime ./.mf/observability/latest.json ".mf/doctor/**/project.json" --format terminal,json
```

Exit-Codes entsprechen dem Rest der CLI: `0` bestanden, `1` Richtlinienfehler,
`2` Analyse unvollständig. Ungültige oder fehlende Opt-in-Spuren brechen
gewöhnliches `mfdoctor check` nicht; sie lassen nur die Laufzeitkorrelation weg.

## Verwandte Seiten

- [CLI: eine Laufzeitspur korrelieren](./cli.md#correlate-a-runtime-trace)
- [Laufzeit und Manifeste](./runtime-manifests.md#observability)
- [Vertrag für externe Laufzeitaufzeichnungen](./runtime-capture.md) — validierte
  Capture-Hüllen und Adapter
- [Einschränkungen](./limitations.md#permanent-guarantees--non-goals) — keine
  Client-Injection, kein In-Browser-Agent
