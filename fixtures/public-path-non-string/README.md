# `artifact/public-path-non-string-manifest`

Public non-string `publicPath` values used by adapter unit tests.

- `vite.ts` — Vite MF `publicPath` as a function (not bundler `output.publicPath`).
- `rsbuild.ts` — Rsbuild public `output.publicPath` as a function.

These are plugin-emit fixtures. CLI `check` cannot invent `bundler.outputPublicPathKind`.
