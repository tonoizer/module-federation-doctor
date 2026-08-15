# MFDoctor Contributing Guide

Thanks for your interest in contributing. New contributors are welcome. Read
the [Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

## Sending a pull request

1. Create a focused branch from `main` (`feat/`, `fix/`, `docs/`, or similar).
2. Make the smallest change that solves the problem.
3. Add or update tests when behavior changes.
4. Run the relevant checks and make sure CI passes.
5. Open a concise PR with a clear summary, related issue, and test results.

## Setup

The repository requires Node `>=22.12.0`. Install [Vite+](https://viteplus.dev/guide/)
once; it selects the repository's Node.js, package manager, and toolchain versions.

```bash
vp install
vp pack
vp exec playwright install chromium
```

## Testing

Run focused checks while working:

```bash
vp fmt --check
vp lint --deny-warnings
vp test run test/unit
vp test run test/integration
```

Use `vp run <script>` for repository tasks, `vp run --filter <package> <script>`
for workspace tasks, and `vp exec <binary>` for local tools. Use `vp add` and
`vp remove` when changing dependencies; the pinned pnpm policy is an implementation
detail of the Vite+ setup.

Before submitting a PR, run the full repository check:

```bash
vp run check
```

`vp run demo:showcase` is a release gate for the one-rule CLI fixtures under
`examples/showcase`. Per-bundler build and MFDoctor demos live under
`examples/standalone-findings`; keep them current when adapter wiring or
catchable configuration rules change.

## Adapter contract

MFDoctor is plugin-primary and CLI-complementary. Bundler adapters run after emit
in Node and must never inject MFDoctor into browser assets.

When adding or extending an adapter:

- pass through the public Module Federation options supplied by the app;
- collect facts from emitted manifests, stats, and other public build outputs;
- record capabilities honestly when optional evidence is unavailable;
- do not scrape undocumented private plugin fields or instance state.

## Research sources

Use primary sources when changing a rule or describing upstream behavior:

- [Module Federation configuration](https://module-federation.io/configure/index.html)
- [Core option types](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types/plugins/ModuleFederationPlugin.ts)
- [Manifest and stats types](https://github.com/module-federation/core/tree/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types)
- [Runtime snapshots](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/runtime-core/src/plugins/snapshot/SnapshotHandler.ts)
- [Vite option normalization](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/src/utils/normalizeModuleFederationOptions.ts)
- [Vite integration](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/src/index.ts)
- [Observability Plugin](https://module-federation.io/plugin/plugins/observability-plugin)

Record the upstream commit when using a local clone. Do not treat dirty files
or fork-only branches as official behavior.

## Changesets

If a change affects the published `@tonoizer/mfdoctor` package, add a changeset
with `vp run changeset` and commit the generated file. Documentation, test-only,
and repository-maintenance changes normally do not need one.

The maintainer release flow lives in [RELEASING.md](./RELEASING.md).

For bugs, use the [bug report template][bug]. For security issues, follow the
[security policy][security] and do not open a public issue. General questions
belong in the [Discord community][discord].

[bug]: https://github.com/tonoizer/module-federation-doctor/issues/new?template=bug_report.yml
[discord]: https://discord.gg/VYtDGFmgVN
[security]: ./SECURITY.md
