# Finding showcases

These setups are intentionally wrong so `mfdoctor check` / `mfdoctor federation`
can demo real findings. They are not apps and are not part of the green e2e path.

Showcase fixtures prefer cases Module Federation plugins often allow through to
a build (or only warn about later). Rules that duplicate a hard plugin
failure—such as a missing `name`—stay in the catalog but are not demoed here.

## Config

| Directory                       | Expected rule                   | Severity |
| ------------------------------- | ------------------------------- | -------- |
| `config/expose-key-invalid`     | `config/expose-key-invalid`     | error    |
| `config/expose-path-missing`    | `config/expose-path-missing`    | error    |
| `config/remote-entry-invalid`   | `config/remote-entry-invalid`   | error    |
| `config/filename-invalid`       | `config/filename-invalid`       | error    |
| `config/share-scope-undeclared` | `config/share-scope-undeclared` | error    |
| `config/remote-http-insecure`   | `config/remote-http-insecure`   | warning  |

## Shared

| Directory                        | Expected rule                    | Severity |
| -------------------------------- | -------------------------------- | -------- |
| `shared/eager-without-singleton` | `shared/eager-without-singleton` | warning  |
| `shared/version-unsatisfied`     | `shared/version-unsatisfied`     | error    |
| `shared/singleton-risk`          | `shared/singleton-risk`          | warning  |
| `shared/unused`                  | `shared/unused`                  | warning  |
| `shared/candidate`               | `shared/candidate`               | warning  |

## Reliability

| Directory                                   | Expected rule                               | Severity |
| ------------------------------------------- | ------------------------------------------- | -------- |
| `reliability/version-first-offline-remotes` | `reliability/version-first-offline-remotes` | warning  |
| `reliability/shared-import-false`           | `reliability/shared-import-false`           | warning  |

## Federation

Committed `.project.json` facts for `mfdoctor federation`:

| Directory                         | Expected rule                     | Severity |
| --------------------------------- | --------------------------------- | -------- |
| `federation/version-conflict`     | `federation/version-conflict`     | error    |
| `federation/share-scope-mismatch` | `federation/share-scope-mismatch` | error    |
| `federation/singleton-mismatch`   | `shared/singleton-mismatch`       | warning  |
| `federation/name-conflict`        | `federation/name-conflict`        | error    |
| `federation/missing-provider`     | `federation/missing-provider`     | error    |

## Runtime

| Directory                 | Expected                  | Exit |
| ------------------------- | ------------------------- | ---- |
| `runtime/green`           | no findings               | 0    |
| `runtime/shared-mismatch` | `runtime/shared-mismatch` | 1    |

```bash
pnpm build
pnpm demo:showcase
# or one at a time:
node dist/cli.js check examples/showcase/config/expose-key-invalid --ci --format terminal
node dist/cli.js federation "examples/showcase/federation/version-conflict/*.project.json" --format terminal
node dist/cli.js runtime examples/showcase/runtime/green/trace.json "examples/showcase/runtime/green/*.project.json" --format terminal
```

For a healthy multi-bundler app, use `examples/mixed-federation`.
For nested multi-bundler orchestration, use `examples/nested-federation`.
For a red multi-bundler combination, use `examples/mixed-federation-issues`.
