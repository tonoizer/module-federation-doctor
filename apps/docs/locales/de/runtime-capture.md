<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Vertrag für externe Laufzeitaufzeichnungen

> Bibliothek-/Erweiterungsdokumentation für Autorinnen und Autoren, die ein
> externes Capture-Tool anbinden. Host-Teams, die MFDoctor integrieren,
> beginnen mit [Setup](./setup.md), [CI](./production-readiness.md),
> [Rules](./rules/) und [Limitations](./limitations.md).

Der Laufzeitaufzeichnungsvertrag ist eine explizite Übergabegrenze für ein
externes Capture-/Export-Tool. Er ist kein MFDoctor-Laufzeitagent.

Die Designentscheidung steht in [ADR 0084: External runtime capture boundary](https://github.com/tonoizer/module-federation-doctor/blob/main/docs/adr/0084-external-runtime-capture-boundary.md).

Capture muss von einer Person mit einem freigegebenen Ziel oder einer Exportdatei
gestartet werden. Es darf nicht aus `check`, einem Bundler-Adapter, dem
Anwendungsstart oder einem Client-Bundle laufen. Die aktuellen
Adapterschnittstellen lesen vorhandene Exporte von Observability, DevTools,
Anwendungen und Node/SSR, bieten einen ausdrücklich angeforderten
Browser-Transport und projizieren bereitgestellte Snapshot-/Runtime-Instance-
Fallback-Nachweise. Es werden niemals Plugins injiziert,
Laufzeit-Mutatoren aufgerufen, Storage gelesen oder Header, Bodies, Cookies,
Quelltext, Props, Factories oder Raw Stacks exportiert.

Der Vertrag zeichnet Quellenfähigkeiten als `exact`, `partial`, `unavailable`,
`not-applicable` oder `unknown` auf. Fehlende Felder alter oder Preview-Versionen
bleiben unbekannt. Jeder Datensatz erhält außerdem Capture-, Navigation-, Realm-
und Sequenzbezug, damit gleiche Trace-IDs verschiedener Realms nicht verbunden
werden.

Die Standardgrenzen betragen 5 MiB, 100 Reports, 5.000 Events, 500 Snapshots,
100 Instanzen, 2.000 Netzwerkdatensätze, 200 Fehler, 4 KiB Strings, Tiefe 12
und 100 Objektschlüssel. Die harte Gesamtgrenze beträgt 25 MiB; Kürzungen werden
aufgezeichnet.

Vertrag, begrenzter dateibasierter Import, vorhandene Datei-/Export-Adapter, der
explizite schreibgeschützte Browser-Transport, sichere
Snapshot-/Runtime-Instance-Projektionen und der Netzwerk-/Fehler-Fallback sind
die ausgelieferten sicheren Slices. Die atomische validierte JSON-Übergabe ist
über den Capture-Einstiegspunkt verfügbar; automatischer Export bleibt außerhalb
dieser Grenze. Der begrenzte dateibasierte Import ist über den bestehenden
Offline-Laufzeitbefehl verfügbar:

```bash
mfdoctor runtime ./capture.json
```

Der Befehl akzeptiert nur Vertragsversion 1, weist übergroße oder unsichere
Dateien vor der Analyse zurück und behält die bestehende Laufzeitausgabe bei.
Laufzeitmutation und automatischer Export bleiben außerhalb der Grenze.

## Vorhandene Export-Adapter

Der Einstiegspunkt `@tonoizer/mfdoctor/capture` kann einen vom Benutzer
bereitgestellten Export ohne Browser- oder Laufzeitanbindung normalisieren:

```ts
import { loadRuntimeCaptureExportFile } from "@tonoizer/mfdoctor/capture";

const capture = await loadRuntimeCaptureExportFile(".mf/observability/latest.json", {
  adapter: "observability",
});
```

Der Adapter akzeptiert aktuelle oder teilweise Observability-Reports, offizielle
DevTools-Exporte, anwendungseigene `onReport`-/`onEvent`-Dateien sowie Node/SSR-
JSON-Exporte. Er verwendet den vorhandenen Runtime-Reader erneut, ergänzt
bereichsbezogene Identität, Herkunft, Fähigkeiten, Kürzungen und stabile
Datensatz-IDs und validiert anschließend den vollständigen Vertrag. DevTools-
Projektionen bleiben teilweise und behalten eine `source-supplied`-Relation zu
ihren Report-Datensätzen.

Der Adapter liest ausschließlich den bereitgestellten Wert. Er startet keinen
Browser und verbindet sich nicht mit einem Browser, liest keine Live-Globals,
installiert kein Plugin, aktiviert DevTools nicht, ruft keine
Laufzeit-`load`-/`register`-/`init`-APIs auf und verändert die Eingabe nicht.
Das atomische Schreiben der Ausgabedatei ist explizit und wird von diesem
Adapter niemals implizit ausgeführt.

## Atomische Offline-Übergabe

Nach der Erzeugung eines validierten Envelopes durch einen externen Adapter kann
der Capture-Einstiegspunkt ihn schreiben:

```ts
import {
  importRuntimeCaptureNetworkFallback,
  writeRuntimeCaptureExportFile,
} from "@tonoizer/mfdoctor/capture";

const capture = importRuntimeCaptureNetworkFallback({
  errors: [{ code: "RUNTIME-007", message: "remote entry failed" }],
});

await writeRuntimeCaptureExportFile(capture, "./.mf/doctor/runtime-capture.json");
```

Der Writer validiert zunächst eine sichere normalisierte Kopie, bevor er eine
temporäre Geschwisterdatei anlegt. Er begrenzt die serialisierte UTF-8-Ausgabe
auf `limits.maxBytes`, schreibt mit Modus `0600`, leert die Datei, benennt sie
atomar um und entfernt den temporären Pfad bei einem Fehler. Eine vorhandene
Ausgabedatei bleibt bei Validierungs- oder Rename-Fehlern unverändert.

## Expliziter Browser-Transport

Ein externes Browser-Tool kann einen engen Connector für ein ausdrücklich
freigegebenes Ziel bereitstellen. MFDoctor ruft nur
`readObservabilityExport` oder `readDevtoolsExport` auf. Der Connector darf
keine beliebige Seitenauswertung, Plugin-Injektion, Laufzeitmutation oder
DevTools-Overrides anbieten.

```ts
import { captureRuntimeBrowserExport } from "@tonoizer/mfdoctor/capture";

const capture = await captureRuntimeBrowserExport(connector, {
  mode: "attach",
  target: { id: "tab-1", url: "https://app.example.test/" },
  userApproved: true,
});
```

Der Connector liefert Session-, Ziel-, Navigations- und Realm-Identität. Der
Transport validiert Web-Ziele, weist Zugangsdaten und geheime Query-Schlüssel
zurück, übergibt den Bereich an den offiziellen Export-Reader und schließt die
externe Verbindung bei Erfolg oder Fehler. Die Seite wird weder neu geladen noch
navigiert. Capture bleibt eine einzelne explizite Operation; gewöhnliches
`check`, Bundler-Adapter und Anwendungsstart rufen sie nie auf.

## Schreibgeschützte Fallback-Projektionen

Wenn ein externes Tool bereits ein Laufzeit-State-Objekt gelesen hat, kann der
Capture-Einstiegspunkt die kleine, sichere Snapshot-/Runtime-Instance-Oberfläche
projizieren:

```ts
import { importRuntimeCaptureFallback } from "@tonoizer/mfdoctor/capture";

const capture = importRuntimeCaptureFallback({
  runtimeVersion: "2.5.0",
  moduleInfo: {
    totalCount: 1,
    entries: [
      {
        name: "checkout",
        publicPath: "https://cdn.example.test/checkout/",
        remoteEntry: "https://cdn.example.test/checkout/remoteEntry.js",
      },
    ],
  },
  instances: [{ name: "host", remoteNames: ["checkout"], shareScopes: ["default"] }],
});
```

Die Projektion liest für `moduleInfo`, Snapshot-Einträge und
`instances`/`runtimeInstances` ausschließlich eigene Daten-Eigenschaften.
Unbekannte Runtime-Graphen werden ignoriert; `getPublicPath`, Factories,
Funktionen, Header, rohe Fehler und Runtime-APIs werden nicht gelesen oder
aufgerufen. Das Eingabeobjekt wird nicht verändert. Ein konfiguriertes
`disableSnapshot: true` erzeugt die Snapshot-Fähigkeit `not-applicable` ohne
Snapshot-Datensätze. Fehlendes moduleInfo ist `unavailable`; abgeschnittene,
ungezählte, fehlerhafte oder quotenbegrenzte Daten bleiben `partial` oder
`unknown`. Preview-/unbekannte Runtime-Versionen erhöhen die
Shared-Lifecycle-Fähigkeit nicht; der Fallback leitet aus Instanznamen oder
Scopes niemals den Zustand geteilter Pakete ab.

## Netzwerk-/Fehler-Fallback-Metadaten

Ein externer Collector kann begrenzte MF-orientierte Request- und
Runtime-Fehler-Metadaten übergeben, ohne Request-Interna zu exportieren:

```ts
import { importRuntimeCaptureNetworkFallback } from "@tonoizer/mfdoctor/capture";

const capture = importRuntimeCaptureNetworkFallback({
  network: [
    {
      url: "https://cdn.example.test/checkout/remoteEntry.js",
      kind: "remote-entry",
      status: 200,
      requestId: "request-1",
      timestamp: 1_000,
    },
  ],
  errors: [
    {
      code: "RUNTIME-007",
      message: "remote entry failed",
      requestId: "request-1",
      timestamp: 1_001,
    },
  ],
});
```

Projiziert werden nur freigegebene URL-, Kind-, Status-, Fehler-/Dauer-/Initiator-
Klassen sowie Fehlercode/-name/-message/-phase, Request-IDs und Zeitstempel.
URL-Zugangsdaten und geheime Query-Werte werden vor Digest und Speicherung
redigiert; Header, Bodies, Cookies, Raw Stacks und beliebige Fehlerkontexte
werden ignoriert. Eine gleiche Request-ID oder redigierte URL erzeugt eine
exakte Relation. Eine Übereinstimmung nur über Zeit ist
`time-window-candidate` und niemals eine exakte kausale Verknüpfung. Überläufe
und fehlerhafte Datensätze bleiben `partial`/`unknown` und erzeugen explizite
Kürzungsdaten.

## Datenschutz und Paketgrenze

Der Capture-Vertrag bewahrt nur begrenzte, freigegebene Nachweise:

| Aufbewahrt                                                                                                                                                      | Niemals gelesen oder aufbewahrt                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quellversion, abgegrenzte Identität, sicherer Locator, Status-/Klassenmetadaten, begrenzter Diagnose-Text, Herkunft, Vollständigkeit, Digest und Kürzungsstatus | Cookies, Authorization-Header, Request-/Response-Bodies, Zugangsdaten, geheime Query-Werte, rohe Stacks, Factories, Props, Storage, beliebige Runtime-Graphen oder private Plugin-Interna |

Die Redigierung erfolgt vor stabilen IDs, Content-Digests, Pufferung und
Dateischreiben. Der Standard-Einstieg `@tonoizer/mfdoctor` und die Bundler-
Adapter importieren den Capture-Einstiegspunkt nicht und stellen seine
Funktionen nicht bereit. Verwenden Sie den expliziten Subpath
`@tonoizer/mfdoctor/capture` nur aus einem Node-/Offline-Tool; er darf niemals
in ein Client-Bundle oder in `check`, einen Build-Adapter oder den
Anwendungsstart gelangen.
