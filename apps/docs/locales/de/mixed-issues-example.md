<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Mixed federation issues example

Same Vite + Rspack + Rsbuild topology as the [healthy mixed example](./mixed-example.md),
but configured so MFDoctor reports shared and cross-project conflicts.

| Finding                                     | How it is planted                                              |
| ------------------------------------------- | -------------------------------------------------------------- |
| `config/remote-manifest-recommended`        | Host remotes use `remoteEntry.js` URLs (rule left on)          |
| `reliability/version-first-offline-remotes` | Host keeps `version-first` with remotes and no recovery plugin |
| `shared/version-unsatisfied`                | Rspack remote installs React 18 against `requiredVersion: ^19` |
| `shared/singleton-risk`                     | Rspack remote shares React without `singleton`                 |
| `federation/version-conflict`               | Installed React versions do not satisfy every consumer range   |
| `federation/share-scope-mismatch`           | Rsbuild remote shares React on `legacy`                        |
| `shared/singleton-mismatch`                 | Host singleton vs Rspack non-singleton                         |

```bash
vp run demo:mixed-issues
# or manually:
vp run --filter './examples/mixed-federation-issues/**' build
node dist/cli.js check examples/mixed-federation-issues/host-vite --ci --format terminal
node dist/cli.js check examples/mixed-federation-issues/remote-rspack --ci --format terminal
node dist/cli.js federation \
  examples/mixed-federation-issues/host-vite/.mf/doctor/project.json \
  examples/mixed-federation-issues/remote-rspack/.mf/doctor/project.json \
  examples/mixed-federation-issues/remote-rsbuild/.mf/doctor/project.json \
  --format terminal
```

This suite is a CLI demo only. Playwright e2e stays on the green
[mixed federation](./mixed-example.md) path.
