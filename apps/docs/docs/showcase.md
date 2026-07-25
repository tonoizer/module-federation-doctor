# Finding showcase

`examples/showcase` holds themed, intentional misconfigs. Run them with the CLI
to see the exact rule IDs Doctor reports:

```bash
pnpm demo:showcase
```

## Config

| Setup                   | Command                                                                       | Finding                                 |
| ----------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| Empty `name`            | `node dist/cli.js check examples/showcase/config/name-required --ci`          | `config/name-required` (error)          |
| Expose key without `./` | `node dist/cli.js check examples/showcase/config/expose-key-invalid --ci`     | `config/expose-key-invalid` (error)     |
| Missing expose path     | `node dist/cli.js check examples/showcase/config/expose-path-missing --ci`    | `config/expose-path-missing` (error)    |
| Invalid remote entry    | `node dist/cli.js check examples/showcase/config/remote-entry-invalid --ci`   | `config/remote-entry-invalid` (error)   |
| Invalid filename        | `node dist/cli.js check examples/showcase/config/filename-invalid --ci`       | `config/filename-invalid` (error)       |
| Undeclared share scope  | `node dist/cli.js check examples/showcase/config/share-scope-undeclared --ci` | `config/share-scope-undeclared` (error) |
| Insecure remote HTTP    | `node dist/cli.js check examples/showcase/config/remote-http-insecure --ci`   | `config/remote-http-insecure` (warning) |

## Shared

| Setup                   | Command                                                                        | Finding                                    |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| Eager without singleton | `node dist/cli.js check examples/showcase/shared/eager-without-singleton --ci` | `shared/eager-without-singleton` (warning) |
| Version unsatisfied     | `node dist/cli.js check examples/showcase/shared/version-unsatisfied --ci`     | `shared/version-unsatisfied` (error)       |
| Singleton risk          | `node dist/cli.js check examples/showcase/shared/singleton-risk --ci`          | `shared/singleton-risk` (warning)          |
| Unused shared           | `node dist/cli.js check examples/showcase/shared/unused --ci`                  | `shared/unused` (warning)                  |
| Shared candidate        | `node dist/cli.js check examples/showcase/shared/candidate --ci`               | `shared/candidate` (warning)               |

## Reliability

| Setup                         | Command                                                                                   | Finding                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Version-first offline remotes | `node dist/cli.js check examples/showcase/reliability/version-first-offline-remotes --ci` | `reliability/version-first-offline-remotes` (warning) |
| Shared `import: false`        | `node dist/cli.js check examples/showcase/reliability/shared-import-false --ci`           | `reliability/shared-import-false` (warning)           |

## Federation

| Setup                | Command                                                                                          | Finding                                   |
| -------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Version conflict     | `node dist/cli.js federation "examples/showcase/federation/version-conflict/*.project.json"`     | `federation/version-conflict` (error)     |
| Share scope mismatch | `node dist/cli.js federation "examples/showcase/federation/share-scope-mismatch/*.project.json"` | `federation/share-scope-mismatch` (error) |
| Singleton mismatch   | `node dist/cli.js federation "examples/showcase/federation/singleton-mismatch/*.project.json"`   | `shared/singleton-mismatch` (warning)     |
| Name conflict        | `node dist/cli.js federation "examples/showcase/federation/name-conflict/*.project.json"`        | `federation/name-conflict` (error)        |
| Missing provider     | `node dist/cli.js federation "examples/showcase/federation/missing-provider/*.project.json"`     | `federation/missing-provider` (error)     |

## Runtime

| Setup           | Command                                                                                                                                    | Finding                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Healthy trace   | `node dist/cli.js runtime examples/showcase/runtime/green/trace.json "examples/showcase/runtime/green/*.project.json"`                     | no findings (exit 0)              |
| Shared mismatch | `node dist/cli.js runtime examples/showcase/runtime/shared-mismatch/trace.json "examples/showcase/runtime/shared-mismatch/*.project.json"` | `runtime/shared-mismatch` (error) |

These directories are demo fixtures, not runnable apps. Keep
[mixed federation](./mixed-example.md) for the healthy multi-bundler path and
[mixed federation issues](./mixed-issues-example.md) for a red combination.
