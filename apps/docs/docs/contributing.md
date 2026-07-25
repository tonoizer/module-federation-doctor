# Contributing

Use Node `>=22.12.0` and pnpm 11. Run `pnpm install
--frozen-lockfile`, then `pnpm check`. Add behavior tests for rules and adapters.
Run `pnpm changeset` for a public package change.

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

## Roadmap

- **[v1.0](https://github.com/tonoizer/module-federation-doctor/milestone/1)** —
  governance-ready Doctor (Webpack + CI federation gate + policy packs +
  baselines + dynamic-import completeness + compatibility matrix + npm
  publish). Epic:
  [#30](https://github.com/tonoizer/module-federation-doctor/issues/30).
- **[post-v1](https://github.com/tonoizer/module-federation-doctor/milestone/2)** —
  later adapters (Rolldown / Vite Plus / Modern.js). Not release blockers for
  v1.0 or the upstream maintainer conversation.

Close the matching GitHub issue and drop the row from
[limitations](./limitations.md) when work ships.

### v1.0

| ID             | Issue                                                                 | Topic                                                                                                                                 |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `MFDOCTOR-101` | [#10](https://github.com/tonoizer/module-federation-doctor/issues/10) | Webpack adapter                                                                                                                       |
| `MFDOCTOR-105` | [#14](https://github.com/tonoizer/module-federation-doctor/issues/14) | Dynamic-import completeness beyond static analysis _(shipped — see [capabilities](./capabilities.md#dynamic-import-completeness-v1))_ |
| `MFDOCTOR-106` | [#15](https://github.com/tonoizer/module-federation-doctor/issues/15) | Compatibility matrix for v1 bundlers and runtimes _(shipped — see [compatibility](./compatibility.md))_                               |
| `MFDOCTOR-109` | [#25](https://github.com/tonoizer/module-federation-doctor/issues/25) | One-shot workspace federation gate for CI                                                                                             |
| `MFDOCTOR-110` | [#26](https://github.com/tonoizer/module-federation-doctor/issues/26) | Shareable policy packs and named presets                                                                                              |
| `MFDOCTOR-111` | [#27](https://github.com/tonoizer/module-federation-doctor/issues/27) | Fingerprint baselines and suppressions                                                                                                |
| `MFDOCTOR-115` | [#32](https://github.com/tonoizer/module-federation-doctor/issues/32) | Build-time only / never in client bundle                                                                                              |
| `MFDOCTOR-117` | [#34](https://github.com/tonoizer/module-federation-doctor/issues/34) | Runtime-only MF (no bundler plugin) out of scope                                                                                      |
| `MFDOCTOR-112` | [#28](https://github.com/tonoizer/module-federation-doctor/issues/28) | First public npm publish _(after product items)_                                                                                      |
| `MFDOCTOR-113` | [#29](https://github.com/tonoizer/module-federation-doctor/issues/29) | Propose Doctor to official MF org _(after publish)_                                                                                   |

### post-v1

| ID             | Issue                                                                 | Topic                                          |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| `MFDOCTOR-102` | [#11](https://github.com/tonoizer/module-federation-doctor/issues/11) | Rolldown and Vite Plus lifecycle coverage      |
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
