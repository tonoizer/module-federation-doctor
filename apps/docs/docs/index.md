# Module Federation Doctor

Module Federation Doctor finds config, shared dependency, and emitted artifact
problems in Vite, Rspack, and Rsbuild projects. It runs locally, produces stable
machine-readable reports, and stays offline by default. The separate `probe`
command uses the network only when you ask it to inspect a deployed manifest.

Start with [adapter setup](./setup.md), then add the [CI command](./cli.md).
Use the [production audit](./production-readiness.md) to choose config,
performance, runtime, and deployment checks.
