# Plugin emit

The post-emit build plugin is the primary MFDoctor DX. Vite registers
`federationDoctor` from `@tonoizer/mfdoctor/vite`; sibling adapters export
bundler-idiomatic names (`ModuleFederationDoctorPlugin` / webpack,
`moduleFederationDoctorPlugin` / rspack+modern,
`pluginModuleFederationDoctor` / rsbuild). A production-style example build
writes `.mf/doctor/project.json` (and usually `report.json`) after the bundler
emit so CLI `check` / `workspace` can consume real facts.

## Sub-features

- `emit-register` registers the matching adapter beside the Module Federation plugin (Vite: `federationDoctor({ moduleFederation, … })`).
- `emit-project-json` writes `.mf/doctor/project.json` after a successful build.
- `emit-findings` can leave intentional findings in `.mf/doctor/report.json` (red cells use `failOn: "never"` so the build still finishes).

## How to get to it (user POV)

- Add the matching adapter in a Vite/Rspack/Rsbuild/Webpack config under `examples/standalone-findings/{vite,webpack,rspack,rsbuild}/`. Modern red emit is the documented partial stub at `examples/standalone-findings/modern/` (same `modifyBundlerChain` afterEmit path as the green smoke in `examples/compatibility/modern/`; matrix status stays partial). Nuxt lives under `examples/compatibility/nuxt/`.
- Build the example package, e.g. `pnpm exec vp run --filter @mfdoctor-standalone/vite build` (bare `vp` needs `node_modules/.bin` on `PATH`). Modern: `pnpm exec vp run --filter @mfdoctor-standalone/modern build`.
- Or run the catalog script: `pnpm demo:standalone` (builds all five standalone cells).
- Vite Plus package smoke (partial Rolldown) lives at `examples/compatibility/rolldown`, not under `examples/standalone-findings/vite`.

## Driving it with the post-emit plugin

Preconditions:

- Doctor passed (`dist/cli.js` built).
- Example dependencies installed (`pnpm install` at repo root covers workspace packages).
- Start the build as a child process you own; record its PID.

- **Build one red cell.** Run `pnpm exec vp run --filter @mfdoctor-standalone/vite build` from the repo root (or an equivalent filter build for another standalone cell).
- **Observe emit.** Confirm `examples/standalone-findings/vite/.mf/doctor/project.json` exists after the build exits.
- **Observe findings.** Read `.mf/doctor/report.json` and expect rule IDs such as `config/remote-http-insecure`, `config/remote-manifest-recommended`, and `reliability/version-first-offline-remotes` (see `examples/standalone-findings/README.md`). The emit report is the source of truth for this feature.
- **Optional follow-up.** Run `node dist/cli.js check examples/standalone-findings/vite --format json --output - --no-write`. Static CLI `check` re-analyzes config/source; it does **not** replay the plugin report. Expect `status.incompleteReasons` to still include `missing-emit`. This cell has no `mfdoctor.config`, so static check defaults `bundler` to `unknown` and typically also includes `partial-bundler` — that is not a replay of emit `bundler.lifecycle.flavor`. On this Vite 8 cell the emit file records `rolldown-vite` (`vite@8.x` Rolldown engine, not the `vite-plus` package). Prove `vite-plus` at `examples/compatibility/rolldown` if that path is in scope. Remote findings may differ (e.g. `config/remote-entry-invalid` instead of `config/remote-http-insecure` / `config/remote-manifest-recommended`). Do not require an identical `ruleId` set.
- **Proof.** Capture build command, exit code, and copies (or excerpts) of `project.json` / `report.json` keys under
  `.cursor/skills/verify-mfdoctor/evidence/plugin-emit/`. Prefer text excerpts over huge binaries.

## Gotchas

- Red cells intentionally set `failOn: "never"` so findings do not fail the bundler — still assert the report contents.
- Killing by process name is forbidden; only signal the PID you started if you must abort.
- Example builds can dirty `examples/**/.mf/` (gitignored). Clean those trees after proof if you want a pristine worktree; never delete skill `evidence/`.
- Do not invent new bundler adapters or scrape private MF plugin fields for verification.
- A green or overlapping CLI `check` after the build is not required to prove emit — prefer `.mf/doctor/report.json` from the adapter build.
- `--output -` without `--no-write` still writes `.mf/doctor/project.json` and replaces emit facts with static-check facts (`bundler.name` `unknown`). Keep `--no-write` when the emit artifacts are the proof.
