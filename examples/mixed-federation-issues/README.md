# Mixed federation issues

Intentionally broken Vite host + Rspack/Rsbuild remotes. Builds emit MFDoctor
project facts so `check` and `federation` can surface shared and cross-project
conflicts. Not part of Playwright e2e.

| Finding                                     | Where                                                          |
| ------------------------------------------- | -------------------------------------------------------------- |
| `config/remote-manifest-recommended`        | Host remotes point at `remoteEntry.js`                         |
| `reliability/version-first-offline-remotes` | Host uses `version-first` with remotes and no recovery plugin  |
| `shared/version-unsatisfied`                | Rspack remote installs React 18 against `requiredVersion: ^19` |
| `shared/singleton-risk`                     | Rspack remote shares React without `singleton`                 |
| `federation/version-conflict`               | Cross-project React ranges vs installed versions               |
| `federation/share-scope-mismatch`           | Rsbuild remote shares React on `legacy`                        |
| `shared/singleton-mismatch`                 | Host singleton vs Rspack non-singleton                         |

```bash
vp run demo:mixed-issues
```

After a build, inspect cross-project conflicts with explicit project facts:

```bash
node dist/cli.js federation \
  examples/mixed-federation-issues/host-vite/.mf/doctor/project.json \
  examples/mixed-federation-issues/remote-rspack/.mf/doctor/project.json \
  examples/mixed-federation-issues/remote-rsbuild/.mf/doctor/project.json \
  --format terminal
```
