# Finding showcase

`examples/showcase` holds small, intentional misconfigs. Run them with the CLI
to see the exact rule IDs Doctor reports:

```bash
pnpm demo:showcase
```

| Setup                          | Command                                                                 | Finding                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| Empty `name`                   | `node dist/cli.js check examples/showcase/name-required --ci`           | `config/name-required` (error)             |
| Expose key without `./`        | `node dist/cli.js check examples/showcase/expose-key-invalid --ci`      | `config/expose-key-invalid` (error)        |
| Eager shared without singleton | `node dist/cli.js check examples/showcase/eager-without-singleton --ci` | `shared/eager-without-singleton` (warning) |

These directories are demo fixtures, not runnable apps. Keep
[mixed federation](./mixed-example.md) for the healthy multi-bundler path.
