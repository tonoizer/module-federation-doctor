# Contributing

Use Node `>=22.12.0` and pnpm 11. Run `pnpm install
--frozen-lockfile`, then `pnpm check`. Add behavior tests for rules and adapters.
Run `pnpm changeset` for a public package change.

For mixed-federation Playwright flake triage, see
[`test/e2e/README.md`](https://github.com/tonoizer/module-federation-doctor/blob/main/test/e2e/README.md).

## Release gates

`pnpm demo:showcase` (`scripts/demo-showcase.mjs`) is a release gate: it runs
~20 one-rule CLI fixtures under `examples/showcase` (config, shared, federation,
and runtime) and asserts each fixture’s expected `ruleId` and exit code. The
[Integration workflow](https://github.com/tonoizer/module-federation-doctor/blob/main/.github/workflows/integration.yml)
runs the same script on every PR and on `main`. When a case fails, the log line
names the fixture path (or glob), the expected `ruleId`, and the actual vs
expected exit code.

Per-bundler build+Doctor demos live under `examples/standalone-findings`
(`pnpm demo:standalone`). They are not a release gate yet; keep them in sync when
adapter wiring or catchable shared/config rules change.

Add or update a showcase fixture when you ship or change a rule that needs a
human-readable demo. Keep runtime cases (`examples/showcase/runtime/green` and
`shared-mismatch`) in the script so `mfdoctor runtime` regressions are caught in
CI.

## Architecture notes

When adding or extending a bundler adapter:

- Pass through the same public MF options object the app gives Module Federation.
- Collect facts from emitted manifests, stats, and other public build outputs.
- Record [capabilities](./capabilities.md) honestly when optional input is
  missing.
- Do **not** scrape undocumented private Module Federation plugin fields or
  private plugin instance state to fill gaps.

This permanent non-goal is documented under
[limitations](./limitations.md#permanent-guarantees--non-goals).

## Agent skills

Doctor-specific agent UX prefers the build plugin / CLI finding output (rule
id, message, fix, Doctor rule docs URL, official `module-federation.io`
sources, and reliable exit codes). There is no Codex `mfdoctor` skill.

For Module Federation concepts (config, runtime, shared deps, observability),
use [`.agents/skills/mf`](https://github.com/tonoizer/module-federation-doctor/tree/main/.agents/skills/mf)
(from `module-federation/agent-skills`). When changing a Doctor rule or
claiming upstream behavior, start from the [source map](./sources.md).

## Roadmap

- **[v1.0](https://github.com/tonoizer/module-federation-doctor/milestone/1)** —
  governance-ready Doctor (CI federation gate + policy packs +
  baselines + dynamic-import completeness + compatibility matrix + npm
  publish). Epic:
  [#30](https://github.com/tonoizer/module-federation-doctor/issues/30).
- **[post-v1](https://github.com/tonoizer/module-federation-doctor/milestone/2)** —
  later adapters (Modern.js). Not release blockers for
  v1.0 or the upstream maintainer conversation.

Close the matching GitHub issue and drop the row from
[limitations](./limitations.md) when work ships.

### v1.0

| ID             | Issue                                                                 | Topic                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MFDOCTOR-101` | [#10](https://github.com/tonoizer/module-federation-doctor/issues/10) | Webpack adapter _(shipped — see [setup](./setup.md#webpack))_                                                                                                                     |
| `MFDOCTOR-102` | [#11](https://github.com/tonoizer/module-federation-doctor/issues/11) | Rolldown and Vite Plus lifecycle coverage _(shipped as **partial** — see [compatibility](./compatibility.md) / [Vite integration](./vite-integration.md#rolldown-and-vite-plus))_ |
| `MFDOCTOR-105` | [#14](https://github.com/tonoizer/module-federation-doctor/issues/14) | Dynamic-import completeness beyond static analysis _(shipped — see [capabilities](./capabilities.md#dynamic-import-completeness-v1))_                                             |
| `MFDOCTOR-106` | [#15](https://github.com/tonoizer/module-federation-doctor/issues/15) | Compatibility matrix for v1 bundlers and runtimes _(shipped — see [compatibility](./compatibility.md))_                                                                           |
| `MFDOCTOR-109` | [#25](https://github.com/tonoizer/module-federation-doctor/issues/25) | One-shot workspace federation gate for CI _(shipped — see [CLI](./cli.md#workspace-federation-gate) / [setup](./setup.md#multi-app-ci-loop))_                                     |
| `MFDOCTOR-110` | [#26](https://github.com/tonoizer/module-federation-doctor/issues/26) | Shareable policy packs and named presets _(shipped — see [policy packs](./policy-packs.md))_                                                                                      |
| `MFDOCTOR-111` | [#27](https://github.com/tonoizer/module-federation-doctor/issues/27) | Fingerprint baselines and suppressions _(shipped)_                                                                                                                                |
| `MFDOCTOR-127` | [#55](https://github.com/tonoizer/module-federation-doctor/issues/55) | Wire showcase demos into PR CI _(shipped — see [showcase](./showcase.md) and release gates above)_                                                                                |
| `MFDOCTOR-125` | [#53](https://github.com/tonoizer/module-federation-doctor/issues/53) | Slim or remove Codex mfdoctor skill once CLI is agent-complete _(shipped — skill removed; see [Agent skills](#agent-skills) / [sources](./sources.md))_                           |
| `MFDOCTOR-115` | [#32](https://github.com/tonoizer/module-federation-doctor/issues/32) | Build-time only / never in client bundle                                                                                                                                          |
| `MFDOCTOR-117` | [#34](https://github.com/tonoizer/module-federation-doctor/issues/34) | Runtime-only MF (no bundler plugin) out of scope                                                                                                                                  |
| `MFDOCTOR-112` | [#28](https://github.com/tonoizer/module-federation-doctor/issues/28) | First public npm publish _(after product items)_                                                                                                                                  |
| `MFDOCTOR-113` | [#29](https://github.com/tonoizer/module-federation-doctor/issues/29) | Propose Doctor to official MF org _(after publish)_                                                                                                                               |

### post-v1

| ID             | Issue                                                                 | Topic                                          |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| `MFDOCTOR-103` | [#12](https://github.com/tonoizer/module-federation-doctor/issues/12) | Modern.js adapter without hiding direct Rspack |

`MFDOCTOR-104` / [#13](https://github.com/tonoizer/module-federation-doctor/issues/13)
(HTML analysis UI) was closed as not planned — Doctor does not ship an HTML
dashboard.

`MFDOCTOR-116` / [#33](https://github.com/tonoizer/module-federation-doctor/issues/33)
(in-browser Doctor runtime agent) was closed as not planned — Doctor stays
build/CI-only and must not add bundle size or runtime cost. Adapters must not
add `transform` / `load` / `banner` hooks that inject Doctor into assets.

Permanent non-goals (documented under
[limitations](./limitations.md#permanent-guarantees--non-goals)): no
undocumented private Module Federation plugin fields
([#18](https://github.com/tonoizer/module-federation-doctor/issues/18));
build-time-only Doctor
([#32](https://github.com/tonoizer/module-federation-doctor/issues/32)).
