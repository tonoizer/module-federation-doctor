# Vite+ command inventory

This repository uses Vite+ as the contributor-facing command interface. The
inventory below records the boundary between commands migrated to `vp`, commands
that intentionally retain pnpm, and historical or consumer-facing text that
must preserve its original provenance.

## Migrated to Vite+

- Root and workspace `package.json` scripts use `vp run` for scripts, `vp run
--filter` for workspace selection, `vp run --filter . build` for root-only
  package builds, and `vp exec` for local binaries. The root filter matters:
  a bare `vp run build` schedules every workspace build and can load example
  configs before the root package has produced its exported `dist` files.
- The Husky pre-commit hook uses `vp run`.
- CI workflows use `vp run` and `vp exec` after `.github/actions/setup-vp`,
  whose clean-checkout bootstrap runs `vp pack` before Vite+ discovers workspace
  task configs.
- `scripts/demo-*.mjs`, `scripts/giga-smoke.mjs`,
  `scripts/verify-compatibility-matrix.mjs`, `scripts/run-e2e.mjs`,
  `test/integration/adapters.test.ts`, and `playwright.config.ts` use Vite+
  task or executable dispatch.
- `CONTRIBUTING.md`, the root development section in `README.md`, and the E2E
  and benchmark runbooks show Vite+ commands.

## Intentionally retained pnpm

- `package.json`'s `packageManager` and `engines.pnpm`, `pnpm-lock.yaml`, and
  `pnpm-workspace.yaml` are the pinned package-manager policy consumed by Vite+.
- `.github/actions/setup-vp/action.yml` enables the pinned pnpm shim so Vercel
  and low-level package operations retain a deterministic fallback, then runs
  `vp pack` so local package exports exist before workspace task discovery.
- `vercel.json` keeps `pnpm install --frozen-lockfile` and the pnpm build command
  until a Vercel preview proves that the global `vp` shim is available there.
- `scripts/pack-check.mjs` uses pnpm for tarball creation and the isolated
  temporary consumer. Its `--dir` install/run flow and workspace-root lookup are
  package-manager operations without an equivalent Vite+ task selection.
- `.github/workflows/release-files.yml` uses pnpm for the low-level release
  tarball operation; the build itself uses `vp run`.
- `.github/workflows/pkg-pr-new.yml` uses `pnpm dlx` for the external
  `pkg-pr-new` CLI because Vite+ has no `dlx` command.
- `scripts/capture-runtime-devtools-partial.mjs` runs inside a separate pinned
  upstream checkout, so it uses that checkout's package manager rather than the
  MFDoctor workspace toolchain.

## Historical or consumer-facing pnpm

- `fixtures/**` provenance and evidence records preserve the commands that
  produced upstream evidence; changing them would rewrite history rather than
  migrate this repository.
- `CHANGELOG.md` preserves release-era wording.
- Published-package README, docs, and example snippets retain pnpm where they
  document a consumer's package-manager choice or the monorepo compatibility
  contract. The repository's contributor instructions use Vite+.
