# Rolldown / Vite Plus compatibility smoke

Exercises `@tonoizer/mfdoctor/vite` on a Vite Plus production build — the same
entry as classic Vite. The cell aliases `vite` to
`@voidzero-dev/vite-plus-core` and declares `vite-plus` so MFDoctor records
`bundler.lifecycle.flavor: "vite-plus"` / `engine: "rolldown"`. The smoke
build (`build.mjs`) calls Vite Plus's programmatic `build()` — Vite Plus does
not ship a `vite` CLI binary.

Rolldown may finish disk writes after an empty `writeBundle`. MFDoctor then
scans the known output root at `closeBundle` and marks that emit evidence
partial. Agents should treat `postEmitHook: "closeBundle"` plus
`doctor/partial-analysis` as the honest Rolldown path, not a missing adapter.

This is **Vite Plus production emit** evidence — enough for a **partial**
matrix cell, not a full **supported** claim. `report.status` keeps
`partial-bundler` for this lifecycle. Direct Rolldown without
`@module-federation/vite` stays unsupported.
