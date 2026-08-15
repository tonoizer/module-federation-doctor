# One-rule CLI showcase

These setups are intentionally wrong so `mfdoctor check` / `mfdoctor federation`
/ `mfdoctor runtime` can demo **one rule (or a small combination) at a time**.
They are CLI fixtures, not bundler apps, and are not part of the green e2e path.

For per-bundler **build+MFDoctor** demos with visible findings, use
[`../standalone-findings`](../standalone-findings) (`vp run demo:standalone`).

Showcase fixtures prefer cases Module Federation plugins often allow through to
a build (or only warn about later). Rules that duplicate a hard plugin
failure—such as a missing `name`—stay in the catalog but are not demoed here.

## Config

| Directory                                     | Expected rule                           | Severity / note                                     |
| --------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `config/expose-key-invalid`                   | `config/expose-key-invalid`             | error                                               |
| `config/expose-path-missing`                  | `config/expose-path-missing`            | error                                               |
| `config/remote-entry-invalid`                 | `config/remote-entry-invalid`           | error                                               |
| `config/filename-invalid`                     | `config/filename-invalid`               | error                                               |
| `config/share-scope-undeclared`               | `config/share-scope-undeclared`         | error                                               |
| `config/remote-http-insecure`                 | `config/remote-http-insecure`           | warning                                             |
| `config/implementation-local`                 | _(none)_                                | local `implementation` does not fire                |
| `config/implementation-suspicious-suppressed` | _(none)_                                | `rules["config/implementation-suspicious"] = "off"` |
| `config/remote-localhost-in-production`       | `config/remote-localhost-in-production` | warning (CI mode)                                   |
| `config/remote-alias-prefix-collision`        | `config/remote-alias-prefix-collision`  | error                                               |
| `config/dts-output-dir-mismatch`              | `config/dts-output-dir-mismatch`        | warning                                             |

## Shared

| Directory                          | Expected rule                    | Severity / note                          |
| ---------------------------------- | -------------------------------- | ---------------------------------------- |
| `shared/eager-without-singleton`   | `shared/eager-without-singleton` | warning                                  |
| `shared/version-unsatisfied`       | `shared/version-unsatisfied`     | error                                    |
| `shared/singleton-risk`            | `shared/singleton-risk`          | warning                                  |
| `shared/singleton-risk-suppressed` | _(none)_                         | `rules["shared/singleton-risk"] = "off"` |
| `shared/unused`                    | `shared/unused`                  | warning                                  |
| `shared/unused-unresolved`         | `doctor/partial-analysis`        | no `shared/unused` (unresolved dynamics) |
| `shared/candidate`                 | `shared/candidate`               | info                                     |
| `shared/candidate-suppressed`      | _(none)_                         | `rules["shared/candidate"] = "off"`      |

## Reliability

| Directory                                   | Expected rule                               | Severity |
| ------------------------------------------- | ------------------------------------------- | -------- |
| `reliability/version-first-offline-remotes` | `reliability/version-first-offline-remotes` | warning  |
| `reliability/shared-import-false`           | `reliability/shared-import-false`           | warning  |

## Federation

Committed `.project.json` facts for `mfdoctor federation`:

| Directory                            | Expected rule                        | Severity |
| ------------------------------------ | ------------------------------------ | -------- |
| `federation/version-conflict`        | `federation/version-conflict`        | error    |
| `federation/share-scope-mismatch`    | `federation/share-scope-mismatch`    | error    |
| `federation/share-strategy-mismatch` | `federation/share-strategy-mismatch` | warning  |
| `federation/circular-remote-graph`   | `federation/circular-remote-graph`   | warning  |
| `federation/singleton-mismatch`      | `shared/singleton-mismatch`          | warning  |
| `federation/name-conflict`           | `federation/name-conflict`           | error    |
| `federation/missing-provider`        | `federation/missing-provider`        | error    |

## Runtime

| Directory                 | Expected                  | Exit |
| ------------------------- | ------------------------- | ---- |
| `runtime/green`           | no findings               | 0    |
| `runtime/shared-mismatch` | `runtime/shared-mismatch` | 1    |

```bash
vp run build
vp run demo:showcase
# or one at a time:
node dist/cli.js check examples/showcase/config/expose-key-invalid --ci --format terminal
node dist/cli.js federation "examples/showcase/federation/version-conflict/*.project.json" --format terminal
node dist/cli.js runtime examples/showcase/runtime/green/trace.json "examples/showcase/runtime/green/*.project.json" --format terminal
```

For a healthy multi-bundler app, use `examples/mixed-federation`.
For nested multi-bundler orchestration, use `examples/nested-federation`.
For a red multi-bundler combination, use `examples/mixed-federation-issues`.
For per-bundler standalone build findings, use `examples/standalone-findings`.
