<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Capability matrix

Analysis depth per supported bundler. For supported / partial / unsupported
**product** cells (Node, package managers, report surfaces), see the
[compatibility matrix](./compatibility.md).

| Capability                             | Vite / Rolldown / Vite Plus                                     | Rspack                | Rsbuild               | Webpack               | Modern.js                                                |
| -------------------------------------- | --------------------------------------------------------------- | --------------------- | --------------------- | --------------------- | -------------------------------------------------------- |
| Explicit MF config                     | Yes                                                             | Yes                   | Yes                   | Yes                   | Yes                                                      |
| Static imports                         | Yes                                                             | Yes                   | Yes                   | Yes                   | Yes                                                      |
| Supported dynamic patterns (see below) | Yes                                                             | Yes                   | Yes                   | Yes                   | Yes                                                      |
| Manifest and stats                     | Opt-in (`manifest: true`); no webpack stats                     | Default (`!== false`) | Default (`!== false`) | Default (`!== false`) | Default under hood; see [matrix](./runtime-manifests.md) |
| Emitted assets                         | On-disk `writeBundle` / `closeBundle` (Rolldown-safe)           | Compilation hooks     | Rspack when available | Compilation hooks     | Via Rspack/Webpack `afterEmit`                           |
| Opt-in runtime traces                  | Correlated when `runtimeTrace` / `mfdoctor runtime` is supplied | Same                  | Same                  | Same                  | Same                                                     |
| Cross-project checks                   | Yes                                                             | Yes                   | Yes                   | Yes                   | Yes                                                      |
| Lifecycle recording                    | `bundler.lifecycle` (`vite` / `rolldown-vite` / `vite-plus`)    | —                     | —                     | —                     | —                                                        |

Rules consult recorded capabilities. Missing optional input creates
`doctor/partial-analysis` instead of pretending full analysis happened.
The “Manifest and stats” row is **not** a blanket Yes: Vite/Rolldown omit
`mf-manifest.json` / `mf-stats.json` unless `manifest: true`, and missing
webpack compilation stats on those bundlers is expected. See the
[per-bundler matrix](./runtime-manifests.md#per-bundler-expectations).
Adapters must not scrape private Module Federation plugin fields to invent
coverage — see
[permanent guarantees / non-goals](./limitations.md#permanent-guarantees--non-goals).

## Vollständigkeit dynamischer Imports (v1)

MFDoctor’s import/shared analysis is **not** “static only.” Offline `check` /
adapter runs resolve the patterns below when evidence exists in source, config,
manifest facts, or an opt-in Observability export. Unresolvable dynamics yield
`doctor/partial-analysis` rather than fabricated certainty. MFDoctor still does
**not** claim 100% of arbitrary runtime JavaScript.

### Supported (resolved when evidence exists)

| Pattern                                                                                   | Evidence                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Static `import` / `export … from`                                                         | Source scan                                                     |
| Dynamic `import("…")` / `import('…')` of local modules, packages, or `remoteAlias/expose` | Source scan + configured remotes                                |
| `require("…")` string literals                                                            | Source scan                                                     |
| `loadRemote("alias/expose")`                                                              | Source scan (recorded under `imports.remotes`)                  |
| `loadShare("pkg")` / `loadShareSync("pkg")`                                               | Source scan (`imports.packages` / `dynamicPackages`)            |
| `registerRemotes([{ name: "…", … }])` with string `name` / `alias`                        | Source scan                                                     |
| Conditional / runtime remotes named in an opt-in Observability trace                      | `runtimeTrace` on MFDoctor options or `mfdoctor runtime`        |
| Remotes listed on an on-disk `mf-manifest.json`                                           | Manifest facts (`imports.remotes`, `evidenceSources: manifest`) |

Shared usage for `shared/unused` includes static imports, resolved dynamic /
`loadShare*` literals, and packages named in an opt-in runtime trace. Remote
aliases are not treated as shared packages.

### Not resolved (honest partial analysis)

| Pattern                                                                       | Behavior                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `import(expr)`, template literals, or non-literal `loadRemote` / `loadShare*` | Recorded in `imports.unresolvedDynamic`; `doctor/partial-analysis`    |
| `registerRemotes(variable)` or objects without string `name`/`alias`          | Same                                                                  |
| Arbitrary conditional remotes with no config, manifest, or trace evidence     | Not invented; stay silent or partial when unresolved call sites exist |
| Executing remote JS or fetching live remotes during `check` / `federation`    | Out of scope (use `probe` / Observability separately)                 |

When unresolved package-capable dynamics exist, `shared/unused` does **not**
claim a package is unused — prefer `doctor/partial-analysis` over a false pass
or false unused finding.

## Korrelation semantischer Identitäten

Der additive Identitätsvertrag ermöglicht deterministische Offline-Korrelation,
ohne V1-Berichte, Fingerprints, Baselines, Terminalausgabe, SARIF oder
Exit-Codes zu verändern. `correlateSemanticIdentity(subject, candidates)`
liefert die Ergebnisse exact, strong, weak, ambiguous oder unknown sowie
begrenzte Kandidatenschlüssel, übereinstimmende Dimensionsnamen, fehlende
Evidenz und Konflikte. Bei gleichwertiger stärkster Evidenz wird niemals ein
Kandidat willkürlich ausgewählt.

Die Korrelation berücksichtigt den Geltungsbereich. Grenzen für Target, Realm
und Umgebung bleiben getrennt; ein Browser-Kandidat kann keinen SSR-Bereich
erfüllen, und ein unbekannter oder nicht begrenzter Bereich kann nicht zu
vollständiger Evidenz aufgewertet werden. Die zur Erklärung verwendeten Werte
werden nicht in das Ergebnis kopiert, sodass Pfade, URLs, Zugangsdaten und
andere Quelldaten außerhalb des additiven Vertrags bleiben.

`createIdentityCapabilityEdge` erfasst Producer-, Consumer-, Shared-Provider-
und Runtime-Beziehungen als deterministische Digest-IDs.
`assessIdentityCapabilityCoverage` bewertet diese Kanten innerhalb eines
angeforderten Bereichs und meldet vollständige, partielle oder unbekannte
Abdeckung. Diese Graph-Fakten sind optionale Bibliotheksdaten; bestehende
Legacy-Host/Remote-Projektionen bleiben unverändert.

## Portable Ownership-Governance

`defineIdentityGovernanceRule` validiert eine portable Zuständigkeitsregel,
während `resolveIdentityGovernance(identity, rules)` eine deterministische
Priorität anwendet: Zuerst gewinnt ein Selektor für einen exakten
Identitätsschlüssel, danach Selektoren für Parent/Kind und Container/Kind;
Prioritäten lösen Regeln innerhalb derselben Spezifitätsstufe auf. Die
Zuständigkeiten für Consumer, Producer, Shared Provider, Deployments und
Runtime-Plattformen bleiben getrennt.

Zuständigkeiten mit gleicher Priorität werden als `ambiguous` zurückgegeben;
der Resolver wählt kein Team alphabetisch aus. Partielle oder unbekannte
Governance-Evidenz bleibt `unknown` und meldet die unvollständigen Regel-IDs.
Bereichskonflikte und fehlende Target-, Realm- oder Umgebungsdimensionen bleiben
als Diagnosen erhalten. Governance ist eine additive Bibliotheksfunktion; sie
unterdrückt keine Befunde, ändert keine Baselines und implementiert keine
Waiver.

## Laufzeit-Identitätsprojektion

`projectRuntimeCaptureIdentity(capture, options)` ist die additive Brücke von
einer bereinigten #84-Laufzeitaufzeichnung zu expliziten Laufzeit-Realm- und
Laufzeit-Instanzidentitäten. Sie verlangt ein explizites Target und Realm,
trennt Deployment-, Realm-, Instanz-, Paket- und Versionsdimensionen und
liefert exact, strong, weak oder unknown mit begrenzten Diagnosen fehlender
Felder.

Fehlende Deployment- oder Instanznachweise bleiben eine quellbezogene
unbekannte Identität. Ein `instanceName` oder ein anderes Anzeigelabel wird
niemals zu semantischem Nachweis. Die Projektion bewahrt Grenzen zwischen
Browser, SSR, Worker, Node und Frames und verändert weder Laufzeitstatus noch
führt sie Remote-Code aus oder prüft Client-Bundles. V1-Berichte und CLI-
Verhalten bleiben unverändert; Finding-Historie, Waiver und die V1-
Kompatibilitätsbrücke bleiben getrennte additive Slices.

## Build-/Artifact-/Deployment-Korrelation

`correlateBuildArtifactDeployment(input)` verknüpft explizite Build-, Artifact-,
Deployment- und Umgebungsidentitäten über Parent- und Artifact-Schlüssel.
Begrenzte übereinstimmende, fehlende und konfliktbehaftete Dimensionen werden
zurückgegeben, statt aus Manifestnamen zu raten. `correlateDeploymentRelationship(input)`
akzeptiert ein explizites Offline-Faktum `redeploy` oder `rollback` nur bei
übereinstimmender Umgebung und Artifact-Menge; die Reihenfolge wird nicht aus
Zeitstempeln oder Labels abgeleitet.

Die Beziehungen bewahren getrennte Build- und Deployment-Vorkommnisse, auch
wenn eine Artifact-Menge erneut ausgerollt wird. Unvollständige oder
widersprüchliche #81-Evidenz bleibt weak oder unknown; die Bibliothek führt
keine Deployments aus.

## Finding-Lineage und Offline-Historie

`createFindingLineage` gibt einer Regelauswertung eine stabile
`findingLineageId` und eine getrennte `findingOccurrenceId`. Die Lineage wird
nur aus dem von der Regel deklarierten Identitätsschema, dem semantischen
Subject, dem stabilen Verstoßschlüssel und dem ausdrücklich deklarierten Scope
gebildet. Nachrichten, Schweregrad, Quellpositionen, Zeitstempel und volatile
Evidenz sind nicht Teil der Lineage-ID. Der bestehende V1-Fingerprint bleibt
unverändert und ist weiterhin die Kompatibilitätsidentität für Baselines und
SARIF.

`createFindingHistorySnapshot` und `diffFindingHistory` vergleichen gespeicherte
lokale oder CI-Snapshots. Sie melden neue, persistente, behobene, verschärfte,
verbesserte und unbekannte/unbestätigte Änderungen. Ein fehlender oder partieller
späterer Snapshot kann keine Behebung beweisen; dafür ist vollständige,
vergleichbare Evidenz erforderlich. Der Vertrag ist offline und
bibliotheksbasiert: Er fügt weder Telemetrie, einen gehosteten Verlaufsspeicher,
standardmäßiges CLI-Verhalten noch Regelunterdrückung hinzu.
