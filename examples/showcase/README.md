# Finding showcases

These configs are intentionally wrong so `mfdoctor check` can demo real
findings. They are not apps and are not part of the green e2e path.

| Directory                 | Expected rule                    | Severity |
| ------------------------- | -------------------------------- | -------- |
| `name-required`           | `config/name-required`           | error    |
| `expose-key-invalid`      | `config/expose-key-invalid`      | error    |
| `eager-without-singleton` | `shared/eager-without-singleton` | warning  |

```bash
pnpm build
pnpm demo:showcase
# or one at a time:
node dist/cli.js check examples/showcase/name-required --ci --format terminal
```

For a healthy multi-bundler app, use `examples/mixed-federation`.
