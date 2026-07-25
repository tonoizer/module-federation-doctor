# Finding showcases

These configs are intentionally wrong so `mfdoctor check` can demo real
findings. They are not apps and are not part of the green e2e path.

Showcase fixtures target cases Module Federation plugins often allow through
to a build (or only warn about later). Rules that duplicate a hard plugin
failure—such as a missing `name`—stay in the catalog but are not demoed here.

| Directory                 | Expected rule                    | Severity |
| ------------------------- | -------------------------------- | -------- |
| `expose-key-invalid`      | `config/expose-key-invalid`      | error    |
| `eager-without-singleton` | `shared/eager-without-singleton` | warning  |

```bash
pnpm build
pnpm demo:showcase
# or one at a time:
node dist/cli.js check examples/showcase/expose-key-invalid --ci --format terminal
```

For a healthy multi-bundler app, use `examples/mixed-federation`.
