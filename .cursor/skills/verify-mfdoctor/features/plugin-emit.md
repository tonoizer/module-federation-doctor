# Plugin emit

The post-emit build plugin (`federationDoctor` from `@tonoizer/mfdoctor/vite` and sibling adapters) is the primary MFDoctor DX. A production-style example build writes `.mf/doctor/project.json` (and usually `report.json`) after the bundler emit so CLI `check` / `workspace` can consume real facts.

## Sub-features

- `emit-register` registers `federationDoctor({ moduleFederation, … })` beside the Module Federation plugin.
- `emit-project-json` writes `.mf/doctor/project.json` after a successful build.
- `emit-findings` can leave intentional findings in `.mf/doctor/report.json` (red cells use `failOn: "never"` so the build still finishes).

## How to get to it (user POV)

- Add the matching adapter in a Vite/Rspack/Rsbuild/Webpack/Modern config (see `examples/standalone-findings/*/`).
- Build the example package, e.g. `vp run --filter @mfdoctor-standalone/vite build`.
- Or run the catalog script: `pnpm demo:standalone` (builds all four standalone cells).

## Driving it with the post-emit plugin

Preconditions:

- Doctor passed (`dist/cli.js` built).
- Example dependencies installed (`pnpm install` at repo root covers workspace packages).
- Start the build as a child process you own; record its PID.

- **Build one red cell.** Run `vp run --filter @mfdoctor-standalone/vite build` from the repo root (or an equivalent `pnpm`/`vp` filter build for another standalone cell).
- **Observe emit.** Confirm `examples/standalone-findings/vite/.mf/doctor/project.json` exists after the build exits.
- **Observe findings.** Read `.mf/doctor/report.json` and expect rule IDs such as `config/remote-http-insecure`, `config/remote-manifest-recommended`, and `reliability/version-first-offline-remotes` (see `examples/standalone-findings/README.md`).
- **Optional follow-up.** Run `node dist/cli.js check examples/standalone-findings/vite --format json --output -` and confirm findings align with the emitted report.
- **Proof.** Capture build command, exit code, and copies (or excerpts) of `project.json` / `report.json` keys under
  `.cursor/skills/verify-mfdoctor/evidence/plugin-emit/`. Prefer text excerpts over huge binaries.

## Gotchas

- Red cells intentionally set `failOn: "never"` so findings do not fail the bundler — still assert the report contents.
- Killing by process name is forbidden; only signal the PID you started if you must abort.
- Example builds can dirty `examples/**/.mf/` (gitignored). Clean those trees after proof if you want a pristine worktree; never delete skill `evidence/`.
- Do not invent new bundler adapters or scrape private MF plugin fields for verification.
